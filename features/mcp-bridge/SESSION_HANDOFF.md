# Session Handoff - MCP Bridge for Gemini CLI

**Date:** 2024-12-19
**Status:** ✅ WORKING - E2E tested with Gemini 3 Pro

## Quick Resume

```bash
# 1. Start A2A server (keep running)
CODER_AGENT_PORT=41242 USE_CCPA=true npm run start -w packages/a2a-server

# 2. Restart Claude Code to pick up MCP server (already configured in ~/.claude/settings.json)

# 3. Test - call gemini_get_agent_capabilities_and_version
```

## Current State

### What's Done ✅
- MCP bridge built and working (`features/mcp-bridge/dist/`)
- JSON-RPC envelope fix applied (critical - A2A expects `method: "message/stream"`)
- 9 MCP tools with LLM-friendly descriptive names
- OAuth auth working via `USE_CCPA=true`
- Fixed port via `CODER_AGENT_PORT=41242`
- Claude Code settings configured (`~/.claude/settings.json`)
- Test files created (`src/*.test.ts`) - need to run `npm test`

### What's NOT Done ❌
- Tests not yet run (vitest installed, tests written)
- Per-request model selection (Flash vs Pro) - requires A2A server fork
- Real streaming (currently buffered)

## Architecture

```
Claude Code ──MCP (stdio)──▶ MCP Bridge ──HTTP──▶ A2A Server ──▶ Gemini 3.0
                             (features/         (packages/      (Pro)
                              mcp-bridge/)       a2a-server/)
```

## Tool Names (Updated)

| New Name | Purpose |
|----------|---------|
| `gemini_delegate_task_to_assistant` | Async task delegation (grunt work) |
| `gemini_approve_or_deny_pending_action` | Respond to tool confirmations |
| `gemini_check_task_progress_and_status` | Get task status |
| `gemini_cancel_running_task` | Cancel running task |
| `gemini_list_all_active_sessions` | List sessions |
| `gemini_quick_consultation_for_second_opinion` | Sync consultation |
| `gemini_execute_cli_command` | CLI commands (init, restore) |
| `gemini_list_available_cli_commands` | List commands |
| `gemini_get_agent_capabilities_and_version` | Agent info (ping test) |

## Critical Fix Applied

**Problem:** A2A server expects JSON-RPC format, not raw messages.

**Solution in `a2a-client.ts`:**
```typescript
// Wrap ALL requests in JSON-RPC envelope
const body = {
  jsonrpc: '2.0',
  id: requestId,
  method: 'message/stream',  // CRITICAL
  params: {
    message: messageObj,
    metadata: { coderAgent: { ... } }
  }
};
```

## Files Changed This Session

```
features/mcp-bridge/
├── src/
│   ├── index.ts          # Tool names updated, descriptions enhanced
│   ├── a2a-client.ts     # JSON-RPC envelope fix (CRITICAL)
│   ├── a2a-client.test.ts # NEW - unit tests
│   └── index.test.ts     # NEW - MCP tool tests
├── package.json          # Added vitest, test scripts
├── README.md             # Complete setup guide
├── AUTHENTICATION.md     # OAuth vs API key docs
├── MODEL_CONFIGURATION.md # Model selection analysis
└── SESSION_HANDOFF.md    # This file

.claude/
└── settings.json.example # Template for users
```

## Environment Setup

### A2A Server
```bash
CODER_AGENT_PORT=41242 USE_CCPA=true npm run start -w packages/a2a-server
```

### MCP Bridge (auto-started by Claude Code)
Configured in `~/.claude/settings.json`:
```json
{
  "mcpServers": {
    "gemini": {
      "command": "node",
      "args": ["/home/matlod1/Documents/AI/modcli/gemini-cli/features/mcp-bridge/dist/index.js"],
      "env": { "A2A_SERVER_URL": "http://localhost:41242" }
    }
  }
}
```

## Test Commands

```bash
# Build
cd features/mcp-bridge && npm run build

# Run tests
npm test

# Test A2A directly
curl http://localhost:41242/.well-known/agent-card.json

# Test MCP bridge
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | A2A_SERVER_URL=http://localhost:41242 node dist/index.js
```

## Known Gaps for Future

1. **Model Selection:** A2A server uses `settings.general.previewFeatures` to choose model at startup. No per-request selection. See `MODEL_CONFIGURATION.md` for fork plan.

2. **Streaming:** Currently buffers entire SSE response. Could add true streaming later.

3. **Tests:** Written but not run. Execute `npm test` to verify.

## Git Commits This Session

```
7c51499a docs: comprehensive setup guide with Claude Code integration
203e63f7 fix: wrap A2A requests in JSON-RPC envelope
3e2023fa docs: add authentication analysis for CLI OAuth vs API key
210cb9ed docs: add model configuration analysis and improve MCP tool descriptions
c6d1dd2e feat: add MCP bridge for Claude Code integration
```

## Verified Working

```bash
# This returned "Four" from Gemini 3 Pro:
echo '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{
  "name":"gemini_delegate_task_to_assistant",
  "arguments":{"task":"What is 2+2? Answer in one word.","workspace":"/home/matlod1/Documents/AI/modcli/gemini-cli","autoExecute":true}
}}' | A2A_SERVER_URL=http://localhost:41242 node dist/index.js
```

## Key Documentation

- [README.md](./README.md) - Complete setup guide
- [AUTHENTICATION.md](./AUTHENTICATION.md) - OAuth vs API key
- [MODEL_CONFIGURATION.md](./MODEL_CONFIGURATION.md) - Model selection & A2A fork plan
- `.claude/settings.json.example` - Template for users
