import { describe, expect, it, beforeEach } from "vitest";
import { createTaskService } from "../services/taskService";

describe("taskService", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("creates a task attributed to the given actor", () => {
    const service = createTaskService();
    const task = service.createTask({ title: "Demo" }, { actor: "human" });
    expect(task.title).toBe("Demo");
    expect(task.status).toBe("todo");
    expect(task.createdBy).toBe("human");
    expect(task.id).toBeTruthy();
    expect(task.lastUpdatedAt).toBe(task.createdAt);
  });

  it("rejects empty or oversized titles", () => {
    const service = createTaskService();
    expect(() =>
      service.createTask({ title: "  " }, { actor: "human" }),
    ).toThrowError(/title is required/i);
    expect(() =>
      service.createTask(
        { title: "x".repeat(121) },
        { actor: "human" },
      ),
    ).toThrowError(/120 characters/i);
  });

  it("notifies subscribers on each change", () => {
    const service = createTaskService();
    let calls = 0;
    service.subscribe(() => {
      calls += 1;
    });
    service.createTask({ title: "One" }, { actor: "human" });
    service.createTask({ title: "Two" }, { actor: "agent" });
    expect(calls).toBe(2);
  });

  it("records activity events for both human and agent actors", () => {
    const service = createTaskService();
    service.createTask({ title: "From human" }, { actor: "human" });
    service.createTask({ title: "From agent" }, { actor: "agent" });
    const { activity } = service.getState();
    expect(activity).toHaveLength(2);
    expect(activity[0].actor).toBe("agent");
    expect(activity[1].actor).toBe("human");
    expect(activity[0].kind).toBe("created");
  });

  it("filters tasks by status", () => {
    const service = createTaskService();
    service.createTask({ title: "A" }, { actor: "human" });
    const result = service.listTasks({ status: "todo" });
    expect(result).toHaveLength(1);
    expect(service.listTasks({ status: "done" })).toHaveLength(0);
  });

  it("persists tasks to localStorage", () => {
    const first = createTaskService();
    first.createTask({ title: "Persisted" }, { actor: "human" });

    const second = createTaskService();
    expect(second.getState().tasks[0]?.title).toBe("Persisted");
  });

  it("updateTask mutates fields, bumps lastUpdatedAt, and records one activity event per real change", () => {
    const service = createTaskService();
    const created = service.createTask({ title: "Init" }, { actor: "human" });

    const before = service.getState().activity.length;
    const beforeTs = created.lastUpdatedAt;

    const result = service.updateTask(
      { id: created.id, status: "doing" },
      { actor: "agent" },
    );
    expect(result.changed).toBe(true);
    expect(result.noOp).toBe(false);
    expect(result.task.status).toBe("doing");
    expect(result.task.lastUpdatedAt).toBeGreaterThanOrEqual(beforeTs);

    expect(service.getState().activity.length).toBe(before + 1);
    expect(service.getState().activity[0].kind).toBe("updated");
    expect(service.getState().activity[0].actor).toBe("agent");

    // No-op when fields match existing values.
    const tsBeforeNoop = service.getState().tasks[0].lastUpdatedAt;
    const noop = service.updateTask(
      { id: created.id, status: "doing" },
      { actor: "agent" },
    );
    expect(noop.noOp).toBe(true);
    expect(noop.changed).toBe(false);
    expect(service.getState().activity.length).toBe(before + 1);
    expect(service.getState().tasks[0].lastUpdatedAt).toBe(tsBeforeNoop);
  });

  it("updateTask throws on unknown id and on invalid status", () => {
    const service = createTaskService();
    const created = service.createTask({ title: "T" }, { actor: "human" });
    expect(() =>
      service.updateTask({ id: "ghost", title: "X" }, { actor: "agent" }),
    ).toThrowError(/not found/i);
    expect(() =>
      service.updateTask(
        { id: created.id, status: "archived" as never },
        { actor: "agent" },
      ),
    ).toThrowError(/invalid status/i);
  });

  it("completeTask is idempotent and only records activity on first completion", () => {
    const service = createTaskService();
    const created = service.createTask({ title: "Closable" }, { actor: "human" });
    const before = service.getState().activity.length;

    const first = service.completeTask({ id: created.id }, { actor: "agent" });
    expect(first.alreadyDone).toBe(false);
    expect(first.task.status).toBe("done");
    expect(service.getState().activity.length).toBe(before + 1);
    expect(service.getState().activity[0].kind).toBe("completed");

    const second = service.completeTask({ id: created.id }, { actor: "agent" });
    expect(second.alreadyDone).toBe(true);
    expect(second.task.status).toBe("done");
    expect(service.getState().activity.length).toBe(before + 1);
  });

  it("completeTask throws on unknown id", () => {
    const service = createTaskService();
    expect(() =>
      service.completeTask({ id: "ghost" }, { actor: "agent" }),
    ).toThrowError(/not found/i);
  });

  it("getProjectSummary reflects the current state with accurate counts and percentComplete", () => {
    const service = createTaskService();
    expect(service.getProjectSummary().total).toBe(0);
    expect(service.getProjectSummary().percentComplete).toBe(0);

    const a = service.createTask({ title: "A" }, { actor: "human" });
    const b = service.createTask({ title: "B" }, { actor: "human" });
    service.updateTask({ id: a.id, status: "doing" }, { actor: "agent" });
    service.completeTask({ id: b.id }, { actor: "agent" });

    const summary = service.getProjectSummary();
    expect(summary.total).toBe(2);
    expect(summary.byStatus).toEqual({ todo: 0, doing: 1, done: 1 });
    expect(summary.percentComplete).toBe(50);
    expect(typeof summary.lastUpdatedAt).toBe("number");
    expect(summary.lastUpdatedAt).toBeGreaterThan(0);
  });
});
