import type {
  Actor,
  ActivityEvent,
  ActivityKind,
  CompleteTaskInput,
  CreateTaskInput,
  Listener,
  ProjectSummary,
  Task,
  TaskServiceState,
  TaskStatus,
  UpdateTaskInput,
} from "../types";

/**
 * TaskService — single source of truth for tasks and activity.
 *
 * Both the React UI and the WebMCP adapter call into this service.
 * State changes trigger all registered listeners synchronously,
 * so React rerenders immediately when an agent mutates a task.
 *
 * Activity is recorded exactly once per *real* mutation. No-op
 * updates (no fields changed) and idempotent completes (target
 * already done) emit no activity and do not bump timestamps.
 */

export interface CreateOptions {
  actor: Actor;
  idFactory?: () => string;
  now?: () => number;
}

export interface MutationOptions {
  actor: Actor;
  now?: () => number;
}

export interface UpdateResult {
  task: Task;
  changed: boolean;
  noOp: boolean;
}

export interface CompleteResult {
  task: Task;
  alreadyDone: boolean;
}

export interface TaskService {
  getState(): TaskServiceState;
  subscribe(listener: Listener): () => void;
  listTasks(filter?: { status?: TaskStatus }): Task[];
  createTask(input: CreateTaskInput, options: CreateOptions): Task;
  updateTask(input: UpdateTaskInput, options: MutationOptions): UpdateResult;
  completeTask(input: CompleteTaskInput, options: MutationOptions): CompleteResult;
  getProjectSummary(): ProjectSummary;
}

const STORAGE_KEY = "webmcp-taskboard:v1";

interface PersistedShape {
  tasks: Task[];
  activity: ActivityEvent[];
}

function loadPersisted(): PersistedShape | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedShape;
    if (!parsed || !Array.isArray(parsed.tasks) || !Array.isArray(parsed.activity)) {
      return null;
    }
    // Backfill lastUpdatedAt for state written by Slice 1 builds.
    parsed.tasks = parsed.tasks.map((t) => ({
      ...t,
      lastUpdatedAt: t.lastUpdatedAt ?? t.createdAt,
    }));
    return parsed;
  } catch {
    return null;
  }
}

function persist(state: TaskServiceState): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* quota or disabled — non-fatal */
  }
}

function defaultId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `id-${Math.random().toString(36).slice(2, 10)}-${Date.now()}`;
}

function isValidStatus(value: unknown): value is TaskStatus {
  return value === "todo" || value === "doing" || value === "done";
}

function computeSummary(state: TaskServiceState): ProjectSummary {
  const byStatus: Record<TaskStatus, number> = { todo: 0, doing: 0, done: 0 };
  let lastUpdatedAt: number | null = null;
  for (const task of state.tasks) {
    byStatus[task.status] += 1;
    if (task.lastUpdatedAt > (lastUpdatedAt ?? 0)) lastUpdatedAt = task.lastUpdatedAt;
  }
  const total = state.tasks.length;
  const percentComplete =
    total === 0 ? 0 : Math.round((byStatus.done / total) * 100);
  return { total, byStatus, percentComplete, lastUpdatedAt };
}

export function createTaskService(initial?: Partial<TaskServiceState>): TaskService {
  const listeners = new Set<Listener>();
  const persisted = loadPersisted();
  const state: TaskServiceState = {
    tasks: initial?.tasks ?? persisted?.tasks ?? [],
    activity: initial?.activity ?? persisted?.activity ?? [],
  };
  // Cached derived view. Replaced on every mutation so reference
  // identity is stable across non-mutating reads (this matters for
  // useSyncExternalStore selectors).
  let cachedSummary: ProjectSummary = computeSummary(state);

  function emit(): void {
    for (const listener of listeners) listener();
  }

  function commit(): void {
    cachedSummary = computeSummary(state);
    persist(state);
    emit();
  }

  function recordEvent(
    task: Task,
    kind: ActivityKind,
    actor: Actor,
    at: number,
  ): void {
    const event: ActivityEvent = {
      id: defaultId(),
      taskId: task.id,
      taskTitle: task.title,
      kind,
      actor,
      at,
    };
    state.activity = [event, ...state.activity].slice(0, 50);
  }

  function findIndex(id: string): number {
    return state.tasks.findIndex((t) => t.id === id);
  }

  return {
    getState() {
      return state;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    listTasks(filter) {
      if (!filter?.status) return [...state.tasks];
      return state.tasks.filter((t) => t.status === filter.status);
    },
    createTask(input, options) {
      const title = input.title.trim();
      if (!title) {
        throw new Error("Task title is required.");
      }
      if (title.length > 120) {
        throw new Error("Task title must be 120 characters or fewer.");
      }
      const description = input.description?.trim();
      if (description && description.length > 2000) {
        throw new Error("Task description must be 2000 characters or fewer.");
      }
      const now = options.now ? options.now() : Date.now();
      const id = options.idFactory ? options.idFactory() : defaultId();
      const task: Task = {
        id,
        title,
        description: description || undefined,
        status: "todo",
        createdAt: now,
        lastUpdatedAt: now,
        createdBy: options.actor,
      };
      const event: ActivityEvent = {
        id: defaultId(),
        taskId: id,
        taskTitle: title,
        kind: "created",
        actor: options.actor,
        at: now,
      };
      state.tasks = [task, ...state.tasks];
      state.activity = [event, ...state.activity].slice(0, 50);
      commit();
      return task;
    },
    updateTask(input, options) {
      if (!input.id || typeof input.id !== "string") {
        throw new Error("Task id is required.");
      }
      const idx = findIndex(input.id);
      if (idx < 0) {
        throw new Error(`Task not found: ${input.id}`);
      }
      const current = state.tasks[idx];

      let nextTitle = current.title;
      if (input.title !== undefined) {
        const trimmed = input.title.trim();
        if (!trimmed) {
          throw new Error("Task title cannot be empty.");
        }
        if (trimmed.length > 120) {
          throw new Error("Task title must be 120 characters or fewer.");
        }
        nextTitle = trimmed;
      }

      let nextDescription = current.description;
      if (input.description !== undefined) {
        const trimmed = input.description.trim();
        if (trimmed.length > 2000) {
          throw new Error("Task description must be 2000 characters or fewer.");
        }
        nextDescription = trimmed || undefined;
      }

      let nextStatus = current.status;
      if (input.status !== undefined) {
        if (!isValidStatus(input.status)) {
          throw new Error(
            `Invalid status: ${String(input.status)} (expected todo|doing|done)`,
          );
        }
        nextStatus = input.status;
      }

      const changed =
        nextTitle !== current.title ||
        nextDescription !== current.description ||
        nextStatus !== current.status;

      if (!changed) {
        // No-op: do not record activity, do not bump timestamp.
        return { task: current, changed: false, noOp: true };
      }

      const now = options.now ? options.now() : Date.now();
      const updated: Task = {
        ...current,
        title: nextTitle,
        description: nextDescription,
        status: nextStatus,
        lastUpdatedAt: now,
      };
      state.tasks = state.tasks.map((t, i) => (i === idx ? updated : t));
      recordEvent(updated, "updated", options.actor, now);
      commit();
      return { task: updated, changed: true, noOp: false };
    },
    completeTask(input, options) {
      if (!input.id || typeof input.id !== "string") {
        throw new Error("Task id is required.");
      }
      const idx = findIndex(input.id);
      if (idx < 0) {
        throw new Error(`Task not found: ${input.id}`);
      }
      const current = state.tasks[idx];
      if (current.status === "done") {
        // Idempotent: same status, no activity, no commit.
        return { task: current, alreadyDone: true };
      }
      const now = options.now ? options.now() : Date.now();
      const updated: Task = {
        ...current,
        status: "done",
        lastUpdatedAt: now,
      };
      state.tasks = state.tasks.map((t, i) => (i === idx ? updated : t));
      recordEvent(updated, "completed", options.actor, now);
      commit();
      return { task: updated, alreadyDone: false };
    },
    getProjectSummary() {
      return cachedSummary;
    },
  };
}
