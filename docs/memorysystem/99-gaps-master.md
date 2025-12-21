# 99 - Master Gaps & Open Questions

**Status:** Living Document **Last Updated:** 2024-12-20

## Purpose

Consolidated list of all open questions, gaps, and things that need
consideration. This ensures nothing gets lost as we iterate on the design.

---

## Critical Path Questions

These block core architecture decisions.

### 1. Storage Foundation ✅ DECIDED

- [x] **Vector + Metadata:** LanceDB (embedded, Lance columnar format)
- [x] **Graph:** LadybugDB (embedded, Cypher queries, formerly Kuzu)
- [ ] **File storage:** Git-native vs object store vs hybrid?

### 2. Embedding Strategy ✅ DECIDED

- [x] **Agnostic:** OpenAI-compatible API (ollama, vLLM, SGLang, llama.cpp,
      OpenAI)
- [x] **Config-driven:** Provider configs with dimensions, chunk sizes,
      matryoshka support
- [ ] **Default model:** Which to recommend? (nomic-embed-text?
      text-embedding-3-small?)
- [ ] **Chunking strategy:** Implementation details

### 3. Deployment Model

- [ ] **Local-first:** Everything runs on dev machine?
- [ ] **Server mode:** Central server with agents connecting?
- [ ] **Hybrid:** Local with optional sync?

### 4. Agent Runtime

- [ ] **How do agents run?** Separate processes? Containers? Threads?
- [ ] **IPC mechanism:** Unix sockets? HTTP? Message queue?
- [ ] **Lifecycle management:** Who starts/stops agents?

### 5. Code Index

- [ ] **What repos to index?** Start with local only? Include GitHub?
- [ ] **Storage:** Full code or metadata + on-demand fetch?
- [ ] **GitHub auth:** PAT per user? GitHub App for org?
- [ ] **AST parsing:** Tree-sitter? Language-specific parsers?

---

## By Component

### Architecture (01)

- [ ] How do we handle conflicting information in memory cores?
- [ ] What's the eviction/archival strategy for old working memory?
- [ ] How do agents discover each other's capabilities?
- [ ] What happens when orchestrator crashes mid-workflow?
- [ ] How do we version memory cores as knowledge evolves?
- [ ] What's the security model for multi-user scenarios?
- [ ] How do we handle large binary artifacts (models, datasets)?
- [ ] What's the sync story for distributed teams?

### Memory Cores (02)

- [ ] What's the file format? YAML, JSON, Markdown, SQLite?
- [ ] How do we handle large code examples? Inline vs file reference?
- [ ] What's the embedding model and where does it run?
- [ ] How do we handle versioning of entries?
- [ ] What's the merge strategy when cores conflict?
- [ ] How do we garbage collect unused/stale entries?
- [ ] Should cores be git repos themselves for versioning?
- [ ] How do we share cores across machines/team members?
- [ ] What's the privacy model for personal vs shared cores?
- [ ] How do we handle code examples that become outdated?
- [ ] What's the indexing strategy for fast retrieval?
- [ ] How do we validate code examples still work?

### Working Memory (03)

- [ ] What's the maximum size of working memory before it gets unwieldy?
- [ ] How do we handle working memory for very long-running workflows
      (days/weeks)?
- [ ] What's the conflict resolution when multiple agents write simultaneously?
- [ ] How do we handle task graph cycles (circular dependencies)?
- [ ] What happens to working memory if orchestrator dies?
- [ ] How do we garbage collect old/stale working memories?
- [ ] Should working memory have access controls per agent?
- [ ] How do we handle branching workflows (A or B paths)?
- [ ] What's the notification mechanism when things change?
- [ ] How do we visualize working memory state for humans?
- [ ] Should artifacts be stored inline or by reference?
- [ ] How do we handle partial failures (some tasks done, some failed)?

### Agent Roles (04)

- [ ] How do we handle role escalation (dev needs help, calls for senior)?
- [ ] Should agents have "experience" that improves over time?
- [ ] How do we handle an agent that's stuck (timeout, error loop)?
- [ ] Can an agent have multiple roles (dev + qa for small tasks)?
- [ ] How do we calibrate which role is best for edge-case tasks?
- [ ] Should roles be extensible (user-defined custom roles)?
- [ ] How do we measure agent performance per role?
- [ ] What's the handoff protocol when reassigning a task?
- [ ] How do we handle role-specific tool access (security)?
- [ ] Should agents have personality/style (verbose vs terse)?
- [ ] How do we prevent role confusion in prompts?
- [ ] What happens if no agent with required role is available?

### Orchestration (05)

- [ ] What's the maximum parallelism? How many concurrent agents?
- [ ] How do we handle priority inversion (high-priority blocked by low)?
- [ ] What's the timeout for stuck detection?
- [ ] How do we load balance across agents?
- [ ] Should orchestrator be stateless (recoverable) or stateful?
- [ ] How do we handle network partitions between orchestrator and agents?
- [ ] What's the retry policy (count, backoff, circuit breaker)?
- [ ] How do we prevent thundering herd on recovery?
- [ ] Should we support task preemption (pause A to run urgent B)?
- [ ] How do we handle circular dependency detection?
- [ ] What's the story for distributed orchestration (multiple orchestrators)?
- [ ] How do we handle agent version mismatches?
- [ ] What's the quota/resource management model?
- [ ] How do we handle rate limiting from underlying APIs?

### Human Interaction (06)

- [ ] How do we handle conflicting nudges from multiple humans?
- [ ] What's the UX for nudge composition? CLI? GUI? Voice?
- [ ] How do we prevent nudge overload (human sends too many)?
- [ ] What's the notification fatigue mitigation strategy?
- [ ] How do we handle nudges to agents that have finished?
- [ ] Should nudges be editable/retractable after sending?
- [ ] How do we track nudge effectiveness (was it helpful)?
- [ ] What's the auth model for who can nudge what?
- [ ] How do we handle nudges in different timezones?
- [ ] Should there be nudge templates for common situations?
- [ ] How do we handle long-form instructions vs quick nudges?
- [ ] What's the mobile experience for on-the-go oversight?

### Worktree & Checkpoints (07)

- [ ] How do we handle binary files in worktrees?
- [ ] What's the cleanup policy for old worktrees/branches?
- [ ] How do we merge work from multiple agent worktrees?
- [ ] What's the conflict resolution strategy?
- [ ] How do we handle submodules in worktrees?
- [ ] What's the disk space management strategy?
- [ ] How do we handle very large repos?
- [ ] Should checkpoints be stored in git or external?
- [ ] How do we sync worktrees with remote changes?
- [ ] What's the backup strategy for logs?
- [ ] How do we handle credentials/secrets in worktrees?
- [ ] Should agents share worktrees for collaborative tasks?
- [ ] What's the log retention policy?
- [ ] How do we search across agent logs?

### Retrieval System (08)

- [ ] Which embedding model? Local vs cloud tradeoffs?
- [ ] How do we handle embedding model upgrades (re-embed everything)?
- [ ] What's the vector dimension vs quality vs speed tradeoff?
- [ ] How do we handle multi-lingual content?
- [ ] What's the index update latency requirement?
- [ ] How do we handle very long entries that exceed embedding context?
- [ ] Should we chunk entries or embed whole?
- [ ] What's the hybrid search weight tuning strategy?
- [ ] How do we evaluate retrieval quality?
- [ ] What's the caching strategy for frequent queries?
- [ ] How do we handle sensitive/private entries in search?
- [ ] What's the backup/recovery for indexes?
- [ ] How do we handle index corruption?
- [ ] Should graph be in same DB as vectors or separate?

### Logging & Observability (09)

- [ ] What's the log format standard? OpenTelemetry? Custom?
- [ ] How do we handle sensitive data in logs (API keys, secrets)?
- [ ] What's the log aggregation strategy for distributed setup?
- [ ] How do we correlate logs with git commits?
- [ ] What's the retention policy for different log types?
- [ ] How do we handle log volume at scale?
- [ ] Should we support log streaming to external systems?
- [ ] What's the log backup and recovery strategy?
- [ ] How do we handle timezone in logs?
- [ ] What's the log access control model?
- [ ] How do we prevent log tampering in audit trail?
- [ ] What's the storage cost estimation for logs?
- [ ] How do we sample logs for high-traffic operations?
- [ ] Should we support log anonymization for sharing?

### Data Schema (10)

- [ ] What's the ID format? UUID v4? ULID? Nanoid?
- [ ] How do we handle schema versioning across distributed nodes?
- [ ] What's the backup format for portability?
- [ ] How do we handle nullable vs optional fields?
- [ ] What's the validation strategy for data integrity?
- [ ] How do we handle cascading deletes?
- [ ] Should we use soft deletes for everything?
- [ ] What's the indexing strategy for common queries?
- [ ] How do we handle very large content fields?
- [ ] Should embeddings be stored inline or in separate table?
- [ ] What's the blob storage strategy for artifacts?
- [ ] How do we handle concurrent updates?
- [ ] What's the conflict resolution for distributed updates?
- [ ] Should we support multiple embedding models per entry?

### Code Index (11)

- [ ] How do we handle large repos? (e.g., monorepos with 100k files)
- [ ] What's the storage footprint for code index?
- [ ] How do we handle rate limiting for GitHub API?
- [ ] Should we store full code or just metadata + fetch on demand?
- [ ] How do we detect breaking changes in golden paths?
- [ ] What's the auth model for accessing private repos in team setting?
- [ ] How do we handle binary files and generated code?
- [ ] Should we index dependencies (node_modules, etc.)?
- [ ] How do we handle code that's been removed but referenced?
- [ ] What's the versioning strategy for indexed code? (specific commit?)
- [ ] How do we handle multiple languages in same codebase?
- [ ] Should we support code snippets that span multiple files?
- [ ] How do we rank code quality automatically?
- [ ] What's the story for indexing notebooks (Jupyter)?

---

## Cross-Cutting Concerns

### Security

- [ ] How do we authenticate agents?
- [ ] How do we authorize access to memory cores?
- [ ] How do we handle secrets in agent context?
- [ ] What's the encryption strategy for sensitive data?
- [ ] How do we audit security-relevant actions?

### Performance

- [ ] What's the latency budget for context retrieval?
- [ ] How do we handle cold starts?
- [ ] What's the memory footprint per agent?
- [ ] How do we optimize for large memory cores?
- [ ] What's the scaling strategy (vertical vs horizontal)?

### Reliability

- [ ] What's the failure domain? If X fails, what breaks?
- [ ] How do we handle partial outages?
- [ ] What's the recovery procedure for each component?
- [ ] How do we detect and alert on failures?
- [ ] What's the backup and restore process?

### Developer Experience

- [ ] What's the CLI interface for common operations?
- [ ] How do we debug issues in the system?
- [ ] What's the testing strategy for memory cores?
- [ ] How do we simulate multi-agent scenarios?
- [ ] What's the onboarding experience for new users?

---

## Implementation Phases

### Phase 1: Foundation (MVP)

**Goal:** Single-agent with persistent memory

Must answer:

- [ ] Storage: SQLite + sqlite-vss?
- [ ] Embedding: Which model, where?
- [ ] Format: How are memory cores stored?
- [ ] CLI: Basic commands for query/add

### Phase 2: Working Memory

**Goal:** Task tracking with single orchestrator + single worker

Must answer:

- [ ] Working memory persistence
- [ ] Task lifecycle
- [ ] Agent-to-working-memory protocol

### Phase 3: Multi-Agent

**Goal:** Multiple concurrent workers

Must answer:

- [ ] Agent isolation (worktrees)
- [ ] Concurrent access to working memory
- [ ] Orchestration loop

### Phase 4: Human-in-Loop

**Goal:** Full nudge and oversight capability

Must answer:

- [ ] Nudge injection mechanism
- [ ] Watch mode UI
- [ ] Approval gates

### Phase 5: Knowledge Curation

**Goal:** Librarian agent, quality maintenance

Must answer:

- [ ] Deduplication algorithm
- [ ] Link discovery
- [ ] Staleness detection

---

## Decision Log

Track decisions as we make them.

| Date       | Decision                           | Rationale                                               | Docs Updated               |
| ---------- | ---------------------------------- | ------------------------------------------------------- | -------------------------- |
| 2024-12-20 | LanceDB for vectors + metadata     | Embedded, serverless, Lance format, hybrid search       | 12-technology-decisions.md |
| 2024-12-20 | LadybugDB for graph                | Embedded, Cypher, ACID, C++ core, fast traversal        | 12-technology-decisions.md |
| 2024-12-20 | OpenAI-compatible embedding API    | Agnostic to provider, config-driven, matryoshka support | 12-technology-decisions.md |
| 2024-12-20 | OpenAI-compatible LLM API (future) | Gemini now, OpenRouter/local later, role-based routing  | 12-technology-decisions.md |

---

## Notes

Add freeform notes, ideas, and references here as we iterate.

```
TODO: Add notes as conversation progresses
```
