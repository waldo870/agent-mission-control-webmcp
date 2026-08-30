interface Props {
  title: string;
  goal: string;
}

export function MissionHeader({ title, goal }: Props) {
  return (
    <header className="mission-header" data-testid="mission-header">
      <div className="mission-meta">
        <span className="mission-eyebrow">Agent Mission Control</span>
        <h1>{title}</h1>
        <p className="mission-goal">{goal}</p>
      </div>
      <div className="mission-actors" aria-label="Two surfaces">
        <div className="actor-card actor-human">
          <span className="actor-tag">Humans</span>
          <strong>Use the UI</strong>
          <p>Click, type, move tasks between columns.</p>
        </div>
        <div className="actor-card actor-agent">
          <span className="actor-tag">Agents</span>
          <strong>Use WebMCP</strong>
          <p>Call registered tools on document.modelContext.</p>
        </div>
        <div className="actor-card actor-shared">
          <span className="actor-tag">Shared</span>
          <strong>Same state</strong>
          <p>Both surfaces mutate one TaskService in real time.</p>
        </div>
      </div>
    </header>
  );
}
