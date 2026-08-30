/**
 * Domain types shared by the UI and the WebMCP adapter.
 *
 * WebMCP requires `name` 1–128 chars matching `[A-Za-z0-9_\-.]`.
 * Tool descriptions and schemas are sent verbatim to agents.
 */

export type TaskStatus = "todo" | "doing" | "done";

export interface Task {
  id: string;
  title: string;
  description?: string;
  status: TaskStatus;
  createdAt: number;
  createdBy: Actor;
  /** Last mutation timestamp; equals createdAt until the task is updated or completed. */
  lastUpdatedAt: number;
}

export type Actor = "human" | "agent";

export type ActivityKind = "created" | "updated" | "completed";

export interface ActivityEvent {
  id: string;
  taskId: string;
  taskTitle: string;
  kind: ActivityKind;
  actor: Actor;
  at: number;
}

export interface CreateTaskInput {
  title: string;
  description?: string;
}

export interface UpdateTaskInput {
  id: string;
  title?: string;
  description?: string;
  status?: TaskStatus;
}

export interface CompleteTaskInput {
  id: string;
}

export interface ProjectSummary {
  total: number;
  byStatus: Record<TaskStatus, number>;
  percentComplete: number;
  lastUpdatedAt: number | null;
}

export interface TaskServiceState {
  tasks: Task[];
  activity: ActivityEvent[];
}

export type Listener = () => void;
