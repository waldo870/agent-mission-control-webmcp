/**
 * WebMCP adapter — registers all task-board tools with the browser's
 * native `document.modelContext` API.
 *
 * Tools registered (Slice 1 + Slice 2):
 *   list_tasks, create_task, update_task, complete_task,
 *   get_project_summary.
 *
 * No polyfills, no fake tool registry. If `document.modelContext` is
 * unavailable (e.g., user agent / origin trial not active),
 * `registerWebMCPTools()` returns `null` and the UI shows a
 * "WebMCP unavailable" banner.
 *
 * Both the imperative tool callbacks and the React UI call
 * `TaskService` directly, so any agent action is reflected in the
 * UI on the next render cycle.
 */

import type {
  CompleteTaskInput,
  CreateTaskInput,
  Task,
  UpdateTaskInput,
} from "../types";
import type { TaskService } from "../services/taskService";

/**
 * The descriptor shape that the imperative WebMCP API expects.
 * Mirrors the W3C explainer's `ModelContextTool` dictionary.
 *
 * We intentionally exclude `exposedTo` and `signal` here — the
 * adapter owns those lifecycle concerns.
 */
export interface WebMCPToolDescriptor {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean };
  execute: (input: unknown) => Promise<string>;
}

/**
 * The result returned by `registerWebMCPTools`. Callers keep the
 * abort function and call it on app teardown / HMR cleanup.
 */
export interface WebMCPHandle {
  abort: () => void;
  tools: { name: string; description: string }[];
  /** Set when `document.modelContext` exists but registration rejected. */
  registrationError?: string;
}

const createTaskInputSchema = {
  type: "object",
  properties: {
    title: {
      type: "string",
      minLength: 1,
      maxLength: 120,
      description: "Short, action-oriented task title (1-120 chars).",
    },
    description: {
      type: "string",
      maxLength: 2000,
      description: "Optional longer description (max 2000 chars).",
    },
  },
  required: ["title"],
  additionalProperties: false,
} as const;

const listTasksInputSchema = {
  type: "object",
  properties: {
    status: {
      type: "string",
      enum: ["todo", "doing", "done"],
      description: "Optional status filter.",
    },
  },
  additionalProperties: false,
} as const;

const updateTaskInputSchema = {
  type: "object",
  properties: {
    id: {
      type: "string",
      minLength: 1,
      description: "ID of the task to update.",
    },
    title: {
      type: "string",
      minLength: 1,
      maxLength: 120,
      description: "New title (1-120 chars). Omit to leave unchanged.",
    },
    description: {
      type: "string",
      maxLength: 2000,
      description:
        "New description (max 2000 chars). Send empty string to clear.",
    },
    status: {
      type: "string",
      enum: ["todo", "doing", "done"],
      description: "Move task to a different column.",
    },
  },
  required: ["id"],
  additionalProperties: false,
} as const;

const completeTaskInputSchema = {
  type: "object",
  properties: {
    id: {
      type: "string",
      minLength: 1,
      description: "ID of the task to mark as done.",
    },
  },
  required: ["id"],
  additionalProperties: false,
} as const;

const projectSummaryInputSchema = {
  type: "object",
  properties: {},
  additionalProperties: false,
} as const;

export function buildToolDescriptors(service: TaskService): WebMCPToolDescriptor[] {
  return [
    {
      name: "list_tasks",
      description:
        "List tasks on the shared task board. Optionally filter by status (todo, doing, done). Returns an array of task objects with id, title, description, status, createdAt, createdBy, lastUpdatedAt.",
      inputSchema: listTasksInputSchema,
      annotations: { readOnlyHint: true },
      execute: async (input) => {
        const args = (input ?? {}) as { status?: Task["status"] };
        const tasks = service.listTasks(
          args.status ? { status: args.status } : undefined,
        );
        return JSON.stringify({ tasks });
      },
    },
    {
      name: "create_task",
      description:
        "Create a new task on the shared task board. The task is attributed to the agent and appears in the UI immediately. Requires a non-empty title.",
      inputSchema: createTaskInputSchema,
      annotations: { untrustedContentHint: false },
      execute: async (input) => {
        const args = (input ?? {}) as CreateTaskInput;
        try {
          const task = service.createTask(args, { actor: "agent" });
          return JSON.stringify({ task });
        } catch (err) {
          const message = err instanceof Error ? err.message : "Unknown error";
          return JSON.stringify({ error: message });
        }
      },
    },
    {
      name: "update_task",
      description:
        "Update an existing task by id. Pass any subset of {title, description, status} — omitted fields are left unchanged. Fails safely with an error object if the id is unknown or any field is invalid. Activity is recorded only when fields actually change.",
      inputSchema: updateTaskInputSchema,
      annotations: { untrustedContentHint: false },
      execute: async (input) => {
        const args = (input ?? {}) as UpdateTaskInput;
        try {
          const result = service.updateTask(args, { actor: "agent" });
          return JSON.stringify({ task: result.task, changed: result.changed, noOp: result.noOp });
        } catch (err) {
          const message = err instanceof Error ? err.message : "Unknown error";
          return JSON.stringify({ error: message });
        }
      },
    },
    {
      name: "complete_task",
      description:
        "Mark a task as done by id. Idempotent: calling on an already-done task returns {task, alreadyDone: true} and does not record a new activity event. Fails safely with an error object if the id is unknown.",
      inputSchema: completeTaskInputSchema,
      annotations: { untrustedContentHint: false },
      execute: async (input) => {
        const args = (input ?? {}) as CompleteTaskInput;
        try {
          const result = service.completeTask(args, { actor: "agent" });
          return JSON.stringify({ task: result.task, alreadyDone: result.alreadyDone });
        } catch (err) {
          const message = err instanceof Error ? err.message : "Unknown error";
          return JSON.stringify({ error: message });
        }
      },
    },
    {
      name: "get_project_summary",
      description:
        "Return a snapshot of the project: total task count, count by status (todo/doing/done), percent complete (0-100), and the most recent task mutation timestamp. Reflects the current shared state.",
      inputSchema: projectSummaryInputSchema,
      annotations: { readOnlyHint: true },
      execute: async () => {
        return JSON.stringify(service.getProjectSummary());
      },
    },
  ];
}

/**
 * Probe whether `document.modelContext` exists in this document.
 * Pure feature detection — does not invoke registration.
 */
export function isWebMCPAvailable(): boolean {
  return typeof document !== "undefined" && "modelContext" in document;
}

/**
 * Register the task-board tools with `document.modelContext`.
 *
 * Returns `null` when WebMCP is unavailable so callers can surface
 * a graceful "unavailable" state in the UI.
 *
 * The caller-provided `options.signal` is honored so that React 19
 * StrictMode's synchronous cleanup can abort in-flight registerTool()
 * promises — that is the only reliable way to prevent a stale
 * registration from leaking into the document-level model context.
 */
export async function registerWebMCPTools(
  service: TaskService,
  options?: { signal: AbortSignal },
): Promise<WebMCPHandle | null> {
  if (!isWebMCPAvailable()) {
    return null;
  }
  const ctx = (document as Document & {
    modelContext: {
      registerTool: (
        tool: WebMCPToolDescriptor,
        options?: { signal: AbortSignal },
      ) => Promise<void>;
    };
  }).modelContext;

  const abortController = new AbortController();
  const descriptors = buildToolDescriptors(service);

  const handle: WebMCPHandle = {
    abort: () => abortController.abort(),
    tools: descriptors.map((d) => ({ name: d.name, description: d.description })),
  };

  // If the outer caller already aborted before we got here, refuse.
  if (options?.signal?.aborted) {
    handle.registrationError = "WebMCP registration aborted before start";
    return handle;
  }

  // Forward external abort to our internal controller. This is what lets
  // React's StrictMode cleanup cancel pending registerTool() calls.
  const onExternalAbort = () => abortController.abort();
  options?.signal?.addEventListener("abort", onExternalAbort, { once: true });

  try {
    for (const descriptor of descriptors) {
      // Honor a pre-aborted signal between iterations: if cleanup ran
      // mid-loop, the first poll of `signal.aborted` would let the loop
      // bail out before calling registerTool again.
      if (abortController.signal.aborted) break;
      await ctx.registerTool(descriptor, { signal: abortController.signal });
    }
    options?.signal?.removeEventListener("abort", onExternalAbort);
    return handle;
  } catch (err) {
    options?.signal?.removeEventListener("abort", onExternalAbort);
    const message = err instanceof Error ? err.message : String(err);
    handle.registrationError = message;
    // Tear down any tools that did succeed before the failure.
    abortController.abort();
    return handle;
  }
}
