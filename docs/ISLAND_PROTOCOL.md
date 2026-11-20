# Agent Island protocol: show any AI agent on the island

The island shows what an AI coding agent is doing: thinking, reading, running a command, waiting for you, done, out of quota. Claude Code and Codex are read from their own files. **GitHub Copilot CLI** and **OpenCode** have adapters (sections 6 and 7). Every other agent can report to the island itself by appending one line of JSON per event to a file. No server, no port, no login, no library: if the agent can run a command or write a file, it can use the island.

The island reads local files only. Nothing is sent anywhere.

## 1. Where to write

Append to any `*.jsonl` file in the feed folder:

```
%LOCALAPPDATA%\dev.dotdock.desktop\agents\
```

- Create the folder if it does not exist. The island creates it at start, so it is normally there.
- Pick any file name ending in `.jsonl`, for example `aider-<pid>.jsonl`. One file per agent process or per session keeps writers apart; one file may hold many sessions.
- Names starting with a dot are ignored, so write temp files as `.name.tmp` if you must.
- Files nobody wrote to for 24 hours are deleted by the island. Do not keep anything there.

## 2. One line, one event

Each line is a JSON object on a single line, UTF-8, ending in `\n`, at most 32 KiB. Append the whole line in one write call so two writers never interleave. Lines that are not valid JSON, are too long or name an unknown phase are skipped; the rest of the file is still read.

```json
{"v":1,"agent":"aider","name":"Aider","session":"s1","at":1795062601000,"phase":"editing","tool":"edit","detail":"app.css","cwd":"D:\\work\\dotDock","tokens_out":812,"pid":4242}
```

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `v` | number | no | Protocol version. `1` today. A line that names another version is skipped. |
| `agent` | string | **yes** | Who you are, as an id: lower case, up to 16 characters of `a-z 0-9 - _` (anything else becomes `-`). `copilot` and `opencode` are the built-in adapters' ids; use your own for anything else. |
| `name` | string | no | Display name for toasts and labels (up to 24 characters). Without it the island shows `agent`. |
| `session` | string | **yes** | Your id for this session (up to 36 characters of `a-z A-Z 0-9 - _`; other characters are dropped). Each session is shown separately and can be paged to. |
| `at` | number | no | When it happened, Unix time in **milliseconds**. Without it the time the island read the line is used. A time in the future is treated as now. |
| `phase` | string | no | What the agent is doing now. See section 3. A line without `phase` only updates the fields below. |
| `tool` | string | no | The tool in use (`Read`, `Bash`, `edit`...). Belongs to `phase`. |
| `detail` | string | no | The one short thing the tool works on: a file name, a search pattern, a command. At most 80 characters are shown. Obvious secrets in commands (`--token x`, `API_KEY=x`, `sk-...`) are masked. Belongs to `phase`. |
| `cwd` | string | no | The folder the agent works in. The folder's name becomes the project name. |
| `project` | string | no | A project name to show instead of the folder's name. |
| `title` | string | no | What the session is about, shown when there is no `detail` (up to 80 characters). Send a title, not the prompt. |
| `summary` | string | no | What was done, with `phase: "done"`. The first readable line is shown. |
| `tokens_out` | number | no | Output tokens produced in the current turn. Only send real numbers; the island never estimates. |
| `context` | number | no | Tokens in the context window after the latest reply. |
| `problem` | object | no | With `phase: "limit"` or `"error"`: `{"kind":"usage_limit","message":"Session limit","resets":"5pm"}`. `kind` is one of `usage_limit`, `login`, `connection`, `overloaded`, `model`, `api` (default `api`). `message` is a short label, `resets` the reset time as you want it shown. |
| `pid` | number | no | Process id of the agent. When that process ends the session shows **Stopped**. Without it a session that goes quiet for 5 minutes while working is dropped. |

A wrongly typed field (a string where a number belongs) is ignored; the rest of the line still counts.

## 3. Phases

| `phase` | Show it when | Island |
| --- | --- | --- |
| `thinking` | The model is working and no tool is running. | Thinking |
| `reading` | A tool reads a file or a page. | Reading |
| `searching` | A tool searches files or the web. | Searching |
| `editing` | A tool writes or edits a file. | Editing |
| `running` | A command is running. | Running |
| `waiting` | The agent is blocked on you: a permission prompt, a question. Put what it asks in `detail`. Sound and notification fire. | Needs you |
| `done` | The turn is finished. Put the result in `summary`. Sound and notification fire. Stays visible for a few seconds (a setting). | Done |
| `paused` | You interrupted it. | Paused |
| `limit` | Out of quota. Add `problem` with `resets` when you know it. | Limit reached |
| `error` | It failed: signed out, offline, server busy, no model. Add `problem`. | by `problem.kind` |
| `stopped` | The session was closed. | Stopped |
| `idle` | Nothing is happening; the session is hidden. | nothing |

Every `thinking`..`running` event while the session was not already active **starts a turn**: the island starts its stopwatch and the token count at 0. `done`, `paused`, `limit`, `error`, `stopped` end it. Send `tokens_out` as the running total of the turn, not a delta.

`tool`, `detail`, `summary` and `problem` replace what was there whenever a `phase` arrives, so a new phase never shows the last phase's file. Send them with the phase they belong to.

## 4. What a good integration sends

Mapped onto the events almost every agent has:

| The agent's moment | Line |
| --- | --- |
| You press enter on a prompt | `{"agent":"x","session":"s","phase":"thinking","cwd":"..."}` |
| A tool is about to run | `{"agent":"x","session":"s","phase":"reading","tool":"Read","detail":"lib.rs"}` |
| A tool returned | `{"agent":"x","session":"s","phase":"thinking"}` |
| A reply streamed or a step ended | `{"agent":"x","session":"s","tokens_out":1284}` |
| It asks you something | `{"agent":"x","session":"s","phase":"waiting","detail":"Run npm test?"}` |
| The turn ended | `{"agent":"x","session":"s","phase":"done","summary":"Fixed the header layout."}` |
| You pressed Esc | `{"agent":"x","session":"s","phase":"paused"}` |
| The API said no | `{"agent":"x","session":"s","phase":"limit","problem":{"kind":"usage_limit","message":"Session limit","resets":"5pm"}}` |
| The process exits | `{"agent":"x","session":"s","phase":"stopped"}` |

Send `pid` once (any line) so a crash shows as Stopped instead of Thinking forever.

## 5. Examples

PowerShell (also fine from a hook script):

```powershell
$feed = Join-Path $env:LOCALAPPDATA 'dev.dotdock.desktop\agents'
New-Item -ItemType Directory -Force $feed | Out-Null
$line = @{ v = 1; agent = 'myagent'; session = 'run1'; phase = 'running'; tool = 'shell'; detail = 'cargo test'
           at = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(); pid = $PID } | ConvertTo-Json -Compress
Add-Content -Path (Join-Path $feed 'myagent-run1.jsonl') -Value $line -Encoding utf8
```

Bash (Git Bash, WSL writes to `/mnt/c/...`):

```bash
feed="$LOCALAPPDATA/dev.dotdock.desktop/agents"; mkdir -p "$feed"
printf '{"v":1,"agent":"myagent","session":"run1","phase":"done","summary":"All tests pass"}\n' >> "$feed/myagent-run1.jsonl"
```

Node:

```js
import { appendFileSync, mkdirSync } from "node:fs";
const feed = `${process.env.LOCALAPPDATA}\\dev.dotdock.desktop\\agents`;
mkdirSync(feed, { recursive: true });
const report = (event) =>
  appendFileSync(`${feed}\\myagent-${process.pid}.jsonl`, JSON.stringify({ v: 1, agent: "myagent", at: Date.now(), pid: process.pid, ...event }) + "\n");
report({ session: "run1", phase: "thinking", cwd: process.cwd() });
```

To see it work without any agent, run the PowerShell example and look at the notch: it shows **Running · cargo test** within a fraction of a second.

## 6. GitHub Copilot CLI

Connect in the island settings writes one file, `%USERPROFILE%\.copilot\hooks\dotdock-island.json` (`$COPILOT_HOME\hooks` when that is set), and nothing else. Copilot CLI loads every `*.json` in that folder as hooks. The file registers the island's hook program for `sessionStart`, `userPromptSubmitted`, `preToolUse`, `postToolUse`, `postToolUseFailure`, `errorOccurred`, `agentStop`, `sessionEnd` and `notification`, in the `exec` form (no shell starts):

```json
{ "type": "command", "exec": "C:/Users/me/AppData/Local/dev.dotdock.desktop/island/dotdock-island-hook-<hash>.exe",
  "args": ["--agent", "copilot", "--event", "preToolUse", "--spool", "C:/Users/me/AppData/Local/dev.dotdock.desktop/agents"],
  "timeoutSec": 5 }
```

The hook reads the event JSON Copilot sends on stdin and appends one protocol line to `copilot-<session>.jsonl` in the feed folder; it exits 0 and prints nothing, so it never approves, denies or changes anything. Disconnect deletes the file. Restart Copilot CLI sessions that were open before Connect: hooks are read at session start.

| Copilot event | Island |
| --- | --- |
| `userPromptSubmitted`, `postToolUse`, `postToolUseFailure` | Thinking |
| `preToolUse` | Reading, Searching, Editing or Running, with the file, pattern or command from `toolArgs`; `ask_user` is Needs you |
| `notification` with `notification_type` `permission_prompt` or `elicitation_dialog` | Needs you, with Copilot's message |
| `agentStop` | Done (Copilot sends no reply text, so there is no summary) |
| `errorOccurred` with `recoverable` not true | Error, or Limit when the message says so |
| `sessionEnd`: `user_exit`, `abort`, `error` or `timeout` | Stopped, Paused, Error |

Prompts, tool results and file contents in the payload are never copied. Hooks registered under PascalCase event names (`PreToolUse`...) send the same data in snake_case and are read too.

## 7. OpenCode

OpenCode 2 runs plugins inside its server. Connect writes one file, `%USERPROFILE%\.config\opencode\plugins\dotdock-island.js` (`$XDG_CONFIG_HOME\opencode\plugins` when that is set), and nothing else; OpenCode loads local plugins from that folder on its own. The plugin subscribes to OpenCode's event stream and appends adapter lines to `opencode-<pid>.jsonl`:

```json
{"v":1,"adapter":"opencode","pid":4242,"event":{"id":"evt_...","type":"session.tool.called","created":1795062601000,
 "location":{"directory":"D:\\work\\dotDock"},"data":{"sessionID":"ses_...","id":"call_1","input":{"filePath":"D:\\work\\dotDock\\src\\lib.rs"}}}}
```

The island translates them (`session.execution.started` is Thinking, `session.tool.called` shows the tool and its file or command, `permission.asked` is Needs you, `session.execution.succeeded` is Done with the first line of the last reply, `session.execution.failed` is Error or Limit, `session.execution.interrupted` is Paused). Sub-agent sessions are folded into their parent's `task` call; duplicate events are dropped. The plugin copies no prompt, tool output or file contents: tool input is cut down to the fields that name a file, pattern, command or address, and a reply to its first 300 characters. Disconnect deletes the file. Restart OpenCode after Connect or Disconnect.

OpenCode 1.x loads a different plugin format; Connect supports 2.x only (`docs/BLOCKERS.md`).

## 8. Guarantees and limits

- The island never writes to the feed folder, only reads and deletes files older than 24 hours.
- It follows only the last 256 KiB of a file it meets for the first time, so a long log from yesterday costs nothing.
- Feed sessions appear in the pager next to Claude Code and Codex sessions and respect the same settings (size, sound, notifications, how long a finished task stays). **Click to focus** raises the terminal that owns `pid`; without `pid` the island cannot tell which window it is.
- Connect and Disconnect are one file each (sections 6 and 7) and leave the agent's other files byte for byte as they were. Claude Code's Connect is described in `docs/ISLAND_INTEGRATION.md`.
- The protocol is versioned by `v`. Additions are new optional fields; a change that breaks a line's meaning gets `v: 2`, and the island keeps reading `v: 1`.
