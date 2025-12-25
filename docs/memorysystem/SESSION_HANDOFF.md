# Memory System - Session Handoff

**Date:** 2024-12-25 **Status:** Design validated, ready to implement **Key
File:** `INTEGRATION_NOTES.md` (comprehensive technical notes, 17 sections)

---

## Quick Context for Future Claude

You're building a **memory core system** for gemini-cli that provides semantic
retrieval of past learnings, patterns, and project context. The goal is to make
AI agents "remember" useful information across sessions.

### What We Did This Session

1. **Explored gemini-cli internals** to find clean integration points
2. **Traced the full context flow** from GEMINI.md files → system prompt → API
   call
3. **Discovered the IDE context pattern** - the key insight for our approach
4. **Documented everything** in `INTEGRATION_NOTES.md`

### The Key Insight: IDE Context Pattern

This is the most important discovery. Gemini-cli already injects dynamic context
per-turn:

```typescript
// client.ts lines 499-511
if (this.config.getIdeMode()) {
  this.getChat().addHistory({
    role: 'user',
    parts: [{ text: contextParts.join('\n') }], // Just a user message!
  });
}
```

**Why this matters for memory cores:**

- We can inject retrieved context the same way
- It's dynamic (adapts to each user question via semantic search)
- It goes through history → gets compressed → key facts preserved
- Minimal code changes needed

### The Architecture We're Leaning Towards

```
┌─────────────────────────────────────────────────────────────────┐
│                     SYSTEM PROMPT (static)                       │
│  ├── Base prompt (prompts.ts)                                    │
│  ├── GEMINI.md content (hierarchical discovery)                  │
│  ├── MCP server instructions                                     │
│  └── Memory Core: Project context ← NEW (conventions, arch)     │
├─────────────────────────────────────────────────────────────────┤
│                     PER-TURN HISTORY (dynamic)                   │
│  ├── Initial setup (date, folder structure)                      │
│  ├── IDE context (active file, cursor, selection)                │
│  ├── Memory Core: Relevant patterns ← NEW (semantic retrieval)  │
│  └── User messages + Model responses                             │
└─────────────────────────────────────────────────────────────────┘
```

**Hybrid approach:**

1. **Static layer:** Project-level context in system prompt (refreshes on
   `/memory refresh`)
2. **Dynamic layer:** Semantic retrieval per-turn based on user's actual
   question

### Files You Need to Read

| Priority | File                                         | Why                                                  |
| -------- | -------------------------------------------- | ---------------------------------------------------- |
| 1        | `docs/memorysystem/INTEGRATION_NOTES.md`     | Full technical exploration, code references, options |
| 2        | `docs/memorysystem/02-memory-cores.md`       | What we're building (the vision)                     |
| 3        | `packages/core/src/core/client.ts`           | Lines 499-511 for IDE context pattern                |
| 4        | `packages/core/src/utils/memoryDiscovery.ts` | Lines 558-582 for memory refresh flow                |

### Integration Options (from INTEGRATION_NOTES.md)

| Option | Approach                 | Pros                     | Cons                      |
| ------ | ------------------------ | ------------------------ | ------------------------- |
| A      | System prompt injection  | Simple, single point     | Static, not adaptive      |
| B      | IDE context pattern      | Dynamic, semantic search | Adds latency              |
| C      | Hook-based               | Zero core changes        | External process overhead |
| **D**  | **Hybrid (recommended)** | Best of both             | More complex              |

### What's Already Built

**Gemini-cli has:**

- GEMINI.md file discovery and hierarchical loading ✅
- `/memory` commands (show, add, refresh, list) ✅
- `ContextManager` for JIT context loading (experimental) ✅
- Hook system (`BeforeModel`, `AfterModel`, etc.) ✅
- Compression that preserves key knowledge ✅

**What we need to build:**

- `MemoryCoreManager` - orchestrates retrieval
- LanceDB store - vector storage with Pydantic models
- LadybugDB store - graph relationships
- Retrieval logic - Matryoshka embedding trick

### Minimal Upstream Changes

```
config.ts:
  + memoryCoreManager?: MemoryCoreManager
  + enableMemoryCores?: boolean

client.ts (after IDE context, ~line 511):
  + if (this.config.getMemoryCoreManager()) {
  +   const context = await this.config.getMemoryCoreManager()
  +     .getRelevantContext(request);
  +   if (context) {
  +     this.getChat().addHistory({
  +       role: 'user',
  +       parts: [{ text: context }],
  +     });
  +   }
  + }
```

### Decisions Made

1. **Injection point:** After IDE context in client.ts (~line 511)
2. **No aggressive timeout:** Quality context is worth the wait
3. **Error handling:** Log failures, don't block conversation
4. **Subagents:** Parent curates context + search_memory tool available

### Next Steps

1. **Implement MemoryCoreManager interface** - getRelevantContext(), search()
2. **Create search_memory tool** - for subagent access
3. **Prototype LanceDB store** - vector storage backend
4. **Test compression interaction** - verify context survives

### The User's Style

- Prefers building things organically from real needs
- Values minimal upstream changes for easy merging
- Okay with experimentation and iteration
- Prefers quality over speed - will block for good context

### Key Code Locations

```
packages/core/src/
├── config/config.ts          # Central config, getUserMemory(), setUserMemory()
├── core/
│   ├── client.ts             # GeminiClient, sendMessageStream(), IDE context injection
│   ├── geminiChat.ts         # Chat session, history management
│   └── prompts.ts            # System prompt building, getCoreSystemPrompt()
├── services/
│   ├── contextManager.ts     # Experimental JIT context (good pattern to follow)
│   └── chatCompressionService.ts  # How history gets compressed
└── utils/
    ├── memoryDiscovery.ts    # GEMINI.md loading, refreshServerHierarchicalMemory()
    └── environmentContext.ts # Initial history setup
```

### Questions Still Open

- Where should memory cores live? `~/.gemini/cores/` or project-local
  `.gemini/cores/`?
- What embedding model to use? Local (ollama) or API?
- How to index new learnings from subagent discoveries?
- Should search_memory tool be always-available or opt-in for subagents?

### Questions Answered

- Hook output format: BeforeAgent appends to request (→history), BeforeModel
  modifies contents (not history)
- Retrieval latency: Block for quality, no aggressive timeout, error handling
- Subagent context: Parent curates + tool access for more

---

## Commands to Get Oriented

```bash
# See the integration notes
cat docs/memorysystem/INTEGRATION_NOTES.md

# See what we're building
cat docs/memorysystem/02-memory-cores.md

# See the IDE context pattern (the key insight)
sed -n '499,511p' packages/core/src/core/client.ts

# See how memory refresh works
sed -n '558,582p' packages/core/src/utils/memoryDiscovery.ts

# All memory system docs
ls -la docs/memorysystem/
```

---

## TL;DR for Future Claude

1. Read `INTEGRATION_NOTES.md` first - it has 17 sections of technical details
2. **Injection point:** After IDE context in client.ts:511, as user message
3. **No timeout:** Quality context worth waiting for, just handle errors
4. **Subagents:** Parent curates context + search_memory tool for more
5. **Design validated** - ready to implement

**Start by asking:** "Ready to implement MemoryCoreManager, or want to prototype
the LanceDB store first?"

---

_Last updated: 2024-12-25 (design validated, subagent strategy decided)_
