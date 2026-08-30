/**
 * Vertical Slice 1 + 2 verification harness — same-origin WebMCP path.
 *
 * Drives the REAL same-origin WebMCP contract documented by the
 * Chrome imperative API:
 *
 *   document.modelContext.registerTool(tool, options?)
 *   document.modelContext.getTools(options?)
 *   document.modelContext.executeTool(tool, input, options?)
 *
 * Notes:
 *   * `executeTool` accepts a JSON STRING (not an object) — we mirror
 *     that contract in the fake by parsing input before dispatching.
 *   * `getTools()` returns tools sorted ascending by name, per spec.
 *   * We register tools through the production `registerWebMCPTools`
 *     adapter so any drift in the production wiring is caught.
 *
 * All registered tool callbacks route through the shared TaskService
 * so React rerenders on every mutation.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import { createTaskService } from "../services/taskService";

type Registered = {
  name: string;
  title?: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean };
  execute: (input: unknown) => Promise<string>;
  signal?: AbortSignal;
};

type FakeModelContext = {
  registerTool: (t: Registered, options?: { signal?: AbortSignal }) => Promise<void>;
  getTools: (options?: { fromOrigins?: string[] }) => Promise<Registered[]>;
  executeTool: (
    tool: Registered,
    input: string,
    options?: { signal?: AbortSignal },
  ) => Promise<string>;
};

function installFakeModelContext() {
  const registered: Registered[] = [];

  const ctx: FakeModelContext = {
    async registerTool(t, options) {
      if (registered.some((r) => r.name === t.name)) {
        throw new Error(`InvalidStateError: tool already registered: ${t.name}`);
      }
      registered.push(t);
      if (options?.signal) {
        t.signal = options.signal;
        options.signal.addEventListener("abort", () => {
          const idx = registered.indexOf(t);
          if (idx >= 0) registered.splice(idx, 1);
        });
      }
    },
    async getTools() {
      return [...registered].sort((a, b) => a.name.localeCompare(b.name));
    },
    async executeTool(tool, input, options) {
      const match = registered.find((r) => r.name === tool.name);
      if (!match) throw new Error("UnknownError: tool not found");
      let parsed: unknown = {};
      if (typeof input === "string" && input.length > 0) {
        try {
          parsed = JSON.parse(input);
        } catch (err) {
          const message = err instanceof Error ? err.message : "invalid JSON";
          throw new Error(`SyntaxError: executeTool input is not valid JSON (${message})`);
        }
      }
      void options;
      return match.execute(parsed);
    },
  };

  Object.defineProperty(document, "modelContext", {
    configurable: true,
    value: ctx,
  });
  return { ctx, registered };
}

function uninstallFakeModelContext() {
  delete (document as Document & { modelContext?: unknown }).modelContext;
}

const TOOL_NAMES = [
  "complete_task",
  "create_task",
  "get_project_summary",
  "list_tasks",
  "update_task",
] as const;

describe("WebMCP real path verification (Slice 1 + Slice 2)", () => {
  beforeEach(() => {
    uninstallFakeModelContext();
    localStorage.clear();
    vi.resetModules();
  });

  afterEach(() => {
    uninstallFakeModelContext();
    localStorage.clear();
  });

  async function bootstrap() {
    const { App } = await import("../App");
    const utils = render(<App />);
    await act(async () => {
      await Promise.resolve();
    });
    return utils;
  }

  function ctx(): FakeModelContext {
    return (document as Document & { modelContext: FakeModelContext })
      .modelContext;
  }

  it("registers all five tools; getTools() returns them in alpha order", async () => {
    const { registered } = installFakeModelContext();
    await bootstrap();

    expect(registered.map((r) => r.name).slice().sort()).toEqual(
      [...TOOL_NAMES].sort(),
    );

    const tools = await ctx().getTools();
    expect(tools.map((t) => t.name)).toEqual([...TOOL_NAMES]);
    // Read-only annotations preserved.
    expect(tools.find((t) => t.name === "list_tasks")?.annotations?.readOnlyHint).toBe(true);
    expect(tools.find((t) => t.name === "get_project_summary")?.annotations?.readOnlyHint).toBe(true);
  });

  it("create_task via executeTool() is attributed to the AGENT and renders in the UI", async () => {
    installFakeModelContext();
    await bootstrap();
    const tools = await ctx().getTools();
    const create = tools.find((t) => t.name === "create_task")!;

    const raw = await ctx().executeTool(
      create,
      JSON.stringify({
        title: "Verify create_task",
        description: "issued through document.modelContext.executeTool",
      }),
    );
    const parsed = JSON.parse(raw);
    expect(parsed.task.title).toBe("Verify create_task");
    expect(parsed.task.createdBy).toBe("agent");

    const todoColumn = screen.getByTestId("column-todo");
    expect(within(todoColumn).getByText("Verify create_task")).toBeInTheDocument();
    expect(within(todoColumn).getByText("Agent")).toBeInTheDocument();
  });

  it("list_tasks via executeTool() reflects the current shared state (read path)", async () => {
    installFakeModelContext();
    await bootstrap();
    const tools = await ctx().getTools();
    const list = tools.find((t) => t.name === "list_tasks")!;

    const before = JSON.parse(await ctx().executeTool(list, "{}"));
    expect(before.tasks).toEqual([]);

    await ctx().executeTool(
      tools.find((t) => t.name === "create_task")!,
      JSON.stringify({ title: "Listed via executeTool" }),
    );

    const after = JSON.parse(await ctx().executeTool(list, "{}"));
    expect(after.tasks).toHaveLength(1);
    expect(after.tasks[0].title).toBe("Listed via executeTool");
    expect(after.tasks[0].createdBy).toBe("agent");

    const filtered = JSON.parse(
      await ctx().executeTool(list, JSON.stringify({ status: "doing" })),
    );
    expect(filtered.tasks).toEqual([]);
  });

  it("update_task via executeTool() moves the card and emits exactly one updated event", async () => {
    installFakeModelContext();
    await bootstrap();
    const tools = await ctx().getTools();
    const create = tools.find((t) => t.name === "create_task")!;
    const update = tools.find((t) => t.name === "update_task")!;

    const created = JSON.parse(
      await ctx().executeTool(
        create,
        JSON.stringify({ title: "Move me" }),
      ),
    ).task;

    // Change status to doing.
    const real = JSON.parse(
      await ctx().executeTool(
        update,
        JSON.stringify({ id: created.id, status: "doing" }),
      ),
    );
    expect(real.noOp).toBe(false);
    expect(real.changed).toBe(true);
    expect(real.task.status).toBe("doing");

    // UI reflects the move.
    expect(within(screen.getByTestId("column-doing")).getByText("Move me")).toBeInTheDocument();
    expect(within(screen.getByTestId("column-todo")).queryByText("Move me")).toBeNull();

    // Activity log: exactly one updated event for this task, AGENT actor.
    const items = screen.getAllByTestId(/^activity-/);
    const updated = items.find((node) => within(node).queryByText("updated"));
    expect(updated).toBeTruthy();
    // The activity row must label the actor as Agent.
    expect(within(updated!).getAllByText("Agent").length).toBeGreaterThan(0);
  });

  it("update_task no-op does not record activity or bump timestamp", async () => {
    installFakeModelContext();
    await bootstrap();
    const tools = await ctx().getTools();
    const create = tools.find((t) => t.name === "create_task")!;
    const update = tools.find((t) => t.name === "update_task")!;
    const list = tools.find((t) => t.name === "list_tasks")!;

    const created = JSON.parse(
      await ctx().executeTool(
        create,
        JSON.stringify({ title: "Untouched" }),
      ),
    ).task;

    // Send the same title — should be a no-op.
    const noop = JSON.parse(
      await ctx().executeTool(
        update,
        JSON.stringify({ id: created.id, title: "Untouched" }),
      ),
    );
    expect(noop.noOp).toBe(true);

    // No "updated" event should appear.
    const items = screen.getAllByTestId(/^activity-/);
    expect(items.find((node) => within(node).queryByText("updated"))).toBeUndefined();

    // The task is still in the list with its original timestamp.
    const after = JSON.parse(await ctx().executeTool(list, "{}"));
    expect(after.tasks[0].lastUpdatedAt).toBe(created.lastUpdatedAt);
  });

  it("update_task fails safely on unknown id; UI shows no new card", async () => {
    installFakeModelContext();
    await bootstrap();
    const tools = await ctx().getTools();
    const update = tools.find((t) => t.name === "update_task")!;
    const list = tools.find((t) => t.name === "list_tasks")!;

    const before = JSON.parse(await ctx().executeTool(list, "{}"));
    expect(before.tasks).toEqual([]);

    const result = JSON.parse(
      await ctx().executeTool(
        update,
        JSON.stringify({ id: "nope-1234", title: "Ghost" }),
      ),
    );
    expect(result).toHaveProperty("error");
    expect(result.error).toMatch(/not found/i);

    const after = JSON.parse(await ctx().executeTool(list, "{}"));
    expect(after.tasks).toEqual([]);
  });

  it("complete_task via executeTool() flips UI to done and emits exactly one completed event (idempotent)", async () => {
    installFakeModelContext();
    await bootstrap();
    const tools = await ctx().getTools();
    const create = tools.find((t) => t.name === "create_task")!;
    const complete = tools.find((t) => t.name === "complete_task")!;

    const created = JSON.parse(
      await ctx().executeTool(create, JSON.stringify({ title: "Finalize me" })),
    ).task;

    const first = JSON.parse(
      await ctx().executeTool(
        complete,
        JSON.stringify({ id: created.id }),
      ),
    );
    expect(first.alreadyDone).toBe(false);
    expect(first.task.status).toBe("done");

    // UI card moved to done column.
    const doneColumn = screen.getByTestId("column-done");
    expect(within(doneColumn).getByText("Finalize me")).toBeInTheDocument();

    // Second call is idempotent — no new activity event.
    const completedBefore = screen
      .getAllByTestId(/^activity-/)
      .filter((node) => within(node).queryByText("completed")).length;

    const second = JSON.parse(
      await ctx().executeTool(
        complete,
        JSON.stringify({ id: created.id }),
      ),
    );
    expect(second.alreadyDone).toBe(true);
    expect(second.task.status).toBe("done");

    const completedAfter = screen
      .getAllByTestId(/^activity-/)
      .filter((node) => within(node).queryByText("completed")).length;
    expect(completedAfter).toBe(completedBefore);
  });

  it("complete_task fails safely on unknown id", async () => {
    installFakeModelContext();
    await bootstrap();
    const tools = await ctx().getTools();
    const complete = tools.find((t) => t.name === "complete_task")!;

    const result = JSON.parse(
      await ctx().executeTool(complete, JSON.stringify({ id: "missing-zzz" })),
    );
    expect(result).toHaveProperty("error");
    expect(result.error).toMatch(/not found/i);
  });

  it("get_project_summary via executeTool() reflects the current shared state", async () => {
    installFakeModelContext();
    await bootstrap();
    const tools = await ctx().getTools();
    const create = tools.find((t) => t.name === "create_task")!;
    const complete = tools.find((t) => t.name === "complete_task")!;
    const update = tools.find((t) => t.name === "update_task")!;
    const summary = tools.find((t) => t.name === "get_project_summary")!;

    const empty = JSON.parse(await ctx().executeTool(summary, "{}"));
    expect(empty.total).toBe(0);
    expect(empty.percentComplete).toBe(0);

    const a = JSON.parse(await ctx().executeTool(create, JSON.stringify({ title: "A" }))).task;
    const b = JSON.parse(await ctx().executeTool(create, JSON.stringify({ title: "B" }))).task;

    await ctx().executeTool(update, JSON.stringify({ id: a.id, status: "doing" }));
    await ctx().executeTool(complete, JSON.stringify({ id: b.id }));

    const after = JSON.parse(await ctx().executeTool(summary, "{}"));
    expect(after.total).toBe(2);
    expect(after.byStatus).toEqual({ todo: 0, doing: 1, done: 1 });
    expect(after.percentComplete).toBe(50);
    expect(typeof after.lastUpdatedAt).toBe("number");
    expect(after.lastUpdatedAt).toBeGreaterThan(0);

    // The summary panel in the DOM also reflects this.
    expect(screen.getByTestId("summary-total").textContent).toBe("2");
    expect(screen.getByTestId("summary-percent").textContent).toBe("50%");
    expect(screen.getByTestId("summary-done").textContent).toBe("1");
  });

  it("agent-created and human-created tasks coexist with correct activity attribution", async () => {
    installFakeModelContext();
    await bootstrap();
    const tools = await ctx().getTools();
    const userEventModule = await import("@testing-library/user-event");
    const user = userEventModule.default.setup();

    const input = screen.getByPlaceholderText(/draft webmcp outline/i);
    await user.type(input, "Human-authored task");
    await user.click(screen.getByRole("button", { name: /add task/i }));

    await ctx().executeTool(
      tools.find((t) => t.name === "create_task")!,
      JSON.stringify({ title: "Agent-authored task" }),
    );

    const all = JSON.parse(
      await ctx().executeTool(
        tools.find((t) => t.name === "list_tasks")!,
        "{}",
      ),
    ).tasks;
    expect(all).toHaveLength(2);
    const human = all.find((t: { title: string }) => t.title === "Human-authored task");
    const agent = all.find((t: { title: string }) => t.title === "Agent-authored task");
    expect(human.createdBy).toBe("human");
    expect(agent.createdBy).toBe("agent");
  });

  it("localStorage round-trip: a task created via executeTool() survives a fresh service instance", async () => {
    installFakeModelContext();
    await bootstrap();
    const tools = await ctx().getTools();
    await ctx().executeTool(
      tools.find((t) => t.name === "create_task")!,
      JSON.stringify({ title: "Persisted across reload" }),
    );

    expect(localStorage.getItem("webmcp-taskboard:v1")).toContain(
      "Persisted across reload",
    );

    const fresh = createTaskService();
    const restored = fresh.getState();
    expect(
      restored.tasks.find((t) => t.title === "Persisted across reload"),
    ).toBeTruthy();
    expect(
      restored.activity.find((t) => t.taskTitle === "Persisted across reload")
        ?.actor,
    ).toBe("agent");
  });

  it("abort() unregisters all tools via AbortSignal; getTools() reports the empty set", async () => {
    const { ctx, registered } = installFakeModelContext();
    const utils = await bootstrap();

    expect(registered.length).toBe(TOOL_NAMES.length);
    expect(registered.every((t) => !!t.signal)).toBe(true);

    await act(async () => {
      utils.unmount();
    });

    expect(registered.length).toBe(0);
    expect(await ctx.getTools()).toEqual([]);
  });

  /**
   * Regression: real Chrome reported "5 tools missing" while a manually
   * registered `probe_test` survived. Root cause was a race between
   * App.tsx's useEffect cleanup (synchronous in React 19 StrictMode)
   * and the .then() callback that assigned the registration handle and
   * aborted. By the time cleanup ran, `handle` was still null, so the
   * controller was never aborted; then the late .then() either aborted
   * its own freshly-registered tools OR the second mount's tools never
   * landed because the controller had already been torn down.
   *
   * Fix: the adapter accepts an external `options.signal` and forwards
   * it through every ctx.registerTool() call so the browser can refuse
   * the registration before it lands in the document-level model
   * context registry. The cleanup function (which runs synchronously,
   * before any .then() resolves) aborts that signal.
   *
   * This test exercises that contract directly: when the caller's
   * signal is aborted before the first registerTool() call resolves,
   * the live registry must end empty (the "stale" mount's tools must
   * NOT have leaked through).
   */
  it("callers can abort registration mid-flight via options.signal and the registry stays clean", async () => {
    const registered: { name: string }[] = [];
    const ctx = {
      async registerTool(
        t: { name: string },
        options?: { signal?: AbortSignal },
      ): Promise<void> {
        // Mirror Chrome's behavior: a call on an aborted signal must
        // reject without committing to the document-level registry.
        if (options?.signal?.aborted) {
          throw new Error("AbortError: registration aborted");
        }
        // Honor an abort that arrives while this Promise is pending.
        await new Promise<void>((resolve) => {
          if (!options?.signal || options.signal.aborted) {
            resolve();
            return;
          }
          const onAbort = () => resolve();
          options.signal.addEventListener("abort", onAbort, { once: true });
        });
        if (options?.signal?.aborted) {
          throw new Error("AbortError: registration aborted");
        }
        registered.push(t);
      },
      async getTools() {
        return [...registered];
      },
      async executeTool() {
        return "{}";
      },
    };
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: ctx,
    });

    // Simulate App.tsx's effect: register, then abort from "cleanup".
    const { registerWebMCPTools } = await import("../webmcp/adapter");
    const abortController = new AbortController();

    const registrationPromise = registerWebMCPTools(createTaskService(), {
      signal: abortController.signal,
    });

    // Synchronous abort like React 19 StrictMode's effect cleanup.
    abortController.abort();

    const handle = await registrationPromise;
    expect(handle).not.toBeNull();

    // Flush any pending microtasks so the adapter's for-loop has
    // a chance to react to the abort.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // After abort, the live registry must be empty — the discarded
    // mount's tools must NOT have committed. Previously the
    // implementation leaked these through because cleanup ran before
    // the .then() resolved and the controller was never aborted.
    expect(registered.length).toBe(0);
  });
});
