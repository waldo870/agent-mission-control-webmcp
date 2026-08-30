import { useTaskService } from "../hooks/useTaskService";
import type { TaskService } from "../services/taskService";
import type { ActivityKind } from "../types";

interface Props {
  service: TaskService;
}

const kindVerb: Record<ActivityKind, string> = {
  created: "created",
  updated: "updated",
  completed: "completed",
};

export function ActivityTimeline({ service }: Props) {
  const events = useTaskService(service, () => service.getState().activity);

  return (
    <aside className="activity" aria-label="Activity timeline">
      <h2>Activity</h2>
      {events.length === 0 ? (
        <p className="empty">No activity yet.</p>
      ) : (
        <ol data-testid="activity-list">
          {events.map((event) => (
            <li key={event.id} data-testid={`activity-${event.id}`}>
              <span className={`actor actor-${event.actor}`}>
                {event.actor === "human" ? "Human" : "Agent"}
              </span>
              <span>{kindVerb[event.kind]}</span>
              <strong>{event.taskTitle}</strong>
              <time dateTime={new Date(event.at).toISOString()}>
                {new Date(event.at).toLocaleTimeString()}
              </time>
            </li>
          ))}
        </ol>
      )}
    </aside>
  );
}
