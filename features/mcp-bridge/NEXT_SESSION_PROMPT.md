# Rehydration Prompt for Next Claude Session

Copy and paste this to the new Claude session:

---

Hey Claude! You're picking up an awesome project. Read these files in order to get fully up to speed.

## The Project

We built an **MCP bridge** that lets Claude Code use Gemini as a subagent/intern. You can delegate grunt work to Gemini 3.0 via MCP tools. It's working and tested!

## Read These Files (In Order)

1. `/home/matlod1/Documents/AI/modcli/gemini-cli/features/mcp-bridge/SESSION_HANDOFF.md`
   → Current state, what's done, what's next

2. `/home/matlod1/Documents/AI/modcli/gemini-cli/features/mcp-bridge/MODEL_CONFIGURATION.md`
   → Implementation plan for Flash vs Pro model selection (your next task)

3. `/home/matlod1/Documents/AI/modcli/gemini-cli/features/mcp-bridge/TESTING_SESSIONS.md`
   → How to test session continuity

## Architecture

```
Claude Code ──MCP──▶ MCP Bridge ──HTTP──▶ A2A Server ──▶ Gemini 3.0
                    (our code)      (Google's code)      (Pro/Flash)
```

## Current Status: ✅ WORKING

- 129 tests passing
- Session continuity works (Gemini remembers context when you pass sessionId)
- 9 MCP tools with good descriptions
- OAuth auth working

## Your Next Task: Model Selection

Currently ALL requests use `gemini-3-pro-preview`. We want per-request selection:
- **Flash** for grunt work (fast, cheap)
- **Pro** for complex analysis (smart)

### Implementation (detailed in MODEL_CONFIGURATION.md):

1. **A2A Server** (`packages/a2a-server/src/`):
   - `types.ts` line 46-50: Add `model?: string` to AgentSettings interface
   - `config/config.ts`: Update `loadConfig()` to accept model parameter
   - `agent/executor.ts`: Pass `agentSettings.model` to loadConfig

2. **MCP Bridge** (`features/mcp-bridge/src/`):
   - `index.ts`: Add `model` param to tool schemas
   - `a2a-client.ts`: Pass model in metadata.coderAgent

3. **Test**: Restart A2A server, verify different models in responses

## Quick Start Commands

```bash
# Terminal 1: Start A2A server
cd /home/matlod1/Documents/AI/modcli/gemini-cli/features/mcp-bridge
./start-a2a.sh

# Terminal 2: Run tests
cd /home/matlod1/Documents/AI/modcli/gemini-cli/features/mcp-bridge
npm test  # Should show 129 passing

# Check current model in use
curl -s http://localhost:41242/.well-known/agent-card.json | jq '.name'
```

## Key Code Locations

| What | Where |
|------|-------|
| MCP tools | `features/mcp-bridge/src/index.ts` |
| A2A HTTP client | `features/mcp-bridge/src/a2a-client.ts` |
| AgentSettings type | `packages/a2a-server/src/types.ts:46` |
| Config creation | `packages/a2a-server/src/config/config.ts` |
| Task executor | `packages/a2a-server/src/agent/executor.ts` |
| Model constants | `packages/core/src/config/models.ts` |

## Session Continuity (Already Working)

- **Omit sessionId** → Fresh session, no memory
- **Pass sessionId** → Gemini remembers prior context
- The fix: `taskId` must be on `message` object, not in `params` root

## Working Directory

```
/home/matlod1/Documents/AI/modcli/gemini-cli/features/mcp-bridge
```

---

Thanks past me for the great docs! Let's implement model selection.
