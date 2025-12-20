# MCP Bridge Session Startup

## Quick Context

You're working on an **MCP bridge** that lets Claude Code use Gemini as a
subagent. The bridge translates MCP protocol to A2A (Agent-to-Agent) protocol.

**Current state:** Fully functional with 141 tests passing.

## Read These Files First

1. `SESSION_HANDOFF.md` - Full technical context
2. `README.md` - User-facing setup guide

## Architecture (30-second version)

```
Claude Code ──MCP──▶ MCP Bridge ──HTTP──▶ A2A Server ──▶ Gemini API
              │      (this pkg)           (separate)     (cloud)
              │
              └── stdio transport, 9 tools exposed
```

**Key insight:** The MCP bridge is a translator. It receives MCP tool calls from
Claude Code and converts them to A2A protocol HTTP requests to the Gemini A2A
server.

## What's Implemented

| Feature                | File                        | How It Works                       |
| ---------------------- | --------------------------- | ---------------------------------- |
| 9 MCP Tools            | `src/index.ts`              | Tool definitions + handlers        |
| Session Memory         | `src/a2a-client.ts:347-414` | taskId/contextId on message object |
| Model Selection        | `src/a2a-client.ts:377-388` | metadata.coderAgent.model          |
| Progress Notifications | `src/index.ts:531-595`      | sendProgress() during streaming    |
| A2A Protocol           | `src/a2a-client.ts`         | JSON-RPC envelope, SSE parsing     |

## Critical Implementation Details

### 1. Message Structure (Most Common Bug Source)

Everything must be on the **message object**, not params:

```typescript
// CORRECT
params: {
  message: {
    taskId: "...",           // HERE
    contextId: "...",        // HERE
    metadata: { ... }        // HERE
  }
}

// WRONG - executor never sees these
params: {
  taskId: "...",             // IGNORED
  metadata: { ... }          // IGNORED
  message: { ... }
}
```

### 2. JSON-RPC Envelope Required

All requests must be wrapped:

```typescript
const body = {
  jsonrpc: '2.0',
  id: requestId,
  method: 'message/stream',
  params: { message: messageObj },
};
```

### 3. Progress Notifications

Only sent when Claude Code provides `progressToken`:

```typescript
const progressToken = request.params._meta?.progressToken;
if (progressToken) {
  // Use streaming version
  await a2aClient.sendMessageStreaming(task, (event) => {
    sendProgress(progressToken, count++, undefined, getProgressMessage(event));
  }, ...);
}
```

## Quick Commands

```bash
# Working directory
cd /home/matlod1/Documents/AI/modcli/gemini-cli/features/mcp-bridge

# Start A2A server (separate terminal)
cd /home/matlod1/Documents/AI/modcli/gemini-cli
CODER_AGENT_PORT=41242 USE_CCPA=true npm run start -w packages/a2a-server

# Run tests
npm test                    # All 141 tests
npm run build               # Compile TypeScript

# Test MCP server directly
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node dist/index.js

# Check A2A server health
curl http://localhost:41242/.well-known/agent-card.json
```

## Test Structure

| File                  | Tests | What It Tests                          |
| --------------------- | ----- | -------------------------------------- |
| `index.test.ts`       | 45    | Tool definitions, formatting, progress |
| `integration.test.ts` | 7     | Real API calls (needs server)          |
| `a2a-client.test.ts`  | 28    | HTTP client, parsing                   |
| `mcp-tools.test.ts`   | 30    | Tool schemas                           |
| `scenarios.test.ts`   | 31    | Usage scenarios                        |

## Suggested Next Tasks

### 1. Session Persistence (Medium)

Sessions are in-memory, lost when A2A server restarts. Could persist to
disk/redis.

### 2. Better Error Messages (Small)

More actionable errors when A2A server down, auth fails, etc.

### 3. Progress for Consultation Tool (Small)

Only `gemini_delegate_task_to_assistant` has progress. Could add to
`gemini_quick_consultation_for_second_opinion`.

### 4. Retry Logic (Medium)

Add automatic retry for transient failures.

### 5. Rate Limiting (Medium)

Track API usage, implement backoff.

## MCP Configuration

Location: `~/.claude/settings.json`

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

**Important:** After changes, must restart Claude Code completely (not just
`/clear` or resume).

## Common Issues

| Symptom                    | Cause                     | Fix                         |
| -------------------------- | ------------------------- | --------------------------- |
| MCP tools not appearing    | Claude Code not restarted | Exit and relaunch `claude`  |
| "A2A server not reachable" | Server not running        | Start with command above    |
| Session not found          | Server restarted          | Sessions are in-memory      |
| Gemini doesn't remember    | taskId not on message     | Check a2a-client.ts:368     |
| Wrong model used           | metadata not on message   | Check a2a-client.ts:377-388 |

## Key Files Quick Reference

| File                      | Purpose            | Key Lines                          |
| ------------------------- | ------------------ | ---------------------------------- |
| `src/index.ts`            | MCP server + tools | 50-408 (tools), 541-595 (progress) |
| `src/a2a-client.ts`       | A2A HTTP client    | 347-414 (sendMessage)              |
| `src/integration.test.ts` | Real API tests     | Model selection tests at 131-168   |

## This Session's Work (2024-12-19)

1. Added integration tests for model selection (flash/pro verification)
2. Implemented MCP progress notifications (streaming status updates)
3. Updated all documentation

Total: 141 tests passing, all features working.
