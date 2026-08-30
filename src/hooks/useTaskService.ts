import { useSyncExternalStore } from "react";
import type { TaskService } from "../services/taskService";

/**
 * Subscribe a React component to the TaskService via
 * useSyncExternalStore. Re-renders are synchronous with state
 * changes, so agent-created tasks are visible immediately.
 */
export function useTaskService<T>(service: TaskService, selector: () => T): T {
  return useSyncExternalStore(
    (listener) => service.subscribe(listener),
    selector,
    selector,
  );
}
