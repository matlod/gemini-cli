# Memory System - Session Handoff

**Date:** 2024-12-25 **Status:** Phase 3 Complete, Ready for Integration

---

## Next Session Prompt

```
Read docs/memorysystem/SESSION_HANDOFF.md first.

Phase 3 memory infrastructure is COMPLETE and production-hardened:
- LanceDBStore with table-per-embedding-space (provider+model+dim+norm+version)
- FastEmbed embeddings (npm-only, no daemon)
- Provider ladder (local-first: Ollama → FastEmbed → OpenAI only if explicit)
- Full validation: dimension mismatch throws, lineage validated on upsert
- Race-safe init, chunked deletes, SQL injection prevention

Next steps:
1. Run integration test (embed → upsert → query → verify)
2. Wire ephemeral injection into geminiChat.ts
3. Add MemoryCoreManager to Config

Read these files to understand the implementation:
- packages/core/src/memory/store/lancedbStore.ts (vector store)
- packages/core/src/memory/embeddings/embeddingProviderFactory.ts (provider ladder)
- packages/core/src/memory/MemoryCoreManager.ts (main orchestrator)
- docs/memorysystem/INTEGRATION_NOTES.md (injection points in gemini-cli)
```

---

## Files to Read (Priority Order)

### 1. Core Implementation Files

| File                                                              | Purpose                                       | Read When                        |
| ----------------------------------------------------------------- | --------------------------------------------- | -------------------------------- |
| `packages/core/src/memory/store/lancedbStore.ts`                  | Vector store with embedding space isolation   | Understanding storage            |
| `packages/core/src/memory/embeddings/embeddingProviderFactory.ts` | Provider ladder (Ollama → FastEmbed)          | Understanding provider selection |
| `packages/core/src/memory/MemoryCoreManager.ts`                   | Main orchestrator, `createWithAutoProvider()` | Understanding API                |
| `packages/core/src/memory/relevance/llmFilter.ts`                 | LLM-based relevance filtering                 | Understanding retrieval          |

### 2. Interface/Type Files

| File                                                | Purpose                                                            |
| --------------------------------------------------- | ------------------------------------------------------------------ |
| `packages/core/src/memory/store/store.ts`           | `MemoryStore`, `VectorSearchResult`, `EmbeddingLineage` interfaces |
| `packages/core/src/memory/embeddings/embeddings.ts` | `EmbeddingClient` interface                                        |
| `packages/core/src/memory/types.ts`                 | `MemoryHit`, `MemoryScope`, `MemoryRetrieveOptions`                |
| `packages/core/src/memory/formatters.ts`            | `formatMemoryHits()` for injection                                 |

### 3. Documentation Files

| File                                           | Purpose                                                                       | Priority                  |
| ---------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------- |
| `docs/memorysystem/INTEGRATION_NOTES.md`       | **CRITICAL** - Full analysis of gemini-cli internals, injection points, hooks | Must read for integration |
| `docs/memorysystem/08-retrieval-system.md`     | Retrieval patterns and architecture                                           | Reference                 |
| `docs/memorysystem/10-data-schema.md`          | Full data schema (our impl is simpler)                                        | Reference                 |
| `docs/memorysystem/12-technology-decisions.md` | LanceDB + embedding API decisions                                             | Reference                 |
| `docs/memorysystem/99-gaps-master.md`          | Open questions (many resolved)                                                | Reference                 |

### 4. Integration Target Files

| File                                         | Purpose                                                            |
| -------------------------------------------- | ------------------------------------------------------------------ |
| `packages/core/src/core/geminiChat.ts`       | **PRIMARY** - Where ephemeral injection goes (`sendMessageStream`) |
| `packages/core/src/utils/memoryDiscovery.ts` | Static layer injection point (`refreshServerHierarchicalMemory`)   |
| `packages/core/src/config/config.ts`         | Add `MemoryCoreManager` to config                                  |
| `packages/core/src/core/client.ts`           | Alternative injection point (IDE context pattern)                  |

---

## What's Implemented (Phase 3)

### Dependencies

```json
{
  "@lancedb/lancedb": "^0.23.0",
  "fastembed": "^2.1.0"
}
```

### File Structure

```
packages/core/src/memory/
├── types.ts                    ✅ MemoryHit, MemoryScope, options
├── formatters.ts               ✅ formatMemoryHits(), estimateTokens()
├── MemoryCoreManager.ts        ✅ createWithAutoProvider(), retrieveRelevant()
├── index.ts                    ✅ All exports
├── store/
│   ├── store.ts                ✅ MemoryStore interface, EmbeddingLineage
│   ├── lancedbStore.ts         ✅ Full impl with all hardening
│   └── index.ts                ✅
├── embeddings/
│   ├── embeddings.ts           ✅ EmbeddingClient interface
│   ├── ollamaEmbeddings.ts     ✅ Ollama provider
│   ├── fastembedEmbeddings.ts  ✅ FastEmbed provider (npm-only)
│   ├── embeddingProviderFactory.ts ✅ Provider ladder
│   └── index.ts                ✅
└── relevance/
    ├── llmFilter.ts            ✅ LLM-based filtering
    └── index.ts                ✅
```

---

## Key Design Decisions

### 1. Embedding Space Isolation

Each space gets its own table to prevent dimension mismatch:

```typescript
// Space ID: provider|model|dim|norm|version
// Table name: memory_entries__fastembed__fast_bge_small_en_v1_5__384__none__v1

// norm/version are STORE-LEVEL only (encoded in table name, not per-row)
// Per-row: provider, model, dim
// Table-level: norm, version
```

### 2. Provider Ladder (LOCAL-FIRST)

```
1. Explicit EMBED_PROVIDER env var → use it directly
2. Ollama reachable at localhost:11434 → use Ollama
3. EMBED_BASE_URL set → use custom endpoint (vLLM/TEI)
4. Fallback → FastEmbed (always works, no daemon)

OpenAI requires explicit opt-in: EMBED_PROVIDER=openai
(Logs loudly if OPENAI_API_KEY exists but auto selects local)
```

### 3. Ephemeral Injection (NOT History)

Memory is injected into `contentsToUse` per-turn, NOT via `addHistory()`:

- No accumulation
- No compression drift
- Fresh retrieval each turn
- Clean, targeted context

### 4. Production Hardening

- **Dimension validation**: Throws on mismatch with descriptive error
- **Lineage validation**: Provider/model must match store config
- **Race-safe init**: Try open → create → retry open pattern
- **Chunked deletes**: 200 IDs per batch via `IN (...)`
- **SQL escaping**: `escapeString()` used in ALL predicates
- **Both distance + score**: Returns raw distance for debugging, score for
  ranking

---

## Environment Variables

```bash
EMBED_PROVIDER=auto|openai|ollama|fastembed|endpoint  # Force provider
EMBED_MODEL=...                                        # Override model
EMBED_BASE_URL=...                                     # For endpoint provider
OPENAI_API_KEY=...                                     # Only used if EMBED_PROVIDER=openai
OLLAMA_HOST=http://localhost:11434                     # Ollama host
MEMORY_DB_PATH=...                                     # LanceDB location
```

---

## Remaining Integration Work

### 1. Ephemeral Injection (Primary)

**File:** `packages/core/src/core/geminiChat.ts` in `sendMessageStream()`

**Pattern:** See `INTEGRATION_NOTES.md` Section 15 for full pseudo-code

```typescript
// Key points:
// - Inject BEFORE API call, AFTER BeforeModel hooks
// - Check hasPendingToolCall (can't inject during tool chains)
// - Modify contentsToUse, NOT addHistory()
// - Wrap with <memory> tags + "Reference Only" framing
```

### 2. Config Integration

**File:** `packages/core/src/config/config.ts`

```typescript
private memoryCoreManager?: MemoryCoreManager;
getMemoryCoreManager(): MemoryCoreManager | undefined;
setMemoryCoreManager(manager: MemoryCoreManager): void;
```

### 3. Static Layer (Optional)

**File:** `packages/core/src/utils/memoryDiscovery.ts` in
`refreshServerHierarchicalMemory()`

```typescript
const coreMemory =
  (await config.getMemoryCoreManager()?.getProjectCoreMemory()) || '';
const finalMemory = [result.memoryContent, mcpInstructions, coreMemory]
  .filter(Boolean)
  .join('\n\n');
```

### 4. search_memory Tool (Future)

For subagents that don't get per-turn injection. Parent curates context in task
description, subagent can call `search_memory` tool for more.

---

## Testing Checklist

```
[ ] Dimension mismatch test: create store for 384, upsert 768 vector → throws
[ ] Space isolation test: store A (384) and B (768), query A never returns B
[ ] Provider ladder test: no Ollama + no EMBED_PROVIDER → uses FastEmbed
[ ] Upsert/query roundtrip: embed texts, upsert, query, verify results
[ ] Lineage validation: entry with wrong provider/model → throws
```

---

## Quick Test Command

```bash
# Build first
npm run build

# Test (falls back to FastEmbed if no Ollama)
MEMORY_DB_PATH=/tmp/memory-test node -e "
  const { LanceDBMemoryCoreManager } = require('./packages/core/dist/memory');
  (async () => {
    const mgr = await LanceDBMemoryCoreManager.createWithAutoProvider({
      dbPath: process.env.MEMORY_DB_PATH
    });
    console.log('Manager initialized');
    console.log('Space:', mgr.store?.getSpaceId?.() || 'N/A');
  })();
"
```

---

## Commits

| Hash        | Description                                               |
| ----------- | --------------------------------------------------------- |
| `78d31aa4`  | Phase 1-2: types, formatters, integration points          |
| `9f7b9f21`  | Phase 3 scaffolding: store, embeddings, relevance modules |
| `(pending)` | Phase 3 implementation + hardening                        |

---

## Things Future You Should Know

1. **FastEmbed downloads models on first use** (~100MB). First embed call may be
   slow.

2. **Ollama must be running** with the model pulled. Check with `ollama list`.

3. **Table names include full space config**. Changing
   provider/model/dim/norm/version creates a NEW table. Old data remains but
   won't be searched.

4. **VectorSearchResult now has both `distance` and `score`**. Use `score` for
   ranking/filtering, `distance` for debugging.

5. **minScore is heuristic** unless you standardize on cosine metric +
   L2-normalized vectors across all providers.

6. **The GPT 5.2 feedback was excellent**. All suggestions were implemented:
   space ID with norm/version, dimension validation, chunked deletes, race-safe
   init, local-first ladder, SQL escaping everywhere.

7. **INTEGRATION_NOTES.md is the bible** for understanding gemini-cli internals.
   It has detailed analysis of the execution flow, injection points, and hook
   system.

---

_Last updated: 2024-12-25 (Phase 3 complete, production-hardened)_
