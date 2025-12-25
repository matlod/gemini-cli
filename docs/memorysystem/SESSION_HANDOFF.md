# Memory System - Session Handoff

**Date:** 2024-12-25 **Status:** Design finalized, ready to implement **Key
File:** `INTEGRATION_NOTES.md` (comprehensive technical notes, 19 sections)

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

### The Key Insight: Ephemeral Injection (NOT History)

After iteration with external reviews, we chose **ephemeral injection** over
history-based injection:

```typescript
// geminiChat.ts - inject into contentsToUse, NOT addHistory
// Memory is sent for THIS turn only, not stored in history

contentsToUse = [
  ...contentsToUse.slice(0, -1), // All but user request
  { role: 'user', parts: [{ text: memoryContext }] }, // Memory
  contentsToUse[contentsToUse.length - 1], // User request last
];
```

**Why ephemeral beats history-based:**

| History-based (addHistory) | Ephemeral (contentsToUse) |
| -------------------------- | ------------------------- |
| Accumulates over turns     | Fresh each turn           |
| Gets compressed → degraded | Never compressed          |
| Needs deduplication logic  | No dedupe needed          |
| Bloats context             | Clean, targeted           |

**Result:** Simpler architecture, no compression drift, no dedup complexity.

### The Final Architecture (Hybrid)

```
┌─────────────────────────────────────────────────────────────────┐
│              LAYER 1: SYSTEM PROMPT (static, curated)            │
│  ├── Base prompt (prompts.ts)                                    │
│  ├── GEMINI.md content (hierarchical discovery)                  │
│  ├── MCP server instructions                                     │
│  └── Memory Core: Project context ← NEW (arch, conventions)     │
│                                                                  │
│  • Refreshed via /memory refresh                                 │
│  • Always present, never compressed                              │
│  • Curated, stable invariants                                    │
├─────────────────────────────────────────────────────────────────┤
│         LAYER 2: EPHEMERAL INJECTION (dynamic, per-turn)         │
│                                                                  │
│  • Semantic retrieval based on user's question                   │
│  • Injected into contentsToUse (NOT history)                     │
│  • Fresh each turn, no accumulation                              │
│  • Wrapped with <memory> tags + "Reference Only" framing         │
│  • External audit via Langfuse/proxy (not in history)            │
└─────────────────────────────────────────────────────────────────┘
```

**Key insight:** Dynamic memory is ephemeral. It's injected, used, and
discarded. Re-retrieval is the source of truth, not persistence.

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

memoryDiscovery.ts (for static layer):
  + projectCoreMemory = await manager.getProjectCoreMemory()
  + finalMemory = [..., projectCoreMemory].join("\n\n")

geminiChat.ts (for dynamic layer - EPHEMERAL):
  + if (!hasPendingToolCall && manager) {
  +   const hits = await manager.retrieveRelevant(request, { signal });
  +   if (hits.length > 0) {
  +     // Inject into contentsToUse, NOT addHistory()
  +     contentsToUse = [..., memoryMessage, userRequest];
  +   }
  + }
```

### Decisions Made

1. **Ephemeral injection:** Dynamic memory injected into contentsToUse, NOT
   history
2. **Two layers:** Static (system prompt) + Dynamic (ephemeral per-turn)
3. **No deduplication needed:** Ephemeral = no accumulation
4. **No compression concerns:** Memory never enters history
5. **Quality over speed:** Block for good retrieval, no aggressive timeout
6. **Relevance over caps:** Filter by similarity, not arbitrary token limits
7. **Subagents:** Parent curates context + search_memory tool available
8. **External audit:** Use Langfuse/proxy, not history persistence

### Next Steps (Phased)

**Phase 1: Foundation**

1. MemoryCoreManager interface with `retrieveRelevant()` returning ranked hits
2. LanceDB store prototype
3. `search_memory` tool for subagents

**Phase 2: Integration** 4. Static layer in
`refreshServerHierarchicalMemory()` 5. Dynamic layer (ephemeral) in
`geminiChat.sendMessageStream()`

**Phase 3: Hardening** 6. Relevance filtering, token safety, prompt sanitization

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

- **History vs Ephemeral:** Ephemeral wins (no bloat, no compression, no dedupe)
- **BeforeModel vs addHistory:** Use contentsToUse modification, not addHistory
- **Deduplication:** Not needed with ephemeral approach
- **Compression:** Not a concern - memory never enters history
- **Retrieval latency:** Block for quality, no aggressive timeout
- **Subagent context:** Parent curates + search_memory tool

### External Review Summary

Three external reviews validated the architecture. Key finding: **ephemeral
injection resolves most originally-identified issues**.

Remaining concerns (addressed in design):

- Token overflow near limit → relevance filtering
- AbortSignal → wired through retrieveRelevant()
- Prompt injection → `<memory>` tags + "Reference Only" framing
- Subagent context → search_memory tool + parent curation

See `INTEGRATION_NOTES.md` Sections 15-16 for full details.

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

1. Read `INTEGRATION_NOTES.md` - 19 sections with final architecture
2. **EPHEMERAL injection:** Dynamic memory goes into contentsToUse, NOT history
3. **Two layers:** Static (system prompt) + Dynamic (ephemeral per-turn)
4. **No dedupe/compression concerns:** Ephemeral = fresh each turn
5. **Subagents:** Parent curates + search_memory tool
6. **Design finalized** - phased implementation plan ready

**Start by asking:** "Ready to implement Phase 1 (MemoryCoreManager interface +
LanceDB)?"

---

_Last updated: 2024-12-25 (ephemeral injection architecture finalized)_
