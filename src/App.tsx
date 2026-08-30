import { useEffect, useRef, useState } from "react";
import { ActivityTimeline } from "./components/ActivityTimeline";
import { CreateTaskForm } from "./components/CreateTaskForm";
import { MissionHeader } from "./components/MissionHeader";
import { ProjectSummaryPanel } from "./components/ProjectSummaryPanel";
import { TaskBoard } from "./components/TaskBoard";
import { WebMCPStatus } from "./components/WebMCPStatus";
import { WebMCPToolsPanel } from "./components/WebMCPToolsPanel";
import { defaultMissionSeed } from "./mission/defaultMission";
import { createTaskService } from "./services/taskService";
import {
  registerWebMCPTools,
  type WebMCPHandle,
} from "./webmcp/adapter";

// Single shared service instance — UI + WebMCP both talk to this.
// When localStorage is empty, seed with the default mission so the
// demo opens into a realistic state. Existing state is preserved.
// Tests run in non-test envs to opt out of seeding; we also gate
// against vitest's MODE for robustness.
function buildService() {
  const isTest =
    typeof import.meta !== "undefined" &&
    (import.meta as { env?: { MODE?: string } }).env?.MODE === "test";
  if (isTest) return createTaskService();
  const hasPersisted =
    typeof localStorage !== "undefined" &&
    localStorage.getItem("webmcp-taskboard:v1");
  if (hasPersisted) return createTaskService();
  return createTaskService({ tasks: defaultMissionSeed() });
}

const taskService = buildService();

const MISSION_TITLE = "Launch an AI Workshop";
const MISSION_GOAL =
  "Get 30 sign-ups, ship the agenda, and run a 90-minute demo of Agent Mission Control — humans and a web agent coordinating the same task board through WebMCP.";

export function App() {
  const [webmcpHandle, setWebmcpHandle] = useState<WebMCPHandle | null>(null);
  // handleRef lets the cleanup function observe the latest handle even if
  // the registration promise resolves asynchronously AFTER cleanup runs
  // (React 19 StrictMode double-mounts effects, and AbortController
  // unregisters tools when its abort signal fires in real Chrome).
  const handleRef = useRef<WebMCPHandle | null>(null);

  useEffect(() => {
    // One AbortController per effect run. Cleanup owns the abort; we do
    // NOT abort inside the .then() callback because in React 19 StrictMode
    // the cleanup runs synchronously when the effect re-runs, BEFORE the
    // .then() has resolved. The previous implementation captured `handle`
    // inside the .then() but then stored it via a `let` that cleanup
    // observed as null, so cleanup did nothing AND then the late .then()
    // aborted its own freshly-registered tools on the next commit.
    //
    // The fix: the abort signal flows INTO each ctx.registerTool() call,
    // so the browser can refuse the registration before it lands in the
    // document-level model context registry. handleRef captures any
    // partial handle so cleanup also aborts once the .then() resolves.
    const abortController = new AbortController();
    let cancelled = false;

    (async () => {
      const result = await registerWebMCPTools(taskService, {
        signal: abortController.signal,
      });
      if (cancelled) {
        // Effect was cleaned up before registration finished — tear down
        // any tools that already landed in the model context.
        result?.abort();
        return;
      }
      handleRef.current = result;
      setWebmcpHandle(result);
    })();

    return () => {
      cancelled = true;
      // Crucially, abort fires whether or not the registration has
      // completed. In real Chrome, that abort signal prevents each
      // pending registerTool() from committing its tool to the
      // document-level model context registry.
      abortController.abort();
      handleRef.current?.abort();
      handleRef.current = null;
    };
  }, []);

  return (
    <div className="app">
      <MissionHeader title={MISSION_TITLE} goal={MISSION_GOAL} />
      <WebMCPStatus handle={webmcpHandle} />
      <main>
        <section className="board-section">
          <header className="section-header">
            <h2>Mission tasks</h2>
            <p>Humans edit tasks here. Agents edit the same tasks via WebMCP.</p>
          </header>
          <TaskBoard service={taskService} />
        </section>
        <div className="side-panel">
          <WebMCPToolsPanel handle={webmcpHandle} />
          <ProjectSummaryPanel service={taskService} />
          <CreateTaskForm service={taskService} />
          <ActivityTimeline service={taskService} />
        </div>
      </main>
    </div>
  );
}
