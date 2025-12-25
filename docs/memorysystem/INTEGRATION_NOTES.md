# Memory System Integration Notes

**Purpose:** Document our exploration of gemini-cli internals to find clean
integration points for the memory core system.

**Date Started:** 2024-12-25

---

## 1. Context Flow Architecture (System Prompt)

The system prompt is built in layers and memory is appended at the end.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         SYSTEM PROMPT FLOW                               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  GEMINI.md files (hierarchical discovery)                                │
│       ↓                                                                  │
│  memoryDiscovery.ts: loadServerHierarchicalMemory()                      │
│       ↓                                                                  │
│  config.setUserMemory(memoryContent)  ←──── INTEGRATION SEAM            │
│       ↓                                                                  │
│  config.getUserMemory()                                                  │
│       ↓                                                                  │
│  prompts.ts: getCoreSystemPrompt(config, userMemory)                     │
│       │                                                                  │
│       └──→ return `${basePrompt}\n\n---\n\n${userMemory}`               │
│                 ↓                                                        │
│  client.ts: GeminiChat(systemInstruction)                                │
│       ↓                                                                  │
│  Gemini API                                                              │
└─────────────────────────────────────────────────────────────────────────┘
```

### Key Files for System Prompt

| File                                           | Key Functions                        | What It Does                                   |
| ---------------------------------------------- | ------------------------------------ | ---------------------------------------------- |
| `packages/core/src/config/config.ts`           | `getUserMemory()`, `setUserMemory()` | Central memory store (just a string)           |
| `packages/core/src/core/prompts.ts`            | `getCoreSystemPrompt()`              | Builds system prompt, appends memory as suffix |
| `packages/core/src/utils/memoryDiscovery.ts`   | `refreshServerHierarchicalMemory()`  | Orchestrates GEMINI.md loading                 |
| `packages/core/src/services/contextManager.ts` | `ContextManager` class               | Tiered loading (experimental JIT feature)      |

### Memory Storage in Config

```typescript
// config.ts lines 360, 1064-1069
private userMemory: string;

getUserMemory(): string {
  return this.userMemory;
}

setUserMemory(newUserMemory: string): void {
  this.userMemory = newUserMemory;
}
```

### System Prompt Assembly

```typescript
// prompts.ts lines 380-385
const memorySuffix =
  userMemory && userMemory.trim().length > 0
    ? `\n\n---\n\n${userMemory.trim()}`
    : '';

return `${basePrompt}${memorySuffix}`;
```

### Memory Refresh Flow

```typescript
// memoryDiscovery.ts lines 558-582
export async function refreshServerHierarchicalMemory(config: Config) {
  const result = await loadServerHierarchicalMemory(/* ... */);

  // MCP server instructions get appended too
  const mcpInstructions =
    config.getMcpClientManager()?.getMcpInstructions() || '';

  const finalMemory = [result.memoryContent, mcpInstructions.trimStart()]
    .filter(Boolean)
    .join('\n\n');

  config.setUserMemory(finalMemory);
  config.setGeminiMdFileCount(result.fileCount);
  config.setGeminiMdFilePaths(result.filePaths);

  // Event emitted - we could subscribe to this!
  coreEvents.emit(CoreEvent.MemoryChanged, result);

  return result;
}
```

---

## 2. Existing ContextManager (Experimental)

There's already a tiered context system behind a feature flag:

```typescript
// config.ts line 697-699
if (this.experimentalJitContext) {
  this.contextManager = new ContextManager(this);
}
```

### ContextManager Tiers

| Tier            | Method                          | When Loaded                      |
| --------------- | ------------------------------- | -------------------------------- |
| 1 - Global      | `loadGlobalMemory()`            | Startup, `~/.gemini/GEMINI.md`   |
| 2 - Environment | `loadEnvironmentMemory()`       | Startup, trusted roots           |
| 3 - JIT         | `discoverContext(accessedPath)` | On file access, upward traversal |

### ContextManager Pattern

```typescript
// contextManager.ts
export class ContextManager {
  private readonly loadedPaths: Set<string> = new Set();
  private globalMemory: string = '';
  private environmentMemory: string = '';

  // Tracks what's already loaded to avoid duplicates
  private markAsLoaded(paths: string[]): void {
    for (const p of paths) {
      this.loadedPaths.add(p);
    }
  }
}
```

---

## 3. Message History Handling

### History Storage

History is stored as a simple array of `Content` objects in `GeminiChat`:

```typescript
// geminiChat.ts line 218
private history: Content[] = []

// Content structure (from @google/genai)
interface Content {
  role: 'user' | 'model';
  parts: Part[];  // text, functionCall, functionResponse, etc.
}
```

### Two Types of History

```typescript
// geminiChat.ts lines 551-581
getHistory(curated: boolean = false): Content[] {
  const history = curated
    ? extractCuratedHistory(this.history)  // Valid turns only
    : this.history;                         // Everything
  return structuredClone(history);  // Deep copy!
}
```

- **Comprehensive History:** All turns including invalid/empty responses
- **Curated History:** Only valid turns, used for API requests

### Initial History Setup

```typescript
// environmentContext.ts lines 79-101
export async function getInitialChatHistory(
  config,
  extraHistory?,
): Promise<Content[]> {
  const envParts = await getEnvironmentContext(config); // date, platform, folder structure

  return [
    {
      role: 'user',
      parts: [
        {
          text: `
        ${envContextString}
        Reminder: Do not return an empty response when a tool call is required.
        My setup is complete. I will provide my first command in the next turn.
      `,
        },
      ],
    },
    ...(extraHistory ?? []),
  ];
}
```

First message always contains:

- Today's date
- Operating system
- Project temp directory
- Folder structure of working directories

### IDE Context Injection (Per-Turn)

```typescript
// client.ts lines 221-387
private getIdeContextParts(forceFullContext: boolean): {
  contextParts: string[];
  newIdeContext: IdeContext | undefined;
}
```

IDE context is injected **before each API call** (not in system prompt):

- **Full context:** Active file, cursor position, selected text, other open
  files
- **Delta context:** Files opened/closed, active file changed, cursor moved,
  selection changed

```typescript
// client.ts lines 499-511 (in sendMessageStream)
if (this.config.getIdeMode() && !hasPendingToolCall) {
  const { contextParts, newIdeContext } = this.getIdeContextParts(
    this.forceFullIdeContext || history.length === 0,
  );
  if (contextParts.length > 0) {
    this.getChat().addHistory({
      role: 'user',
      parts: [{ text: contextParts.join('\n') }],
    });
  }
}
```

**Key insight:** IDE context is added as a user message, not in system prompt!

### Compression Behavior

```typescript
// chatCompressionService.ts
export const DEFAULT_COMPRESSION_TOKEN_THRESHOLD = 0.5; // 50% of limit
export const COMPRESSION_PRESERVE_THRESHOLD = 0.3; // Keep last 30%
```

**Compression algorithm:**

1. **Trigger:** When token count > 50% of model's limit
2. **Split:** Find split point preserving last 30% of history
3. **Summarize:** Send older history to Flash model with compression prompt
4. **Output:** Structured XML snapshot (see `getCompressionPrompt()` in
   prompts.ts)
5. **Rebuild:** `[summary as user msg] + [model ack] + [preserved history]`

```typescript
// chatCompressionService.ts lines 200-210
const extraHistory: Content[] = [
  {
    role: 'user',
    parts: [{ text: summary }], // The compressed summary
  },
  {
    role: 'model',
    parts: [{ text: 'Got it. Thanks for the additional context!' }],
  },
  ...historyToKeep, // Last 30%
];
```

### Compression Summary Format

```xml
<state_snapshot>
  <overall_goal>User's high-level objective</overall_goal>
  <key_knowledge>
    - Build Command: `npm run build`
    - Testing: Tests run with `npm test`
  </key_knowledge>
  <file_system_state>
    - CWD: `/home/user/project`
    - MODIFIED: `services/auth.ts`
    - CREATED: `tests/new-feature.test.ts`
  </file_system_state>
  <recent_actions>
    - Ran `grep 'old_function'` returned 3 results
    - Ran `npm run test` failed due to snapshot mismatch
  </recent_actions>
  <current_plan>
    1. [DONE] Identify deprecated API usage
    2. [IN PROGRESS] Refactor component
    3. [TODO] Update tests
  </current_plan>
</state_snapshot>
```

### Hook Points in History Flow

Several hooks fire during the message flow:

| Hook                          | When                           | Purpose                |
| ----------------------------- | ------------------------------ | ---------------------- |
| `fireBeforeAgentHook`         | Before processing user message | Block/modify request   |
| `fireBeforeModelHook`         | Before API call                | Modify config/contents |
| `fireBeforeToolSelectionHook` | Before API call                | Modify tool config     |
| `fireAfterModelHook`          | After each chunk               | Modify response        |
| `fireAfterAgentHook`          | After response complete        | Force continuation     |
| `firePreCompressHook`         | Before compression             | Auto or manual trigger |

---

## 4. Key Architectural Insights

### Context Injection Points

There are **THREE** places context can be injected:

| Location             | When                      | What Goes There                     | Persistence              |
| -------------------- | ------------------------- | ----------------------------------- | ------------------------ |
| **System Prompt**    | Session start, on refresh | GEMINI.md content, MCP instructions | Per-session              |
| **Initial History**  | Session start             | Date, platform, folder structure    | Compressed eventually    |
| **Per-Turn History** | Before each API call      | IDE context (files, cursor)         | In history, compressible |

### The IDE Context Pattern

This is the most interesting pattern for our memory cores:

```typescript
// client.ts - IDE context is injected as a USER MESSAGE
if (this.config.getIdeMode()) {
  this.getChat().addHistory({
    role: 'user',
    parts: [{ text: contextParts.join('\n') }], // <-- Just a user message!
  });
}
```

**Why this matters:**

- We could inject memory core context the same way
- It's per-turn, so it can be **dynamic** based on conversation
- It goes through normal history → gets compressed → key facts preserved

### Compression Preserves Key Knowledge

The compression summary explicitly extracts:

- `<key_knowledge>` - Crucial facts, conventions, constraints
- `<file_system_state>` - Files touched and learnings
- `<current_plan>` - Task state

**This means:** If we inject memory core context, the compression will naturally
extract and preserve the important parts!

### Hook System is Extensible

The hook system (`fireBeforeModelHook`, etc.) can:

- Block requests
- Modify contents before sending
- Modify responses after receiving

**This could be our cleanest integration point** - no core file changes needed.

---

## 5. Potential Integration Points

### Option A: System Prompt Injection (Static)

**Where:** `refreshServerHierarchicalMemory()` in memoryDiscovery.ts

**How:** After loading GEMINI.md content, also query memory cores and append.

```typescript
// memoryDiscovery.ts line ~574
const mcpInstructions =
  config.getMcpClientManager()?.getMcpInstructions() || '';
const coreMemory =
  (await config.getMemoryCoreManager()?.getProjectContext()) || ''; // NEW

const finalMemory = [result.memoryContent, mcpInstructions, coreMemory]
  .filter(Boolean)
  .join('\n\n');

config.setUserMemory(finalMemory);
```

**Pros:**

- Single integration point
- Memory cores appear in system prompt like GEMINI.md
- Works with existing refresh flow

**Cons:**

- Static per-session (doesn't adapt to conversation)
- Uses system prompt tokens (not compressed)

### Option B: IDE Context Pattern (Dynamic Per-Turn)

**Where:** In `sendMessageStream()` next to IDE context injection

**How:** Query memory cores based on current message, inject as user message.

```typescript
// client.ts after IDE context injection (~line 511)
if (this.config.getMemoryCoreManager()) {
  const memoryContext = await this.config
    .getMemoryCoreManager()
    .getRelevantContext(request); // Semantic search based on user message

  if (memoryContext) {
    this.getChat().addHistory({
      role: 'user',
      parts: [{ text: `Relevant context from memory:\n${memoryContext}` }],
    });
  }
}
```

**Pros:**

- Dynamic, adapts to each turn
- Semantic search based on actual user question
- Gets compressed with history (key facts preserved)
- Similar pattern to existing IDE context

**Cons:**

- Adds latency (retrieval before each turn)
- Need to manage what's already been injected

### Option C: Hook-Based (Zero Core Changes)

**Where:** Custom `BeforeModel` hook

**How:** Use existing hook system to inject context without modifying core
files.

```typescript
// Our hook (loaded via settings.json or extension)
{
  "hooks": {
    "beforeModel": {
      "command": "memory-core-context",
      "timeout": 5000
    }
  }
}

// Hook script queries memory cores, returns additional context
// Hook output gets added to request contents
```

**Pros:**

- **Zero upstream changes**
- Uses existing extension/hook infrastructure
- Can be enabled/disabled per-project

**Cons:**

- Hook overhead (subprocess call)
- Less integrated (external process)
- Need to investigate hook output handling

### Option D: Hybrid Approach (Recommended)

**Static base + Dynamic retrieval:**

1. **System prompt:** Project-level context (conventions, architecture) from
   memory cores
2. **Per-turn:** Semantic retrieval for specific questions/tasks

```
System Prompt:
├── Base prompt (prompts.ts)
├── GEMINI.md content
├── MCP instructions
└── Memory Core: Project context (static)  ← NEW

Per-Turn (history):
├── Initial setup (date, folder structure)
├── IDE context (files, cursor)
├── Memory Core: Relevant patterns (dynamic)  ← NEW
└── User messages + Model responses
```

---

## 6. Minimal Upstream Changes Strategy

To keep upstream merges clean, we want:

```
UPSTREAM CHANGES (minimal):
├── config.ts
│   ├── Add `memoryCoreManager?: MemoryCoreManager` field
│   └── Add `enableMemoryCores?: boolean` to ConfigParameters
│
└── memoryDiscovery.ts OR prompts.ts
    └── One hook point to include core memory

OUR CODE (separate files, easy to maintain):
├── src/memory/
│   ├── MemoryCoreManager.ts      # Main orchestration
│   ├── lancedb-store.ts          # Vector storage
│   ├── ladybugdb-store.ts        # Graph storage
│   └── retrieval.ts              # Query logic
```

---

## 7. Answered Questions

| Question                                  | Answer                                                                                                         |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| How does message history work?            | Array of `Content` objects with `user`/`model` roles. Two views: comprehensive (all) and curated (valid only). |
| How does compression decide what to keep? | Keeps last 30% of history, summarizes rest into structured XML with `<state_snapshot>` format.                 |
| When/how is IDE context injected?         | Per-turn, as a user message, before API call. Delta-based (only changes).                                      |
| Is there a hook system?                   | Yes! `BeforeModel`, `AfterModel`, `BeforeAgent`, `AfterAgent`, etc. Can modify contents.                       |
| How do MCP tools get context?             | MCP instructions appended to userMemory in `refreshServerHierarchicalMemory()`.                                |

---

## 8. Remaining Questions

- [ ] How does the hook output get incorporated into request contents?
- [ ] What's the exact format expected by `BeforeModelHook` for modifying
      contents?
- [ ] Can we access the full request (including history) in hooks?
- [ ] How does JIT context (`experimentalJitContext`) interact with tool file
      access?
- [ ] What triggers `MemoryChanged` event subscribers?

---

## 9. Code References

### Files Read

| File                                                   | Purpose                                  | Key Lines                |
| ------------------------------------------------------ | ---------------------------------------- | ------------------------ |
| `packages/core/src/core/prompts.ts`                    | System prompt building                   | 80-386, 393-451          |
| `packages/core/src/core/client.ts`                     | GeminiClient, turn handling, IDE context | 64-789, 221-387, 499-511 |
| `packages/core/src/core/geminiChat.ts`                 | Chat session, history management         | 207-881, 574-581         |
| `packages/core/src/config/config.ts`                   | Central config, memory storage           | 333-1718, 1064-1069      |
| `packages/core/src/utils/memoryDiscovery.ts`           | GEMINI.md discovery, refresh             | 1-648, 558-582           |
| `packages/core/src/utils/environmentContext.ts`        | Initial history setup                    | 1-102, 79-101            |
| `packages/core/src/services/contextManager.ts`         | Experimental JIT context                 | 1-112                    |
| `packages/core/src/services/chatCompressionService.ts` | History compression                      | 1-251, 32-38, 200-210    |

### Key Events

```typescript
// Memory changed - could subscribe for cache invalidation
coreEvents.emit(CoreEvent.MemoryChanged, result); // memoryDiscovery.ts:580

// Hooks - could use for context injection
fireBeforeModelHook(messageBus, { model, config, contents }); // geminiChat.ts:454
fireBeforeAgentHook(messageBus, request); // client.ts:414
```

### Key Config Flags

```typescript
// Existing flags we might leverage
experimentalJitContext: boolean; // Enables ContextManager
ideMode: boolean; // Enables IDE context injection
enableHooks: boolean; // Enables hook system
```

---

## 10. Detailed Execution Flow Analysis

Understanding the exact order of operations is critical for memory injection:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    sendMessageStream() EXECUTION ORDER                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                               │
│  1. BeforeAgent Hook (client.ts:410-437)                                     │
│     └── Can add additionalContext → APPENDED TO REQUEST (not history)        │
│     └── Becomes part of user message, then flows to history                  │
│                                                                               │
│  2. Compression Check (client.ts:480)                                        │
│     └── Uses CURRENT history (before IDE/memory injection)                   │
│     └── If triggered: startChat() rebuilds with compressed history           │
│                                                                               │
│  3. Pending Tool Call Check (client.ts:491-497)                              │
│     └── If model's last message has functionCall → SKIP context injection    │
│     └── API requires functionResponse immediately after functionCall          │
│                                                                               │
│  4. IDE Context Injection (client.ts:499-511)                                │
│     └── Adds to HISTORY as user message                                      │
│     └── Only if ideMode && !hasPendingToolCall                               │
│                                                                               │
│  5. ═══ OUR INJECTION POINT WOULD BE HERE ═══                                │
│     └── After IDE context, before turn.run()                                 │
│                                                                               │
│  6. Turn.run() (client.ts:553)                                               │
│     └── geminiChat.sendMessageStream()                                       │
│         └── BeforeModel Hook (geminiChat.ts:449-506)                         │
│             └── Can modify contents (what's sent THIS turn)                  │
│             └── NOT history - just the current request                       │
│         └── BeforeToolSelection Hook                                         │
│         └── API call                                                         │
│         └── AfterModel Hook (per chunk)                                      │
│                                                                               │
│  7. AfterAgent Hook (client.ts:631-654)                                      │
│     └── Can force continuation                                               │
│                                                                               │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 11. Potential Interaction Issues & Risks

### Issue 1: Compression Timing

**The Problem:**

```
Timeline:
  Turn N-1: Memory context A injected → now in history
  Turn N:   Compression triggers (line 480)
            └── Memory context A IS in history being compressed
            └── IDE context injection (line 499-511) happens AFTER
            └── Our memory injection would happen AFTER
            └── NEW memory context B not yet in history
```

**Risk Level:** LOW

**Why it's OK:**

- Compression preserves `<key_knowledge>` - important facts survive
- Memory context is designed to be re-retrieved when relevant
- Static system prompt context is never compressed

**Mitigation:**

- Format memory injections to be compression-friendly (use clear labels)
- Consider: `## Memory Core Context\n- Key fact 1\n- Key fact 2`

---

### Issue 2: Pending Tool Call Guard

**The Problem:**

```typescript
// client.ts:491-497
const hasPendingToolCall =
  lastMessage?.role === 'model' &&
  lastMessage.parts?.some((p) => 'functionCall' in p);

if (this.config.getIdeMode() && !hasPendingToolCall) {
  // IDE context injection
}
```

During multi-tool-call chains, context injection is SKIPPED.

**Risk Level:** LOW-MEDIUM

**Why it might be OK:**

- Tool chains usually operate on established context
- Injecting mid-chain could confuse the model
- Context will be injected on the next "real" user turn

**Risk:**

- Long tool chains lose opportunity for fresh memory retrieval
- If user's intent shifts mid-chain, we miss it

**Mitigation:**

- Accept this limitation (matches IDE context behavior)
- OR: Track "turns since last memory injection" and force on next opportunity

---

### Issue 3: LocalAgentExecutor (Subagents) Have Separate Flow

**The Problem:**

```typescript
// local-executor.ts - Subagents have:
// - Their own compression service (line 155)
// - Their own system prompt building (lines 999-1034)
// - NO IDE context injection
// - NO BeforeAgent/AfterAgent hooks (run in YOLO mode)
```

**Risk Level:** MEDIUM

**Impact:**

- Subagents (Task tool spawns) won't get per-turn memory injection
- They only get what's in their system prompt

**Mitigation Options:**

1. **Accept it:** Subagents are short-lived, focused tasks
2. **Inject in subagent system prompt:** Add memory context in
   `buildSystemPrompt()`
3. **Pass context via inputs:** Parent passes relevant context in task
   description

---

### Issue 4: BeforeModel Hook Modifies Request, Not History

**The Problem:**

```typescript
// geminiChatHookTriggers.ts:112-123
// BeforeModel can return modifiedContents

// geminiChat.ts:479-484
if (beforeModelResult.modifiedContents) {
  contentsToUse = beforeModelResult.modifiedContents; // <- Current request only!
}
```

BeforeModel modifies what's sent THIS turn, not persistent history.

**Risk Level:** LOW (just understanding)

**Impact:**

- Hook-based injection via BeforeModel won't persist in history
- Context would need re-injection every turn
- Compression won't see hook-injected content (it's not in history)

**Comparison to IDE Context Pattern:** | Approach | Persists in History |
Compressed | Re-injected Each Turn |
|----------|---------------------|------------|----------------------| | IDE
Context (addHistory) | Yes | Yes | Delta only | | BeforeModel Hook | No | No |
Must re-inject | | BeforeAgent Hook | Yes (via request→history) | Yes | Must
re-inject |

---

### Issue 5: After Compression, Chat Restarts

**The Problem:**

```typescript
// client.ts:779-783
if (info.compressionStatus === CompressionStatus.COMPRESSED) {
  if (newHistory) {
    this.chat = await this.startChat(newHistory); // NEW chat session!
    this.forceFullIdeContext = true;
  }
}
```

**Risk Level:** LOW

**Why it's OK:**

- System prompt is rebuilt (includes static memory context)
- `forceFullIdeContext = true` means full IDE context on next turn
- We should do the same for memory context

**Mitigation:**

- Track similar flag: `forceFullMemoryContext`
- On compression, re-retrieve full memory context

---

### Issue 6: Loop Detection

**The Problem:** Could repeated memory injection trigger loop detection?

```typescript
// loopDetectionService.ts:29-31
const TOOL_CALL_LOOP_THRESHOLD = 5;
const CONTENT_LOOP_THRESHOLD = 10;
```

**Risk Level:** VERY LOW

**Why it's OK:**

- Loop detection looks at tool calls and content patterns
- Memory context is injected as user messages, not model output
- The model's responses would need to loop, not our injections

---

### Issue 7: Token Budget Competition

**The Problem:**

```
System Prompt Budget:
├── Base prompt (~X tokens)
├── GEMINI.md content (variable)
├── MCP instructions (variable)
└── Memory Core context (NEW - variable) ← Competes for space

Per-Turn Budget:
├── IDE context (variable, delta-compressed)
├── Memory context (NEW - variable)       ← Competes for space
└── Actual conversation
```

**Risk Level:** MEDIUM

**Impact:**

- Too much memory context → less room for conversation
- System prompt memory eats "premium" never-compressed tokens
- Per-turn memory adds to history → faster compression trigger

**Mitigation:**

- **Budget management:** Cap memory injection at N tokens
- **Relevance scoring:** Only inject high-confidence matches
- **Tiered approach:**
  - System prompt: Only critical project-level facts
  - Per-turn: Only directly relevant patterns
- **Monitor:** Track token counts, warn if memory eating too much

---

### Issue 8: Retrieval Latency

**The Problem:**

```
User sends message
    ↓
BeforeAgent hook (~10ms)
    ↓
Compression check (~50-500ms if triggered)
    ↓
Memory retrieval ← NEW (~100-500ms for vector search)
    ↓
API call (~500-2000ms)
```

**Risk Level:** MEDIUM

**Impact:**

- Adds latency to every turn
- Vector search + embedding = noticeable delay
- Bad UX if retrieval is slow

**Mitigation:**

- **Async prefetch:** Start retrieval while user is typing
- **Caching:** Cache embeddings for repeated queries
- **Local models:** Use local embedding (Ollama) vs API
- **Timeout:** Cap retrieval at 200ms, proceed without if slow
- **Background:** Retrieve in background, inject on NEXT turn if late

---

## 12. Hook System Deep Dive (Answered Questions)

### How does BeforeAgent additionalContext work?

```typescript
// client.ts:431-436
const additionalContext = hookOutput?.getAdditionalContext();
if (additionalContext) {
  const requestArray = Array.isArray(request) ? request : [request];
  request = [...requestArray, { text: additionalContext }];
}
```

- Context is APPENDED to the user's request
- Becomes part of the user message in history
- Compression CAN see it (it's in history)
- Re-injection needed each turn (hook runs each turn)

### BeforeModel hook modifies contents how?

```typescript
// geminiChat.ts:479-484
if (beforeModelResult.modifiedContents) {
  contentsToUse = beforeModelResult.modifiedContents as Content[];
}
```

- Modifies `contentsToUse` which is sent to API
- Does NOT modify `this.history`
- Not persistent - one-time modification

### Can hooks access full history?

```typescript
// geminiChatHookTriggers.ts:71-88
const response = await messageBus.request({
  type: MessageBusType.HOOK_EXECUTION_REQUEST,
  eventName: 'BeforeModel',
  input: {
    llm_request: llmRequest, // Contains contents, not full history
  },
});
```

- BeforeModel gets `contents` (current request)
- Does NOT get full conversation history
- To access history, hook would need different mechanism

---

## 13. Recommended Approach (Updated)

Based on interaction analysis:

### For Per-Turn Memory Injection (Option B - IDE Pattern)

```typescript
// client.ts after line 511
// IMPORTANT: Also respect hasPendingToolCall guard
if (!hasPendingToolCall && this.config.getMemoryCoreManager()) {
  const startTime = Date.now();
  const memoryContext = await Promise.race([
    this.config.getMemoryCoreManager().getRelevantContext(request),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 200)), // 200ms timeout
  ]);

  if (memoryContext && Date.now() - startTime < 200) {
    this.getChat().addHistory({
      role: 'user',
      parts: [{ text: `## Relevant Memory\n${memoryContext}` }],
    });
  }
}
```

### For Subagent Support

```typescript
// local-executor.ts in buildSystemPrompt()
// Add memory context to subagent prompts
const memoryContext = await this.runtimeContext
  .getMemoryCoreManager()
  ?.getTaskContext(this.definition.name);

if (memoryContext) {
  finalPrompt += `\n\n## Relevant Memory\n${memoryContext}`;
}
```

### For Post-Compression Recovery

```typescript
// client.ts after compression handling
if (info.compressionStatus === CompressionStatus.COMPRESSED) {
  if (newHistory) {
    this.chat = await this.startChat(newHistory);
    this.forceFullIdeContext = true;
    this.forceFullMemoryContext = true; // NEW - re-retrieve memory
  }
}
```

---

## 14. Subagent Memory Strategy

Subagents (spawned via Task tool) have a separate execution flow and don't
receive per-turn memory injection. Instead, we use a **delegation pattern**:

### The Pattern

```
┌─────────────────────────────────────────────────────────────────────┐
│                     PARENT AGENT (main conversation)                 │
├─────────────────────────────────────────────────────────────────────┤
│  Per-Turn:                                                           │
│    1. User message arrives                                           │
│    2. Memory retrieval (can take time, quality > speed)             │
│    3. Inject as history: "## Relevant Memory\n..."                  │
│    4. Model generates response                                       │
│                                                                      │
│  Spawning Subagent:                                                  │
│    1. Include curated context in task description                   │
│    2. Ensure search_memory tool is available                        │
│    3. Subagent can fetch more if needed                             │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                           SUBAGENT                                   │
├─────────────────────────────────────────────────────────────────────┤
│  Initial Context:                                                    │
│    - Task description (with parent-curated memory)                  │
│    - System prompt from agent definition                            │
│                                                                      │
│  During Execution:                                                   │
│    - Can call search_memory tool for more context                   │
│    - Can call other tools as defined                                │
│    - Own compression service handles long sessions                  │
│                                                                      │
│  Return:                                                             │
│    - Results back to parent                                          │
│    - (Parent could index new learnings discovered)                  │
└─────────────────────────────────────────────────────────────────────┘
```

### Why This Works

1. **Parent has full context** - knows conversation history, user intent
2. **Parent curates** - passes only what's relevant, avoiding noise
3. **Subagent is autonomous** - can fetch more via tool calls if needed
4. **No core changes to local-executor.ts** - works with existing architecture

### The Memory Tool for Subagents

```typescript
{
  name: 'search_memory',
  description: 'Search project memory for relevant patterns, conventions, or past solutions',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'What to search for'
      },
      scope: {
        type: 'string',
        enum: ['project', 'global'],
        default: 'project'
      }
    },
    required: ['query']
  }
}
```

### Context Format for Subagent Tasks

When parent spawns subagent, include context that survives compression:

```typescript
const taskWithContext = `
## Task
${taskDescription}

## Key Context (preserve these facts)
- Auth uses JWT tokens stored in localStorage
- API endpoints follow REST conventions at /api/v2/*
- Tests use vitest, run with 'pnpm test'

## Memory Tools Available
If you need more context, use the search_memory tool.
`;
```

### Tool Availability Decision

**Recommendation: Always available**

| Always Available                 | Opt-In                          |
| -------------------------------- | ------------------------------- |
| Simpler - subagents just have it | Parent controls tool budget     |
| More autonomous                  | Faster if not needed            |
| Risk: subagent over-fetches      | Risk: parent forgets to include |

The search_memory tool should be registered in the parent's tool registry so
subagents can reference it by name.

### Considerations

1. **MCP tool access**: If memory is an MCP tool, verify subagents can access
   via parent registry lookup (local-executor.ts:106-111)

2. **Cost/latency**: Each subagent memory call = embedding + search. For
   parallel subagents, consider caching or parent pre-fetching.

3. **New learnings capture**: When subagent discovers something useful, who
   indexes it?
   - AfterAgent hook on parent sees result → indexes
   - Subagent has `remember_this` tool
   - Background transcript analysis

4. **Circular prevention**: Tool execution is synchronous, so memory tool calls
   won't trigger recursive context injection.

---

## 15. Updated Injection Pattern (Final)

Based on analysis, the recommended injection pattern:

```typescript
// client.ts after IDE context injection (~line 511)
// Quality over speed - allow time for good retrieval
if (!hasPendingToolCall && this.config.getMemoryCoreManager()) {
  try {
    // Can make multiple LLM calls if needed for best context
    const memoryContext = await this.config
      .getMemoryCoreManager()
      .getRelevantContext(request);

    if (memoryContext) {
      this.getChat().addHistory({
        role: 'user',
        parts: [{ text: `## Relevant Memory\n${memoryContext}` }],
      });
    }
  } catch (error) {
    // Log but don't block - memory enhances, doesn't gate
    debugLogger.warn(`Memory retrieval failed: ${error.message}`);
    // Optional: emit event for monitoring
    // coreEvents.emit(CoreEvent.MemoryRetrievalFailed, error);
  }
}
```

Key decisions:

- **No aggressive timeout** - quality context is worth the wait
- **Error handling** - failures logged but don't block conversation
- **Respects hasPendingToolCall** - matches IDE context behavior

---

## 16. Next Steps

1. **Implement MemoryCoreManager interface** - define getRelevantContext(),
   search()
2. **Create search_memory tool** - for subagent access
3. **Prototype LanceDB store** - vector storage backend
4. **Test compression interaction** - verify context survives
5. **Verify MCP tool access for subagents** - confirm registry lookup works
6. **Design indexing strategy** - when/how to capture new learnings

---

## 17. Files for External Review

For another LLM to review this design, send these files in order:

```bash
# 1. Quick context (what we're building)
cat docs/memorysystem/README.md

# 2. This file (detailed technical analysis)
cat docs/memorysystem/INTEGRATION_NOTES.md

# 3. The key code file (to verify our understanding)
cat packages/core/src/core/client.ts

# 4. Subagent executor (to verify tool access)
cat packages/core/src/agents/local-executor.ts
```

Ask the reviewer to validate:

- Injection point choice (after IDE context)
- Subagent delegation pattern
- Error handling approach
- Any risks we missed

---

_Last updated: 2024-12-25 (subagent strategy, final injection pattern)_
