# 01 - Architecture Overview

**Status:** Draft **Last Updated:** 2024-12-20

## System Layers

### Layer 1: Persistent Memory (Memory Cores)

Long-lived knowledge that survives across sessions, projects, and time.

```
Memory Cores
├── Technology Cores (e.g., "typescript-patterns", "mcp-lessons")
├── Project Cores (e.g., "gemini-cli-context", "acme-app-history")
├── Pattern Cores (e.g., "golden-auth-architecture", "api-design")
└── Personal Cores (e.g., "my-preferences", "team-conventions")
```

**Characteristics:**

- Curated, not just accumulated
- Rich metadata (tags, relationships, confidence, source)
- Versioned (knowledge evolves)
- Queryable via semantic search + graph traversal

### Layer 2: Working Memory (Task Context)

Task-scoped shared state that lives during a workflow.

```
Working Memory (per task set)
├── Task Graph (what's delegated, what's done, what's blocked)
├── Shared Context (decisions made, constraints discovered)
├── Agent Associations (which agent wrote what)
└── Completion Status (ready for review, needs rework, approved)
```

**Characteristics:**

- Created when orchestrator starts a task set
- Subagents read from and write to it
- Orchestrator monitors for completion
- Can be promoted to memory core after completion

### Layer 3: Orchestration

Coordination of async work across multiple agents.

```
Orchestration
├── Task Dispatch (delegate to right agent role)
├── Dependency Tracking (A must finish before B)
├── Completion Monitoring (poll for done, handle failures)
├── Review Triggers (send to QA when ready)
└── Human Injection Points (where nudges can land)
```

### Layer 4: Agent Execution

Individual agents doing work in isolated contexts.

```
Agent Worker
├── Role (dev, qa, researcher, librarian, analyst)
├── Own Worktree (isolated git branch/worktree)
├── Own Logs (full history of actions)
├── Checkpoint Capability (save state, can restore)
└── Non-destructive Operations (additive only)
```

### Layer 5: Human Oversight

Human watching, nudging, approving.

```
Human Interaction
├── Watch Mode (see what's happening across agents)
├── Nudge Injection (send message to specific agent's next turn)
├── Priority Override (pause this, focus on that)
├── Approval Gates (must approve before proceeding)
└── Course Correction (agent going off rails → redirect)
```

## Data Flow

```
1. Human initiates task
   └──▶ Orchestrator creates Working Memory
        └──▶ Queries Memory Cores for relevant context
             └──▶ Dispatches to Agent Workers
                  └──▶ Workers execute (with their own worktrees)
                       └──▶ Workers write results to Working Memory
                            └──▶ Orchestrator sees completion
                                 └──▶ Triggers review/next steps
                                      └──▶ Human can nudge at any point
```

## Key Interactions

### Current: Session Handoff (What We Have)

```
Session N writes SESSION_HANDOFF.md
Session N+1 reads SESSION_HANDOFF.md
└── Manual, single-threaded, loses context
```

### Future: Memory System (What We're Building)

```
Agent writes to Working Memory with associations
Other agents query Working Memory for context
Orchestrator tracks all, human can inject at any point
Completed work promotes to Memory Cores
└── Automatic, multi-threaded, context compounds
```

## Technology Stack (Decided)

| Component         | Technology    | Notes                                          |
| ----------------- | ------------- | ---------------------------------------------- |
| Vector + Metadata | **LanceDB**   | Embedded, Lance columnar format, hybrid search |
| Graph             | **LadybugDB** | Embedded, Cypher queries, ACID, formerly Kuzu  |
| Embeddings        | TBD           | Local (ollama) vs Cloud (OpenAI)               |
| File Storage      | Git-native    | Worktrees for agent isolation                  |
| IPC               | TBD           | Unix sockets, HTTP, or message queue           |
| Orchestration     | TBD           | Custom polling initially                       |

See [12-technology-decisions.md](./12-technology-decisions.md) for
implementation details.

## Interaction Patterns We Need to Support

Based on current workflow (Claude Code sessions):

1. **I'm working on X, need context from past work on similar things**
   - Query memory cores for related lessons/patterns
   - Inject into current context

2. **Delegate subtask to another agent, wait for completion**
   - Create task in working memory
   - Dispatch to worker
   - Monitor for completion
   - Retrieve results

3. **Human says "actually, do Y instead" mid-task**
   - Inject nudge into orchestrator or specific worker
   - Worker sees it on next turn
   - Adjusts course

4. **Something went wrong, need to restore to earlier state**
   - Worker has full log history
   - Can identify checkpoint to restore to
   - Additive restoration (not destructive revert)

5. **Task complete, save learnings for next time**
   - Extract key insights from working memory
   - Curate into memory core
   - Link to related knowledge

---

## Gaps & Open Questions

- [ ] How do we handle conflicting information in memory cores?
- [ ] What's the eviction/archival strategy for old working memory?
- [ ] How do agents discover each other's capabilities?
- [ ] What happens when orchestrator crashes mid-workflow?
- [ ] How do we version memory cores as knowledge evolves?
- [ ] What's the security model for multi-user scenarios?
- [ ] How do we handle large binary artifacts (models, datasets)?
- [ ] What's the sync story for distributed teams?
