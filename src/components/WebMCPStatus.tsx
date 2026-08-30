import type { WebMCPHandle } from "../webmcp/adapter";

interface Props {
  handle: WebMCPHandle | null;
}

export function WebMCPStatus({ handle }: Props) {
  if (handle && !handle.registrationError) {
    return (
      <div className="webmcp-status ok" data-testid="webmcp-status">
        <strong>WebMCP active</strong>
        <span>Registered {handle.tools.length} tools: {handle.tools.map((t) => t.name).join(", ")}</span>
      </div>
    );
  }
  if (handle && handle.registrationError) {
    return (
      <div className="webmcp-status warning" data-testid="webmcp-status" role="alert">
        <strong>WebMCP registration failed</strong>
        <span>{handle.registrationError}</span>
      </div>
    );
  }
  return (
    <div className="webmcp-status warning" data-testid="webmcp-status" role="status">
      <strong>WebMCP unavailable</strong>
      <span>
        document.modelContext was not found in this browser. The board still works — agents
        cannot reach it until the WebMCP origin trial or chrome://flags/#enable-webmcp-testing
        is enabled.
      </span>
    </div>
  );
}
