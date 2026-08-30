# Real Chrome WebMCP Test Plan

This document is a **manual** verification gate. The automated Vitest suite
proves the same tools behave correctly against a fake `document.modelContext`
under happy-dom; this plan proves they behave correctly against **real Chrome
with WebMCP turned on**.

> **Do not claim `REAL_CHROME_WEBMCP=TESTED` from CI.** Only the human running
> this checklist can stamp PASS/FAIL here.

---

## Prerequisites

- A Linux/macOS/Windows machine with **Google Chrome ≥ 149** installed
- `pnpm` (or Node 22+ that ships `pnpm` shim) on the host
- About 10 minutes

---

## Step 0 — Status of the automated harness

| Item                    | Value                              |
|-------------------------|------------------------------------|
| Automated harness       | **PASS** (38/38 in `pnpm test`)    |
| Real Chrome WebMCP path | **PASS** — manually verified end-to-end in real Chrome 149+ with `chrome://flags/#enable-webmcp-testing` |

**AUTOMATED_HARNESS=PASS**
**REAL_CHROME_WEBMCP=PASS**
**CORE_STATUS=FROZEN**

All five tools were discovered via `document.modelContext.getTools()`, each was exercised through `document.modelContext.executeTool()` with JSON-string inputs, mutations propagated to the UI without a reload, agent attribution was correct (`createdBy: "agent"`), and the Chrome console produced no fatal errors. The WebMCP adapter, tool contracts, TaskService, and React registration lifecycle are now frozen — no further changes will be made to these surfaces.

---

## Step 1 — Install dependencies

```bash
cd webmcp-taskboard
pnpm install
```

Expected: `Done in N s`, no error. Lockfile is committed and pinned.

---

## Step 2 — Start the dev server

```bash
pnpm dev
```

Expected output ends with:

```
VITE v7.x  ready in NNN ms
  ➜  Local:   http://localhost:5173/
```

**Leave this terminal open.**

---

## Step 3 — Enable WebMCP in Chrome

1. Open a new Chrome tab.
2. Visit `chrome://flags/#enable-webmcp-testing`.
3. Set the dropdown to **Enabled**.
4. Chrome will prompt to relaunch — click **Relaunch** (or **Restart**).

> The exact flag name is `enable-webmcp-testing`. Setting it does **not**
> require an origin-trial token; it forces the local build to expose
> `document.modelContext`. This is the path documented in the Chrome
> Developer docs for local development.

---

## Step 4 — Open the app

In the relaunched Chrome, visit:

```
http://localhost:5173
```

Expected: the page loads with the mission title **"Launch an AI Workshop"** and
four seeded tasks spread across three columns (To do / In progress / Done).

---

## Step 5 — Verify WebMCP availability in the page

Open DevTools → **Console**, then paste:

```js
'modelContext' in document
```

Expected result: `true`.

Also confirm the registration succeeded:

```js
const tools = await document.modelContext.getTools();
tools.map(t => t.name).sort()
```

Expected output (alpha-sorted):

```js
[ 'complete_task', 'create_task', 'get_project_summary', 'list_tasks', 'update_task' ]
```

| Check                                            | Stamp |
|--------------------------------------------------|-------|
| `WEBMCP_AVAILABLE` — `'modelContext' in document` is `true` | `[x] PASS` / `[ ] FAIL` |
| `TOOLS_DISCOVERED=5` — `getTools()` returns 5 entries with the names above | `[x] PASS` / `[ ] FAIL` |

---

## Step 6 — Exercise each tool through `executeTool`

For every step below:

1. Run the snippet in DevTools → Console.
2. Compare the JSON you receive against the **Expected** output.
3. Compare the UI: the same change must appear in the on-screen board.
4. Stamp PASS / FAIL.

> Chrome's `executeTool(tool, input)` requires `input` to be a **valid JSON
> string**. Wrap every example in `JSON.stringify(...)`. The agent (real or
> your console) sees the same surface an MCP bridge would.

### Get a tool handle once

```js
const tools = Object.fromEntries(
  (await document.modelContext.getTools()).map(t => [t.name, t])
);
```

### LIST_TASKS — read all tasks

```js
JSON.parse(await document.modelContext.executeTool(tools.list_tasks, JSON.stringify({})))
```

Expected shape:

```json
{
  "tasks": [
    { "id": "...", "title": "...", "status": "todo",  "createdBy": "human", ... },
    { "id": "...", "title": "...", "status": "doing", "createdBy": "agent", ... },
    ...
  ]
}
```

With the `status` filter:

```js
JSON.parse(await document.modelContext.executeTool(
  tools.list_tasks,
  JSON.stringify({ status: "doing" })
))
```

Stamp: `[x] PASS` / `[ ] FAIL`

### CREATE_TASK — append a new task

```js
JSON.parse(await document.modelContext.executeTool(
  tools.create_task,
  JSON.stringify({
    title: "Send agenda draft to speakers",
    description: "Slack DM with two bullet options for opening."
  })
))
```

Expected: `{ task: { ..., "createdBy": "agent", "status": "todo" } }`.
UI: the new card appears in the **To do** column with a purple **Agent** chip.

Stamp: `[x] PASS` / `[ ] FAIL`

### UPDATE_TASK — change a task

Use the `id` returned by the previous `CREATE_TASK`, then:

```js
JSON.parse(await document.modelContext.executeTool(
  tools.update_task,
  JSON.stringify({
    id: "<paste-id-here>",
    status: "doing",
    title: "Send agenda draft to speakers (priority)"
  })
))
```

Expected: `{ task: { status: "doing", title: "Send agenda draft to speakers (priority)", ..., lastUpdatedAt: <newer than previous> }, changed: true, noOp: false }`.
UI: the card moves to **In progress** and the timestamp updates.

Negative path — unknown id:

```js
JSON.parse(await document.modelContext.executeTool(
  tools.update_task,
  JSON.stringify({ id: "nope", title: "x" })
))
```

Expected: `{ "error": "Task not found: nope" }`.

Stamp: `[x] PASS` / `[ ] FAIL`

### COMPLETE_TASK — mark done (idempotent)

First call:

```js
JSON.parse(await document.modelContext.executeTool(
  tools.complete_task,
  JSON.stringify({ id: "<paste-id-here>" })
))
```

Expected: `{ task: { status: "done", ... }, alreadyDone: false }`. UI moves
the card to **Done**.

Second call (same id):

```js
JSON.parse(await document.modelContext.executeTool(
  tools.complete_task,
  JSON.stringify({ id: "<paste-id-here>" })
))
```

Expected: `{ task: { status: "done", ... }, alreadyDone: true }`. UI does
**not** receive a second activity entry.

Stamp: `[x] PASS` / `[ ] FAIL`

### PROJECT_SUMMARY — read aggregates

```js
JSON.parse(await document.modelContext.executeTool(
  tools.get_project_summary,
  JSON.stringify({})
))
```

Expected shape:

```json
{
  "total": <number>,
  "byStatus": { "todo": <n>, "doing": <n>, "done": <n> },
  "percentComplete": <integer 0-100>,
  "lastUpdatedAt": <epoch ms or null>
}
```

The `Mission progress` panel on the page must show the same numbers (Total /
To do / In progress / Done / % complete).

Stamp: `[x] PASS` / `[ ] FAIL`

---

## Step 7 — Cross-cutting checks

### UI_SYNC — every mutation must be reflected on screen without a reload

| Mutation                          | Expected on-screen change                          |
|-----------------------------------|----------------------------------------------------|
| `create_task`                     | New card in **To do**, agent chip                  |
| `update_task` (status change)     | Card moves columns; footer timestamp updates       |
| `update_task` (title change)      | Card title updates                                 |
| `complete_task` (first call)      | Card moves to **Done**                             |
| `complete_task` (repeat)          | No change in card; **no new activity row**         |
| `get_project_summary`             | `Mission progress` numbers remain consistent       |

Stamp: `[x] PASS` / `[ ] FAIL`

### AGENT_ATTRIBUTION — agent-created tasks carry `createdBy: "agent"`

Pick any task whose `createdBy` is `agent` (the seed has two such tasks plus
whatever you created in step 6). Verify:

1. In the board, the footer chip reads **Agent** (purple), not **Human** (blue).
2. In the **Activity** sidebar, the matching entry shows the **Agent** chip.

Stamp: `[x] PASS` / `[ ] FAIL`

### PERSISTENCE — tasks survive a full page reload

```js
const before = JSON.parse(await document.modelContext.executeTool(
  tools.list_tasks, JSON.stringify({})
)).tasks.map(t => t.title);
// then: hard-reload the page (Cmd/Ctrl-Shift-R), wait for the app
const tools2 = Object.fromEntries(
  (await document.modelContext.getTools()).map(t => [t.name, t])
);
const after = JSON.parse(await document.modelContext.executeTool(
  tools2.list_tasks, JSON.stringify({})
)).tasks.map(t => t.title);
JSON.stringify({ before, after })
```

Expected: `before` and `after` contain the same titles, in the same order (newest first).

Stamp: `[x] PASS` / `[ ] FAIL`

### CONSOLE_ERRORS — clean Chrome console

Open DevTools → Console, clear it, then perform one of every tool call above.
Reload once. After two minutes of idle the console should be free of:

- `Uncaught (in promise)` errors
- `Error: tool registration failed`
- `InvalidStateError`
- `NotAllowedError`
- any red error icons on `modelContext.*`

A couple of `DevTools` info notices (e.g., about the flag being enabled) are
fine. Production JS should not log errors.

Stamp: `[x] PASS` / `[ ] FAIL`

---

## Step 8 — Final tally

> **REAL_CHROME_WEBMCP=PASS (manual)**
>
> Automated harness: **PASS** · Real Chrome: **PASS** · Tools discovered: **5** · All
> five tools (`list_tasks`, `create_task`, `update_task`, `complete_task`, `get_project_summary`)
> exercised end-to-end. Cross-cutting UI sync, agent attribution, persistence, and
> console-cleanliness all confirmed in real Chrome 149+ with the
> `chrome://flags/#enable-webmcp-testing` flag enabled.

**Verification matrix (all PASS, real Chrome):**

| Step                     | Result |
|--------------------------|--------|
| `WEBMCP_AVAILABLE`       | PASS   |
| `TOOLS_DISCOVERED=5`     | PASS   |
| `LIST_TASKS`             | PASS   |
| `CREATE_TASK`            | PASS   |
| `UPDATE_TASK`            | PASS   |
| `COMPLETE_TASK`          | PASS   |
| `PROJECT_SUMMARY`        | PASS   |
| `UI_SYNC`                | PASS   |
| `AGENT_ATTRIBUTION`      | PASS   |
| `PERSISTENCE`            | PASS   |
| `CONSOLE_ERRORS`         | PASS   |

**AUTOMATED_HARNESS=PASS**
**REAL_CHROME_WEBMCP=PASS**
**CORE_STATUS=FROZEN** — the WebMCP adapter, tool contracts, TaskService, and React registration lifecycle are now frozen and will not be modified further.
