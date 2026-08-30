import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  buildToolDescriptors,
  isWebMCPAvailable,
  registerWebMCPTools,
} from "../webmcp/adapter";
import { createTaskService } from "../services/taskService";

/**
 * Install a minimal mock for `document.modelContext`. The Chrome
 * implementation requires a real browser with the origin trial or
 * the chrome://flags entry; in tests we stand in a fake.
 */
function installMockModelContext() {
  type Registered = {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
    annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean };
    execute: (input: unknown) => Promise<string>;
    signal?: AbortSignal;
  };
  const registered: Registered[] = [];
  const tool = {
    registerTool: vi.fn(async (t: Registered, options?: { signal?: AbortSignal }) => {
      if (options?.signal) {
        options.signal.addEventListener("abort", () => {
          const idx = registered.indexOf(t);
          if (idx >= 0) registered.splice(idx, 1);
        });
      }
      registered.push(t);
    }),
  };
  Object.defineProperty(document, "modelContext", {
    configurable: true,
    value: tool,
  });
  return { registered, tool };
}

const TOOL_NAMES = [
  "complete_task",
  "create_task",
  "get_project_summary",
  "list_tasks",
  "update_task",
] as const;

describe("webmcp adapter", () => {
  beforeEach(() => {
    delete (document as Document & { modelContext?: unknown }).modelContext;
    localStorage.clear();
  });

  it("reports WebMCP unavailable when document.modelContext is absent", () => {
    expect(isWebMCPAvailable()).toBe(false);
  });

  it("returns null when document.modelContext is missing", async () => {
    const result = await registerWebMCPTools(createTaskService());
    expect(result).toBeNull();
  });

  it("registers all five tools when document.modelContext is present", async () => {
    const { tool } = installMockModelContext();
    const service = createTaskService();
    const handle = await registerWebMCPTools(service);
    expect(handle).not.toBeNull();
    expect(tool.registerTool).toHaveBeenCalledTimes(TOOL_NAMES.length);
    expect(handle?.tools.map((t) => t.name).slice().sort()).toEqual(
      [...TOOL_NAMES].sort(),
    );
    handle?.abort();
  });

  it("list_tasks tool returns the current tasks", async () => {
    installMockModelContext();
    const service = createTaskService();
    const handle = await registerWebMCPTools(service);
    const descriptors = buildToolDescriptors(service);
    const list = descriptors.find((d) => d.name === "list_tasks")!;
    service.createTask({ title: "Existing" }, { actor: "human" });
    const raw = await list.execute({});
    expect(JSON.parse(raw).tasks).toHaveLength(1);
    expect(JSON.parse(raw).tasks[0].title).toBe("Existing");
    handle?.abort();
  });

  it("create_task tool routes through the shared service (agent attribution)", async () => {
    installMockModelContext();
    const service = createTaskService();
    const handle = await registerWebMCPTools(service);
    const descriptors = buildToolDescriptors(service);
    const create = descriptors.find((d) => d.name === "create_task")!;
    const result = await create.execute({ title: "From agent" });
    const parsed = JSON.parse(result);
    expect(parsed.task.title).toBe("From agent");
    expect(service.getState().tasks[0].createdBy).toBe("agent");
    handle?.abort();
  });

  it("create_task tool surfaces validation errors as structured output", async () => {
    installMockModelContext();
    const service = createTaskService();
    const handle = await registerWebMCPTools(service);
    const create = buildToolDescriptors(service).find(
      (d) => d.name === "create_task",
    )!;
    const result = await create.execute({ title: "" });
    expect(JSON.parse(result)).toHaveProperty("error");
    handle?.abort();
  });

  it("update_task tool changes fields, records activity, and never writes no-op activity", async () => {
    installMockModelContext();
    const service = createTaskService();
    const handle = await registerWebMCPTools(service);
    const descriptors = buildToolDescriptors(service);
    const create = descriptors.find((d) => d.name === "create_task")!;
    const update = descriptors.find((d) => d.name === "update_task")!;

    const created = JSON.parse(await create.execute({ title: "Original" })).task;
    const before = service.getState().activity.length;

    // No-op update: same title the task already has.
    const noop = JSON.parse(
      await update.execute({ id: created.id, title: "Original" }),
    );
    expect(noop.noOp).toBe(true);
    expect(noop.changed).toBe(false);
    expect(service.getState().activity.length).toBe(before);

    // Real update: change status.
    const real = JSON.parse(
      await update.execute({ id: created.id, status: "doing" }),
    );
    expect(real.noOp).toBe(false);
    expect(real.changed).toBe(true);
    expect(real.task.status).toBe("doing");
    expect(real.task.createdBy).toBe("agent");
    expect(service.getState().activity.length).toBe(before + 1);
    expect(service.getState().activity[0].kind).toBe("updated");
    expect(service.getState().activity[0].actor).toBe("agent");

    handle?.abort();
  });

  it("update_task tool fails safely on unknown id and invalid status", async () => {
    installMockModelContext();
    const service = createTaskService();
    const handle = await registerWebMCPTools(service);
    const update = buildToolDescriptors(service).find(
      (d) => d.name === "update_task",
    )!;

    const unknownId = JSON.parse(await update.execute({ id: "nope", title: "X" }));
    expect(unknownId).toHaveProperty("error");
    expect(unknownId.error).toMatch(/not found/i);

    const created = service.createTask({ title: "T" }, { actor: "human" });
    const badStatus = JSON.parse(
      await update.execute({ id: created.id, status: "archived" as never }),
    );
    expect(badStatus).toHaveProperty("error");
    expect(badStatus.error).toMatch(/invalid status/i);

    handle?.abort();
  });

  it("complete_task is idempotent: alreadyDone: true on second call, activity recorded once", async () => {
    installMockModelContext();
    const service = createTaskService();
    const handle = await registerWebMCPTools(service);
    const descriptors = buildToolDescriptors(service);
    const complete = descriptors.find((d) => d.name === "complete_task")!;

    const created = service.createTask({ title: "Closable" }, { actor: "human" });
    const before = service.getState().activity.length;

    const first = JSON.parse(await complete.execute({ id: created.id }));
    expect(first.alreadyDone).toBe(false);
    expect(first.task.status).toBe("done");
    expect(service.getState().activity.length).toBe(before + 1);

    const second = JSON.parse(await complete.execute({ id: created.id }));
    expect(second.alreadyDone).toBe(true);
    expect(second.task.status).toBe("done");
    // No additional activity event recorded.
    expect(service.getState().activity.length).toBe(before + 1);

    handle?.abort();
  });

  it("complete_task fails safely on unknown id", async () => {
    installMockModelContext();
    const handle = await registerWebMCPTools(createTaskService());
    const complete = buildToolDescriptors(createTaskService()).find(
      (d) => d.name === "complete_task",
    )!;
    const result = JSON.parse(await complete.execute({ id: "missing" }));
    expect(result).toHaveProperty("error");
    expect(result.error).toMatch(/not found/i);
    handle?.abort();
  });

  it("get_project_summary reflects the current shared state", async () => {
    installMockModelContext();
    const service = createTaskService();
    const handle = await registerWebMCPTools(service);
    const descriptors = buildToolDescriptors(service);
    const create = descriptors.find((d) => d.name === "create_task")!;
    const complete = descriptors.find((d) => d.name === "complete_task")!;
    const summary = descriptors.find(
      (d) => d.name === "get_project_summary",
    )!;

    const empty = JSON.parse(await summary.execute({}));
    expect(empty).toMatchObject({ total: 0, byStatus: { todo: 0, doing: 0, done: 0 }, percentComplete: 0 });

    const a = JSON.parse(await create.execute({ title: "A" })).task;
    const b = JSON.parse(await create.execute({ title: "B" })).task;
    await complete.execute({ id: a.id });

    const after = JSON.parse(await summary.execute({}));
    expect(after.total).toBe(2);
    expect(after.byStatus).toMatchObject({ todo: 1, doing: 0, done: 1 });
    expect(after.percentComplete).toBe(50);
    expect(typeof after.lastUpdatedAt).toBe("number");
    expect(after.lastUpdatedAt).toBeGreaterThan(0);

    void b;
    handle?.abort();
  });

  it("abort() unregisters all tools", async () => {
    const { registered } = installMockModelContext();
    const handle = await registerWebMCPTools(createTaskService());
    expect(registered.length).toBe(TOOL_NAMES.length);
    handle?.abort();
    // Signal-based unregister is observed asynchronously.
    await new Promise((r) => setTimeout(r, 0));
    expect(registered.length).toBe(0);
  });
});
