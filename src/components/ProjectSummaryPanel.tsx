import { useTaskService } from "../hooks/useTaskService";
import type { TaskService } from "../services/taskService";

interface Props {
  service: TaskService;
}

export function ProjectSummaryPanel({ service }: Props) {
  const summary = useTaskService(service, () => service.getProjectSummary());

  return (
    <section
      className="summary"
      aria-label="Mission progress"
      data-testid="project-summary"
    >
      <h2>Mission progress</h2>
      <dl>
        <div>
          <dt>Total</dt>
          <dd data-testid="summary-total">{summary.total}</dd>
        </div>
        <div>
          <dt>To do</dt>
          <dd data-testid="summary-todo">{summary.byStatus.todo}</dd>
        </div>
        <div>
          <dt>In progress</dt>
          <dd data-testid="summary-doing">{summary.byStatus.doing}</dd>
        </div>
        <div>
          <dt>Done</dt>
          <dd data-testid="summary-done">{summary.byStatus.done}</dd>
        </div>
        <div>
          <dt>% complete</dt>
          <dd data-testid="summary-percent">{summary.percentComplete}%</dd>
        </div>
      </dl>
    </section>
  );
}
