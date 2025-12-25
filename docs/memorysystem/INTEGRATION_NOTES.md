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

## 10. Next Steps

1. **Investigate hooks deeper** - Can we use `BeforeModelHook` to inject context
   without core changes?
2. **Prototype Option B** - IDE context pattern seems most promising for dynamic
   retrieval
3. **Decide on storage location** - Where do memory cores live?
   `~/.gemini/cores/` or project-local?
4. **Minimal MVP** - Just wire LanceDB into system prompt to prove the pattern
   works

---

_Last updated: 2024-12-25_
