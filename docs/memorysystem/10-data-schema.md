# 10 - Data Schema

**Status:** Draft **Last Updated:** 2024-12-21

## Purpose

Define the core data models that underpin the entire memory system. These
schemas are the source of truth for how data is structured, stored, and related.

**Technology Stack:**

- **LanceDB** - Vector storage + metadata (Pydantic models)
- **LadybugDB** - Graph relationships (Cypher DDL)
- **TypeScript** - Application interfaces

See [12-technology-decisions.md](./12-technology-decisions.md) for rationale.

---

## TypeScript Interfaces

These are implementation-agnostic and used in the application layer.

### Memory Entry

The fundamental unit of knowledge.

```typescript
interface MemoryEntry {
  // Identity
  id: string; // Unique identifier (ULID recommended)
  core_id: string; // Which memory core this belongs to

  // Content
  title: string; // Brief descriptive title
  content: string; // Main knowledge content (markdown)
  summary?: string; // AI-generated summary

  // Classification
  type: EntryType;
  tags: string[];

  // Relationships (stored in LadybugDB, referenced here)
  related: string[]; // Entry IDs of related entries
  supersedes?: string; // Entry ID this replaces
  superseded_by?: string; // Entry ID that replaced this
  depends_on: string[]; // Prerequisite entries

  // Quality
  confidence: 'high' | 'medium' | 'low';
  verified: boolean;
  verified_at?: Date;
  verified_by?: string;

  // Provenance
  source: string; // Where this came from
  source_type: 'manual' | 'extracted' | 'promoted' | 'imported';
  created_at: Date;
  updated_at: Date;
  created_by: string; // Agent or human ID

  // Code references (links to CodeLocation in LadybugDB)
  code_refs?: CodeReference[];

  // Search (stored in LanceDB)
  embedding?: number[]; // Vector embedding
  keywords?: string[]; // Extracted keywords

  // Metadata
  metadata?: Record<string, any>; // Extensible metadata
}

type EntryType =
  | 'lesson' // Something learned
  | 'pattern' // Reusable approach
  | 'gotcha' // Common pitfall
  | 'decision' // Choice that was made
  | 'example' // Working code example
  | 'reference' // Link to external resource
  | 'convention'; // Team/project standard

interface CodeReference {
  codebase_id: string;
  file_path: string;
  symbol?: string;
  start_line?: number;
  end_line?: number;
  relevance: string; // Why this code is referenced
}
```

### Memory Core

A collection of related memory entries.

```typescript
interface MemoryCore {
  // Identity
  id: string;
  name: string;
  description: string;

  // Classification
  type: CoreType;
  tags: string[];

  // Ownership
  owner: string; // User or team ID
  visibility: 'private' | 'team' | 'public';

  // State
  entry_count: number;
  last_updated: Date;

  // Configuration
  config: CoreConfig;

  // Metadata
  created_at: Date;
  created_by: string;
}

type CoreType =
  | 'technology' // Language, framework, tool
  | 'project' // Specific project context
  | 'pattern' // Architectural patterns
  | 'personal'; // Individual preferences

interface CoreConfig {
  // Auto-curation
  auto_dedupe: boolean;
  auto_link: boolean;

  // Quality thresholds
  min_confidence: 'high' | 'medium' | 'low';
  require_verification: boolean;

  // Retention
  archive_after_days?: number;

  // Embedding
  embedding_provider: string; // Reference to config provider
}
```

### Working Memory

Task-scoped shared context.

```typescript
interface WorkingMemory {
  // Identity
  id: string;
  name: string;

  // Goal
  goal: string;
  constraints: string[];

  // Status
  status: WorkingMemoryStatus;
  created_at: Date;
  updated_at: Date;
  completed_at?: Date;

  // Context sources
  memory_core_refs: string[]; // Cores used for context

  // Human
  owner: string; // Human who initiated

  // Configuration
  config: WorkingMemoryConfig;
}

type WorkingMemoryStatus =
  | 'active'
  | 'paused'
  | 'completed'
  | 'cancelled'
  | 'archived';

interface WorkingMemoryConfig {
  // Checkpointing
  checkpoint_interval_ms: number;

  // Cleanup
  auto_archive_after_hours: number;

  // Limits
  max_tasks: number;
  max_agents: number;
}
```

### Task

A unit of work within working memory.

```typescript
interface Task {
  // Identity
  id: string;
  working_memory_id: string;

  // Description
  title: string;
  description: string;

  // Status
  status: TaskStatus;

  // Assignment
  assigned_to?: string; // Agent ID
  assigned_at?: Date;

  // Dependencies (stored in LadybugDB task graph)
  depends_on: string[]; // Task IDs
  blocks: string[]; // Task IDs waiting on this

  // Timing
  created_at: Date;
  started_at?: Date;
  completed_at?: Date;

  // Result
  result?: TaskResult;

  // Review
  needs_review: boolean;
  reviewed_by?: string;
  review_status?: 'approved' | 'needs_rework' | 'rejected';
  review_comments?: string;

  // Priority
  priority: number; // Higher = more urgent

  // Metadata
  metadata?: Record<string, any>;
}

type TaskStatus =
  | 'pending' // Not started
  | 'assigned' // Given to agent
  | 'in_progress' // Being worked
  | 'blocked' // Waiting on dependency
  | 'review' // Awaiting review
  | 'completed' // Done
  | 'failed' // Errored
  | 'cancelled'; // Abandoned

interface TaskResult {
  summary: string;
  artifacts: string[]; // Artifact IDs
  next_steps?: string[];
  learnings?: string[]; // Potential memory core entries
}
```

### Additional Entities

```typescript
interface Agent {
  id: string;
  role: AgentRole;
  status: AgentStatus;
  current_task_id?: string;
  worktree_path?: string;
  log_path: string;
  working_memory_id?: string;
  tasks_completed: number;
  tasks_failed: number;
  created_at: Date;
  last_active_at: Date;
}

type AgentRole =
  | 'orchestrator'
  | 'developer'
  | 'qa'
  | 'researcher'
  | 'librarian'
  | 'analyst';
type AgentStatus = 'idle' | 'working' | 'blocked' | 'error' | 'terminated';

interface Decision {
  id: string;
  working_memory_id: string;
  question: string;
  choice: string;
  alternatives: string[];
  rationale: string;
  made_by: string;
  made_at: Date;
  task_id?: string;
  affects_tasks: string[];
  reversible: boolean;
  reversed_by?: string;
  confidence: 'high' | 'medium' | 'low';
}

interface Artifact {
  id: string;
  working_memory_id: string;
  type: ArtifactType;
  path: string;
  description: string;
  created_by: string;
  created_at: Date;
  task_id: string;
  version: number;
  checksum: string;
  previous_version_id?: string;
  git_commit?: string;
  git_branch?: string;
}

type ArtifactType =
  | 'code'
  | 'test'
  | 'config'
  | 'document'
  | 'migration'
  | 'schema';

interface Nudge {
  id: string;
  message: string;
  target: string;
  working_memory_id: string;
  priority: 'low' | 'normal' | 'high' | 'critical';
  delivery: 'next_turn' | 'immediate' | 'when_idle';
  created_at: Date;
  created_by: string;
  delivered: boolean;
  delivered_at?: Date;
  acknowledged: boolean;
  acknowledged_at?: Date;
}

interface Checkpoint {
  id: string;
  agent_id: string;
  branch: string;
  commit: string;
  worktree_path: string;
  task_id: string;
  working_memory_id: string;
  trigger:
    | 'manual'
    | 'periodic'
    | 'before_risky'
    | 'milestone'
    | 'before_restore';
  description: string;
  staged_changes: string[];
  unstaged_changes: string[];
  stash_ref?: string;
  created_at: Date;
}
```

---

## LanceDB Schema (Python Pydantic)

LanceDB stores vectors + metadata together. These Pydantic models define the
schema.

```python
import lancedb
from lancedb.pydantic import LanceModel, Vector
from datetime import datetime
from typing import Optional, List
from enum import Enum

class EntryType(str, Enum):
    LESSON = "lesson"
    PATTERN = "pattern"
    GOTCHA = "gotcha"
    DECISION = "decision"
    EXAMPLE = "example"
    REFERENCE = "reference"
    CONVENTION = "convention"

class Confidence(str, Enum):
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"

class SourceType(str, Enum):
    MANUAL = "manual"
    EXTRACTED = "extracted"
    PROMOTED = "promoted"
    IMPORTED = "imported"


class MemoryEntry(LanceModel):
    """Main knowledge entry - stored in LanceDB with embeddings."""

    # Identity
    id: str                              # ULID
    core_id: str

    # Content
    title: str
    content: str
    summary: Optional[str] = None

    # Classification
    entry_type: EntryType
    tags: List[str]

    # Quality
    confidence: Confidence
    verified: bool = False
    verified_at: Optional[datetime] = None
    verified_by: Optional[str] = None

    # Provenance
    source: str
    source_type: SourceType
    created_at: datetime
    updated_at: datetime
    created_by: str

    # Vector for semantic search
    # Dimension depends on embedding model (768 for nomic, 1536 for OpenAI)
    embedding: Vector(768)  # Adjust based on config

    # Keywords for hybrid search
    keywords: Optional[List[str]] = None

    # Extensible metadata (JSON)
    metadata: Optional[str] = None  # JSON string


class CodeSnippet(LanceModel):
    """Indexed code for semantic code search."""

    id: str                              # ULID
    codebase_id: str
    file_path: str
    symbol: Optional[str] = None         # Function/class name
    symbol_type: Optional[str] = None    # 'function', 'class', 'method'

    # Content
    content: str                         # The actual code
    language: str
    start_line: int
    end_line: int

    # Context
    docstring: Optional[str] = None
    imports: Optional[List[str]] = None

    # Indexing metadata
    indexed_at: datetime
    commit_sha: Optional[str] = None

    # Vector
    embedding: Vector(768)


class GoldenPathStep(LanceModel):
    """A step in a golden path walkthrough."""

    id: str
    golden_path_id: str
    step_order: int

    # Content
    title: str
    description: str                     # Markdown explanation

    # Code reference
    codebase_id: str
    file_path: str
    symbol: Optional[str] = None
    start_line: Optional[int] = None
    end_line: Optional[int] = None

    # Cached code (for display, may be stale)
    code_snapshot: Optional[str] = None
    snapshot_commit: Optional[str] = None

    # Concepts taught in this step
    key_concepts: List[str]

    # Vector for semantic search
    embedding: Vector(768)


class WorkingMemoryEntry(LanceModel):
    """Context entries for active tasks - fast retrieval needed."""

    id: str
    working_memory_id: str
    task_id: Optional[str] = None

    # Content
    content_type: str                    # 'context', 'discovery', 'artifact_ref'
    content: str

    # Source
    source_type: str                     # 'memory_core', 'code_search', 'agent'
    source_id: Optional[str] = None

    # Timing
    created_at: datetime
    expires_at: Optional[datetime] = None

    # Vector for task-scoped search
    embedding: Vector(768)
```

### LanceDB Table Creation

```python
import lancedb

# Connect to database
db = lancedb.connect("./memory-data/lance")

# Create tables with schemas
memory_entries = db.create_table("memory_entries", schema=MemoryEntry)
code_snippets = db.create_table("code_snippets", schema=CodeSnippet)
golden_path_steps = db.create_table("golden_path_steps", schema=GoldenPathStep)
working_memory = db.create_table("working_memory", schema=WorkingMemoryEntry)

# Create indexes for performance
memory_entries.create_index(
    metric="cosine",
    num_partitions=256,
    num_sub_vectors=96
)
memory_entries.create_scalar_index("core_id")
memory_entries.create_scalar_index("entry_type")
memory_entries.create_scalar_index("created_at")

code_snippets.create_index(metric="cosine", num_partitions=128)
code_snippets.create_scalar_index("codebase_id")
code_snippets.create_scalar_index("file_path")
code_snippets.create_scalar_index("language")
```

---

## LadybugDB Schema (Cypher DDL)

LadybugDB stores graph relationships. Node tables have minimal data (IDs + key
properties), with full content in LanceDB.

### Node Tables

```cypher
-- Memory entries (minimal - full data in LanceDB)
CREATE NODE TABLE MemoryEntry (
    id STRING PRIMARY KEY,
    core_id STRING,
    title STRING,
    entry_type STRING,
    confidence STRING,
    created_at TIMESTAMP
);

-- Memory cores
CREATE NODE TABLE MemoryCore (
    id STRING PRIMARY KEY,
    name STRING,
    core_type STRING,
    owner STRING,
    visibility STRING
);

-- Code locations (for REFERENCES_CODE relationships)
CREATE NODE TABLE CodeLocation (
    id STRING PRIMARY KEY,
    codebase_id STRING,
    file_path STRING,
    symbol STRING,
    start_line INT64,
    end_line INT64
);

-- Golden paths
CREATE NODE TABLE GoldenPath (
    id STRING PRIMARY KEY,
    name STRING,
    concept STRING,
    description STRING
);

-- Working memories
CREATE NODE TABLE WorkingMemory (
    id STRING PRIMARY KEY,
    name STRING,
    status STRING,
    owner STRING,
    created_at TIMESTAMP
);

-- Tasks (for task graph)
CREATE NODE TABLE Task (
    id STRING PRIMARY KEY,
    working_memory_id STRING,
    title STRING,
    status STRING,
    priority INT64
);

-- Agents
CREATE NODE TABLE Agent (
    id STRING PRIMARY KEY,
    role STRING,
    status STRING
);

-- Decisions
CREATE NODE TABLE Decision (
    id STRING PRIMARY KEY,
    working_memory_id STRING,
    question STRING,
    choice STRING,
    made_at TIMESTAMP
);
```

### Relationship Tables

```cypher
-- Entry relationships
CREATE REL TABLE RELATED (
    FROM MemoryEntry TO MemoryEntry,
    strength FLOAT,
    discovered_at TIMESTAMP
);

CREATE REL TABLE DEPENDS_ON (
    FROM MemoryEntry TO MemoryEntry,
    reason STRING
);

CREATE REL TABLE SUPERSEDES (
    FROM MemoryEntry TO MemoryEntry,
    reason STRING,
    superseded_at TIMESTAMP
);

-- Entry to core membership
CREATE REL TABLE BELONGS_TO (
    FROM MemoryEntry TO MemoryCore,
    added_at TIMESTAMP
);

-- Entry to code references
CREATE REL TABLE REFERENCES_CODE (
    FROM MemoryEntry TO CodeLocation,
    relevance STRING,
    context STRING
);

-- Golden path structure
CREATE REL TABLE PATH_STEP (
    FROM GoldenPath TO CodeLocation,
    step_order INT64,
    description STRING,
    key_concepts STRING  -- JSON array
);

CREATE REL TABLE IMPLEMENTS (
    FROM MemoryEntry TO GoldenPath
);

-- Task graph
CREATE REL TABLE TASK_DEPENDS_ON (
    FROM Task TO Task
);

CREATE REL TABLE ASSIGNED_TO (
    FROM Task TO Agent,
    assigned_at TIMESTAMP
);

CREATE REL TABLE PART_OF (
    FROM Task TO WorkingMemory
);

-- Decision tracking
CREATE REL TABLE DECISION_AFFECTS (
    FROM Decision TO Task
);

CREATE REL TABLE DECISION_REFERENCES (
    FROM Decision TO MemoryEntry
);

-- Core relationships
CREATE REL TABLE CORE_EXTENDS (
    FROM MemoryCore TO MemoryCore,
    relationship_type STRING  -- 'inherits', 'supplements'
);
```

### Example Graph Queries

```cypher
-- Find all entries related to a specific entry (2 hops)
MATCH (start:MemoryEntry {id: $entry_id})-[:RELATED*1..2]-(related:MemoryEntry)
RETURN DISTINCT related.id, related.title, related.entry_type;

-- Find entries that reference code in a specific file
MATCH (e:MemoryEntry)-[:REFERENCES_CODE]->(c:CodeLocation)
WHERE c.file_path CONTAINS 'token-service'
RETURN e.id, e.title, c.symbol, c.start_line;

-- Get golden path steps in order
MATCH (p:GoldenPath {id: $path_id})-[s:PATH_STEP]->(c:CodeLocation)
RETURN c.file_path, c.symbol, s.step_order, s.description
ORDER BY s.step_order;

-- Find all entries that depend on entries I'm about to change
MATCH (affected:MemoryEntry)-[:DEPENDS_ON]->(changing:MemoryEntry)
WHERE changing.id IN $changing_ids
RETURN affected.id, affected.title;

-- Get task dependency graph for a working memory
MATCH (t:Task)-[:PART_OF]->(wm:WorkingMemory {id: $wm_id})
OPTIONAL MATCH (t)-[:TASK_DEPENDS_ON]->(dep:Task)
RETURN t.id, t.title, t.status, collect(dep.id) as dependencies;

-- Find entries in a core with their code references
MATCH (e:MemoryEntry)-[:BELONGS_TO]->(c:MemoryCore {id: $core_id})
OPTIONAL MATCH (e)-[:REFERENCES_CODE]->(code:CodeLocation)
RETURN e.id, e.title, collect({file: code.file_path, symbol: code.symbol}) as code_refs;
```

---

## Data Split Strategy

| Data Type     | LanceDB                   | LadybugDB            |
| ------------- | ------------------------- | -------------------- |
| Entry content | Full text, embeddings     | ID, title, type only |
| Relationships | -                         | All edges            |
| Code snippets | Full code + embeddings    | CodeLocation nodes   |
| Golden paths  | Step content + embeddings | PATH_STEP edges      |
| Task graph    | -                         | Full structure       |
| Queries       | Semantic search           | Graph traversal      |

**Sync Strategy:**

- Entry ID is the join key between both DBs
- Writes go to both (transaction wrapper)
- Reads can query either or combine results

---

## ID Format

**Recommendation:** ULID (Universally Unique Lexicographically Sortable
Identifier)

```python
from ulid import ULID

entry_id = str(ULID())  # "01ARZ3NDEKTSV4RRFFQ69G5FAV"
```

**Why ULID:**

- Sortable by creation time (useful for queries)
- URL-safe (no special characters)
- 128-bit like UUID but more compact
- Monotonically increasing within millisecond

---

## Migration Strategy

```python
from dataclasses import dataclass
from typing import Callable

@dataclass
class Migration:
    version: int
    name: str
    up_lance: Callable[[lancedb.Table], None]
    up_ladybug: str  # Cypher
    down_ladybug: str  # Cypher for rollback

# Example migration
migration_002 = Migration(
    version=2,
    name="add_verified_by_to_entries",
    up_lance=lambda table: table.add_column("verified_by", str, None),
    up_ladybug="ALTER TABLE MemoryEntry ADD verified_by STRING",
    down_ladybug="ALTER TABLE MemoryEntry DROP verified_by"
)
```

---

## Gaps & Open Questions

- [ ] ULID vs UUID vs Nanoid - final decision?
- [ ] How do we handle schema versioning across distributed nodes?
- [ ] What's the backup format for portability? (Lance files + Ladybug export)
- [ ] How do we handle very large content fields? (Chunking? References?)
- [ ] What's the validation strategy for data integrity?
- [ ] How do we handle cascading deletes? (Soft delete in Lance, remove edges in
      Ladybug?)
- [ ] Transaction coordination between LanceDB and LadybugDB writes
- [ ] Should we support multiple embedding models per entry? (For model
      upgrades)
- [ ] LadybugDB Python bindings maturity - any gotchas?
- [ ] Backup strategy for both DBs together (atomic snapshot?)
