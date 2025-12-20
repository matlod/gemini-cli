# MCP-A2A Bridge Lessons Learned

This document captures lessons learned from debugging issues in the MCP-to-A2A
bridge integration.

## Issue: Stale AbortSignal Causing Tool Approval Failures

**Date:** 2024-12-20 **Symptom:** `AbortError: This operation was aborted` when
approving tool calls **Root Cause:** Stale abort signals from closed HTTP
connections

### The Problem

When using `gemini_delegate_task_to_assistant` without `autoExecute`:

1. First HTTP request starts task, LLM requests tool, task goes to
   `input-required`
2. MCP bridge receives SSE response with `final: true`, HTTP connection closes
3. A2A server's abort signal is triggered (socket close)
4. Second HTTP request sends approval via
   `gemini_approve_or_deny_pending_action`
5. Tool executes successfully, BUT...
6. Execution checks the stale abort signal and throws

### Key Insight: SSE Connection Lifecycle

The MCP bridge makes separate HTTP requests for each operation:

- Request 1: `gemini_delegate_task_to_assistant` → SSE stream → connection
  closes after `final: true`
- Request 2: `gemini_approve_or_deny_pending_action` → SSE stream → connection
  closes

The A2A server was treating socket close as "abort the execution" when it should
be "pause until next request."

### The Fix (Two Parts)

#### Part 1: CoreToolScheduler (packages/core)

**File:** `packages/core/src/core/coreToolScheduler.ts`

```typescript
// BEFORE: Would cancel if signal was aborted
if (outcome === ToolConfirmationOutcome.Cancel || signal.aborted) {
  this.cancelAll(signal);
}

// AFTER: Only cancel on explicit user cancel, not stale signal
if (outcome === ToolConfirmationOutcome.Cancel) {
  this.cancelAll(signal);
}
```

And create fresh signal for execution:

```typescript
// Create fresh AbortController for execution after user confirms
const freshController = new AbortController();
const freshSignal = freshController.signal;
await this.attemptExecutionOfScheduledCalls(freshSignal);
```

#### Part 2: Executor (packages/a2a-server)

**File:** `packages/a2a-server/src/agent/executor.ts`

1. **Graceful socket close:** Don't cancel tools when socket closes

   ```typescript
   // BEFORE: Cancel everything
   currentTask.cancelPendingTools('Execution aborted');

   // AFTER: Let task remain active
   logger.info('Task remains active for resumption');
   ```

2. **Secondary execution waits:** Keep SSE connection open

   ```typescript
   // Wait for primary execution to complete before returning
   await new Promise((resolve) => {
     const checkInterval = setInterval(() => {
       if (!this.executingTasks.has(taskId)) {
         clearInterval(checkInterval);
         resolve();
       }
     }, 50);
   });
   ```

3. **Fresh signal after tool completion:** When stale abort detected with
   successful tools

   ```typescript
   // Create fresh signal BEFORE checking abort status
   if (
     abortSignal.aborted &&
     activeSignal === abortSignal &&
     hasSuccessfulTools
   ) {
     const freshController = new AbortController();
     activeSignal = freshController.signal;
   }

   // Now check abort with potentially fresh signal
   if (activeSignal.aborted) {
     throw new Error('Execution aborted');
   }
   ```

4. **Idle timeout cleanup:** 30-minute timeout for truly abandoned tasks

### Debugging Tips

1. **Trace the signal lifecycle:** Follow AbortController/AbortSignal from
   creation through all uses
2. **Check socket events:** Socket `close` event triggers abort in the executor
3. **Log timestamps:** Compare socket close time with subsequent request time
4. **Watch for "pending execution":** When `executingTasks.has(taskId)` is true,
   primary is still running

### Key Patterns

1. **Closures capture values:** Callbacks like `onConfirm` capture the original
   signal. New requests can't provide fresh signals.

2. **SSE connection closing is normal:** The MCP bridge closes HTTP after
   receiving final SSE event. This is expected, not an error.

3. **Fresh signals for user actions:** When user explicitly confirms, create
   fresh context rather than reusing stale state.

4. **Concurrent executions:** Primary and secondary executions run concurrently.
   Secondary processes the message, primary handles the continuation.

### Testing the Approval Flow

```bash
# 1. Start A2A server
CODER_AGENT_PORT=41242 USE_CCPA=true npm run start -w packages/a2a-server

# 2. In Claude Code, without autoExecute:
gemini_delegate_task_to_assistant: "Create test.md with hello"

# 3. When pending, approve:
gemini_approve_or_deny_pending_action with decision: "approve"

# 4. Verify file was created
ls test.md
```

### Related Files

- `packages/core/src/core/coreToolScheduler.ts` - Tool scheduling and
  confirmation handling
- `packages/a2a-server/src/agent/executor.ts` - Task execution and socket
  handling
- `packages/a2a-server/src/agent/task.ts` - Task state and tool call management
- `features/mcp-bridge/src/a2a-client.ts` - MCP bridge HTTP client

## Additional Debugging Lessons

### Order of Operations Matters

When checking abort signals and creating fresh signals, the ORDER is critical:

```typescript
// WRONG - checks abort before creating fresh signal, always throws
if (activeSignal.aborted) throw;
if (hasSuccessfulTools) activeSignal = freshSignal;

// CORRECT - create fresh signal first, then check
if (hasSuccessfulTools) activeSignal = freshSignal;
if (activeSignal.aborted) throw;
```

This bug cost us several iterations to find!

### Concurrent Execution Coordination

When primary and secondary executions run concurrently:

1. Secondary updates eventBus to point to its SSE connection
2. Secondary must WAIT for primary to complete (poll `executingTasks.has()`)
3. Otherwise secondary returns, closing SSE before primary streams events

```typescript
// Polling pattern to wait for primary
await new Promise((resolve) => {
  const interval = setInterval(() => {
    if (!this.executingTasks.has(taskId)) {
      clearInterval(interval);
      resolve();
    }
  }, 50);
});
```

### Iterative Debugging

Each fix revealed another layer:

1. First fix: Fresh signal in coreToolScheduler → Still failing
2. Second fix: Graceful socket close in executor → Still failing
3. Third fix: Secondary waits for primary → Still failing
4. Fourth fix: Order of abort check vs fresh signal creation → Working!

Don't assume the first fix is complete. Test end-to-end after each change.

### Log Timestamp Analysis

Comparing timestamps in logs reveals execution flow:

```
00:02:00.724 - First execution enters waitForPendingTools
00:02:04.732 - Socket closes (4 seconds later)
00:02:09.543 - Second request arrives (5 seconds after close)
00:02:09.548 - Both executions complete
```

The gap between socket close and second request shows the task remained active.

## Future Considerations

1. **Long-polling alternative:** Instead of closing connection, could keep it
   open and poll for confirmations
2. **WebSocket upgrade:** More efficient for bidirectional communication
3. **Session tokens:** Track confirmation intent across requests rather than
   relying on abort signals
4. **Execution handoff:** Instead of primary/secondary, could have clean handoff
   where secondary becomes primary
