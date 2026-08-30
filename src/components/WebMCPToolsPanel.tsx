import type { WebMCPHandle } from "../webmcp/adapter";

interface Props {
  handle: WebMCPHandle | null;
}

const TOOL_PURPOSES: Record<string, string> = {
  list_tasks: "Read the current task list (optionally filter by status).",
  create_task: "Add a new task; attributed to the agent.",
  update_task: "Change title, description, or status of an existing task.",
  complete_task: "Mark a task as done. Idempotent on already-done tasks.",
  get_project_summary:
    "Read total / by-status counts, percent complete, last updated.",
};

export function WebMCPToolsPanel({ handle }: Props) {
  const tools = handle?.tools ?? [];
  const ready = !!handle && !handle.registrationError && tools.length > 0;

  return (
    <section
      className="webmcp-tools"
      aria-label="WebMCP tools"
      data-testid="webmcp-tools-panel"
    >
      <h2>5 WebMCP tools</h2>
      {ready ? (
        <>
          <p className="webmcp-tools-sub">
            Registered via <code>document.modelContext.registerTool</code> —
            agents call them as a single shared group.
          </p>
          <ul>
            {tools.map((tool) => (
              <li key={tool.name} data-testid={`tool-${tool.name}`}>
                <code>{tool.name}</code>
                <span>{TOOL_PURPOSES[tool.name] ?? tool.description}</span>
              </li>
            ))}
          </ul>
        </>
      ) : handle?.registrationError ? (
        <p className="webmcp-tools-sub warn">
          Registration failed: {handle.registrationError}
        </p>
      ) : (
        <p className="webmcp-tools-sub muted">
          Tools not yet registered. WebMCP unavailable in this browser.
        </p>
      )}
    </section>
  );
}
