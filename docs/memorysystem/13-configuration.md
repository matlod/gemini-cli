# 13 - Configuration

**Status:** Draft **Last Updated:** 2024-12-21

## Purpose

Define the comprehensive configuration schema for the memory system. All
settings are consolidated in a single `memory-config.yaml` file.

---

## Configuration File Location

```
~/.memory-system/
├── memory-config.yaml      # Main configuration
├── lance/                   # LanceDB storage
├── ladybug/                 # LadybugDB storage
└── logs/                    # Agent logs
```

Or project-scoped:

```
project/
├── .memory/
│   ├── memory-config.yaml
│   ├── lance/
│   └── ladybug/
└── src/
```

---

## Full Configuration Schema

```yaml
# memory-config.yaml
# Memory System Configuration
# Version: 1.0

# =============================================================================
# STORAGE
# =============================================================================
storage:
  # Base directory for all storage (can use ~ for home, ${VAR} for env vars)
  base_path: '~/.memory-system'

  # LanceDB (vector + metadata)
  lance:
    path: '${storage.base_path}/lance'
    # Index settings
    index:
      metric: 'cosine' # cosine, L2, dot
      num_partitions: 256 # For IVF index
      num_sub_vectors: 96 # For PQ compression
    # Table-specific settings
    tables:
      memory_entries:
        scalar_indexes: ['core_id', 'entry_type', 'created_at']
      code_snippets:
        scalar_indexes: ['codebase_id', 'file_path', 'language']

  # LadybugDB (graph)
  ladybug:
    path: '${storage.base_path}/ladybug'
    # Buffer pool size (MB)
    buffer_pool_size: 256
    # Enable WAL for durability
    enable_wal: true

# =============================================================================
# EMBEDDINGS
# =============================================================================
embeddings:
  # Named embedding providers
  providers:
    # Local with ollama (default)
    local-nomic:
      type: openai-compatible
      base_url: 'http://localhost:11434/v1'
      model: 'nomic-embed-text'
      dimensions: 768
      max_tokens: 8192
      chunk_size:
        optimal: 512 # Best quality
        max: 2048 # Still works
      matryoshka:
        enabled: true
        dimensions: [768, 512, 384, 256, 128, 64]
      batch_size: 32
      timeout_ms: 30000
      # No API key needed for local

    # Local with vLLM/SGLang
    local-bge:
      type: openai-compatible
      base_url: 'http://localhost:8000/v1'
      model: 'BAAI/bge-large-en-v1.5'
      dimensions: 1024
      max_tokens: 512
      chunk_size:
        optimal: 256
        max: 512
      matryoshka:
        enabled: false
      batch_size: 64
      timeout_ms: 30000

    # OpenAI (cloud)
    openai-3-small:
      type: openai-compatible
      base_url: 'https://api.openai.com/v1'
      model: 'text-embedding-3-small'
      dimensions: 1536
      max_tokens: 8191
      chunk_size:
        optimal: 1000
        max: 4000
      matryoshka:
        enabled: true
        dimensions: [1536, 1024, 768, 512, 256]
      batch_size: 100
      timeout_ms: 60000
      api_key: '${OPENAI_API_KEY}'

    openai-3-large:
      type: openai-compatible
      base_url: 'https://api.openai.com/v1'
      model: 'text-embedding-3-large'
      dimensions: 3072
      max_tokens: 8191
      chunk_size:
        optimal: 1000
        max: 4000
      matryoshka:
        enabled: true
        dimensions: [3072, 2048, 1536, 1024, 512, 256]
      batch_size: 100
      timeout_ms: 60000
      api_key: '${OPENAI_API_KEY}'

  # Which provider to use for what
  usage:
    memory_entries: 'local-nomic'
    code_snippets: 'local-nomic'
    working_memory: 'local-nomic'
    # Can override for specific cores
    # high_quality_core: "openai-3-large"

# =============================================================================
# LLM (for future agentic backends)
# =============================================================================
llm:
  providers:
    # Gemini via A2A server (current)
    gemini:
      type: gemini
      endpoint: 'http://localhost:41242'
      models:
        flash: 'gemini-2.0-flash'
        pro: 'gemini-2.0-pro'

    # OpenRouter (many models)
    openrouter:
      type: openai-compatible
      base_url: 'https://openrouter.ai/api/v1'
      api_key: '${OPENROUTER_API_KEY}'
      models:
        fast: 'anthropic/claude-3-5-haiku'
        reasoning: 'anthropic/claude-3-5-sonnet'
        code: 'deepseek/deepseek-coder'

    # Local llama.cpp
    local-llama:
      type: openai-compatible
      base_url: 'http://localhost:8080/v1'
      models:
        fast: 'llama-3.2-3b'
        reasoning: 'llama-3.1-70b'

    # Local vLLM
    local-vllm:
      type: openai-compatible
      base_url: 'http://localhost:8000/v1'
      models:
        fast: 'Qwen/Qwen2.5-7B-Instruct'
        reasoning: 'Qwen/Qwen2.5-72B-Instruct'
        code: 'Qwen/Qwen2.5-Coder-32B-Instruct'

  # Role-based routing
  usage:
    orchestrator: 'gemini.pro'
    developer: 'gemini.flash'
    qa: 'gemini.flash'
    researcher: 'gemini.flash'
    librarian: 'gemini.flash'
    analyst: 'gemini.pro'

# =============================================================================
# GITHUB INTEGRATION
# =============================================================================
github:
  # Personal Access Token (for private repos)
  pat: '${GITHUB_PAT}'

  # API settings
  api:
    base_url: 'https://api.github.com'
    timeout_ms: 30000
    rate_limit_buffer: 100 # Stop when this many requests remain

  # Clone settings
  clone:
    method: 'https' # https, ssh
    depth: 1 # Shallow clone for indexing
    max_size_mb: 500 # Skip repos larger than this

# =============================================================================
# CODEBASE REGISTRY
# =============================================================================
codebase_registry:
  # Default settings for all codebases
  defaults:
    languages: ['typescript', 'python', 'go', 'rust']
    exclude_patterns:
      - 'node_modules/**'
      - '**/__pycache__/**'
      - '**/dist/**'
      - '**/build/**'
      - '**/.git/**'
      - '**/vendor/**'
    include_patterns:
      - '**/*.ts'
      - '**/*.tsx'
      - '**/*.py'
      - '**/*.go'
      - '**/*.rs'
    max_file_size_kb: 500
    index_frequency: 'daily' # hourly, daily, weekly, manual

  # Registered codebases
  codebases:
    # Local project
    gemini-cli:
      type: 'local'
      path: '/home/user/projects/gemini-cli'
      languages: ['typescript']
      branch: 'main'
      index_frequency: 'on_change'

    # GitHub private repo
    acme-backend:
      type: 'github'
      repo: 'acme-corp/backend'
      branch: 'main'
      languages: ['python', 'go']
      # Can override defaults
      exclude_patterns:
        - 'tests/**'
        - 'migrations/**'

    # Reference/SOTA codebase
    langchain:
      type: 'github'
      repo: 'langchain-ai/langchain'
      branch: 'master'
      languages: ['python']
      read_only: true # Don't track changes, just index
      index_frequency: 'weekly'

# =============================================================================
# MEMORY CORES
# =============================================================================
memory_cores:
  # Default settings
  defaults:
    auto_dedupe: true
    auto_link: true
    min_confidence: 'medium'
    require_verification: false
    archive_after_days: 365
    embedding_provider: 'local-nomic'

  # Pre-defined cores (others can be created dynamically)
  cores:
    common-patterns:
      name: 'Common Patterns'
      type: 'pattern'
      description: 'Cross-project architectural patterns'
      visibility: 'private'

    typescript-lessons:
      name: 'TypeScript Lessons'
      type: 'technology'
      description: 'TypeScript gotchas and best practices'
      visibility: 'private'

# =============================================================================
# ORCHESTRATION
# =============================================================================
orchestration:
  # Polling interval (ms)
  poll_interval_ms: 1000

  # Parallelism limits
  max_concurrent_agents: 4
  max_concurrent_tasks_per_agent: 1

  # Timeouts
  task_timeout_ms: 600000 # 10 minutes
  stuck_detection_ms: 300000 # 5 minutes

  # Retry policy
  retry:
    max_attempts: 3
    backoff_ms: 1000 # Initial backoff
    backoff_multiplier: 2 # Exponential backoff
    max_backoff_ms: 30000

  # Checkpointing
  checkpoint:
    interval_ms: 60000 # Periodic checkpoint every minute
    on_task_complete: true
    on_phase_complete: true
    before_risky_operation: true

# =============================================================================
# WORKING MEMORY
# =============================================================================
working_memory:
  # Defaults for new working memories
  defaults:
    max_tasks: 100
    max_agents: 8
    checkpoint_interval_ms: 60000
    auto_archive_after_hours: 168 # 1 week

  # Garbage collection
  gc:
    enabled: true
    run_interval_hours: 24
    archive_completed_after_days: 7
    delete_archived_after_days: 90

# =============================================================================
# AGENTS
# =============================================================================
agents:
  # Worktree configuration
  worktree:
    base_path: '${storage.base_path}/worktrees'
    cleanup_on_completion: false # Keep for debugging
    cleanup_after_days: 7

  # Logging
  logging:
    base_path: '${storage.base_path}/logs'
    level: 'info' # debug, info, warn, error
    format: 'json' # json, text
    retention_days: 30
    max_size_mb: 100 # Per log file

  # Role-specific settings
  roles:
    developer:
      tools: ['read', 'write', 'bash', 'git']
      max_context_tokens: 32000
    qa:
      tools: ['read', 'bash', 'git']
      max_context_tokens: 16000
    researcher:
      tools: ['read', 'web_search', 'web_fetch']
      max_context_tokens: 64000
    librarian:
      tools: ['read', 'memory_query', 'memory_write']
      max_context_tokens: 32000
    analyst:
      tools: ['read', 'memory_query']
      max_context_tokens: 64000

# =============================================================================
# RETRIEVAL
# =============================================================================
retrieval:
  # Semantic search defaults
  semantic:
    default_limit: 10
    default_threshold: 0.7
    use_matryoshka: true
    matryoshka_initial_dim: 256
    matryoshka_rerank_dim: 768

  # Graph traversal defaults
  graph:
    default_depth: 2
    max_depth: 5

  # Hybrid search weights
  hybrid:
    semantic_weight: 0.6
    keyword_weight: 0.3
    graph_weight: 0.1

  # Caching
  cache:
    enabled: true
    ttl_seconds: 900 # 15 minutes
    max_entries: 1000

# =============================================================================
# OBSERVABILITY
# =============================================================================
observability:
  # Metrics
  metrics:
    enabled: true
    export_interval_seconds: 60
    # Future: prometheus endpoint
    # prometheus_port: 9090

  # Tracing
  tracing:
    enabled: true
    # Future: OTLP exporter
    # otlp_endpoint: "http://localhost:4318"

  # Health checks
  health:
    enabled: true
    port: 8080
    path: '/health'

# =============================================================================
# DEFAULTS
# =============================================================================
defaults:
  # ID generation
  id_format: 'ulid' # ulid, uuid, nanoid

  # Timezone
  timezone: 'UTC'

  # Date format for display
  date_format: 'ISO8601'
```

---

## Environment Variable Interpolation

Configuration values support environment variable interpolation:

```yaml
# Direct reference
api_key: "${OPENAI_API_KEY}"

# With default value
api_key: "${OPENAI_API_KEY:-sk-default}"

# Nested reference
path: "${storage.base_path}/logs"
```

### Implementation

```python
import os
import re
import yaml

def interpolate_env(value: str) -> str:
    """Replace ${VAR} and ${VAR:-default} patterns."""

    # Pattern: ${VAR} or ${VAR:-default}
    pattern = r'\$\{([^}:]+)(?::-([^}]*))?\}'

    def replace(match):
        var_name = match.group(1)
        default = match.group(2)
        return os.environ.get(var_name, default or "")

    return re.sub(pattern, replace, value)

def load_config(path: str) -> dict:
    """Load and interpolate configuration."""

    with open(path) as f:
        config = yaml.safe_load(f)

    def interpolate_recursive(obj):
        if isinstance(obj, str):
            return interpolate_env(obj)
        elif isinstance(obj, dict):
            return {k: interpolate_recursive(v) for k, v in obj.items()}
        elif isinstance(obj, list):
            return [interpolate_recursive(v) for v in obj]
        return obj

    return interpolate_recursive(config)
```

---

## Validation

```python
from pydantic import BaseModel, Field, validator
from typing import Optional, Dict, List
from enum import Enum

class EmbeddingProvider(BaseModel):
    type: str = Field(pattern="^openai-compatible$")
    base_url: str
    model: str
    dimensions: int = Field(gt=0)
    max_tokens: int = Field(gt=0)
    chunk_size: Dict[str, int]
    matryoshka: Optional[Dict] = None
    batch_size: int = Field(default=32, gt=0)
    timeout_ms: int = Field(default=30000, gt=0)
    api_key: Optional[str] = None

class StorageConfig(BaseModel):
    base_path: str
    lance: Dict
    ladybug: Dict

class EmbeddingsConfig(BaseModel):
    providers: Dict[str, EmbeddingProvider]
    usage: Dict[str, str]

    @validator('usage')
    def validate_usage_references(cls, v, values):
        providers = values.get('providers', {})
        for key, provider_name in v.items():
            if provider_name not in providers:
                raise ValueError(f"Usage '{key}' references unknown provider '{provider_name}'")
        return v

class MemoryConfig(BaseModel):
    storage: StorageConfig
    embeddings: EmbeddingsConfig
    llm: Optional[Dict] = None
    github: Optional[Dict] = None
    codebase_registry: Optional[Dict] = None
    memory_cores: Optional[Dict] = None
    orchestration: Optional[Dict] = None
    working_memory: Optional[Dict] = None
    agents: Optional[Dict] = None
    retrieval: Optional[Dict] = None
    observability: Optional[Dict] = None
    defaults: Optional[Dict] = None

def validate_config(config: dict) -> MemoryConfig:
    """Validate configuration against schema."""
    return MemoryConfig(**config)
```

---

## Example Configurations

### Minimal (Local Development)

```yaml
# memory-config.yaml - minimal
storage:
  base_path: '~/.memory-system'
  lance:
    path: '${storage.base_path}/lance'
  ladybug:
    path: '${storage.base_path}/ladybug'

embeddings:
  providers:
    local:
      type: openai-compatible
      base_url: 'http://localhost:11434/v1'
      model: 'nomic-embed-text'
      dimensions: 768
      max_tokens: 8192
      chunk_size:
        optimal: 512
        max: 2048
  usage:
    memory_entries: 'local'
    code_snippets: 'local'
    working_memory: 'local'
```

### Full (Production)

See the complete schema above.

### Team (Shared Settings)

```yaml
# memory-config.yaml - team
storage:
  base_path: '/shared/memory-system'
  lance:
    path: '${storage.base_path}/lance'
  ladybug:
    path: '${storage.base_path}/ladybug'

embeddings:
  providers:
    team-embeddings:
      type: openai-compatible
      base_url: 'https://embeddings.internal.company.com/v1'
      model: 'company-embed-v2'
      dimensions: 1024
      max_tokens: 8192
      chunk_size:
        optimal: 512
        max: 2048
      api_key: '${TEAM_EMBEDDINGS_KEY}'
  usage:
    memory_entries: 'team-embeddings'
    code_snippets: 'team-embeddings'
    working_memory: 'team-embeddings'

github:
  pat: '${GITHUB_PAT}'
  api:
    base_url: 'https://github.company.com/api/v3'

codebase_registry:
  codebases:
    main-monorepo:
      type: 'github'
      repo: 'company/monorepo'
      branch: 'main'
```

---

## CLI Commands

```bash
# Validate configuration
memory-system config validate

# Show resolved configuration (with env vars interpolated)
memory-system config show

# Show specific section
memory-system config show embeddings

# Initialize default configuration
memory-system config init

# Check health of configured services
memory-system config check
```

---

## Gaps & Open Questions

- [ ] Hot-reload configuration changes without restart?
- [ ] Configuration inheritance (base + overlay)?
- [ ] Secrets management integration (Vault, AWS Secrets Manager)?
- [ ] Multi-environment support (dev, staging, prod)?
- [ ] Configuration versioning and migration?
- [ ] Per-project overrides vs global settings precedence?
- [ ] GUI for configuration editing?
- [ ] Validation of external service connectivity on startup?
