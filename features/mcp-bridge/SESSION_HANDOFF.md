# Session Handoff - MCP Bridge for Gemini CLI

**Date:** 2024-12-20 **Status:** COMPLETE - All features working

## Recent Fix: Tool Approval Flow

The tool approval flow (`autoExecute: false`) is now working correctly.

**Problem solved:** When using `gemini_approve_or_deny_pending_action`, the tool
was getting cancelled due to stale abort signals from closed HTTP connections.

**See:** `TOOL_APPROVAL_FIX.md` for technical details and
`MCP_A2A_LESSONS_LEARNED.md` for debugging lessons.

### Files Changed (need commit)

1. `packages/core/src/core/coreToolScheduler.ts` - Fresh abort signal on confirm
2. `packages/a2a-server/src/agent/executor.ts` - Graceful socket close, fresh
   signals

## Quick Resume

```bash
# 1. Start A2A server (in separate terminal)
cd /home/matlod1/Documents/AI/modcli/gemini-cli
CODER_AGENT_PORT=41242 USE_CCPA=true npm run start -w packages/a2a-server

# 2. Run tests
cd features/mcp-bridge && npm test  # 141 tests

# 3. Rebuild if needed
npm run build

# 4. Restart Claude Code to pick up MCP server
```

## What's Working ✅

| Feature                     | Status | Notes                                           |
| --------------------------- | ------ | ----------------------------------------------- |
| MCP Bridge                  | ✅     | 9 tools exposing Gemini via MCP                 |
| Session Continuity          | ✅     | Pass sessionId to maintain conversation memory  |
| Per-Request Model Selection | ✅     | `model: "flash"` or `model: "pro"`              |
| MCP Progress Notifications  | ✅     | Real-time status during task execution          |
| Tool Approval Flow          | ✅     | `autoExecute: false` + approve works correctly  |
| Integration Tests           | ✅     | Model selection verified with real API          |
| OAuth Auth                  | ✅     | Working via `USE_CCPA=true`                     |
| JSON-RPC Format             | ✅     | Proper envelope with `method: "message/stream"` |

## Architecture

```
Claude Code ──MCP (stdio)──▶ MCP Bridge ──HTTP──▶ A2A Server ──▶ Gemini API
                             (this pkg)           (packages/     (Pro/Flash)
                                                   a2a-server/)
```

## Files Structure

```
features/mcp-bridge/
├── src/
│   ├── index.ts              # MCP server, 9 tools, progress notifications
│   ├── a2a-client.ts         # HTTP client for A2A protocol
│   ├── index.test.ts         # 45 unit tests
│   ├── integration.test.ts   # 7 integration tests (real API)
│   ├── a2a-client.test.ts    # 28 client tests
│   ├── mcp-tools.test.ts     # 30 tool tests
│   └── scenarios.test.ts     # 31 scenario tests
├── dist/                     # Compiled output
├── test-outputs/             # Captured real responses (gitignored)
├── start-a2a.sh.example      # Template script
├── README.md                 # Setup guide
├── SESSION_HANDOFF.md        # This file
├── NEXT_SESSION_PROMPT.md    # Quick start for new sessions
├── STREAMING_PROGRESS.md     # Progress notification implementation
├── TESTING_SESSIONS.md       # Session testing with curl examples
├── MODEL_CONFIGURATION.md    # Model selection analysis
└── AUTHENTICATION.md         # OAuth docs
```

## Key Implementation Details

### Session Continuity

**Critical:** taskId and contextId must be on the **message object**, not
params:

```typescript
// CORRECT - A2A SDK passes this to executor
const messageObj = {
  kind: 'message',
  role: 'user',
  parts: [...],
  messageId,
  taskId,      // ON message object
  contextId,   // ON message object
  metadata: {  // ON message object
    coderAgent: { model: 'flash', ... }
  }
};
```

### Model Selection

```typescript
// Grunt work - uses gemini-3-flash-preview
gemini_delegate_task_to_assistant({ task: '...', model: 'flash' });

// Complex reasoning - uses gemini-3-pro-preview
gemini_delegate_task_to_assistant({ task: '...', model: 'pro' });

// Consultation defaults to pro
gemini_quick_consultation_for_second_opinion({ question: '...' });
```

### Progress Notifications

When Claude Code provides `progressToken`, the bridge streams updates:

```typescript
// In tool handler
const progressToken = request.params._meta?.progressToken;

if (progressToken) {
  await a2aClient.sendMessageStreaming(task, (event) => {
    const message = getProgressMessage(event);
    if (message) sendProgress(progressToken, count++, undefined, message);
  }, ...);
}
```

Progress messages: `Gemini is working...`, `Thinking: <subject>`,
`Tool: <name> (status)`, `Generating response...`

## MCP Server Configuration

**Important:** MCP servers go in `.mcp.json`, NOT `settings.json`!

**Project-scoped** (preferred): `gemini-cli/.mcp.json`

```json
{
  "mcpServers": {
    "gemini": {
      "command": "node",
      "args": [
        "/home/matlod1/Documents/AI/modcli/gemini-cli/features/mcp-bridge/dist/index.js"
      ],
      "env": {
        "A2A_SERVER_URL": "http://localhost:41242"
      }
    }
  }
}
```

**Alternative** (CLI command):

```bash
claude mcp add gemini --scope project -- node /path/to/dist/index.js -e A2A_SERVER_URL=http://localhost:41242
```

**Alternative** (global): `claude mcp add gemini --scope user -- ...`

**Verify:** Run `/mcp` in Claude Code to see registered servers.

## Test Commands

```bash
# Run all tests (141 total)
npm test

# Run only unit tests (fast, no server needed)
npm test -- --grep "Tool Definitions|Response Formatting|Progress"

# Run integration tests (needs A2A server running)
npm test -- --grep "Integration"

# Type check
npx tsc --noEmit

# Build
npm run build
```

## Troubleshooting

| Issue                      | Solution                                        |
| -------------------------- | ----------------------------------------------- |
| MCP tools not appearing    | Restart Claude Code completely (not resume)     |
| MCP tools not appearing    | Use `.mcp.json`, NOT `settings.json`            |
| "A2A server not reachable" | Start A2A server on port 41242                  |
| Session not found          | Sessions are in-memory, lost on A2A restart     |
| Model not switching        | Check metadata is on message object, not params |
| callId shows "undefined"   | Extract from `request.callId`, not top-level    |
| AbortError on approval     | Fixed! See `MCP_A2A_LESSONS_LEARNED.md`         |

## Related Files (Outside mcp-bridge)

Model selection required changes in a2a-server:

- `packages/a2a-server/src/types.ts` - Added `model?: string` to AgentSettings
- `packages/a2a-server/src/config/config.ts` - `resolveModel()` with
  requestedModel
- `packages/a2a-server/src/agent/executor.ts` - Passes model to loadConfig

## Documentation

- [README.md](./README.md) - Complete setup guide
- [STREAMING_PROGRESS.md](./STREAMING_PROGRESS.md) - Progress notification
  details
- [TESTING_SESSIONS.md](./TESTING_SESSIONS.md) - Manual curl testing
- [MODEL_CONFIGURATION.md](./MODEL_CONFIGURATION.md) - Model selection analysis
- [AUTHENTICATION.md](./AUTHENTICATION.md) - OAuth vs API key
- [TOOL_APPROVAL_FIX.md](./TOOL_APPROVAL_FIX.md) - Tool approval flow fix
  details
- [MCP_A2A_LESSONS_LEARNED.md](./MCP_A2A_LESSONS_LEARNED.md) - Debugging lessons
  for MCP-A2A integration
