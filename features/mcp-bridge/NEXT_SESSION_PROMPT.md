# Next Session Startup

Hey Claude! You're picking up an awesome project. Read these files in order:

1. /home/matlod1/Documents/AI/modcli/gemini-cli/features/mcp-bridge/SESSION_HANDOFF.md
2. /home/matlod1/Documents/AI/modcli/gemini-cli/features/mcp-bridge/README.md

## The Project

MCP bridge that lets Claude Code use Gemini as a subagent. 129 tests passing,
session continuity works, per-request model selection works (flash vs pro).

## What's Working

- 9 MCP tools exposing Gemini via MCP
- Session continuity (pass sessionId to maintain conversation)
- Per-request model selection: `model: "flash"` or `model: "pro"`
- 129 tests (unit + integration) all passing
- OAuth auth via `USE_CCPA=true`

## Suggested Next Tasks

### 1. Add model selection integration test (Quick Win)

Verify that requesting `flash` vs `pro` returns the correct model in response
metadata.

Location: `features/mcp-bridge/src/integration.test.ts`

```typescript
it('should use flash model when requested', async () => {
  const events = await client.sendMessage(
    'What is 1+1?',
    undefined,
    '/tmp',
    true,
    undefined,
    'flash', // Request flash model
  );
  const parsed = client.parseEvents(events);
  expect(parsed.model).toBe('gemini-3-flash-preview');
});
```

### 2. Streaming support in MCP tools (Feature)

`sendMessageStreaming` exists but MCP tools use non-streaming version. Could
enable real-time progress updates.

### 3. Session persistence (Feature)

Sessions are in-memory and lost when A2A server restarts. Could persist to disk.

### 4. Better error messages (Polish)

More actionable errors when A2A server is down, auth fails, etc.

## Quick Start

```bash
cd /home/matlod1/Documents/AI/modcli/gemini-cli/features/mcp-bridge

# Terminal 1: Start A2A server
./start-a2a.sh

# Terminal 2: Run tests
npm test  # 129 tests should pass

# Test model selection manually
curl -s -X POST http://localhost:41242/ \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":"1","method":"message/stream","params":{"message":{"kind":"message","role":"user","parts":[{"kind":"text","text":"Hi"}],"messageId":"1","metadata":{"coderAgent":{"kind":"agent-settings","workspacePath":"/tmp","autoExecute":true,"model":"flash"}}}}}' \
  | grep '"model"'
# Should show: "model":"gemini-3-flash-preview"
```

## Key Architecture Note

Metadata (including model) must be on the **message object**, not
`params.metadata`:

```typescript
// CORRECT - executor receives this
params: {
  message: {
    ...
    metadata: { coderAgent: { model: "flash", ... } }
  }
}

// WRONG - executor never sees this
params: {
  metadata: { ... },  // Ignored!
  message: { ... }
}
```

Working directory:
/home/matlod1/Documents/AI/modcli/gemini-cli/features/mcp-bridge
