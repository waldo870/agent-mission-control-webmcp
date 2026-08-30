import { useTaskService } from "../hooks/useTaskService";
import type { TaskService } from "../services/taskService";
import type { TaskStatus } from "../types";

interface Props {
  service: TaskService;
}

const columns: { status: TaskStatus; label: string }[] = [
  { status: "todo", label: "To do" },
  { status: "doing", label: "In progress" },
  { status: "done", label: "Done" },
];

function nextStatuses(current: TaskStatus): TaskStatus[] {
  if (current === "todo") return ["doing", "done"];
  if (current === "doing") return ["todo", "done"];
  return ["todo", "doing"];
}

export function TaskBoard({ service }: Props) {
  const tasks = useTaskService(service, () => service.getState().tasks);

  const grouped = columns.map((col) => ({
    ...col,
    items: tasks.filter((t) => t.status === col.status),
  }));

  return (
    <section className="board" aria-label="Task board">
      {grouped.map((col) => (
        <div key={col.status} className="column" data-testid={`column-${col.status}`}>
          <header>
            <h2>{col.label}</h2>
            <span className="count">{col.items.length}</span>
          </header>
          <ul>
            {col.items.length === 0 ? (
              <li className="empty">No tasks</li>
            ) : (
              col.items.map((task) => (
                <li key={task.id} className="task-card" data-testid={`task-${task.id}`}>
                  <h3>{task.title}</h3>
                  {task.description ? <p>{task.description}</p> : null}
                  <footer>
                    <span className={`actor actor-${task.createdBy}`}>
                      {task.createdBy === "human" ? "Human" : "Agent"}
                    </span>
                    <time
                      dateTime={new Date(task.lastUpdatedAt).toISOString()}
                      title={`Updated ${new Date(task.lastUpdatedAt).toLocaleString()}`}
                    >
                      {new Date(task.lastUpdatedAt).toLocaleString()}
                    </time>
                  </footer>
                  <div className="task-actions">
                    {task.status !== "done" ? (
                      <button
                        type="button"
                        data-testid={`complete-${task.id}`}
                        onClick={() =>
                          service.completeTask({ id: task.id }, { actor: "human" })
                        }
                      >
                        Mark done
                      </button>
                    ) : null}
                    {nextStatuses(task.status).map((status) => (
                      <button
                        key={status}
                        type="button"
                        data-testid={`move-${task.id}-${status}`}
                        onClick={() =>
                          service.updateTask(
                            { id: task.id, status },
                            { actor: "human" },
                          )
                        }
                      >
                        Move to {status}
                      </button>
                    ))}
                  </div>
                </li>
              ))
            )}
          </ul>
        </div>
      ))}
    </section>
  );
}
