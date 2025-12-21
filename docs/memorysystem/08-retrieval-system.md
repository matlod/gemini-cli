# 08 - Retrieval System

**Status:** Draft **Last Updated:** 2024-12-21

## Purpose

Find relevant knowledge from memory cores using semantic search, graph
traversal, and hybrid approaches. The right context at the right time.

**Technology Stack:**

- **LanceDB** - Semantic search with vector embeddings
- **LadybugDB** - Graph traversal with Cypher queries
- **OpenAI-compatible API** - Embedding generation (ollama, vLLM, etc.)

See [12-technology-decisions.md](./12-technology-decisions.md) for rationale.

---

## Retrieval Strategies

### 1. Semantic Search (LanceDB)

Find conceptually similar content using embeddings.

```python
import lancedb
from openai import OpenAI

# Setup
db = lancedb.connect("./memory-data/lance")
entries_table = db.open_table("memory_entries")

embedding_client = OpenAI(
    base_url="http://localhost:11434/v1",  # ollama
    api_key="not-needed"
)

async def semantic_search(
    query: str,
    cores: list[str] | None = None,
    entry_types: list[str] | None = None,
    limit: int = 10,
    threshold: float = 0.7
) -> list[dict]:
    """Find semantically similar entries."""

    # Generate query embedding
    response = embedding_client.embeddings.create(
        model="nomic-embed-text",
        input=query
    )
    query_embedding = response.data[0].embedding

    # Build search query
    search = entries_table.search(query_embedding)

    # Apply filters
    if cores:
        search = search.where(f"core_id IN {cores}")
    if entry_types:
        search = search.where(f"entry_type IN {entry_types}")

    # Execute
    results = search.limit(limit).to_pandas()

    # Filter by threshold
    results = results[results['_distance'] <= (1 - threshold)]

    return results.to_dict('records')

# Example usage
results = await semantic_search(
    query="handling JWT token refresh with rotation",
    cores=['auth-jwt', 'security-patterns'],
    limit=5,
    threshold=0.7
)
```

### 2. Matryoshka Two-Stage Search

Use smaller dimensions for fast initial search, full dimensions for reranking.

```python
async def matryoshka_search(
    query: str,
    cores: list[str] | None = None,
    top_k: int = 10
) -> list[dict]:
    """Two-stage search using matryoshka embeddings."""

    # Stage 1: Fast search with 256 dimensions
    response_small = embedding_client.embeddings.create(
        model="nomic-embed-text",
        input=query,
        dimensions=256  # Matryoshka truncation
    )
    query_small = response_small.data[0].embedding

    # Get candidates (larger pool)
    candidates = entries_table.search(query_small) \
        .limit(100) \
        .to_pandas()

    if cores:
        candidates = candidates[candidates['core_id'].isin(cores)]

    # Stage 2: Rerank with full 768 dimensions
    response_full = embedding_client.embeddings.create(
        model="nomic-embed-text",
        input=query,
        dimensions=768
    )
    query_full = response_full.data[0].embedding

    # Compute similarity with full embeddings
    from numpy import dot
    from numpy.linalg import norm

    def cosine_sim(a, b):
        return dot(a, b) / (norm(a) * norm(b))

    candidates['rerank_score'] = candidates['embedding'].apply(
        lambda emb: cosine_sim(query_full, emb)
    )

    # Return top-k after reranking
    return candidates.nlargest(top_k, 'rerank_score').to_dict('records')
```

### 3. Graph Traversal (LadybugDB)

Follow relationships between entries using Cypher.

```python
import ladybugdb

db = ladybugdb.Database("./memory-data/ladybug")
conn = ladybugdb.Connection(db)

def graph_traverse(
    start_id: str,
    depth: int = 2,
    relation_types: list[str] | None = None,
    direction: str = 'both'
) -> list[dict]:
    """Traverse graph from starting entry."""

    # Build relationship pattern
    if relation_types:
        rel_pattern = f"[:{' | :'.join(relation_types)}]"
    else:
        rel_pattern = "[]"

    # Direction
    if direction == 'outgoing':
        pattern = f"-{rel_pattern}->"
    elif direction == 'incoming':
        pattern = f"<-{rel_pattern}-"
    else:
        pattern = f"-{rel_pattern}-"

    query = f"""
        MATCH (start:MemoryEntry {{id: $start_id}}){pattern}*1..{depth}(related:MemoryEntry)
        RETURN DISTINCT related.id, related.title, related.entry_type, related.confidence
    """

    result = conn.execute(query, {"start_id": start_id})
    return [dict(row) for row in result]

# Example: Find all related to a specific lesson
related = graph_traverse(
    start_id='auth-jwt-001',
    depth=2,
    relation_types=['RELATED', 'DEPENDS_ON', 'SUPERSEDES']
)

# Example: Find what depends on this pattern
dependents = graph_traverse(
    start_id='pattern-api-versioning',
    relation_types=['DEPENDS_ON'],
    direction='incoming'
)
```

### 4. Code Reference Lookup

Find entries that reference specific code.

```python
def find_by_code_reference(
    file_path: str | None = None,
    symbol: str | None = None,
    codebase_id: str | None = None
) -> list[dict]:
    """Find entries referencing specific code."""

    conditions = []
    params = {}

    if file_path:
        conditions.append("c.file_path CONTAINS $file_path")
        params["file_path"] = file_path
    if symbol:
        conditions.append("c.symbol = $symbol")
        params["symbol"] = symbol
    if codebase_id:
        conditions.append("c.codebase_id = $codebase_id")
        params["codebase_id"] = codebase_id

    where_clause = " AND ".join(conditions) if conditions else "TRUE"

    query = f"""
        MATCH (e:MemoryEntry)-[r:REFERENCES_CODE]->(c:CodeLocation)
        WHERE {where_clause}
        RETURN e.id, e.title, e.entry_type, c.file_path, c.symbol,
               c.start_line, c.end_line, r.relevance
    """

    result = conn.execute(query, params)
    return [dict(row) for row in result]

# Example: Find all entries about token-service.ts
entries = find_by_code_reference(file_path='token-service')
```

### 5. Golden Path Retrieval

Get structured walkthroughs for patterns.

```python
def get_golden_path(path_id: str) -> dict:
    """Get a golden path with all its steps."""

    # Get path metadata
    path_query = """
        MATCH (p:GoldenPath {id: $path_id})
        RETURN p.id, p.name, p.concept, p.description
    """
    path_result = conn.execute(path_query, {"path_id": path_id})
    path_data = dict(next(path_result))

    # Get steps in order
    steps_query = """
        MATCH (p:GoldenPath {id: $path_id})-[s:PATH_STEP]->(c:CodeLocation)
        RETURN c.file_path, c.symbol, c.start_line, c.end_line,
               s.step_order, s.description, s.key_concepts
        ORDER BY s.step_order
    """
    steps_result = conn.execute(steps_query, {"path_id": path_id})

    path_data['steps'] = [dict(row) for row in steps_result]
    return path_data

def find_golden_paths(concepts: list[str]) -> list[dict]:
    """Find golden paths that cover given concepts."""

    query = """
        MATCH (p:GoldenPath)
        WHERE ANY(concept IN $concepts WHERE p.concept CONTAINS concept)
        RETURN p.id, p.name, p.concept, p.description
    """

    result = conn.execute(query, {"concepts": concepts})
    return [dict(row) for row in result]
```

---

## Hybrid Search Patterns

### Pattern 1: Semantic + Graph Expansion

Start with semantic search, then expand via graph.

```python
async def find_with_context(
    query: str,
    depth: int = 2
) -> list[dict]:
    """Semantic search + graph expansion for rich context."""

    # 1. Semantic search in LanceDB
    query_embedding = await get_embedding(query)
    semantic_results = entries_table.search(query_embedding).limit(5).to_list()

    # 2. Get IDs for graph expansion
    seed_ids = [r["id"] for r in semantic_results]

    # 3. Expand via graph in LadybugDB
    expanded_query = """
        MATCH (seed:MemoryEntry)-[:RELATED*1..$depth]-(expanded:MemoryEntry)
        WHERE seed.id IN $seed_ids
        RETURN DISTINCT expanded.id
    """
    expanded = conn.execute(expanded_query, {"seed_ids": seed_ids, "depth": depth})
    expanded_ids = [r["id"] for r in expanded]

    # 4. Fetch full entries from LanceDB
    all_ids = list(set(seed_ids + expanded_ids))
    full_entries = entries_table.search() \
        .where(f"id IN {all_ids}") \
        .to_list()

    return full_entries
```

### Pattern 2: Graph Query + Semantic Rerank

Start with graph structure, rerank by semantic relevance.

```python
async def find_related_to_code(
    file_path: str,
    query: str
) -> list[dict]:
    """Find entries related to code, ranked by query relevance."""

    # 1. Find entries referencing this code via graph
    graph_query = """
        MATCH (e:MemoryEntry)-[:REFERENCES_CODE]->(c:CodeLocation)
        WHERE c.file_path CONTAINS $path
        RETURN e.id
    """
    graph_results = conn.execute(graph_query, {"path": file_path})
    entry_ids = [r["id"] for r in graph_results]

    if not entry_ids:
        return []

    # 2. Rerank by semantic similarity to query
    query_embedding = await get_embedding(query)
    reranked = entries_table.search(query_embedding) \
        .where(f"id IN {entry_ids}") \
        .limit(10) \
        .to_list()

    return reranked
```

### Pattern 3: Full Hybrid Context Building

Combine everything for task context.

```python
async def build_task_context(
    task: str,
    project_core: str,
    include_code: bool = True,
    max_entries: int = 20
) -> dict:
    """Build comprehensive context for a task."""

    query_embedding = await get_embedding(task)
    context = {
        'entries': [],
        'code_refs': [],
        'golden_paths': [],
        'related_decisions': []
    }

    # 1. Semantic search with core filter
    semantic = entries_table.search(query_embedding) \
        .where(f"core_id = '{project_core}' OR core_id = 'common-patterns'") \
        .limit(10) \
        .to_list()

    context['entries'].extend(semantic)
    seed_ids = [r["id"] for r in semantic]

    # 2. Graph expansion for related entries
    graph_expanded = conn.execute("""
        MATCH (seed:MemoryEntry)-[:RELATED|DEPENDS_ON*1..2]-(rel:MemoryEntry)
        WHERE seed.id IN $seeds
        RETURN DISTINCT rel.id, rel.title, rel.entry_type
    """, {"seeds": seed_ids})

    expanded_ids = [r["id"] for r in graph_expanded]
    if expanded_ids:
        expanded_entries = entries_table.search() \
            .where(f"id IN {expanded_ids}") \
            .limit(10) \
            .to_list()
        context['entries'].extend(expanded_entries)

    # 3. Code references if requested
    if include_code:
        code_refs = conn.execute("""
            MATCH (e:MemoryEntry)-[r:REFERENCES_CODE]->(c:CodeLocation)
            WHERE e.id IN $ids
            RETURN e.id, c.file_path, c.symbol, c.start_line, c.end_line, r.relevance
        """, {"ids": seed_ids})
        context['code_refs'] = [dict(r) for r in code_refs]

    # 4. Applicable golden paths
    golden_paths = conn.execute("""
        MATCH (e:MemoryEntry)-[:IMPLEMENTS]->(p:GoldenPath)
        WHERE e.id IN $ids
        RETURN DISTINCT p.id, p.name, p.concept
    """, {"ids": seed_ids})
    context['golden_paths'] = [dict(r) for r in golden_paths]

    # 5. Deduplicate entries
    seen_ids = set()
    unique_entries = []
    for entry in context['entries']:
        if entry['id'] not in seen_ids:
            seen_ids.add(entry['id'])
            unique_entries.append(entry)
    context['entries'] = unique_entries[:max_entries]

    return context
```

---

## Embedding Pipeline

### Configuration

```python
from dataclasses import dataclass
from typing import Optional

@dataclass
class EmbeddingConfig:
    provider: str                    # 'local-nomic', 'openai', etc.
    base_url: str
    model: str
    dimensions: int
    matryoshka_dims: Optional[list[int]] = None
    batch_size: int = 32
    api_key: Optional[str] = None

# Load from config file
def load_embedding_config(provider: str) -> EmbeddingConfig:
    import yaml
    with open("memory-config.yaml") as f:
        config = yaml.safe_load(f)

    provider_config = config['embeddings']['providers'][provider]
    return EmbeddingConfig(
        provider=provider,
        base_url=provider_config['base_url'],
        model=provider_config['model'],
        dimensions=provider_config['dimensions'],
        matryoshka_dims=provider_config.get('matryoshka', {}).get('dimensions'),
        batch_size=provider_config.get('batch_size', 32),
        api_key=provider_config.get('api_key')
    )
```

### Embedding Client

```python
from openai import OpenAI

class EmbeddingClient:
    def __init__(self, config: EmbeddingConfig):
        self.config = config
        self.client = OpenAI(
            base_url=config.base_url,
            api_key=config.api_key or "not-needed"
        )

    def embed(
        self,
        texts: list[str],
        dimensions: int | None = None
    ) -> list[list[float]]:
        """Generate embeddings for texts."""

        # Validate matryoshka dimensions
        if dimensions and self.config.matryoshka_dims:
            if dimensions not in self.config.matryoshka_dims:
                raise ValueError(f"Dimension {dimensions} not supported. "
                               f"Available: {self.config.matryoshka_dims}")

        # Batch processing
        all_embeddings = []
        for i in range(0, len(texts), self.config.batch_size):
            batch = texts[i:i + self.config.batch_size]

            kwargs = {"model": self.config.model, "input": batch}
            if dimensions and self.config.matryoshka_dims:
                kwargs["dimensions"] = dimensions

            response = self.client.embeddings.create(**kwargs)
            all_embeddings.extend([e.embedding for e in response.data])

        return all_embeddings

    def embed_for_search(self, query: str) -> list[float]:
        """Embed a single query for search."""
        return self.embed([query])[0]
```

### Text Chunking for Long Content

```python
def chunk_text(
    text: str,
    chunk_size: int = 512,
    overlap: int = 50
) -> list[str]:
    """Split text into overlapping chunks for embedding."""

    # Simple word-based chunking
    words = text.split()
    chunks = []

    for i in range(0, len(words), chunk_size - overlap):
        chunk = ' '.join(words[i:i + chunk_size])
        if chunk:
            chunks.append(chunk)

    return chunks

def embed_long_entry(
    entry: dict,
    client: EmbeddingClient
) -> list[float]:
    """Embed an entry that may exceed context limits."""

    # Combine key fields
    text = f"{entry['title']}\n\n{entry['content']}"

    if len(text.split()) <= 512:
        # Short enough - embed directly
        return client.embed([text])[0]

    # Chunk and average embeddings
    chunks = chunk_text(text, chunk_size=512, overlap=50)
    chunk_embeddings = client.embed(chunks)

    # Mean pooling
    import numpy as np
    mean_embedding = np.mean(chunk_embeddings, axis=0)
    return mean_embedding.tolist()
```

---

## Incremental Indexing

Keep indexes up to date efficiently.

```python
from dataclasses import dataclass
from datetime import datetime

@dataclass
class IndexUpdate:
    added: list[dict]
    modified: list[dict]
    deleted: list[str]

async def update_indexes(
    update: IndexUpdate,
    embedding_client: EmbeddingClient
) -> None:
    """Apply incremental updates to all indexes."""

    # --- LanceDB Updates ---

    # Add new entries
    if update.added:
        texts = [f"{e['title']}\n\n{e['content']}" for e in update.added]
        embeddings = embedding_client.embed(texts)

        for entry, embedding in zip(update.added, embeddings):
            entry['embedding'] = embedding

        entries_table.add(update.added)

    # Modify existing entries
    for entry in update.modified:
        # Re-embed
        text = f"{entry['title']}\n\n{entry['content']}"
        entry['embedding'] = embedding_client.embed([text])[0]

        # Delete and re-add (LanceDB upsert pattern)
        entries_table.delete(f"id = '{entry['id']}'")
        entries_table.add([entry])

    # Delete entries
    for entry_id in update.deleted:
        entries_table.delete(f"id = '{entry_id}'")

    # --- LadybugDB Updates ---

    # Add nodes for new entries
    for entry in update.added:
        conn.execute("""
            CREATE (:MemoryEntry {
                id: $id,
                core_id: $core_id,
                title: $title,
                entry_type: $entry_type,
                confidence: $confidence,
                created_at: $created_at
            })
        """, entry)

    # Delete nodes and relationships for deleted entries
    for entry_id in update.deleted:
        conn.execute("""
            MATCH (e:MemoryEntry {id: $id})
            DETACH DELETE e
        """, {"id": entry_id})
```

---

## Query Optimization

### Caching Frequent Queries

```python
from functools import lru_cache
import hashlib

class QueryCache:
    def __init__(self, max_size: int = 1000, ttl_seconds: int = 900):
        self._cache = {}
        self.max_size = max_size
        self.ttl = ttl_seconds

    def _key(self, query: str, **kwargs) -> str:
        data = f"{query}:{sorted(kwargs.items())}"
        return hashlib.sha256(data.encode()).hexdigest()[:16]

    def get(self, query: str, **kwargs) -> list | None:
        key = self._key(query, **kwargs)
        if key in self._cache:
            entry, timestamp = self._cache[key]
            if (datetime.now() - timestamp).seconds < self.ttl:
                return entry
            del self._cache[key]
        return None

    def set(self, query: str, results: list, **kwargs):
        key = self._key(query, **kwargs)
        self._cache[key] = (results, datetime.now())

        # Evict oldest if over capacity
        if len(self._cache) > self.max_size:
            oldest_key = min(self._cache, key=lambda k: self._cache[k][1])
            del self._cache[oldest_key]

query_cache = QueryCache()

async def cached_semantic_search(query: str, **kwargs) -> list:
    # Check cache
    cached = query_cache.get(query, **kwargs)
    if cached is not None:
        return cached

    # Execute search
    results = await semantic_search(query, **kwargs)

    # Cache results
    query_cache.set(query, results, **kwargs)
    return results
```

### Pre-filtering with Scalar Indexes

```python
async def fast_filtered_search(
    query: str,
    core_id: str,
    min_confidence: str = "medium"
) -> list[dict]:
    """Use scalar indexes to reduce search space before vector search."""

    confidence_values = {
        "low": ["low", "medium", "high"],
        "medium": ["medium", "high"],
        "high": ["high"]
    }

    query_embedding = await get_embedding(query)

    # LanceDB uses scalar indexes to filter before vector search
    results = entries_table.search(query_embedding) \
        .where(f"core_id = '{core_id}'") \
        .where(f"confidence IN {confidence_values[min_confidence]}") \
        .limit(10) \
        .to_list()

    return results
```

---

## Gaps & Open Questions

- [ ] How do we handle embedding model upgrades? (Re-embed everything vs
      dual-index)
- [ ] What's the optimal chunk size for different content types?
- [ ] How do we handle multi-lingual content?
- [ ] What's the index update latency requirement? (Real-time vs batch)
- [ ] How do we evaluate retrieval quality? (Metrics, golden sets)
- [ ] What's the caching strategy for distributed setup?
- [ ] How do we handle sensitive/private entries in search?
- [ ] What's the backup/recovery for indexes?
- [ ] How do we handle index corruption?
- [ ] Query planning optimization for complex hybrid queries?
- [ ] Connection pooling for LadybugDB in high-concurrency scenarios?
