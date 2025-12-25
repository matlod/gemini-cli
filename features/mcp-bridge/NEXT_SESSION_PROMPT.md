# MCP Bridge + Memory System - Session Startup

## Quick Context

You're working on **two systems** in the gemini-cli project:

1. **MCP Bridge** (COMPLETE) - Lets Claude Code use Gemini as a subagent via
   MCP→A2A protocol
2. **Memory System** (ACTIVE) - Multi-agent orchestration fabric with persistent
   memory

---

## What to Read First

```bash
# Memory System (current focus) - START HERE
cat docs/memorysystem/SESSION_HANDOFF.md     # Latest session context
cat docs/memorysystem/INTEGRATION_NOTES.md   # Deep technical exploration

# Then if needed:
cat docs/memorysystem/02-memory-cores.md     # What we're building
cat docs/memorysystem/README.md              # Overall vision
```

---

## Latest Session Summary (2024-12-25)

### What We Discovered

We did a deep exploration of gemini-cli internals and found the **perfect
integration pattern**:

**The IDE Context Pattern:**

```typescript
// client.ts lines 499-511 - THIS IS OUR TEMPLATE
if (this.config.getIdeMode()) {
  this.getChat().addHistory({
    role: 'user',
    parts: [{ text: contextParts.join('\n') }], // Just a user message!
  });
}
```

This means we can inject memory core context the same way:

- Dynamic per-turn (semantic search based on user question)
- Gets compressed → key facts preserved
- Minimal code changes needed

### The Architecture

```
System Prompt (static, per-session):
├── Base prompt
├── GEMINI.md content
├── MCP instructions
└── Memory Core: Project context ← NEW

Per-Turn History (dynamic):
├── Initial setup (date, folder structure)
├── IDE context (files, cursor)
├── Memory Core: Relevant patterns ← NEW (semantic retrieval)
└── User messages + Model responses
```

### Minimal Integration

```typescript
// Just add after IDE context injection in client.ts ~line 511
if (this.config.getMemoryCoreManager()) {
  const context = await this.config
    .getMemoryCoreManager()
    .getRelevantContext(request); // Semantic search
  if (context) {
    this.getChat().addHistory({
      role: 'user',
      parts: [{ text: context }],
    });
  }
}
```

### What's Built vs. What's Needed

| Component             | Status                         |
| --------------------- | ------------------------------ |
| GEMINI.md discovery   | ✅ Built (gemini-cli)          |
| /memory commands      | ✅ Built (gemini-cli)          |
| ContextManager (JIT)  | ✅ Built (experimental)        |
| Hook system           | ✅ Built (gemini-cli)          |
| Compression           | ✅ Built (preserves key facts) |
| **MemoryCoreManager** | 📝 Design only                 |
| **LanceDB store**     | 📝 Design only                 |
| **Retrieval logic**   | 📝 Design only                 |

---

## Key Files (with line numbers)

| File                        | What                               | Key Lines      |
| --------------------------- | ---------------------------------- | -------------- |
| `client.ts`                 | IDE context pattern (our template) | 499-511        |
| `memoryDiscovery.ts`        | Memory refresh flow                | 558-582        |
| `config.ts`                 | getUserMemory/setUserMemory        | 1064-1069      |
| `geminiChat.ts`             | History management                 | 574-581        |
| `chatCompressionService.ts` | How compression works              | 32-38, 200-210 |

---

## Next Steps (Pick One)

1. **Prototype LanceDB store** - Get basic vector storage working
2. **Investigate hooks** - Can we inject via BeforeModelHook with zero core
   changes?
3. **Wire into system prompt** - Simplest MVP (static context only)
4. **Pick a real task** - Let requirements emerge from actual use

---

## MCP Bridge (COMPLETE - for reference)

```
Claude Code ──MCP (stdio)──▶ MCP Bridge ──HTTP──▶ A2A Server ──▶ Gemini API
                             (this pkg)           (packages/     (Pro/Flash)
                                                   a2a-server/)
```

**Status:** 141 tests passing, all features working.

**Key Features:** 9 MCP tools, session continuity, model selection, progress
notifications, tool approval flow.

**Files:** `src/index.ts`, `src/a2a-client.ts`

---

## Quick Commands

```bash
# See latest session handoff
cat docs/memorysystem/SESSION_HANDOFF.md

# See technical integration notes
cat docs/memorysystem/INTEGRATION_NOTES.md

# See the IDE context pattern (key insight)
sed -n '499,511p' packages/core/src/core/client.ts

# Memory system docs
ls docs/memorysystem/

# MCP bridge tests
cd features/mcp-bridge && npm test
```

---

## User Preferences

- Prefers organic, real-task-driven development
- Values minimal upstream changes
- Okay with experimentation
- May need refreshers (context gets cleared periodically)

---

_Last updated: 2024-12-25_
