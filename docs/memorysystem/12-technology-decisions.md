# 12 - Technology Decisions

**Status:** Active Decisions **Last Updated:** 2024-12-20

## Decided Technologies

### Vector + Metadata Storage: LanceDB

**Decision:** Use [LanceDB](https://lancedb.com/) for semantic search and
metadata storage.

**Why LanceDB:**

- **Embedded/Serverless** - No separate server, file-based, fits local-first
- **Lance columnar format** - Efficient storage, automatic versioning
- **Stores everything together** - Vectors + raw data + metadata in one place
- **Hybrid search** - Vector similarity + metadata filtering
- **S3 compatible** - Can scale to cloud when needed
- **Python + Pydantic** - Clean schema definition

**Use Cases in Our System:**

- Memory entry embeddings + full entry metadata
- Code snippet embeddings for semantic code search
- Working memory search (find relevant context)
- Golden path step embeddings

**Example Schema:**

```python
import lancedb
from lancedb.pydantic import LanceModel, Vector
from datetime import datetime
from typing import Optional, List

class MemoryEntry(LanceModel):
    id: str
    core_id: str
    title: str
    content: str
    entry_type: str  # 'lesson', 'pattern', 'gotcha', etc.
    tags: List[str]
    confidence: str  # 'high', 'medium', 'low'
    created_at: datetime
    created_by: str
    source: str

    # Vector for semantic search (dimension depends on embedding model)
    embedding: Vector(1536)  # OpenAI ada-002 dimension

    # Optional metadata
    verified: bool = False
    code_refs: Optional[str] = None  # JSON string of code references

# Connect (creates file if not exists)
db = lancedb.connect("./memory.lance")

# Create table with schema
entries_table = db.create_table("memory_entries", schema=MemoryEntry)

# Add entry
entries_table.add([MemoryEntry(
    id="jwt-001",
    core_id="auth-patterns",
    title="Always rotate refresh tokens",
    content="When a refresh token is used...",
    entry_type="lesson",
    tags=["jwt", "auth", "security"],
    confidence="high",
    created_at=datetime.now(),
    created_by="human",
    source="production incident 2024-01",
    embedding=generate_embedding("Always rotate refresh tokens...")
)])

# Semantic search with metadata filter
results = entries_table.search(query_embedding) \
    .where("core_id = 'auth-patterns'") \
    .where("confidence = 'high'") \
    .limit(5) \
    .to_pandas()
```

**Index Types:**

```python
# Vector index for semantic search (IVF_PQ for large scale)
entries_table.create_index(
    metric="cosine",
    num_partitions=256,
    num_sub_vectors=96
)

# Scalar index for metadata filtering
entries_table.create_scalar_index("core_id")
entries_table.create_scalar_index("entry_type")
entries_table.create_scalar_index("created_at")
```

---

### Graph Storage: LadybugDB

**Decision:** Use [LadybugDB](https://github.com/LadybugDB/ladybug) (formerly
Kuzu) for graph relationships.

**Why LadybugDB:**

- **Embedded** - No server, integrates directly into application
- **Cypher query language** - Familiar, powerful graph queries
- **ACID transactions** - Data integrity
- **C++ core** - Fast, with Python/Node.js/Rust bindings
- **Columnar + CSR** - Optimized for both analytics and traversal
- **Vector indexing built-in** - Could complement LanceDB for graph-vector
  hybrid
- **WebAssembly** - Can run in browser if needed

**Use Cases in Our System:**

- Entry-to-entry relationships (related, depends_on, supersedes)
- Entry-to-core membership
- Entry-to-code-ref links
- Golden path step sequences
- Task dependency graphs in working memory
- Agent-to-task assignments

**Example Schema:**

```python
import ladybugdb

# Connect
db = ladybugdb.Database("./memory.ladybug")
conn = ladybugdb.Connection(db)

# Define node tables
conn.execute("""
    CREATE NODE TABLE MemoryEntry (
        id STRING PRIMARY KEY,
        core_id STRING,
        title STRING,
        entry_type STRING
    )
""")

conn.execute("""
    CREATE NODE TABLE MemoryCore (
        id STRING PRIMARY KEY,
        name STRING,
        core_type STRING
    )
""")

conn.execute("""
    CREATE NODE TABLE CodeLocation (
        id STRING PRIMARY KEY,
        codebase_id STRING,
        file_path STRING,
        symbol STRING,
        start_line INT64,
        end_line INT64
    )
""")

conn.execute("""
    CREATE NODE TABLE GoldenPath (
        id STRING PRIMARY KEY,
        name STRING,
        concept STRING
    )
""")

# Define relationship tables
conn.execute("""
    CREATE REL TABLE RELATED (
        FROM MemoryEntry TO MemoryEntry,
        strength FLOAT
    )
""")

conn.execute("""
    CREATE REL TABLE DEPENDS_ON (
        FROM MemoryEntry TO MemoryEntry
    )
""")

conn.execute("""
    CREATE REL TABLE SUPERSEDES (
        FROM MemoryEntry TO MemoryEntry,
        reason STRING
    )
""")

conn.execute("""
    CREATE REL TABLE BELONGS_TO (
        FROM MemoryEntry TO MemoryCore
    )
""")

conn.execute("""
    CREATE REL TABLE REFERENCES_CODE (
        FROM MemoryEntry TO CodeLocation,
        relevance STRING
    )
""")

conn.execute("""
    CREATE REL TABLE PATH_STEP (
        FROM GoldenPath TO CodeLocation,
        step_order INT64,
        description STRING
    )
""")
```

**Example Queries:**

```python
# Find all entries related to a specific entry (2 hops)
result = conn.execute("""
    MATCH (start:MemoryEntry {id: $entry_id})-[:RELATED*1..2]-(related:MemoryEntry)
    RETURN DISTINCT related.id, related.title, related.entry_type
""", {"entry_id": "jwt-001"})

# Find entries that reference code in a specific file
result = conn.execute("""
    MATCH (e:MemoryEntry)-[:REFERENCES_CODE]->(c:CodeLocation)
    WHERE c.file_path CONTAINS 'token-service'
    RETURN e.id, e.title, c.symbol, c.start_line
""")

# Get golden path steps in order
result = conn.execute("""
    MATCH (p:GoldenPath {id: $path_id})-[s:PATH_STEP]->(c:CodeLocation)
    RETURN c.file_path, c.symbol, s.step_order, s.description
    ORDER BY s.step_order
""", {"path_id": "jwt-refresh-rotation"})

# Find all entries that depend on entries I'm about to change
result = conn.execute("""
    MATCH (affected:MemoryEntry)-[:DEPENDS_ON]->(changing:MemoryEntry)
    WHERE changing.id IN $changing_ids
    RETURN affected.id, affected.title
""", {"changing_ids": ["jwt-001", "jwt-002"]})

# Find shortest path between two concepts
result = conn.execute("""
    MATCH path = shortestPath(
        (a:MemoryEntry {id: $from})-[*]-(b:MemoryEntry {id: $to})
    )
    RETURN path
""", {"from": "auth-basics", "to": "oauth-advanced"})
```

---

### Embeddings: OpenAI-Compatible Endpoints

**Decision:** Support any OpenAI-compatible embedding endpoint (ollama,
llama.cpp, vLLM, SGLang, OpenAI, etc.)

**Why agnostic:**

- All major local inference engines support OpenAI-compatible API
- Can swap providers without code changes
- Mix local and cloud as needed
- Future-proof for new models/providers

**Configuration Schema:**

```yaml
# memory-config.yaml
embeddings:
  # Named embedding configurations
  providers:
    local-nomic:
      type: openai-compatible
      base_url: 'http://localhost:11434/v1' # ollama
      model: 'nomic-embed-text'
      dimensions: 768
      max_tokens: 8192
      chunk_size:
        optimal: 512 # tokens - best quality
        max: 2048 # tokens - still works
      matryoshka: # Nesting doll dimensions if supported
        enabled: true
        dimensions: [768, 512, 384, 256, 128, 64]
      batch_size: 32
      api_key: null # Not needed for local

    local-bge:
      type: openai-compatible
      base_url: 'http://localhost:8000/v1' # vLLM or SGLang
      model: 'BAAI/bge-large-en-v1.5'
      dimensions: 1024
      max_tokens: 512
      chunk_size:
        optimal: 256
        max: 512
      matryoshka:
        enabled: false
      batch_size: 64

    openai-ada:
      type: openai-compatible
      base_url: 'https://api.openai.com/v1'
      model: 'text-embedding-ada-002'
      dimensions: 1536
      max_tokens: 8191
      chunk_size:
        optimal: 1000
        max: 4000
      matryoshka:
        enabled: false
      batch_size: 100
      api_key: '${OPENAI_API_KEY}'

    openai-3-small:
      type: openai-compatible
      base_url: 'https://api.openai.com/v1'
      model: 'text-embedding-3-small'
      dimensions: 1536 # Default, can request smaller
      max_tokens: 8191
      chunk_size:
        optimal: 1000
        max: 4000
      matryoshka:
        enabled: true
        dimensions: [1536, 1024, 768, 512, 256] # Request via dimensions param
      batch_size: 100
      api_key: '${OPENAI_API_KEY}'

  # Which provider to use for what
  usage:
    memory_entries: 'local-nomic' # Main knowledge base
    code_snippets: 'local-nomic' # Code search
    working_memory: 'local-nomic' # Fast, local
    # Could use different models for different purposes
    # high_quality_entries: "openai-3-small"
```

**Matryoshka (Nesting Doll) Embeddings:**

Some models (nomic-embed-text, text-embedding-3-small/large) support Matryoshka
representation learning - embeddings can be truncated to smaller dimensions
while preserving quality.

```python
# Use smaller dims for initial fast search, full dims for reranking
async def hybrid_search(query: str):
    # Fast search with 256-dim
    query_emb_small = await embed(query, dimensions=256)
    candidates = lance_table.search(query_emb_small).limit(100).to_list()

    # Rerank with full 768-dim
    query_emb_full = await embed(query, dimensions=768)
    reranked = rerank_by_similarity(candidates, query_emb_full)

    return reranked[:10]
```

**Client Implementation:**

```python
from openai import OpenAI
from typing import List, Optional

class EmbeddingClient:
    def __init__(self, config: dict):
        self.config = config
        self.client = OpenAI(
            base_url=config["base_url"],
            api_key=config.get("api_key") or "not-needed"
        )

    async def embed(
        self,
        texts: List[str],
        dimensions: Optional[int] = None
    ) -> List[List[float]]:
        # Use matryoshka dimensions if supported and requested
        kwargs = {"model": self.config["model"], "input": texts}
        if dimensions and self.config.get("matryoshka", {}).get("enabled"):
            kwargs["dimensions"] = dimensions

        response = self.client.embeddings.create(**kwargs)
        return [e.embedding for e in response.data]

    def chunk_text(self, text: str, optimal: bool = True) -> List[str]:
        chunk_size = self.config["chunk_size"]["optimal" if optimal else "max"]
        # Implement chunking logic...
        return chunks
```

---

### LLMs: Future Agentic Backends

**Current:** Gemini via A2A server (working, tested)

**Future:** Support multiple LLM backends for different agent roles/tasks.

```yaml
# memory-config.yaml
llm:
  providers:
    gemini:
      type: gemini
      # Uses existing A2A server infrastructure
      endpoint: 'http://localhost:41242'
      models:
        fast: 'gemini-2.0-flash'
        reasoning: 'gemini-2.0-pro'

    openrouter:
      type: openai-compatible
      base_url: 'https://openrouter.ai/api/v1'
      api_key: '${OPENROUTER_API_KEY}'
      models:
        fast: 'anthropic/claude-3-haiku'
        reasoning: 'anthropic/claude-3-opus'
        code: 'deepseek/deepseek-coder'

    local-llama:
      type: openai-compatible
      base_url: 'http://localhost:8080/v1' # llama.cpp server
      models:
        fast: 'llama-3.2-3b'
        reasoning: 'llama-3.1-70b'

    local-vllm:
      type: openai-compatible
      base_url: 'http://localhost:8000/v1'
      models:
        fast: 'Qwen/Qwen2.5-7B-Instruct'
        reasoning: 'Qwen/Qwen2.5-72B-Instruct'
        code: 'Qwen/Qwen2.5-Coder-32B-Instruct'

  # Role-based routing
  usage:
    orchestrator: 'gemini.reasoning'
    developer: 'gemini.fast'
    qa: 'gemini.fast'
    researcher: 'gemini.fast'
    librarian: 'gemini.fast'
    analyst: 'gemini.reasoning'

    # Future: local fallback
    # developer_fallback: "local-vllm.code"
```

**Provider Interface:**

```python
from abc import ABC, abstractmethod

class LLMProvider(ABC):
    @abstractmethod
    async def complete(
        self,
        messages: List[dict],
        model: str,
        temperature: float = 0.7,
        max_tokens: int = 4096,
        tools: Optional[List[dict]] = None
    ) -> CompletionResult:
        pass

class OpenAICompatibleProvider(LLMProvider):
    """Works with OpenRouter, vLLM, SGLang, llama.cpp, etc."""

    def __init__(self, base_url: str, api_key: Optional[str] = None):
        self.client = OpenAI(base_url=base_url, api_key=api_key or "not-needed")

    async def complete(self, messages, model, **kwargs):
        response = self.client.chat.completions.create(
            model=model,
            messages=messages,
            **kwargs
        )
        return CompletionResult(
            content=response.choices[0].message.content,
            tool_calls=response.choices[0].message.tool_calls
        )

class GeminiProvider(LLMProvider):
    """Uses existing A2A infrastructure."""

    def __init__(self, a2a_endpoint: str):
        self.endpoint = a2a_endpoint

    async def complete(self, messages, model, **kwargs):
        # Route through A2A server
        # ... existing MCP bridge logic ...
        pass
```

---

## Combined Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      Application Layer                          │
│   (Memory System API - Python/TypeScript)                       │
└───────────┬─────────────────────────────────────────┬───────────┘
            │                                         │
            ▼                                         ▼
┌─────────────────────────────┐       ┌─────────────────────────────┐
│         LanceDB             │       │        LadybugDB            │
│    (./memory.lance/)        │       │    (./memory.ladybug/)      │
├─────────────────────────────┤       ├─────────────────────────────┤
│ • Memory entry embeddings   │       │ • Entry relationships       │
│ • Full entry metadata       │       │ • Core membership           │
│ • Code snippet embeddings   │       │ • Code reference links      │
│ • Semantic search           │       │ • Golden path structure     │
│ • Hybrid filter+vector      │       │ • Task dependencies         │
│ • Versioned storage         │       │ • Graph traversal           │
└─────────────────────────────┘       └─────────────────────────────┘
            │                                         │
            └──────────────────┬──────────────────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │   Unified Query     │
                    │   (semantic +       │
                    │    graph + filter)  │
                    └─────────────────────┘
```

**Data Split:**

- **LanceDB:** Entry content, embeddings, searchable metadata
- **LadybugDB:** Relationships, graph structure, traversal

**Sync Strategy:**

- Entry ID is the join key between both DBs
- Writes go to both (transaction wrapper)
- Reads can query either or combine results

---

## Query Patterns

### Pattern 1: Semantic + Graph Expansion

```python
async def find_context(query: str, depth: int = 2) -> List[MemoryEntry]:
    # 1. Semantic search in LanceDB
    query_embedding = await embed(query)
    semantic_results = lance_table.search(query_embedding).limit(5).to_list()

    # 2. Get IDs for graph expansion
    seed_ids = [r["id"] for r in semantic_results]

    # 3. Expand via graph in LadybugDB
    expanded = conn.execute("""
        MATCH (seed:MemoryEntry)-[:RELATED*1..$depth]-(expanded:MemoryEntry)
        WHERE seed.id IN $seed_ids
        RETURN DISTINCT expanded.id
    """, {"seed_ids": seed_ids, "depth": depth})

    # 4. Fetch full entries from LanceDB
    all_ids = seed_ids + [r["id"] for r in expanded]
    return lance_table.search().where(f"id IN {all_ids}").to_list()
```

### Pattern 2: Graph Query + Semantic Rerank

```python
async def find_related_to_code(file_path: str, query: str) -> List[MemoryEntry]:
    # 1. Find entries referencing this code via graph
    graph_results = conn.execute("""
        MATCH (e:MemoryEntry)-[:REFERENCES_CODE]->(c:CodeLocation)
        WHERE c.file_path = $path
        RETURN e.id
    """, {"path": file_path})

    entry_ids = [r["id"] for r in graph_results]

    # 2. Rerank by semantic similarity to query
    query_embedding = await embed(query)
    reranked = lance_table.search(query_embedding) \
        .where(f"id IN {entry_ids}") \
        .limit(10) \
        .to_list()

    return reranked
```

### Pattern 3: Full Hybrid

```python
async def build_context(
    task: str,
    project_core: str,
    include_code: bool = True
) -> Context:
    query_embedding = await embed(task)

    # Semantic search with core filter
    semantic = lance_table.search(query_embedding) \
        .where(f"core_id = '{project_core}' OR core_id = 'common-patterns'") \
        .limit(10) \
        .to_list()

    # Get related via graph
    seed_ids = [r["id"] for r in semantic]
    graph_expanded = conn.execute("""
        MATCH (seed:MemoryEntry)-[:RELATED|DEPENDS_ON*1..2]-(rel:MemoryEntry)
        WHERE seed.id IN $seeds
        RETURN DISTINCT rel.id, rel.title, rel.entry_type
    """, {"seeds": seed_ids})

    # Get code references if requested
    code_refs = []
    if include_code:
        code_refs = conn.execute("""
            MATCH (e:MemoryEntry)-[r:REFERENCES_CODE]->(c:CodeLocation)
            WHERE e.id IN $ids
            RETURN e.id, c.file_path, c.symbol, c.start_line, c.end_line, r.relevance
        """, {"ids": seed_ids})

    # Get applicable golden paths
    golden_paths = conn.execute("""
        MATCH (e:MemoryEntry)-[:IMPLEMENTS]->(p:GoldenPath)
        WHERE e.id IN $ids
        RETURN DISTINCT p.id, p.name, p.concept
    """, {"ids": seed_ids})

    return Context(
        entries=semantic + graph_expanded,
        code_refs=code_refs,
        golden_paths=golden_paths
    )
```

---

## File Structure

```
memory-data/
├── lance/                      # LanceDB storage
│   ├── memory_entries.lance/   # Entry embeddings + metadata
│   ├── code_snippets.lance/    # Code embeddings
│   └── working_memory.lance/   # Active task context
│
├── ladybug/                    # LadybugDB storage
│   └── memory.ladybug/         # Graph database
│
└── config/
    └── memory.yaml             # Configuration
```

---

## Migration Notes

If we later need to scale beyond embedded:

- **LanceDB** → LanceDB Cloud (same API, just different connection)
- **LadybugDB** → Could export to Neo4j if needed, Cypher is compatible

---

## Gaps & Open Questions (Technology-Specific)

- [ ] What embedding model to use with LanceDB? (OpenAI ada-002? Local?)
- [ ] LanceDB index tuning - what's the right num_partitions for our scale?
- [ ] LadybugDB transaction coordination with LanceDB writes
- [ ] How to handle schema migrations in both DBs?
- [ ] Backup strategy for both DBs together (atomic snapshot?)
- [ ] Performance testing - what's the query latency profile?
- [ ] Memory footprint when both DBs loaded?
- [ ] LadybugDB Python bindings maturity - any gotchas?

---

## References

- [LanceDB Documentation](https://lancedb.github.io/lancedb/)
- [LanceDB GitHub](https://github.com/lancedb/lancedb)
- [LadybugDB GitHub](https://github.com/LadybugDB/ladybug)
- [Cypher Query Language](https://neo4j.com/docs/cypher-manual/)
