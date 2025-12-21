# MCP Bridge + Memory System - Session Startup

## Quick Context

You're working on **two systems** in the gemini-cli project:

1. **MCP Bridge** (COMPLETE) - Lets Claude Code use Gemini as a subagent via
   MCP→A2A protocol
2. **Memory System** (IN PROGRESS) - Multi-agent orchestration fabric with
   persistent memory

---

## What to Read First

```bash
# Memory System (current focus)
cat docs/memorysystem/README.md             # Vision & architecture
cat docs/memorysystem/DOCS_STRATEGY.md      # Phased work plan with progress
cat docs/memorysystem/05-orchestration.md   # 15 orchestration patterns (core!)
cat docs/memorysystem/12-technology-decisions.md  # Tech stack decisions

# MCP Bridge (complete, for reference)
cat features/mcp-bridge/SESSION_HANDOFF.md  # Full technical context
```

---

## Memory System Overview

**Purpose:** Multi-agent orchestration fabric with persistent memory.

**Architecture:**

```
┌─────────────────────────────────────────────────────────────────┐
│                        Human Oversight                          │
│  (nudges, approvals, course corrections, priority changes)      │
└─────────────────────────────────────┬───────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Orchestration Layer                        │
│  - 15 patterns for task coordination                            │
│  - Phased execution with review checkpoints                     │
└───────────┬─────────────────────────────────────────┬───────────┘
            │                                         │
            ▼                                         ▼
┌───────────────────────┐                 ┌───────────────────────┐
│    Working Memory     │◄───────────────►│    Agent Workers      │
│  (per-task context)   │   read/write    │  (roles: QA, dev,     │
│  LadybugDB task graph │                 │   researcher, etc.)   │
└───────────┬───────────┘                 └───────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────────────┐
│                       Memory Cores                              │
│  LanceDB (vectors + metadata) + LadybugDB (graph)               │
│  - Lessons learned, patterns, golden paths                      │
└─────────────────────────────────────────────────────────────────┘
```

### Technology Stack (DECIDED)

| Component         | Technology            | Purpose                          |
| ----------------- | --------------------- | -------------------------------- |
| Vector + Metadata | **LanceDB**           | Semantic search, Pydantic models |
| Graph             | **LadybugDB**         | Relationships, Cypher queries    |
| Embeddings        | **OpenAI-compatible** | ollama, vLLM, SGLang, etc.       |
| Embedding trick   | **Matryoshka**        | Fast search → full rerank        |

### Documentation Status

| Phase | Status       | Tasks                                                                       |
| ----- | ------------ | --------------------------------------------------------------------------- |
| 1     | **COMPLETE** | Schema (10), Retrieval (08), Config (13)                                    |
| 2     | Pending      | Memory Cores (02), Working Memory (03), Code Index (11), Agent Roles (04)   |
| 3     | Pending      | API Design (14), Bootstrap (15), Orchestration (05), Human Interaction (06) |
| 4     | Pending      | Gemini Pro reviews of all docs                                              |

### Key Files

| File                                      | Purpose               | Lines of Interest                  |
| ----------------------------------------- | --------------------- | ---------------------------------- |
| `README.md`                               | Vision, doc index     | Architecture diagram               |
| `DOCS_STRATEGY.md`                        | Work plan             | Progress table, phase instructions |
| `05-orchestration.md`                     | **Core!** 15 patterns | Patterns 1-15 with full TypeScript |
| `10-data-schema.md`                       | LanceDB + LadybugDB   | Pydantic models, Cypher DDL        |
| `08-retrieval-system.md`                  | Query examples        | Semantic, graph, hybrid patterns   |
| `12-technology-decisions.md`              | Tech decisions        | Config examples, query patterns    |
| `13-configuration.md`                     | Full config schema    | memory-config.yaml spec            |
| `analysis/FULL_ORCHESTRATION_ANALYSIS.md` | Subagent findings     | 7 agent analysis, new gaps         |
| `16-future-ideas.md`                      | Advanced patterns     | Constitution, smart tools, UX      |

### 19 Orchestration Patterns (in 05-orchestration.md)

1. **Phased Execution** - Group tasks into phases with review checkpoints
2. **Task Instructions** - Context requirements + expected output specs
3. **Hierarchical Task IDs** - P1-A, P2-B pattern for easy tracking
4. **Progress Tracking** - Observable state table
5. **Partial Parallelism** - Groups within phases, with dependencies
6. **Review Checkpoint Criteria** - Verifiable checklist items
7. **Execution Commands** - Actual dispatch commands as output
8. **Decision Logging** - Track choices with rationale
9. **Gap Tracking** - Living document of unknowns
10. **Context Building** - Pre-fetch before dispatch
11. **Output Validation** - mustContain/mustNotContain specs
12. **Event-Driven Coordination** - Event bus instead of polling
13. **Multi-Agent Checkpoints** - Phase-wide atomic snapshots
14. **Role-Specific Validation** - Validators per agent role
15. **Cascading Priority** - Auto-promote blockers, log as decisions
16. **Pre-Check Investigation** - Fast model scans codebase before main agent
    acts
17. **Draft-Review-Commit** - Three-phase write with self-correction loop
18. **Failure Classification** - Route errors to correct fix (test vs code)
19. **Topic-Based Compression** - Context as database of active/dormant topics

### Future Ideas (in 16-future-ideas.md)

**Safety & Governance:**

- Constitution governance file (hard-coded rules)
- Validated write with auto-lint
- Synchronous interceptor middleware
- Immutability lock for refactoring

**Smart Tools:**

- Windowed file reader (preserve tokens)
- Pattern finder ("how do we do X here?")
- External doc fetching (npm/pypi/mdn)

**Context Management:**

- Token budget manager (proactive compression)
- Automatic gotcha injection (surface past failures)

**UX:**

- Live watch mode dashboard
- Undo stack (beyond git)
- Crash recovery state persistence
- Spec enforcer init flow

---

## MCP Bridge Overview (COMPLETE)

**Purpose:** Let Claude Code use Gemini as a subagent.

```
Claude Code ──MCP (stdio)──▶ MCP Bridge ──HTTP──▶ A2A Server ──▶ Gemini API
                             (this pkg)           (packages/     (Pro/Flash)
                                                   a2a-server/)
```

**Status:** 141 tests passing, all features working.

**Key Features:**

- 9 MCP tools for Gemini interaction
- Session continuity (taskId/contextId)
- Model selection (flash vs pro)
- Progress notifications during streaming
- Tool approval flow (autoExecute: false)

**Files:**

- `src/index.ts` - MCP server + tools
- `src/a2a-client.ts` - HTTP client for A2A
- `SESSION_HANDOFF.md` - Full technical details

---

## Quick Commands

```bash
# Working directories
cd /home/matlod1/Documents/AI/modcli/gemini-cli

# Memory system docs
ls docs/memorysystem/

# MCP bridge
cd features/mcp-bridge && npm test  # 141 tests

# Start A2A server (if needed)
CODER_AGENT_PORT=41242 USE_CCPA=true npm run start -w packages/a2a-server
```

---

## Next Steps (Pick One)

### Option A: Phase 2 - Component Deep-Dive

Enhance these docs with more detail:

- P2-A: `02-memory-cores.md` - Golden path integration, code_refs
- P2-B: `03-working-memory.md` - LadybugDB task graph, state machine
- P2-C: `11-code-index.md` - GitHub PAT, tree-sitter, incremental indexing
- P2-D: `04-agent-roles.md` - System prompts, capability matrix

See `DOCS_STRATEGY.md` for detailed instructions per task.

### Option B: Apply Subagent Findings

The `analysis/FULL_ORCHESTRATION_ANALYSIS.md` has suggested additions for each
component doc. Apply them.

### Option C: Start Prototyping

Begin implementing the memory system based on the documentation.

### Option D: Gemini Reviews (Phase 4)

Use the MCP bridge to have Gemini review each doc and write suggestions.

---

## Critical Implementation Details

### Session Continuity (MCP Bridge)

Everything must be on the **message object**:

```typescript
params: {
  message: {
    taskId: "...",     // HERE
    contextId: "...",  // HERE
    metadata: { ... }  // HERE
  }
}
```

### LanceDB + LadybugDB Split

| Data          | LanceDB                | LadybugDB           |
| ------------- | ---------------------- | ------------------- |
| Content       | Full text + embeddings | ID + key props only |
| Relationships | -                      | All edges           |
| Queries       | Semantic search        | Graph traversal     |

Entry ID is the join key. Writes go to both.

### Matryoshka Search

```python
# Stage 1: Fast search with 256 dims
candidates = table.search(embed(query, dim=256)).limit(100)

# Stage 2: Rerank with full 768 dims
reranked = rerank(candidates, embed(query, dim=768))
```

---

## Common Gotchas

| Issue                    | Solution                                                 |
| ------------------------ | -------------------------------------------------------- |
| MCP tools not appearing  | Restart Claude Code, use `.mcp.json` not `settings.json` |
| A2A server not reachable | Start with command above                                 |
| Session not found        | Sessions are in-memory, lost on restart                  |
| Gemini doesn't remember  | taskId must be ON message object                         |

---

## Files Changed (Uncommitted)

All `docs/memorysystem/` files are new and uncommitted:

- 16 markdown files
- Ready for review and commit

---

## Test Structure (MCP Bridge)

| File                  | Tests | What                         |
| --------------------- | ----- | ---------------------------- |
| `index.test.ts`       | 45    | Tool definitions, formatting |
| `integration.test.ts` | 7     | Real API calls               |
| `a2a-client.test.ts`  | 28    | HTTP client                  |
| `mcp-tools.test.ts`   | 30    | Tool schemas                 |
| `scenarios.test.ts`   | 31    | Usage scenarios              |

---

## Git Status

```bash
# Current branch: main
# Uncommitted: docs/memorysystem/ (16 files)
# Recent commits: tool approval fix, progress notifications, model selection
```

---

---

## Session Summary

**What was built:**

- 19 orchestration patterns covering the full agent lifecycle
- 12+ future ideas for advanced features
- Complete LanceDB + LadybugDB data schemas
- Full configuration schema (memory-config.yaml)
- Topic-based context compression system
- Pre-check → Main → Review "sandwich" architecture

**Key innovations:**

- Topic compression: Active/dormant/archived with key decisions preserved
- Failure classification: Route errors to correct fix (test vs code)
- Draft-Review-Commit: Self-correction loop with governance rules
- Automatic gotcha injection: Surface past failures before they repeat

**Ready for:** Phase 2 (component deep-dive), prototyping, or real project work

---

_Last updated: 2024-12-21_
