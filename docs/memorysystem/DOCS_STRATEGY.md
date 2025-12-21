# Documentation Strategy - Parallel Subagent Work

**Purpose:** Organize doc updates into phases that subagents can work on in
parallel, with review checkpoints between phases.

---

## Phase Overview

```
Phase 1: Foundation Alignment (parallel)
    │
    ▼ [REVIEW CHECKPOINT]
    │
Phase 2: Component Deep-Dive (parallel)
    │
    ▼ [REVIEW CHECKPOINT]
    │
Phase 3: Integration & API (parallel)
    │
    ▼ [REVIEW CHECKPOINT]
    │
Phase 4: Gemini Pro Review (parallel)
    │
    ▼ [FINAL REVIEW]
    │
Ready for Prototyping
```

---

## Phase 1: Foundation Alignment

**Goal:** Update docs that are stale due to technology decisions (LanceDB,
LadybugDB, OpenAI-compatible APIs).

**Can run in parallel:** Yes - these docs don't depend on each other.

| Task ID | Doc                       | Work Required                                                      | Output                |
| ------- | ------------------------- | ------------------------------------------------------------------ | --------------------- |
| P1-A    | 10-data-schema.md         | Replace SQLite with LanceDB Pydantic models + LadybugDB Cypher DDL | Updated schema doc    |
| P1-B    | 08-retrieval-system.md    | Add concrete LanceDB search + LadybugDB traversal examples         | Updated retrieval doc |
| P1-C    | 13-configuration.md (NEW) | Full memory-config.yaml schema - storage, embeddings, llm, github  | New config doc        |

**Subagent Instructions:**

```
P1-A: Update 10-data-schema.md
- Read: 12-technology-decisions.md (for LanceDB/LadybugDB context)
- Remove: SQLite CREATE TABLE statements
- Add: LanceDB Pydantic models (MemoryEntry, CodeSnippet, WorkingMemoryEntry)
- Add: LadybugDB Cypher CREATE NODE/REL TABLE statements
- Keep: TypeScript interfaces (they're implementation-agnostic)
- Update gaps section

P1-B: Update 08-retrieval-system.md
- Read: 12-technology-decisions.md
- Replace generic examples with LanceDB .search() and LadybugDB Cypher
- Add: Hybrid query patterns (semantic + graph)
- Add: Matryoshka embedding usage example
- Update technology section to reference 12-technology-decisions.md
- Update gaps section

P1-C: Create 13-configuration.md
- Read: 12-technology-decisions.md (embeddings, llm sections)
- Create comprehensive memory-config.yaml schema
- Sections: storage, embeddings, llm, github, codebase_registry, defaults
- Add: Environment variable interpolation (${VAR})
- Add: Validation rules
- Add: Example configs (minimal, full, team)
- Add gaps section
```

**Review Checkpoint 1:**

- [ ] Schema doc reflects LanceDB + LadybugDB
- [ ] Retrieval doc has concrete query examples
- [ ] Config schema is comprehensive
- [ ] No contradictions between docs

---

## Phase 2: Component Deep-Dive

**Goal:** Flesh out component docs with more detail now that foundations are
solid.

**Can run in parallel:** Yes - independent components.

**Depends on:** Phase 1 complete (config schema needed for some)

| Task ID | Doc                  | Work Required                                           | Output       |
| ------- | -------------------- | ------------------------------------------------------- | ------------ |
| P2-A    | 02-memory-cores.md   | Expand golden path integration, code_refs examples      | Enhanced doc |
| P2-B    | 03-working-memory.md | Add LadybugDB task graph examples, state machine        | Enhanced doc |
| P2-C    | 11-code-index.md     | Add GitHub PAT config, AST parsing details, tree-sitter | Enhanced doc |
| P2-D    | 04-agent-roles.md    | Add concrete system prompts per role, capability matrix | Enhanced doc |

**Subagent Instructions:**

```
P2-A: Enhance 02-memory-cores.md
- Read: 11-code-index.md, 12-technology-decisions.md
- Add: How memory entries link to golden paths
- Add: code_refs field usage with LadybugDB REFERENCES_CODE relationship
- Add: Curation workflow with Librarian agent
- Add: Example of promoting working memory insight to core
- Expand bootstrap strategy section

P2-B: Enhance 03-working-memory.md
- Read: 12-technology-decisions.md, 05-orchestration.md
- Add: Task graph stored in LadybugDB (Cypher examples)
- Add: State machine diagram for task lifecycle
- Add: Concurrent write handling
- Add: Working memory → memory core promotion flow
- Add: Archival strategy

P2-C: Enhance 11-code-index.md
- Read: 13-configuration.md (from Phase 1)
- Add: GitHub PAT configuration section
- Add: Tree-sitter for AST parsing (language support table)
- Add: Incremental indexing algorithm
- Add: Code embedding chunking strategy (by function, by file, etc.)
- Add: Example codebase registry entries

P2-D: Enhance 04-agent-roles.md
- Read: 03-working-memory.md, 06-human-interaction.md
- Add: Full system prompt template per role
- Add: Tool/capability access matrix (which tools each role can use)
- Add: Escalation paths between roles
- Add: Performance metrics per role
```

**Review Checkpoint 2:**

- [ ] Memory cores clearly link to code index
- [ ] Working memory has concrete LadybugDB examples
- [ ] Code index has GitHub integration details
- [ ] Agent roles have actionable system prompts

---

## Phase 3: Integration & API

**Goal:** Define how components work together, API surface, bootstrap process.

**Can run in parallel:** Partially - some dependencies.

**Depends on:** Phase 2 complete

| Task ID | Doc                     | Work Required                                  | Depends On |
| ------- | ----------------------- | ---------------------------------------------- | ---------- |
| P3-A    | 14-api-design.md (NEW)  | Python/TS API surface for memory system        | P1, P2     |
| P3-B    | 15-bootstrap.md (NEW)   | How to initialize, import existing knowledge   | P2-A       |
| P3-C    | 05-orchestration.md     | Add concrete task dispatch with working memory | P2-B       |
| P3-D    | 06-human-interaction.md | Add nudge injection implementation details     | P2-D       |

**Subagent Instructions:**

```
P3-A: Create 14-api-design.md
- Read: All component docs (02-11)
- Define: Python API classes and methods
  - MemorySystem (main entry point)
  - MemoryCores (query, add, link, curate)
  - WorkingMemory (create, update, complete)
  - CodeIndex (search, index, golden_paths)
  - Agents (create, dispatch, monitor)
- Define: TypeScript API (if different)
- Add: Usage examples for common workflows
- Add: Error handling patterns
- Add gaps section

P3-B: Create 15-bootstrap.md
- Read: 02-memory-cores.md, 11-code-index.md
- Define: First-run initialization process
- Add: Import from existing sources:
  - Markdown files (SESSION_HANDOFF.md style)
  - Git history (extract decisions from commits)
  - Existing codebases
- Add: Memory core templates (quick start)
- Add: Validation and health check
- Add gaps section

P3-C: Enhance 05-orchestration.md
- Read: 03-working-memory.md, 04-agent-roles.md
- Add: Concrete task dispatch implementation
- Add: LadybugDB queries for dependency resolution
- Add: Failure recovery scenarios
- Add: Metrics collection points

P3-D: Enhance 06-human-interaction.md
- Read: 04-agent-roles.md, 05-orchestration.md
- Add: Nudge injection implementation (where in agent loop)
- Add: Watch mode UI mockup (ASCII)
- Add: Notification channel configuration
- Add: Priority override implementation
```

**Review Checkpoint 3:**

- [ ] API design covers all major operations
- [ ] Bootstrap process is clear and actionable
- [ ] Orchestration ties together components
- [ ] Human interaction has implementation details

---

## Phase 4: Gemini Pro Review

**Goal:** Get Gemini 2.0 Pro's opinions on each doc via MCP bridge.

**Can run in parallel:** Yes - all docs independent.

**Depends on:** Phase 3 complete

| Task ID | Input Doc                   | Output Doc                              | Prompt Focus                   |
| ------- | --------------------------- | --------------------------------------- | ------------------------------ |
| P4-01   | 01-architecture-overview.md | 01-architecture-overview-suggestions.md | Architecture gaps, scalability |
| P4-02   | 02-memory-cores.md          | 02-memory-cores-suggestions.md          | Knowledge modeling, quality    |
| P4-03   | 03-working-memory.md        | 03-working-memory-suggestions.md        | Concurrency, state management  |
| P4-04   | 04-agent-roles.md           | 04-agent-roles-suggestions.md           | Role design, prompting         |
| P4-05   | 05-orchestration.md         | 05-orchestration-suggestions.md         | Reliability, recovery          |
| P4-06   | 06-human-interaction.md     | 06-human-interaction-suggestions.md     | UX, timing                     |
| P4-07   | 07-worktree-checkpoints.md  | 07-worktree-checkpoints-suggestions.md  | Git edge cases                 |
| P4-08   | 08-retrieval-system.md      | 08-retrieval-system-suggestions.md      | Search quality, performance    |
| P4-09   | 09-logging-observability.md | 09-logging-observability-suggestions.md | Debugging, ops                 |
| P4-10   | 10-data-schema.md           | 10-data-schema-suggestions.md           | Schema evolution, migrations   |
| P4-11   | 11-code-index.md            | 11-code-index-suggestions.md            | Scale, freshness               |
| P4-12   | 12-technology-decisions.md  | 12-technology-decisions-suggestions.md  | Tech tradeoffs                 |
| P4-13   | 13-configuration.md         | 13-configuration-suggestions.md         | Usability, defaults            |
| P4-14   | 14-api-design.md            | 14-api-design-suggestions.md            | Ergonomics, patterns           |
| P4-15   | 15-bootstrap.md             | 15-bootstrap-suggestions.md             | Onboarding, imports            |

**Gemini Review Prompt Template:**

```
Read the following documentation file for a multi-agent memory system.

After reading, write suggestions to a new file. Focus on:
1. Missing considerations or edge cases
2. Potential implementation challenges
3. Alternative approaches worth considering
4. Questions that should be answered before implementation
5. Connections to other components that might be missing

Be specific and actionable. Reference line numbers or sections when relevant.

File to review:
[CONTENT OF ##-topic.md]
```

**Review Checkpoint 4:**

- [ ] All suggestion files generated
- [ ] Suggestions reviewed by human
- [ ] Key suggestions incorporated into main docs
- [ ] 99-gaps-master.md updated with new gaps discovered

---

## Execution Commands

### Phase 1 (Parallel)

```bash
# Can run simultaneously via Gemini MCP
Agent A: "Update 10-data-schema.md per P1-A instructions"
Agent B: "Update 08-retrieval-system.md per P1-B instructions"
Agent C: "Create 13-configuration.md per P1-C instructions"
```

### Phase 2 (Parallel)

```bash
# Can run simultaneously
Agent A: "Enhance 02-memory-cores.md per P2-A instructions"
Agent B: "Enhance 03-working-memory.md per P2-B instructions"
Agent C: "Enhance 11-code-index.md per P2-C instructions"
Agent D: "Enhance 04-agent-roles.md per P2-D instructions"
```

### Phase 3 (Partial Parallel)

```bash
# P3-A and P3-B can run together
# P3-C and P3-D can run together after P3-A/B
Agent A: "Create 14-api-design.md per P3-A instructions"
Agent B: "Create 15-bootstrap.md per P3-B instructions"

# After A/B complete:
Agent C: "Enhance 05-orchestration.md per P3-C instructions"
Agent D: "Enhance 06-human-interaction.md per P3-D instructions"
```

### Phase 4 (Fully Parallel)

```bash
# All 15 reviews can run simultaneously
for doc in 01 02 03 04 05 06 07 08 09 10 11 12 13 14 15; do
  gemini_delegate_task: "Review $doc-*.md and write suggestions"
done
```

---

## Progress Tracking

| Phase | Task                    | Status       | Agent  | Notes                                          |
| ----- | ----------------------- | ------------ | ------ | ---------------------------------------------- |
| 1     | P1-A: Schema            | **complete** | Claude | LanceDB Pydantic + LadybugDB Cypher DDL        |
| 1     | P1-B: Retrieval         | **complete** | Claude | Concrete examples, matryoshka, hybrid patterns |
| 1     | P1-C: Config            | **complete** | Claude | Full memory-config.yaml schema                 |
| 2     | P2-A: Memory Cores      | pending      |        |                                                |
| 2     | P2-B: Working Memory    | pending      |        |                                                |
| 2     | P2-C: Code Index        | pending      |        |                                                |
| 2     | P2-D: Agent Roles       | pending      |        |                                                |
| 3     | P3-A: API Design        | pending      |        |                                                |
| 3     | P3-B: Bootstrap         | pending      |        |                                                |
| 3     | P3-C: Orchestration     | pending      |        |                                                |
| 3     | P3-D: Human Interaction | pending      |        |                                                |
| 4     | P4-\*: Gemini Reviews   | pending      |        |                                                |

---

## File Naming Convention

- Main docs: `##-topic.md` (e.g., `02-memory-cores.md`)
- Suggestion docs: `##-topic-suggestions.md` (e.g.,
  `02-memory-cores-suggestions.md`)
- Strategy: `DOCS_STRATEGY.md` (this file)
- Gaps: `99-gaps-master.md`
