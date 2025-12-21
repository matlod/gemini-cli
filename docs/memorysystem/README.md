# Memory System Architecture

**Status:** Planning **Last Updated:** 2024-12-21

## Vision

A multi-agent orchestration fabric with persistent memory, enabling:

- Reusable knowledge across projects (don't start from scratch)
- Coordinated async workflows with human oversight
- Organic evolution of tasks as work progresses
- Non-destructive history with additive restoration

## Document Index

| Doc                                                       | Component                        | Status      |
| --------------------------------------------------------- | -------------------------------- | ----------- |
| [01-architecture-overview](./01-architecture-overview.md) | System design                    | Draft       |
| [02-memory-cores](./02-memory-cores.md)                   | Persistent knowledge bases       | Draft       |
| [03-working-memory](./03-working-memory.md)               | Task-scoped shared context       | Draft       |
| [04-agent-roles](./04-agent-roles.md)                     | Role definitions                 | Draft       |
| [05-orchestration](./05-orchestration.md)                 | Task coordination                | Draft       |
| [06-human-interaction](./06-human-interaction.md)         | Nudges, injection, oversight     | Draft       |
| [07-worktree-checkpoints](./07-worktree-checkpoints.md)   | Git worktrees, history           | Draft       |
| [08-retrieval-system](./08-retrieval-system.md)           | Semantic + graph search          | Draft       |
| [09-logging-observability](./09-logging-observability.md) | Agent logs, debugging            | Draft       |
| [10-data-schema](./10-data-schema.md)                     | Core data models                 | Draft       |
| [11-code-index](./11-code-index.md)                       | Codebase indexing + golden paths | Draft       |
| [12-technology-decisions](./12-technology-decisions.md)   | LanceDB + LadybugDB              | **Decided** |
| [13-configuration](./13-configuration.md)                 | Full config schema               | **Draft**   |
| [14-api-design](./14-api-design.md)                       | Python/TS API surface            | Phase 3     |
| [15-bootstrap](./15-bootstrap.md)                         | Init & import process            | Phase 3     |
| [16-future-ideas](./16-future-ideas.md)                   | Advanced patterns & UX ideas     | **Draft**   |
| [99-gaps-master](./99-gaps-master.md)                     | Consolidated open questions      | Draft       |
| [DOCS_STRATEGY](./DOCS_STRATEGY.md)                       | Parallel subagent work plan      | **Active**  |

## Key Principles

1. **Non-destructive** - Never lose work, always additive
2. **Observable** - Every agent has logs, every decision is traceable
3. **Human-in-the-loop** - Nudges inject at the right moment
4. **Organic** - Workflows evolve as tasks complete
5. **Reusable** - Knowledge compounds across projects
6. **Code-linked** - Knowledge points to real code, not duplicates

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Human Oversight                          │
│  (nudges, approvals, course corrections, priority changes)      │
└─────────────────────────────┬───────────────────────────────────┘
                              │ inject into right context
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Orchestration Layer                        │
│  - Task graphs, async coordination, checklist management        │
│  - Delegates to workers, tracks completion, triggers reviews    │
└───────────┬─────────────────────────────────────────┬───────────┘
            │                                         │
            ▼                                         ▼
┌───────────────────────┐                 ┌───────────────────────┐
│    Working Memory     │◄───────────────►│    Agent Workers      │
│  (per-task context)   │   read/write    │  (roles: QA, dev,     │
│  - shared state       │                 │   researcher, etc.)   │
│  - task associations  │                 │  - own worktree       │
│  - completion status  │                 │  - own logs           │
└───────────┬───────────┘                 └───────────────────────┘
            │
            │ query for context
            ▼
┌─────────────────────────────────────────────────────────────────┐
│                       Memory Cores                              │
│  - Lessons learned (by technology, project, pattern)            │
│  - Golden paths pointing to indexed code                        │
│  - Rich metadata + graph relationships                          │
│  - Semantic search + graph traversal                            │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ references
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                       Code Index                                │
│  - Private repos (via GitHub PAT)                               │
│  - Curated reference codebases (SOTA examples)                  │
│  - Semantic search across all indexed code                      │
│  - Golden paths = curated walkthroughs of patterns              │
└─────────────────────────────────────────────────────────────────┘
```

## Quick Start (Future)

```bash
# Start memory system
memory-system start

# Create a new task set with orchestrator
memory-system task create "Build authentication system" \
  --with-memory-core "auth-patterns" \
  --with-memory-core "project-acme-context"

# Watch orchestration
memory-system watch --task-id abc123
```

---

## Gaps & Open Questions (README-level)

- [ ] What's the deployment model? Local-first? Server? Both?
- [ ] How do we bootstrap the first memory cores?
- [ ] What's the migration path from current session handoffs?
- [ ] License/IP considerations for shared memory cores?
