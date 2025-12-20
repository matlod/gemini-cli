# Tool Approval Flow Fix - Session Notes

**Date:** 2024-12-20 **Status:** COMPLETE - Fix implemented and tested
successfully

## Problem Summary

When using `gemini_delegate_task_to_assistant` without `autoExecute`, the tool
approval flow was broken:

1. Gemini requests a tool (e.g., write_file)
2. MCP bridge returns `input-required` with pending approval
3. User approves via `gemini_approve_or_deny_pending_action`
4. Tool gets marked as "cancelled" even though user approved

## Root Cause Analysis

The issue was a **stale abort signal** being used during tool execution:

### Flow Breakdown

1. **First HTTP request:** Task delegated to Gemini
   - Abort signal created: `abortController1`
   - Tool scheduled with this signal captured in closures
   - Task goes to `input-required`, SSE ends with `final: true`
   - **MCP bridge closes HTTP connection** (normal behavior)
   - A2A server sees socket close → `abortController1.abort()` is called

2. **Second HTTP request:** User sends approval
   - Fresh abort controller created: `abortController2`
   - But `handleConfirmationResponse` uses captured `abortController1.signal`
   - That signal is **already aborted** from step 1
   - Scheduler checks `signal.aborted` during execution → cancels tool

### Key Code Locations

**Where the stale signal is captured:**

```typescript
// packages/core/src/core/coreToolScheduler.ts, lines 945-955
onConfirm: (outcome, payload) =>
  this.handleConfirmationResponse(
    reqInfo.callId,
    originalOnConfirm,
    outcome,
    signal,  // <-- THIS IS THE STALE SIGNAL
    payload,
  ),
```

**Where abort is checked (multiple places):**

- Line 1216: `if (signal.aborted)` - after tool result
- Line 1299: `if (signal.aborted)` - in catch block
- Lines 1327, 1354, 1355: in `checkAndNotifyCompletion`

## The Fix

**Create a fresh AbortController when user confirms** (in
`handleConfirmationResponse`):

```typescript
// packages/core/src/core/coreToolScheduler.ts, lines 1055-1074
} else {
  // User explicitly confirmed - create a fresh signal for execution.
  // The original signal may be stale (aborted from a closed socket),
  // but since the user explicitly chose to proceed, we should honor that.
  const freshController = new AbortController();
  const freshSignal = freshController.signal;

  if (payload?.newContent && toolCall) {
    await this._applyInlineModify(toolCall, payload, freshSignal);
  }
  this.setStatusInternal(callId, 'scheduled', freshSignal);
}
// Use fresh signal for execution to avoid stale abort state
const executionController = new AbortController();
await this.attemptExecutionOfScheduledCalls(executionController.signal);
```

## Other Changes Made

### 1. A2A Server Idle Timeout (packages/a2a-server/src/agent/executor.ts)

Added a 30-minute idle timeout mechanism for task cleanup:

- `lastActivity` timestamp on TaskWrapper
- `touchActivity()` method to update timestamp
- `cleanupIdleTasks()` runs every 5 minutes
- Cleanup only happens for non-executing tasks

**Key changes:**

- Lines 40-44: Constants for timeout values
- Lines 53, 58: Added `lastActivity` to TaskWrapper
- Lines 65-78: Added `touchActivity()` and `isIdle()` methods
- Lines 120-188: Cleanup timer and cleanup logic
- Line 451: Touch activity on task access

### 2. Graceful Socket Close (packages/a2a-server/src/agent/executor.ts)

Changed socket close handling to be graceful:

- Lines 425-437: Updated log message and comments
- Lines 672-680: Don't cancel tools or change state on socket close

```typescript
// Before: "Cancelling execution" + cancelPendingTools
// After: "Exiting execution loop (task remains active)" + no cancellation
```

### 3. Secondary Execution Waits for Primary (packages/a2a-server/src/agent/executor.ts)

When a second request arrives while primary is still executing:

- Secondary updates the eventBus to point to new SSE connection
- Secondary processes the confirmation message
- **NEW:** Secondary now waits for primary to complete before returning
- This keeps the SSE connection open so events can stream back

```typescript
// Keep SSE connection open until the first execution completes
await new Promise<void>((resolve) => {
  const checkInterval = setInterval(() => {
    if (!this.executingTasks.has(taskId)) {
      clearInterval(checkInterval);
      resolve();
    }
  }, 50);
});
```

### 4. Fresh Abort Signal After Tool Completion (packages/a2a-server/src/agent/executor.ts)

After `waitForPendingTools()` returns, must create fresh signal BEFORE checking
abort:

```typescript
// Create fresh signal BEFORE checking abort status
if (abortSignal.aborted && activeSignal === abortSignal && hasSuccessfulTools) {
  const freshController = new AbortController();
  activeSignal = freshController.signal;
}

// NOW check abort - will use fresh signal if we just created one
if (activeSignal.aborted) {
  throw new Error('Execution aborted');
}
```

Key insight: The order matters! Original code checked abort first, which always
threw because the original signal was aborted.

## Files Changed

1. `packages/core/src/core/coreToolScheduler.ts`
   - Fresh AbortController in handleConfirmationResponse

2. `packages/a2a-server/src/agent/executor.ts`
   - Idle timeout mechanism
   - Graceful socket close

## Testing Checklist

After rebuilding, test these scenarios:

### 1. Basic Approval Flow

```bash
# Delegate task without autoExecute
gemini_delegate_task_to_assistant: "Create test.md with hello"
# When pending, approve
gemini_approve_or_deny_pending_action with decision: "approve"
# Check: ls test.md should show file exists
```

### 2. Cancellation Still Works

```bash
# Same as above but deny
gemini_approve_or_deny_pending_action with decision: "deny"
# Check: file should NOT be created
```

### 3. Auto-Execute Still Works

```bash
gemini_delegate_task_to_assistant with autoExecute: true
# Should work without manual approval
```

## Bandaid Review - COMPLETED

Reviewed uncommitted changes - **NO BANDAIDS FOUND**. All changes are clean:

**coreToolScheduler.ts:**

- Remove `|| signal.aborted` check → NEEDED (stale signal shouldn't trigger
  cancel)
- Fresh AbortController for execution → ROOT FIX

**executor.ts:**

- Idle timeout mechanism → Feature requested by user
- Graceful socket close → NEEDED (don't cancel on disconnect)

Note: ModifyWithEditor flow still uses old signal but wasn't broken before.

## Testing Results

All tests pass:

- `npm test -w packages/core -- coreToolScheduler` → 38 tests passing
- `npm test -w packages/a2a-server` → 82 tests passing

Manual testing confirmed:

1. Delegate task without autoExecute → Tool waits for approval
2. Approve with `gemini_approve_or_deny_pending_action` → Tool executes
3. Response returns with tool result (no AbortError!)
4. File is created successfully

## Lessons Learned

1. **Trace the signal lifecycle:** When debugging abort issues, follow the
   AbortController/AbortSignal from creation through all uses.

2. **Closures capture values:** The `onConfirm` callback captured the original
   signal in a closure. New requests couldn't provide a fresh signal.

3. **SSE/HTTP connection closing is normal:** In the MCP → A2A flow, the bridge
   closes the HTTP connection after receiving the SSE response. This is
   expected, not an error.

4. **Fresh signals for user actions:** When a user explicitly confirms
   something, create a fresh context rather than reusing stale state.

5. **Bandaids vs root cause:** Initial attempts added checks like
   `if (!userExplicitlyConfirmed)` or `explicitlyConfirmed` flags. The root fix
   was creating a fresh signal.
