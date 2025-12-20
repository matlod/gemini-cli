# Testing Session Continuity

This guide explains how to test and use session continuity with the MCP bridge.

## How Sessions Work

Each task in Gemini has a **taskId** that maintains conversation context. When
you:

- **Omit sessionId**: Creates a fresh session with no memory of previous
  conversations
- **Include sessionId**: Continues an existing conversation, Gemini remembers
  prior context

## Quick Test Commands

### 1. Start A2A Server

```bash
./start-a2a.sh
# Or manually:
cd /path/to/gemini-cli
CODER_AGENT_PORT=41242 USE_CCPA=true npm run start -w packages/a2a-server
```

### 2. Test Session Memory (Direct A2A)

**First message - establish context:**

```bash
curl -s -X POST http://localhost:41242/ \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc":"2.0",
    "id":"1",
    "method":"message/stream",
    "params":{
      "message":{
        "kind":"message",
        "role":"user",
        "parts":[{"kind":"text","text":"My secret word is ELEPHANT. Just say: Got it."}],
        "messageId":"msg-1",
        "metadata":{"coderAgent":{"kind":"agent-settings","workspacePath":"/tmp","autoExecute":true,"model":"flash"}}
      }
    }
  }' | grep -o '"taskId":"[^"]*"' | head -1
```

Save the taskId from output (e.g., `768f0109-7433-4749-846a-6531359dab5f`)

**Second message - SAME session (with taskId on message):**

```bash
curl -s -X POST http://localhost:41242/ \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc":"2.0",
    "id":"2",
    "method":"message/stream",
    "params":{
      "message":{
        "kind":"message",
        "role":"user",
        "parts":[{"kind":"text","text":"What was my secret word?"}],
        "messageId":"msg-2",
        "taskId":"768f0109-7433-4749-846a-6531359dab5f",
        "metadata":{"coderAgent":{"kind":"agent-settings","workspacePath":"/tmp","autoExecute":true,"model":"flash"}}
      }
    }
  }'
```

**Expected:** Gemini responds with "ELEPHANT" because it remembers the context.

**Third message - NEW session (no taskId):**

```bash
curl -s -X POST http://localhost:41242/ \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc":"2.0",
    "id":"3",
    "method":"message/stream",
    "params":{
      "message":{
        "kind":"message",
        "role":"user",
        "parts":[{"kind":"text","text":"What was my secret word?"}],
        "messageId":"msg-3",
        "metadata":{"coderAgent":{"kind":"agent-settings","workspacePath":"/tmp","autoExecute":true,"model":"flash"}}
      }
    }
  }'
```

**Expected:** Gemini does NOT know the secret word (fresh session, no context).

## Testing via MCP Bridge

When using the MCP tools from Claude Code, session management is automatic:

### Fresh Task (No Memory)

```
Use gemini_delegate_task_to_assistant without sessionId:
- task: "Find all TODO comments in the codebase"
- workspace: "/path/to/project"
```

### Continue Existing Task (With Memory)

```
Use gemini_delegate_task_to_assistant WITH sessionId from previous call:
- task: "Now fix the first TODO you found"
- sessionId: "abc123-from-previous-response"
- workspace: "/path/to/project"
```

## Key Technical Details

### Where taskId and metadata Must Be Placed

**CRITICAL:** The `taskId`, `contextId`, and `metadata` must all be on the
**message object**, not in params root:

```typescript
// ✅ CORRECT - SDK passes these to the executor
params: {
  message: {
    kind: "message",
    role: "user",
    parts: [...],
    messageId: "...",
    taskId: "existing-task-id",       // ON the message
    contextId: "existing-context-id", // ON the message
    metadata: {                       // ON the message
      coderAgent: {
        kind: "agent-settings",
        workspacePath: "/path",
        autoExecute: true,
        model: "flash"  // or "pro"
      }
    }
  }
}

// ❌ WRONG - SDK ignores params.taskId and params.metadata!
params: {
  taskId: "existing-task-id",  // NOT on message - ignored!
  metadata: { ... },           // NOT on message - ignored!
  message: { ... }
}
```

### Session States

Tasks can be in these states:

- `submitted` - Just created
- `working` - Gemini is processing
- `input-required` - Waiting for tool approval or user input
- `completed` - Finished successfully
- `failed` - Error occurred
- `canceled` - Manually cancelled

**Important:** You can continue a session even if it's in `input-required`
state.

## When to Use Sessions

### Use SAME session (pass sessionId) when:

- Multi-step tasks: "Find the bug" → "Now fix it" → "Write a test"
- Iterative refinement: "Generate code" → "Make it async" → "Add error handling"
- Context-dependent follow-ups: "What did you find?" after a search

### Use NEW session (omit sessionId) when:

- Starting unrelated tasks
- You want Gemini to approach something fresh without prior assumptions
- Parallel independent tasks

## Automated Tests

Run the test suite to verify session continuity:

```bash
cd features/mcp-bridge
npm test
```

The integration tests in `src/integration.test.ts` verify:

- Basic queries work
- Task state transitions are tracked
- Session continuity preserves context (when not blocked by tool approvals)

## Troubleshooting

### "Gemini doesn't remember previous messages"

1. Check you're passing `sessionId` in the tool call
2. Verify the session exists: use `gemini_list_all_active_sessions`
3. Check if session is in `input-required` state (may need approval first)

### "Session not found" error

- The MCP bridge tracks sessions in memory
- If Claude Code restarts, session map is cleared
- The underlying A2A tasks still exist (check with
  `gemini_list_all_active_sessions`)

### "Task is in terminal state"

- Completed/failed/canceled tasks cannot be continued
- Start a new session for fresh work
