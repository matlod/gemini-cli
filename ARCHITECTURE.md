# Gemini CLI Integration - Architecture

## Vision

Transform Gemini CLI into an agent that Claude Code supervises. Claude acts as the **Senior SWE**, delegating to Gemini as either:
- **Gemini 3.0 Flash** - Async intern for grunt work
- **Gemini 3.0 Pro** - Senior peer for plan review and second opinions

---

## DISCOVERY: Existing A2A Server Package

The codebase already has a **fully-featured Agent-to-Agent server** at `packages/a2a-server/` using Google's `@a2a-js/sdk`. This changes everything.

### What A2A Already Provides

| Feature | Status | Location |
|---------|--------|----------|
| Task creation/management | ✅ Done | `executor.ts`, `task.ts` |
| Tool confirmation requests | ✅ Done | `ToolCallConfirmationEvent` |
| Tool confirmation responses | ✅ Done | `_handleToolConfirmationPart()` |
| Async execution | ✅ Done | `CoderAgentExecutor.execute()` |
| Event streaming (SSE) | ✅ Done | `app.ts` |
| State machine | ✅ Done | `submitted → working → input-required → completed` |
| Persistence | ✅ Done | `InMemoryTaskStore`, `GCSTaskStore` |
| Auto-execute mode | ✅ Done | `autoExecute`, `YOLO` mode |
| Command system | ✅ Done | `commandRegistry` |

### A2A Event Types (Already Defined)

```typescript
// From packages/a2a-server/src/types.ts
enum CoderAgentEvent {
  ToolCallConfirmationEvent = 'tool-call-confirmation',  // Needs decision
  ToolCallUpdateEvent = 'tool-call-update',              // Status update
  TextContentEvent = 'text-content',                     // Text output
  StateChangeEvent = 'state-change',                     // Task state
  ThoughtEvent = 'thought',                              // Agent thinking
  CitationEvent = 'citation',                            // Sources
}
```

### Tool Confirmation Outcomes (Already Defined)

```typescript
// From @google/gemini-cli-core
enum ToolConfirmationOutcome {
  ProceedOnce,           // Execute this once
  Cancel,                // Don't execute
  ProceedAlways,         // Trust all future
  ProceedAlwaysServer,   // Trust this MCP server
  ProceedAlwaysTool,     // Trust this tool type
  ModifyWithEditor,      // Edit before execute
}
```

### A2A HTTP Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/.well-known/agent-card.json` | GET | Agent capabilities |
| `/tasks` | POST | Create new task |
| `/tasks/:taskId/metadata` | GET | Get task status |
| `/tasks/metadata` | GET | List all tasks |
| `/executeCommand` | POST | Execute command (SSE stream) |
| `/listCommands` | GET | List available commands |
| Standard A2A endpoints | * | Via `A2AExpressApp.setupRoutes()` |

### A2A Protocol Flow (From Tests)

The tests in `app.test.ts` reveal the exact SSE event flow:

**1. Basic Message Flow:**
```
POST / with message → SSE stream
  Event 1: {kind: "status-update", status: {state: "submitted"}}
  Event 2: {kind: "status-update", status: {state: "working"}}
  Event 3: {kind: "status-update", metadata: {coderAgent: {kind: "text-content"}}}
  Event 4: {kind: "status-update", status: {state: "input-required"}, final: true}
```

**2. Tool Call Requiring Approval:**
```
POST / with message → SSE stream
  Event: {state: "submitted"}
  Event: {state: "working"}
  Event: {coderAgent: {kind: "state-change"}}
  Event: {coderAgent: {kind: "tool-call-update"}, data: {status: "validating"}}
  Event: {coderAgent: {kind: "tool-call-confirmation"}, data: {status: "awaiting_approval"}}
  Event: {state: "input-required", final: true}  ← WAITS HERE FOR DECISION
```

**3. Sending Tool Confirmation:**
```typescript
// POST / with confirmation message
{
  parts: [{
    kind: "data",
    data: {
      callId: "test-call-id",
      outcome: "proceed_once"  // or "cancel", "proceed_always", etc.
    }
  }]
}
```

**4. Tool Lifecycle (YOLO/auto-execute mode):**
```
validating → scheduled → executing → success
```

**5. SSE Event Format:**
```
data: {"jsonrpc":"2.0","id":"taskId","result":{...event...}}\n\n
```

### Tool Confirmation Outcomes
From `task.ts` `_handleToolConfirmationPart()`:
- `proceed_once` → Execute this tool once
- `cancel` → Don't execute
- `proceed_always` → Trust all future tool calls
- `proceed_always_server` → Trust this MCP server
- `proceed_always_tool` → Trust this tool type
- `modify_with_editor` → Edit before execute (for file edits)

---

## Integration Options

### Option A: MCP Wrapper Around A2A (Recommended)

Create a thin MCP server that internally calls the A2A server.

```
Claude Code ──MCP──▶ MCP Wrapper ──HTTP──▶ A2A Server ──▶ Gemini
```

**Pros:**
- Leverages ALL existing A2A infrastructure
- MCP is Claude Code's native protocol
- Minimal new code - just translation layer
- A2A handles task state, persistence, tool execution

**Cons:**
- Extra hop (MCP → HTTP → A2A)
- Need to map A2A events to MCP notifications

**Implementation:**
```typescript
// packages/mcp-bridge/src/server.ts
const mcpServer = new McpServer();

mcpServer.tool("gemini_task", async (params) => {
  // POST to A2A /tasks endpoint
  const response = await fetch("http://localhost:41242/tasks", {
    method: "POST",
    body: JSON.stringify({ ...params })
  });
  return response.json();
});
```

### Option B: Direct A2A Client

Build a custom client that speaks A2A protocol directly.

```
Claude Code ──HTTP──▶ A2A Server ──▶ Gemini
```

**Pros:**
- No translation layer
- Direct access to all A2A features
- Full streaming support

**Cons:**
- Claude Code doesn't natively speak A2A
- Would need custom tool that makes HTTP calls
- More complex event handling

### Option C: Hybrid - A2A with MCP Sampling

Use A2A for task execution, MCP sampling for decisions.

```
Claude Code ◀──MCP Sampling──▶ Bridge ──HTTP──▶ A2A Server
```

**Pros:**
- Decisions routed via MCP (native)
- A2A handles heavy lifting
- Best of both worlds

**Cons:**
- Most complex to implement
- MCP sampling support varies

---

## Recommended Approach: Option A (MCP Wrapper)

The MCP wrapper is the sweet spot:
1. **Minimal code** - A2A already does 90% of the work
2. **Native protocol** - Claude Code speaks MCP fluently
3. **Clean separation** - MCP layer is thin, A2A does execution

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Claude Code                             │
└────────────────────────┬────────────────────────────────────┘
                         │ MCP Protocol (Stdio)
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                    MCP Bridge                                │
│  ┌─────────────────────────────────────────────────────────┐│
│  │  Tools:                                                  ││
│  │    gemini_task_start → POST /tasks                      ││
│  │    gemini_respond    → POST /message (confirmation)     ││
│  │    gemini_status     → GET /tasks/:id/metadata          ││
│  │    gemini_consult    → POST (sync, wait for response)   ││
│  └─────────────────────────────────────────────────────────┘│
└────────────────────────┬────────────────────────────────────┘
                         │ HTTP + SSE
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                 A2A Server (Existing)                        │
│  • Task management     • Tool confirmation                   │
│  • Event streaming     • Persistence                         │
│  • Gemini integration  • Command registry                    │
└─────────────────────────────────────────────────────────────┘
```

---

## Mental Model

```
Claude Code (Senior SWE - Supervisor)
    │
    │  MCP Protocol (bidirectional)
    │
    ├── Gemini 3.0 Flash (Intern - Async Worker)
    │   • Grunt work with clear specs
    │   • Context gathering / codebase exploration
    │   • Data generation, test fixtures
    │   • Batch operations (rename, refactor)
    │   • Runs in background, Claude reviews output
    │
    └── Gemini 3.0 Pro (Senior Peer - Consultant)
        • Plan review before execution
        • Fresh perspective on complex problems
        • Architecture decisions
        • Catches blind spots Claude might miss
```

## Interaction Flow

This is **bidirectional** - not just request/response:

```
Claude Code                         Gemini CLI (MCP Server)
     │                                       │
     │─── start_task("analyze auth code") ──▶│
     │                                       │ Flash starts working
     │    (Claude continues other work)      │
     │                                       │
     │◀── decision_needed("run grep?") ──────│
     │─── respond("approved") ──────────────▶│
     │                                       │
     │◀── decision_needed("read 50 files?") ─│
     │─── respond("just .ts files") ────────▶│
     │                                       │
     │◀── progress("found 12 auth files") ───│
     │                                       │
     │◀── task_complete(analysis_result) ────│
     │                                       │
     │─── consult_pro("review my plan...") ─▶│
     │◀── pro_response(feedback) ────────────│
```

## Interaction Patterns

| Pattern | Model | Mode | Use Case |
|---------|-------|------|----------|
| Delegate grunt work | Flash | Async | "Generate 20 test fixtures matching this schema" |
| Context gathering | Flash | Async | "Find all files related to auth, summarize patterns" |
| Batch operations | Flash | Async | "Rename UserService to AuthService across codebase" |
| Code review assist | Flash | Async | "Check these files for obvious bugs" |
| Plan review | Pro | Sync | "Here's my implementation plan, what am I missing?" |
| Architecture consult | Pro | Sync | "Two approaches here, trade-offs?" |
| Bug hunting | Pro | Sync | "This test fails intermittently, ideas?" |
| Fresh eyes | Pro | Sync | "Review this complex PR" |

## MCP Interface Design

### Tools Claude Calls

```typescript
// Start an async task (Flash intern)
gemini_task_start {
  task: string,           // What to do
  context?: string,       // Files, code, background
  model: "flash" | "pro", // Which model
  async: boolean          // Background or wait
}
→ { session_id: string }

// Respond to a decision request
gemini_respond {
  session_id: string,
  decision: string | object  // Approval, choice, clarification
}
→ { acknowledged: boolean }

// Check status / get results
gemini_status {
  session_id: string
}
→ { status: "running" | "waiting" | "complete", result?: any }

// Quick sync consultation (Pro)
gemini_consult {
  question: string,
  context: string
}
→ { response: string, concerns?: string[] }

// Cancel a running task
gemini_cancel {
  session_id: string
}
```

### Events Gemini Sends Back

```typescript
// Gemini needs a decision to proceed
decision_needed {
  session_id: string,
  type: "shell_command" | "file_edit" | "file_read" | "clarification" | "checkpoint",
  description: string,
  options?: string[],      // For choice-based decisions
  context?: string         // Relevant info for deciding
}

// Progress update (non-blocking)
progress {
  session_id: string,
  message: string,
  percent?: number
}

// Task finished
task_complete {
  session_id: string,
  result: any,
  summary: string
}

// Something went wrong
error {
  session_id: string,
  error: string,
  recoverable: boolean
}
```

### Decision Types

| Type | When | Claude Responds With |
|------|------|---------------------|
| `shell_command` | Gemini wants to run a command | "approved" / "denied" / "modify: ..." |
| `file_edit` | Gemini wants to edit a file | "approved" / "denied" / "modify: ..." |
| `file_read` | Gemini wants to read files (batch) | "approved" / "only: [patterns]" / "denied" |
| `clarification` | Gemini needs more info | Free-form response |
| `checkpoint` | Gemini at decision point | "proceed" / "adjust: ..." / "abort" |

## Architecture

### Current Gemini CLI Structure

```
packages/
├── cli/           # Terminal UI (React + Ink)
├── core/          # Tools, MCP client, config
├── a2a-server/    # Agent-to-agent HTTP (exists!)
└── ...
```

### New Components

```
packages/
├── mcp-server/                    # NEW: MCP server package
│   ├── src/
│   │   ├── server.ts             # MCP server setup (stdio transport)
│   │   ├── session-manager.ts    # Track active sessions
│   │   ├── tools/
│   │   │   ├── task-start.ts     # Start async task
│   │   │   ├── respond.ts        # Decision response
│   │   │   ├── status.ts         # Check status
│   │   │   ├── consult.ts        # Sync Pro consultation
│   │   │   └── cancel.ts         # Cancel task
│   │   ├── events/
│   │   │   ├── decision-request.ts
│   │   │   ├── progress.ts
│   │   │   └── completion.ts
│   │   └── gemini-bridge.ts      # Interface to core GeminiClient
│   └── package.json
│
├── cli/
│   └── src/commands/
│       └── serveMcpCommand.ts    # `gemini serve-mcp`
│
└── core/
    └── src/
        ├── gemini/
        │   └── gemini-client.ts  # May need hooks for interception
        └── tools/
            └── ... # Intercept confirmations → forward to MCP client
```

### Event Delivery Mechanism

MCP doesn't have native push events. Options:

1. **Sampling** - MCP servers can request LLM completions from client
   - When decision needed, request a "sample" asking Claude to decide
   - Built into MCP spec, might work well

2. **Long-polling tool** - `gemini_wait_for_event { session_id, timeout }`
   - Claude calls this, it blocks until event ready
   - Simple but requires Claude to actively poll

3. **Resource subscriptions** - `gemini://session/{id}/events`
   - Claude subscribes to resource, gets updates
   - Cleaner but more complex

**Recommendation:** Start with **sampling** for decisions (it's designed for this),
use **polling** for progress checks.

## Claude Code Integration

```json
{
  "mcpServers": {
    "gemini-intern": {
      "command": "gemini",
      "args": ["serve-mcp"],
      "env": {
        "GEMINI_API_KEY": "${GEMINI_API_KEY}"
      }
    }
  }
}
```

## Example Workflows

### 1. Context Gathering (Flash, Async)

```
Claude: "I need to understand the auth system"

Claude → gemini_task_start {
  task: "Find all authentication-related files. Summarize the auth flow,
         list key functions, note any security patterns used.",
  model: "flash",
  async: true
}

← { session_id: "abc123" }

(Claude continues working on other things)

← decision_needed { type: "file_read", description: "Found 47 files, read all?" }

Claude → gemini_respond { session_id: "abc123", decision: "only .ts and .tsx" }

← progress { message: "Analyzing 23 TypeScript files..." }

← task_complete {
  result: {
    files: [...],
    summary: "JWT-based auth with refresh tokens...",
    key_functions: [...],
    patterns: [...]
  }
}
```

### 2. Plan Review (Pro, Sync)

```
Claude: "Before I implement this, let me get a second opinion"

Claude → gemini_consult {
  question: "Review this implementation plan for adding OAuth support.
             What am I missing? Any security concerns?",
  context: "<detailed plan here>"
}

← {
  response: "Plan looks solid. Three considerations: ...",
  concerns: [
    "Token storage strategy not specified",
    "No mention of PKCE for mobile clients",
    "Rate limiting on token endpoint?"
  ]
}

Claude: "Good catches, let me address those..."
```

### 3. Grunt Work (Flash, Async)

```
Claude → gemini_task_start {
  task: "Generate 15 test fixtures for the User model.
         Include edge cases: empty strings, unicode names,
         max-length fields, special characters.",
  context: "<User model schema>",
  model: "flash",
  async: true
}

(Claude works on other code)

← task_complete {
  result: { fixtures: [...15 test objects...] },
  summary: "Generated 15 fixtures covering: normal cases (5),
            unicode (3), edge cases (4), invalid inputs (3)"
}

Claude reviews, adjusts as needed
```

## Open Questions

1. **Session persistence** - Save sessions to disk for resume after restart?
2. **Concurrent sessions** - How many parallel Flash tasks?
3. **Context limits** - How much context can we pass to Gemini?
4. **Error recovery** - Retry logic? Automatic or ask Claude?
5. **Audit log** - Record all decisions for debugging?

## Implementation Phases (Revised)

### Phase 1: Get A2A Server Running
- [ ] Start A2A server: `npm run start` in `packages/a2a-server`
- [ ] Test endpoints manually with curl
- [ ] Understand task creation and message flow
- [ ] Document any config needed (API keys, workspace)

### Phase 2: Build MCP Bridge
- [ ] Create `packages/mcp-bridge` package
- [ ] Implement basic MCP server (stdio transport)
- [ ] Tool: `gemini_task_start` → POST /tasks + send message
- [ ] Tool: `gemini_status` → GET /tasks/:id/metadata
- [ ] Tool: `gemini_respond` → POST message with confirmation
- [ ] Test with Claude Code

### Phase 3: Event Streaming
- [ ] Subscribe to A2A SSE stream for task updates
- [ ] Forward `ToolCallConfirmationEvent` → MCP notification/sampling
- [ ] Handle async decision flow
- [ ] Progress updates to Claude

### Phase 4: Polish & Optimize
- [ ] `gemini_consult` for sync Pro queries
- [ ] Model selection (Flash vs Pro) via params
- [ ] Error handling and recovery
- [ ] Claude Code config examples + docs
- [ ] Auto-start A2A server from MCP bridge

## Next Steps

1. ✅ ~~Explore existing `a2a-server` package~~ - **DONE, it's complete!**
2. [ ] Start A2A server and test endpoints
3. [ ] Create minimal MCP bridge with one tool
4. [ ] Test end-to-end: Claude Code → MCP → A2A → Gemini
5. [ ] Iterate based on real usage

## Quick Start

### 1. Build the MCP Bridge

```bash
cd features/mcp-bridge
npm install
npm run build
```

### 2. Start A2A Server

```bash
cd packages/a2a-server
npm run start
# Server runs on http://localhost:41242
```

### 3. Configure Claude Code

Add to `~/.claude/settings.json` or project `.claude/settings.json`:

```json
{
  "mcpServers": {
    "gemini": {
      "command": "node",
      "args": ["/full/path/to/gemini-cli/features/mcp-bridge/dist/index.js"],
      "env": {
        "A2A_SERVER_URL": "http://localhost:41242",
        "GEMINI_WORKSPACE": "/path/to/your/project"
      }
    }
  }
}
```

### 4. Test Endpoints (Optional)

```bash
curl http://localhost:41242/.well-known/agent-card.json
curl -X POST http://localhost:41242/tasks -H "Content-Type: application/json" \
  -d '{"agentSettings": {"workspacePath": "/path/to/project"}}'
```

## File Structure

```
features/                    # Custom mods (separate from upstream)
└── mcp-bridge/             # MCP-to-A2A bridge
    ├── src/
    │   ├── index.ts        # MCP server entry point
    │   └── a2a-client.ts   # HTTP client for A2A
    ├── package.json
    └── README.md

packages/                    # Upstream code
├── a2a-server/             # A2A server (already built!)
├── cli/                    # CLI entry point
└── core/                   # Core logic
```
