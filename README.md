# Agent Mission Control


**A shared mission workspace where humans use the visual UI and AI agents use structured WebMCP tools — both acting on the same live application state.**

🚀 **Live Demo:** https://agent-mission-control-webmcp-roan.vercel.app/

💻 **Source Code:** https://github.com/waldo870/agent-mission-control-webmcp

**Status:** Production deployed · Native WebMCP verified in Chrome · 38/38 tests passing

---

## 5 WebMCP Tools

Agent Mission Control exposes five tools through `document.modelContext`:

| Tool                  | Purpose                                             |
| --------------------- | --------------------------------------------------- |
| `list_tasks`          | List all tasks or filter them by status             |
| `create_task`         | Create a task as an AI agent                        |
| `update_task`         | Update task title, description, or status           |
| `complete_task`       | Mark a task as completed                            |
| `get_project_summary` | Read current mission progress and completion status |

The visual UI and WebMCP tools share the same `TaskService`, so actions performed by a human or an AI agent immediately appear in the same mission state.

---

## How to Test WebMCP

### 1. Enable WebMCP in Chrome

Open:

`chrome://flags/#enable-webmcp-testing`

Set **WebMCP for testing** to **Enabled**, then relaunch Chrome.

### 2. Open the production demo

https://agent-mission-control-webmcp-roan.vercel.app/

### 3. Open Chrome DevTools → Console

Check that WebMCP is available:

```js
'modelContext' in document
```

Expected:

```text
true
```

Discover the registered tools:

```js
const tools = await document.modelContext.getTools();
tools.map(t => t.name);
```

Expected:

```text
[
  "complete_task",
  "create_task",
  "get_project_summary",
  "list_tasks",
  "update_task"
]
```

### 4. Create a task through WebMCP

```js
const create = tools.find(t => t.name === "create_task");

await document.modelContext.executeTool(
  create,
  JSON.stringify({
    title: "WebMCP Demo Task",
    description: "Created through the WebMCP Imperative API"
  })
);
```

The new task should immediately appear in the **TO DO** column with **Agent** attribution.

This demonstrates the production path:

```text
AI Agent
   ↓
document.modelContext
   ↓
WebMCP Tool
   ↓
TaskService
   ↓
Shared State
   ↓
React UI
```

The human-facing UI and agent-facing WebMCP interface operate on the same application state.


A shared workspace where humans and web agents collaborate on the same task
board. **Humans** interact through the on-screen UI. **Web agents** interact
through the browser's native [WebMCP](https://webmachinelearning.github.io/webmcp/)
tools (`document.modelContext`). Both write through a single shared store, so
every agent action is visible in the human UI on the very next render, and
every human action is visible to the next agent call.

Mission seeded by default: **Launch an AI Workshop** — five coordinated tasks
across To do / In progress / Done columns and a live progress summary.

> WebMCP is an emerging browser API. This project tracks the upstream Chrome
> implementation and currently targets the
> `chrome://flags/#enable-webmcp-testing` flag in Chrome 149+. See
> [Limitations](#limitations).

---

## Why WebMCP fits this use case

Classical "AI task tools" copy the board's state into a server, hand it to a
remote model, then push the model's actions back. WebMCP turns the page itself
into a tool provider: every JS object that wants to be reachable from an agent
registers a function on `document.modelContext`, and the agent calls into the
page in the user's browser, in the user's session, with the user's current
DOM state. For a small, single-tab collaboration board this is the right
granularity — the agent does not need its own server, its own auth, or its own
CRUD layer; it shares the React component's source of truth.

This project demonstrates the minimal wiring that makes that work:

1. The same `TaskService` is used by both the React UI and the WebMCP tool
   callbacks, so a write through `create_task` re-renders the board and a
   human click re-enters the same mutation log that the agent sees.
2. The WebMCP tool descriptors carry stable `name`, `description`, and
   `inputSchema` (JSON Schema). Agents discover them via `getTools()` and call
   them via `executeTool(tool, JSON.stringify(input))` exactly as the
   imperative API requires.
3. Activity is attributed to the actor (`"human"` or `"agent"`) at the store
   level, not the UI level, so the timeline never gets the answer wrong.

---

## The five WebMCP tools

Every tool routes through one TaskService.

| Tool                   | Direction | Schema summary                                                  | Notes                                                              |
|------------------------|-----------|-----------------------------------------------------------------|--------------------------------------------------------------------|
| `list_tasks`           | read      | `{ status?: "todo" \| "doing" \| "done" }`                      | `status` is optional; returns the current shared state.            |
| `create_task`          | write     | `{ title: string, description?: string }`                       | Activity attributed to `agent`. UI updates immediately.            |
| `update_task`          | write     | `{ id: string, title?: string, description?: string, status?: ... }` | No-op when nothing changes (`{changed:false, noOp:true}`). |
| `complete_task`        | write     | `{ id: string }`                                                | Idempotent — repeated calls return `{alreadyDone: true}`.          |
| `get_project_summary`  | read      | `{}`                                                            | Returns `{total, byStatus, percentComplete, lastUpdatedAt}`.       |

`executeTool(tool, input)` requires `input` to be a **JSON string**, not an
object. This is enforced by the adapter and exercised by the verification
tests.

---

## Architecture

```
┌────────────────────────────────┐         ┌──────────────────────────┐
│  React UI (humans)             │         │  document.modelContext    │
│  - MissionHeader               │         │  (agents)                 │
│  - TaskBoard (3 columns)       │         │  - list_tasks             │
│  - ProjectSummaryPanel         │         │  - create_task            │
│  - CreateTaskForm              │         │  - update_task            │
│  - ActivityTimeline (H/A)      │         │  - complete_task          │
│  - WebMCPStatus / ToolsPanel   │         │  - get_project_summary    │
└─────────────┬──────────────────┘         └─────────┬────────────────┘
              │                                       │
              └─────────► TaskService ◄───────────────┘
                          (single source of truth)
                          │
                          ▼
                  localStorage (webmcp-taskboard:v1)
```

Layering:

| Path                          | Responsibility                                                |
|-------------------------------|---------------------------------------------------------------|
| `src/types/`                  | Pure data shapes (`Task`, `Actor`, `ActivityEvent`, …)        |
| `src/services/taskService.ts` | Reducer-style store. `commit()` is the only writer.          |
| `src/webmcp/adapter.ts`       | Builds tool descriptors; forwards abort signals to Chrome.   |
| `src/hooks/useTaskService.ts` | `useSyncExternalStore`-based reactive subscription.           |
| `src/components/`             | Render-only React components, no business logic.              |
| `src/mission/defaultMission.ts` | Seed data for the demo when localStorage is empty.          |

There is no backend, no auth, no API key, no third-party service, no fake
WebMCP shim. When `document.modelContext` is missing the UI shows a "WebMCP
unavailable" banner; nothing is faked.

---

## Setup

Requirements: Node 22+, pnpm.

```bash
pnpm install
pnpm dev
# open http://localhost:5173
```

The Vite dev server is bound to `0.0.0.0` by default so the app is reachable
from a remote preview that forwards the port. To bind to the loopback only
(typical for desktop Chrome development), use `pnpm dev:localhost` instead.

---

## Testing in real Chrome (WebMCP)

WebMCP is gated behind a Chrome flag during the origin trial.

1. Open `chrome://flags/#enable-webmcp-testing` in Chrome 149+.
2. Switch the dropdown to **Enabled**.
3. Click **Relaunch**.
4. Visit the app (`http://localhost:5173`, or the remote preview URL).
5. In DevTools → Console:
   ```js
   'modelContext' in document                                  // → true
   (await document.modelContext.getTools()).map(t => t.name)   // → 5 names, alpha-sorted
   ```

A complete per-tool walkthrough with the exact `executeTool(tool,
JSON.stringify({...}))` snippets lives in
[`REAL_BROWSER_TEST.md`](./REAL_BROWSER_TEST.md).

**Verification status (frozen):**

```
AUTOMATED_HARNESS   = PASS  (38/38 in `pnpm test`)
REAL_CHROME_WEBMCP  = PASS  (all 5 tools, manual)
CORE_STATUS         = FROZEN
```

---

## Scripts

| Command           | Purpose                                                  |
|-------------------|----------------------------------------------------------|
| `pnpm dev`        | Vite dev server on port 5173, bound to `0.0.0.0`         |
| `pnpm dev:localhost` | Vite dev server on port 5173, bound to `127.0.0.1` only  |
| `pnpm build`      | `tsc -b && vite build` — emits `dist/`                    |
| `pnpm preview`    | Preview the production build on port 4173                |
| `pnpm test`       | Run the Vitest suite (38 tests)                          |
| `pnpm typecheck`  | `tsc -b --noEmit`                                        |

---

## Repository layout

```
src/
├── App.tsx                         # Root component, WebMCP registration effect
├── main.tsx                        # React 19 createRoot + StrictMode
├── styles.css                      # All styles (design system is inline)
├── components/
│   ├── ActivityTimeline.tsx        # HUMAN / AGENT attribution log
│   ├── CreateTaskForm.tsx          # Human authoring form
│   ├── MissionHeader.tsx           # Title + mission goal
│   ├── ProjectSummaryPanel.tsx     # "Mission progress"
│   ├── TaskBoard.tsx               # 3-column board (To do / In progress / Done)
│   ├── WebMCPStatus.tsx            # Availability banner
│   └── WebMCPToolsPanel.tsx        # Lists the 5 registered tools
├── hooks/
│   └── useTaskService.ts           # Reactive subscription to TaskService
├── mission/
│   └── defaultMission.ts           # Seed when localStorage is empty
├── services/
│   └── taskService.ts              # Reducer store + commit() persistence
├── tests/                          # Vitest suite (slice 1, slice 2, register/unregister race)
├── types/
│   └── index.ts                    # Shared data shapes
└── webmcp/
    └── adapter.ts                  # Tool descriptors + AbortSignal-aware registration
```

---

## Limitations

- **localStorage-only persistence.** A task added in one tab is visible in
  this tab only (or after a same-browser reload). A real backend, SSE
  fan-out, or `BroadcastChannel`-based sync is out of scope.
- **Single-browser demo.** No cross-device sync, no auth, no per-user
  isolation. Two browsers on the same machine have independent task stores.
- **Experimental WebMCP.** The Chrome implementation behind
  `chrome://flags/#enable-webmcp-testing` is a developer-only preview; the API
  surface (`document.modelContext.registerTool`, `getTools`, `executeTool`) may
  evolve.
- **Frozen tool contract.** The five tool names, schemas, and return shapes
  are intentionally stable; any change here is breaking and must be coordinated
  with downstream agent prompts.

---

## License

[MIT](./LICENSE)
