# Phase 3: LanceDB Store + Retrieval Pipeline

**Status:** Planning **Last Updated:** 2024-12-25

## Overview

Phase 3 replaces the `MemoryCoreManager` stub with a real retrieval pipeline:

```
Query → Embed → Vector Search (over-retrieve) → LLM Filter → MemoryHit[]
```

### Key Architecture Decision

**Over-retrieve then filter with LLM:**

- Vector search returns ~50 candidates (topK=50)
- LLM selects 5-12 most relevant based on current context
- No arbitrary token/character caps - relevance determines inclusion

---

## Module Layout

```
packages/core/src/memory/
├── types.ts                    ✅ Done (Phase 1)
├── formatters.ts               ✅ Done (Phase 1)
├── index.ts                    ✅ Done (Phase 1)
├── MemoryCoreManager.ts        🔄 Update with real implementation
├── store/
│   ├── store.ts                🆕 MemoryStore interface
│   └── lancedbStore.ts         🆕 LanceDB implementation
├── embeddings/
│   ├── embeddings.ts           🆕 EmbeddingClient interface
│   └── ollamaEmbeddings.ts     🆕 Ollama implementation (MVP)
└── relevance/
    └── llmFilter.ts            🆕 LLM-based relevance filtering
```

---

## 3.1 Store Layer

### Interface: `store/store.ts`

```typescript
interface MemoryStore {
  /**
   * Initialize connection, create/open tables
   */
  init(): Promise<void>;

  /**
   * Add or update memory entries
   */
  upsert(entries: StoredMemoryEntry[]): Promise<void>;

  /**
   * Delete by ID
   */
  delete(id: string): Promise<void>;

  /**
   * Delete all entries in a scope
   */
  deleteByScope(scope: MemoryScope): Promise<void>;

  /**
   * Vector similarity search
   */
  vectorSearch(
    queryVector: number[],
    options: VectorSearchOptions,
  ): Promise<StoredMemoryEntry[]>;

  /**
   * Close connection gracefully
   */
  close(): Promise<void>;
}

interface StoredMemoryEntry {
  id: string;
  scope: MemoryScope; // 'project' | 'global'
  text: string; // The actual memory content
  source?: string; // Provenance
  tags?: string[]; // For filtering
  createdAt: Date;
  updatedAt: Date;
  embedding: number[]; // Vector for similarity search
}

interface VectorSearchOptions {
  topK: number; // How many candidates to retrieve
  scope?: MemoryScope; // Filter by scope
  minScore?: number; // Optional similarity threshold
}
```

### Implementation: `store/lancedbStore.ts`

**Dependency:** `@lancedb/lancedb` (npm, native NAPI bindings, Node 18+)

**Table Schema:**

```
memory_entries:
  - id: string (primary)
  - scope: string
  - text: string
  - source: string (nullable)
  - tags: string (JSON array as string)
  - createdAt: timestamp
  - updatedAt: timestamp
  - embedding: vector(768)  // Dimension matches embedding model
```

**Key Methods:**

- `init()`: Connect to DB path, create table if not exists
- `upsert()`: Delete existing by ID, then add (LanceDB upsert pattern)
- `vectorSearch()`: `table.search(queryVector).limit(topK).execute()`

---

## 3.2 Embeddings Layer

### Interface: `embeddings/embeddings.ts`

```typescript
interface EmbeddingClient {
  /**
   * Generate embeddings for one or more texts
   */
  embed(texts: string[], signal?: AbortSignal): Promise<number[][]>;

  /**
   * Convenience method for single text
   */
  embedOne(text: string, signal?: AbortSignal): Promise<number[]>;

  /**
   * Get the embedding dimension for this model
   */
  getDimension(): number;
}

interface EmbeddingConfig {
  baseUrl: string; // e.g., 'http://localhost:11434'
  model: string; // e.g., 'nomic-embed-text'
  dimension: number; // e.g., 768
  batchSize?: number; // Max texts per request (default: 32)
  timeoutMs?: number; // Request timeout (default: 30000)
}
```

### Implementation: `embeddings/ollamaEmbeddings.ts`

**Endpoint:** `POST /api/embed` (batch-capable, stable)

**Request:**

```json
{
  "model": "nomic-embed-text",
  "input": ["text1", "text2", ...]
}
```

**Response:**

```json
{
  "model": "nomic-embed-text",
  "embeddings": [[0.1, 0.2, ...], [0.3, 0.4, ...]]
}
```

**Key Considerations:**

- Use native `fetch` with AbortSignal support
- Batch texts according to `batchSize`
- Handle connection errors gracefully (return empty, log warning)

---

## 3.3 LLM Relevance Filter

### Module: `relevance/llmFilter.ts`

**Purpose:** Given over-retrieved candidates, use LLM to select the most
relevant.

```typescript
interface LLMFilterResult {
  selectedIds: string[];
  reasoning?: string; // Optional explanation
}

interface LLMFilterOptions {
  maxSelect?: number; // Max to select (default: 10)
  signal?: AbortSignal;
}

async function filterByRelevance(
  query: string,
  candidates: CandidateHit[],
  options?: LLMFilterOptions,
): Promise<LLMFilterResult>;

interface CandidateHit {
  id: string;
  score: number; // Similarity score from vector search
  textSnippet: string; // First ~200 chars for prompt efficiency
  source?: string;
}
```

### Prompt Design

```
You are a relevance filter. Given a user query and candidate memory entries,
select the ones that are DIRECTLY relevant to answering or helping with the query.

USER QUERY:
{query}

CANDIDATES (id | score | source | snippet):
{candidates formatted as table}

Return JSON only:
{"selected": ["id1", "id2", ...], "notes": "brief reasoning"}

Rules:
- Select 0-{maxSelect} entries
- Only select if DIRECTLY relevant
- Prefer higher scores when relevance is equal
- If nothing is relevant, return {"selected": [], "notes": "none relevant"}
```

### Failure Handling

If LLM call fails (timeout, parse error, abort):

1. Log warning (never throw)
2. Fallback to top N by score (e.g., top 8)
3. Return those as the result

### Which Model?

Use existing Gemini client via `config.getClient()`:

- Inherits auth, model selection, rate limits
- Use `gemini-2.0-flash` for speed (this is a classification task)

---

## 3.4 MemoryCoreManager Implementation

### Updated `retrieveRelevant()`

```typescript
async retrieveRelevant(
  request: string | Part[],
  options?: MemoryRetrieveOptions
): Promise<MemoryHit[]> {
  const { signal, scope = 'project', topK = 50 } = options ?? {};

  // 1. Early abort check
  if (signal?.aborted) return [];

  // 2. Extract query text
  const query = this.extractQueryText(request);
  if (!query) return [];

  // 3. Generate embedding
  const queryVector = await this.embeddings.embedOne(query, signal);
  if (signal?.aborted) return [];

  // 4. Vector search (over-retrieve)
  const candidates = await this.store.vectorSearch(queryVector, {
    topK,
    scope,
  });
  if (signal?.aborted || candidates.length === 0) return [];

  // 5. LLM filter (select relevant subset)
  const candidateHits = candidates.map(c => ({
    id: c.id,
    score: c.score,
    textSnippet: c.text.slice(0, 200),
    source: c.source,
  }));

  const filterResult = await filterByRelevance(query, candidateHits, {
    maxSelect: 10,
    signal,
  });

  // 6. Map selected IDs back to full MemoryHit
  const selectedSet = new Set(filterResult.selectedIds);
  const hits: MemoryHit[] = candidates
    .filter(c => selectedSet.has(c.id))
    .map(c => ({
      id: c.id,
      text: c.text,
      score: c.score,
      source: c.source,
    }));

  return hits;
}
```

### Updated Constructor

```typescript
constructor(config: MemoryConfig) {
  this.store = new LanceDBStore(config.dbPath);
  this.embeddings = new OllamaEmbeddings({
    baseUrl: config.embedding.endpoint ?? 'http://localhost:11434',
    model: config.embedding.model,
    dimension: 768, // nomic-embed-text default
  });
}

async init(): Promise<void> {
  await this.store.init();
}
```

---

## 3.5 Seeding Memory (MVP)

### Option A: Manual JSON Import (Fastest for Testing)

```typescript
// CLI or test helper
async function seedFromFile(filePath: string): Promise<void> {
  const data = JSON.parse(await fs.readFile(filePath, 'utf-8'));
  const entries = data.entries.map((e) => ({
    ...e,
    embedding: await embeddings.embedOne(e.text),
  }));
  await store.upsert(entries);
}
```

**Sample seed file:**

```json
{
  "entries": [
    {
      "id": "mem-001",
      "scope": "project",
      "text": "Always use async/await for API calls in this codebase",
      "source": "conventions.md",
      "tags": ["async", "api"]
    }
  ]
}
```

### Option B: Extract from GEMINI.md (Phase 3b)

Parse existing memory files and auto-populate on first run.

---

## 3.6 Testing Strategy

### Unit Tests

| Component          | Test                            | Mock                |
| ------------------ | ------------------------------- | ------------------- |
| `OllamaEmbeddings` | Returns vectors, handles errors | Mock fetch          |
| `LanceDBStore`     | CRUD operations                 | Mock lancedb        |
| `llmFilter`        | JSON parsing, fallback on error | Mock model response |
| `retrieveRelevant` | Full pipeline                   | Mock all components |

### Integration Test (Optional)

Behind env var `MEMORY_INTEGRATION_TEST=1`:

- Uses real Ollama endpoint
- Uses temp LanceDB folder (cleanup after)
- Seeds test data, runs retrieval, validates results

---

## 3.7 Known Gotchas

1. **@lancedb/lancedb is native bindings**
   - Requires Node 18+
   - May need platform-specific builds in CI
   - Test on target platforms early

2. **Ollama embedding endpoints**
   - `/api/embed` is the stable batch endpoint
   - `/api/embeddings` is OpenAI-compatible but different response shape
   - Stick to `/api/embed` for MVP

3. **LLM filter prompt sensitivity**
   - Keep prompt deterministic (no creativity needed)
   - Request strict JSON format
   - Always have fallback to score-based selection

4. **AbortSignal propagation**
   - Check before AND after every async operation
   - Pass signal through to fetch calls

---

## Execution Order

```
1. Add @lancedb/lancedb dependency
2. Create store/store.ts interface
3. Create store/lancedbStore.ts implementation
4. Create embeddings/embeddings.ts interface
5. Create embeddings/ollamaEmbeddings.ts implementation
6. Wire MemoryCoreManager with store + embeddings (no LLM filter yet)
7. Test: embeddings + vector search working
8. Create relevance/llmFilter.ts
9. Update retrieveRelevant() with full pipeline
10. Add seeding mechanism
11. Integration test
```

---

## Dependencies to Add

```json
{
  "dependencies": {
    "@lancedb/lancedb": "^0.13.0"
  }
}
```

**Note:** Check latest version and Node compatibility before adding.

---

## Next Session Prompt

```
Read docs/memorysystem/PHASE3_IMPLEMENTATION.md for the Phase 3 plan.

Phase 1-2 are complete (types, formatters, stub MemoryCoreManager, integration points).

Start Phase 3:
1. Add @lancedb/lancedb dependency
2. Create store interface and LanceDBStore implementation
3. Create embeddings interface and OllamaEmbeddings implementation
4. Wire up MemoryCoreManager.retrieveRelevant() with real vector search
```

---

_Last updated: 2024-12-25_
