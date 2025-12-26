# Memory System - Session Handoff

**Date:** 2024-12-25 **Status:** Phase 3 Scaffolding Complete, Pending
Embeddings Decision

---

## Latest Update (2024-12-25 Session 2)

### What Got Done This Session

**Phase 3 scaffolding complete (uncommitted):**

```
packages/core/src/memory/
├── types.ts                    ✅ (Phase 1)
├── formatters.ts               ✅ (Phase 1)
├── MemoryCoreManager.ts        ✅ Updated with full pipeline skeleton
├── index.ts                    ✅ Updated with all exports
├── store/
│   ├── store.ts                ✅ NEW - MemoryStore interface
│   ├── lancedbStore.ts         ✅ NEW - Skeleton (needs @lancedb/lancedb)
│   └── index.ts                ✅ NEW
├── embeddings/
│   ├── embeddings.ts           ✅ NEW - EmbeddingClient interface
│   ├── ollamaEmbeddings.ts     ✅ NEW - FULL working implementation
│   └── index.ts                ✅ NEW
└── relevance/
    ├── llmFilter.ts            ✅ NEW - FULL working implementation
    └── index.ts                ✅ NEW

docs/memorysystem/
└── PHASE3_IMPLEMENTATION.md    ✅ NEW - Detailed implementation plan
```

### Open Decision: Embeddings Provider

**Problem:** LanceDB TS SDK only has OpenAI in embedding registry. Python has
many more.

| Option          | External Install | Notes                                           |
| --------------- | ---------------- | ----------------------------------------------- |
| Ollama          | Yes (server)     | Already implemented in ollamaEmbeddings.ts      |
| LanceDB Python  | Python runtime   | Rich embedding registry                         |
| LanceDB TS      | npm only         | **OpenAI only** (needs API key)                 |
| Transformers.js | npm only         | `@huggingface/transformers` - any HF ONNX model |

**Research needed:** Compare LanceDB Python vs TS SDK features beyond
embeddings. If only embeddings differ → use TS + Transformers.js.

### Next Session Tasks

1. Quick research: LanceDB Python vs TS SDK features
2. Commit scaffolding
3. Add dependencies (@lancedb/lancedb + embeddings choice)
4. Implement LanceDBStore TODOs
5. Create TransformersEmbeddings (if chosen)
6. Integration test

---

## Previous Context (Preserved)

### Quick Context for Future Claude

You're building a **memory core system** for gemini-cli that provides semantic
retrieval of past learnings, patterns, and project context. The goal is to make
AI agents "remember" useful information across sessions.

### The Key Insight: Ephemeral Injection (NOT History)

After iteration with external reviews, we chose **ephemeral injection** over
history-based injection:

```typescript
// geminiChat.ts - inject into contentsToUse, NOT addHistory
// Memory is PREPENDED to user message parts (stable turn structure)

const existingParts = lastUserContent.parts ?? [];
contentsToUse = [
  ...contentsToUse.slice(0, -1),
  {
    role: 'user',
    parts: [{ text: memoryText }, ...existingParts],
  },
];
```

**Why ephemeral beats history-based:**

| History-based (addHistory) | Ephemeral (contentsToUse) |
| -------------------------- | ------------------------- |
| Accumulates over turns     | Fresh each turn           |
| Gets compressed → degraded | Never compressed          |
| Needs deduplication logic  | No dedupe needed          |
| Bloats context             | Clean, targeted           |

### The Final Architecture (Hybrid)

```
┌─────────────────────────────────────────────────────────────────┐
│              LAYER 1: SYSTEM PROMPT (static, curated)            │
│  ├── Base prompt (prompts.ts)                                    │
│  ├── GEMINI.md content (hierarchical discovery)                  │
│  ├── MCP server instructions                                     │
│  └── Memory Core: Project context ← IMPLEMENTED                  │
│                                                                  │
│  • Refreshed via /memory refresh                                 │
│  • Always present, never compressed                              │
├─────────────────────────────────────────────────────────────────┤
│         LAYER 2: EPHEMERAL INJECTION (dynamic, per-turn)         │
│                                                                  │
│  • Semantic retrieval based on user's question                   │
│  • Injected into contentsToUse (NOT history)                     │
│  • Prepended to user message parts (stable turn structure)       │
│  • Fresh each turn, no accumulation                              │
│  • Wrapped with <memory> tags + "Reference Only" framing         │
└─────────────────────────────────────────────────────────────────┘
```

### Retrieval Pipeline (Phase 3)

```
Query → Embed → Vector Search (topK=50) → LLM Filter (5-12) → MemoryHit[]
                     ↓                          ↓
              Over-retrieve              Select relevant (no arbitrary caps)
                                                ↓
                                        formatMemoryHits()
                                                ↓
                                   Prepend to user message parts
```

### What's Already Implemented

**Phase 1-2 (Committed `78d31aa4`):**

- Types, formatters, stub MemoryCoreManager
- Config: `enableMemoryCores`, `get/setMemoryCoreManager()`
- geminiChat.ts: Ephemeral injection (prepend to user message)
- memoryDiscovery.ts: Static layer in `refreshServerHierarchicalMemory()`
- tools/search-memory.ts: Subagent tool

**Phase 3 Scaffolding (Uncommitted):**

- Full MemoryCoreManager pipeline skeleton
- MemoryStore interface + LanceDBStore skeleton
- EmbeddingClient interface + OllamaEmbeddings (working)
- llmFilter (working - prompt, parsing, fallback)

### Key Decisions Made

1. **Ephemeral injection:** Dynamic memory into contentsToUse, NOT history
2. **Two layers:** Static (system prompt) + Dynamic (ephemeral per-turn)
3. **Over-retrieve then filter:** topK=50 → LLM selects 5-12 relevant
4. **No arbitrary caps:** Relevance determines inclusion, not token limits
5. **Prepend to user message:** Stable turn structure (not separate message)
6. **Graceful degradation:** Errors logged, never block conversation
7. **hasPendingToolCall guard:** Only check previous message (simplified)

### Files You Need to Read

| Priority | File                                         | Why                                         |
| -------- | -------------------------------------------- | ------------------------------------------- |
| 1        | `docs/memorysystem/PHASE3_IMPLEMENTATION.md` | Detailed Phase 3 plan                       |
| 2        | `docs/memorysystem/INTEGRATION_NOTES.md`     | Full technical exploration, code references |
| 3        | `memory/MemoryCoreManager.ts`                | Main manager with full pipeline             |
| 4        | `memory/store/lancedbStore.ts`               | Vector store (needs implementation)         |

### Key Code Locations

```
packages/core/src/
├── config/config.ts          # enableMemoryCores, get/setMemoryCoreManager
├── core/
│   ├── client.ts             # IDE context pattern reference
│   ├── geminiChat.ts         # Ephemeral injection point (line ~510)
│   └── prompts.ts            # System prompt building
├── memory/                   # NEW - all memory system code
│   ├── MemoryCoreManager.ts  # Main manager
│   ├── store/                # Vector storage
│   ├── embeddings/           # Embedding generation
│   └── relevance/            # LLM filtering
└── utils/
    └── memoryDiscovery.ts    # Static layer injection (line ~580)
```

### What Works Right Now (No Dependencies)

1. **OllamaEmbeddings** - Works if user has Ollama running
2. **llmFilter** - Full implementation with prompt, parsing, fallback
3. **formatMemoryHits** - Sanitization and "Reference Only" framing
4. **All integration points** - Call manager if set, return empty if not

---

_Last updated: 2024-12-25 (Phase 3 scaffolding complete)_
