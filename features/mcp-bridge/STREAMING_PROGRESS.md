# MCP Progress Notifications for Streaming

**Status:** ✅ Implemented **Date:** 2024-12-19

## Why We Did This

Gemini API calls can take 2-30 seconds. Without progress notifications, Claude
Code waits with no feedback. MCP's progress notification feature lets us send
status updates during execution.

### Before (No Visibility)

```
Claude Code → calls MCP tool → waits 10-30s → gets result
                               (no feedback)
```

### After (With Progress)

```
Claude Code → calls MCP tool
                ↓
          "Gemini is working..."
          "Thinking: Analyzing code structure"
          "Tool: read_file (executing)"
          "Generating response..."
                ↓
          returns final result
```

## Implementation

### 1. Progress Token Detection

MCP clients can request progress updates by including a `progressToken` in the
request metadata:

```typescript
// In tool handler
const progressToken = request.params._meta?.progressToken;
```

### 2. sendProgress Helper

```typescript
async function sendProgress(
  progressToken: string | number | undefined,
  progress: number,
  total: number | undefined,
  message: string,
): Promise<void> {
  if (!progressToken || !serverInstance) return;

  await serverInstance.notification({
    method: 'notifications/progress',
    params: { progressToken, progress, total, message },
  } as ProgressNotification);
}
```

### 3. Event-to-Message Mapping

```typescript
function getProgressMessage(event: A2ATaskResponse): string | null {
  const kind = event.metadata?.coderAgent?.kind;

  switch (kind) {
    case 'state-change':
      if (event.status?.state === 'working') return 'Gemini is working...';
      if (event.status?.state === 'completed') return 'Task completed';
      break;
    case 'thought':
      const thought = event.status?.message?.parts?.[0]?.data;
      if (thought?.subject) return `Thinking: ${thought.subject}`;
      return 'Gemini is thinking...';
    case 'tool-call-confirmation':
    case 'tool-call-update':
      const tool = event.status?.message?.parts?.[0]?.data;
      if (tool?.name) return `Tool: ${tool.name} (${tool.status || 'pending'})`;
      break;
    case 'text-content':
      return 'Generating response...';
  }
  return null;
}
```

### 4. Streaming Handler

```typescript
case 'gemini_delegate_task_to_assistant': {
  const progressToken = request.params._meta?.progressToken;

  if (progressToken) {
    // Use streaming with progress notifications
    events = [];
    let progressCount = 0;

    await a2aClient.sendMessageStreaming(
      task,
      (event) => {
        events.push(event);
        const message = getProgressMessage(event);
        if (message) {
          progressCount++;
          sendProgress(progressToken, progressCount, undefined, message);
        }
      },
      session?.taskId,
      workspace,
      autoExecute,
      session?.contextId,
      model,
    );
  } else {
    // Non-streaming (original behavior preserved)
    events = await a2aClient.sendMessage(...);
  }
}
```

## Files Changed

| File                        | Changes                            |
| --------------------------- | ---------------------------------- |
| `src/index.ts:18-23`        | Import `ProgressNotification` type |
| `src/index.ts:536-537`      | `serverInstance` variable          |
| `src/index.ts:541-562`      | `sendProgress()` helper            |
| `src/index.ts:567-595`      | `getProgressMessage()` mapper      |
| `src/index.ts:653-682`      | Streaming in delegate handler      |
| `src/index.test.ts:328-456` | 10 new tests                       |

## Tests Added

- Progress message mapping for each event type
- progressToken extraction from request
- Missing progressToken handling
- Numeric progressToken support
- Notification structure validation

## Behavior Notes

1. **Backward Compatible:** If no `progressToken` provided, uses original
   non-streaming `sendMessage()` - no behavior change.

2. **Error Resilient:** Progress notification failures are silently caught -
   they don't break the main tool execution.

3. **Incremental Count:** Progress count increments with each meaningful event,
   but `total` is undefined since we don't know how many events will come.

## Future Enhancements

1. **Add to consultation tool:** Currently only
   `gemini_delegate_task_to_assistant` supports progress. Could add to
   `gemini_quick_consultation_for_second_opinion`.

2. **Estimated total:** Could track average event counts per task type to
   provide estimated totals.

3. **Rate limiting:** Could throttle progress notifications if events come too
   fast (currently sends on every meaningful event).
