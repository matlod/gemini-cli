# Session Handoff - MCP Bridge for Gemini CLI

**Date:** 2024-12-19
**Status:** Implementation complete, needs build & test

## What This Is

A fork of Google's Gemini CLI modified to act as an MCP server that Claude Code can consume. Gemini becomes Claude's "intern" - handling grunt work, providing second opinions, and gathering context.

## Architecture Overview

```
Claude Code ──MCP (stdio)──▶ MCP Bridge ──HTTP──▶ A2A Server ──▶ Gemini 3.0
                             (features/         (packages/
                              mcp-bridge/)       a2a-server/)
```

**Key insight:** The A2A server (`packages/a2a-server/`) was already fully built by Google. We just created a thin MCP translation layer.

## What Was Built

### 1. MCP Bridge (`features/mcp-bridge/`)

Location chosen to keep mods separate from upstream for easy maintenance.

```
features/mcp-bridge/
├── src/
│   ├── index.ts        # MCP server - 9 tools, full A2A coverage
│   └── a2a-client.ts   # HTTP client for A2A server
├── dist/               # Build output (run npm run build)
├── package.json
├── tsconfig.json
└── README.md
```

### 2. MCP Tools (Full A2A Coverage)

| Tool | Purpose |
|------|---------|
| `gemini_task` | Send task to Gemini, get response with pending approvals |
| `gemini_respond` | Approve/deny tool calls (6 decision types including edit) |
| `gemini_status` | Get task status, available tools, MCP servers |
| `gemini_cancel` | Cancel running task |
| `gemini_list_sessions` | List all active sessions |
| `gemini_consult` | Quick sync consultation (auto-execute mode) |
| `gemini_command` | Execute CLI commands (init, restore, extensions) |
| `gemini_list_commands` | List available CLI commands |
| `gemini_info` | Get agent card (capabilities, skills, version) |

### 3. A2A Client Features

- Full type definitions for A2A protocol
- SSE event parsing with streaming support
- Structured event parsing (text, thoughts, citations, tool calls)
- All tool confirmation outcomes including `modify_with_editor`
- Command execution (streaming and non-streaming)

## What's Already Done (Upstream)

The `packages/a2a-server/` is a complete A2A implementation:
- Task management with state machine
- Tool confirmation flow
- SSE streaming
- Persistence (InMemory or GCS)
- YOLO/auto-execute mode
- Commands: init, restore, extensions

## Next Steps

### 1. Build the Bridge
```bash
cd features/mcp-bridge
npm install  # Already done
npm run build  # NEEDS TO BE RUN
```

### 2. Start A2A Server
```bash
# From project root - use fixed port and OAuth auth
CODER_AGENT_PORT=41242 USE_CCPA=true npm run start -w packages/a2a-server
# Runs on http://localhost:41242
```

**Note:** You must first login via `npm run cli` to create OAuth credentials.

### 3. Configure Claude Code

Copy and customize the example settings file:
```bash
cp .claude/settings.json.example ~/.claude/settings.json
# Edit and replace /REPLACE/WITH/YOUR/PATH with your actual path
```

Or manually add to `~/.claude/settings.json`:
```json
{
  "mcpServers": {
    "gemini": {
      "command": "node",
      "args": ["/YOUR/PATH/TO/gemini-cli/features/mcp-bridge/dist/index.js"],
      "env": {
        "A2A_SERVER_URL": "http://localhost:41242"
      }
    }
  }
}
```

### 4. Test Flow
```
1. Call gemini_info - verify connection
2. Call gemini_task with simple query
3. If tool approval needed, call gemini_respond
4. Call gemini_consult for second opinion test
```

## Key Files to Read

| File | Why |
|------|-----|
| `ARCHITECTURE.md` | Full design doc with A2A protocol details |
| `features/mcp-bridge/README.md` | Bridge usage docs |
| `features/mcp-bridge/AUTHENTICATION.md` | Auth options (OAuth vs API key) |
| `features/mcp-bridge/MODEL_CONFIGURATION.md` | Model selection analysis & A2A fork plan |
| `packages/a2a-server/src/types.ts` | A2A event types |
| `packages/a2a-server/src/config/config.ts` | Auth selection logic (lines 102-125) |
| `packages/a2a-server/src/http/app.ts` | HTTP endpoints |
| `packages/a2a-server/src/agent/task.ts` | Tool confirmation logic |
| `packages/core/src/code_assist/oauth2.ts` | OAuth flow, credential caching |
| `packages/core/src/config/models.ts` | Model constants (Flash, Pro, etc.) |

## A2A Protocol Quick Reference

### Event Flow
```
POST / with message → SSE stream
  submitted → working → [tool events] → input-required (final)
```

### Tool Confirmation Response
```json
{
  "kind": "message",
  "role": "user",
  "parts": [{"kind": "data", "data": {"callId": "xxx", "outcome": "proceed_once"}}],
  "messageId": "uuid",
  "taskId": "xxx"
}
```

### Outcomes
- `proceed_once` - Execute once
- `cancel` - Don't execute
- `proceed_always` - Trust all future
- `proceed_always_tool` - Trust this tool type
- `proceed_always_server` - Trust this MCP server
- `modify_with_editor` - Edit content before save

## Use Cases

1. **Grunt Work (Flash, async):** "Generate 20 test fixtures"
2. **Context Gathering (Flash, async):** "Find all auth-related files"
3. **Plan Review (Pro, sync):** "Review this implementation plan"
4. **Second Opinion (Pro, sync):** "Any bugs in this code?"
5. **Project Init:** `gemini_command("init")` creates GEMINI.md

## Known Issues / TODOs

1. ~~Build not yet verified after final changes~~ ✅ Build works
2. Real streaming not implemented (buffered SSE parsing)
3. No integration tests yet
4. ~~May need Gemini API key setup in A2A server~~ ✅ See [AUTHENTICATION.md](./AUTHENTICATION.md)
5. **Model Selection Gap:** A2A server doesn't support per-request model selection
   - See [MODEL_CONFIGURATION.md](./MODEL_CONFIGURATION.md) for full analysis
   - Currently both delegate_task and consult use same model (determined by settings)
   - Need to fork A2A server to add `model` to AgentSettings

## Authentication

**Use CLI account auth (not API key):**

```bash
# 1. Login via CLI first (one-time, creates ~/.gemini/oauth_creds.json)
npm run cli  # Complete browser OAuth flow

# 2. Start A2A server with USE_CCPA and FIXED PORT
CODER_AGENT_PORT=41242 USE_CCPA=true npm run start -w packages/a2a-server
```

**Important:** Always set `CODER_AGENT_PORT=41242` - without it, the server picks a random port each time.

See [AUTHENTICATION.md](./AUTHENTICATION.md) for full details on auth options.

## Environment

- Node 20+
- TypeScript 5.3+
- MCP SDK 1.0+
- Working dir: `/home/matlod1/Documents/AI/modcli/gemini-cli`
- Branch: `main` (fork of google/gemini-cli)

## Lessons Learned / Gotchas

### 1. A2A Server Already Existed
Don't rebuild what's there. `packages/a2a-server/` is production-ready. We just needed a translation layer.

### 2. SSE Response Format
A2A uses JSON-RPC wrapped in SSE:
```
data: {"jsonrpc":"2.0","id":"taskId","result":{...event...}}\n\n
```
Parse the `result` field, not the whole JSON.

### 3. Tool Confirmation Flow
When Gemini needs approval:
1. Server sends `tool-call-confirmation` event with `status: "awaiting_approval"`
2. Server sends `input-required` state with `final: true`
3. Client sends data part with `{callId, outcome}`
4. Flow continues

The `final: true` is the signal that Gemini is blocked waiting.

### 4. Session vs Task IDs
- `taskId` - A2A's internal ID (changes per task)
- `contextId` - Conversation context (can persist)
- `sessionId` - Our MCP bridge's tracking ID (maps to taskId+contextId)

### 5. Test Files Are Gold
`packages/a2a-server/src/http/app.test.ts` shows exact request/response formats. Read it before debugging.

### 6. YOLO Mode
Set `autoExecute: true` in agentSettings OR use `ApprovalMode.YOLO` to skip all confirmations. Useful for `gemini_consult`.

### 7. Commands Need Workspace
Some commands (init, restore) require `CODER_AGENT_WORKSPACE_PATH` env var or they return 400.

### 8. MCP Stdio Transport
MCP bridge uses stdio - logs go to stderr, protocol goes to stdout. Don't console.log() in the bridge.

## Debugging Tips

```bash
# Test A2A server directly
curl http://localhost:41242/.well-known/agent-card.json

# Check if tasks exist
curl http://localhost:41242/tasks/metadata

# Watch A2A server logs
# (it logs to console when running)

# Test MCP bridge standalone
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node dist/index.js
```

## Why These Design Choices

| Choice | Rationale |
|--------|-----------|
| `features/` folder | Keep mods separate from upstream for clean merges |
| Thin MCP wrapper | A2A does the heavy lifting, we just translate |
| Session tracking in memory | Simple for v1, could add persistence later |
| Buffered SSE (not streaming) | MCP tools are request/response, streaming adds complexity |
| 9 tools | Full A2A coverage without bloat |

## If Something Breaks

1. **"A2A server not reachable"** → Start it: `cd packages/a2a-server && npm run start`
2. **"Session not found"** → Sessions are in-memory, restart clears them
3. **Build errors** → Check Node version (20+), run `npm install`
4. **Tool confirmation stuck** → Check the `callId` matches exactly
5. **Empty response** → Look for `final: true` event, might be waiting for input
