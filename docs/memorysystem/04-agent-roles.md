# 04 - Agent Roles

**Status:** Draft **Last Updated:** 2024-12-20

## Purpose

Define specialized agent roles with distinct capabilities, responsibilities, and
behaviors. Roles enable the right agent to handle the right task.

## Core Roles

### Orchestrator / Manager

**Responsibility:** Coordinate workflows, delegate tasks, track progress, handle
escalations.

```typescript
interface OrchestratorRole {
  name: 'orchestrator';

  capabilities: [
    'create_working_memory',
    'decompose_tasks',
    'assign_tasks',
    'monitor_progress',
    'trigger_reviews',
    'handle_escalations',
    'inject_context',
  ];

  does_not: [
    'execute_tasks_directly', // Delegates instead
    'write_code', // Uses dev agents
    'make_architectural_decisions', // Facilitates, doesn't decide
  ];
}
```

**Behaviors:**

- Breaks down high-level goals into actionable tasks
- Assigns tasks to appropriate worker agents
- Monitors working memory for completions
- Routes completed work to reviewers
- Handles blocked tasks (reassign, escalate, skip)
- Injects relevant context from memory cores
- Responds to human nudges by adjusting priorities

**Example prompts it handles:**

- "Build an authentication system" → Decomposes and delegates
- "What's the status of the current work?" → Reports from working memory
- "Prioritize security review" → Adjusts task ordering

### Developer

**Responsibility:** Write code, implement features, fix bugs.

```typescript
interface DeveloperRole {
  name: 'developer';

  capabilities: [
    'read_code',
    'write_code',
    'run_tests',
    'run_builds',
    'commit_changes',
    'read_memory_cores',
    'write_to_working_memory',
  ];

  constraints: [
    'own_worktree_only', // Can't touch others' worktrees
    'non_destructive_git', // No force push, no hard reset
    'must_have_tests', // For significant changes
    'must_follow_patterns', // From memory cores
  ];
}
```

**Behaviors:**

- Works in isolated worktree
- Queries memory cores for relevant patterns
- Records decisions and discoveries
- Creates artifacts (code files)
- Maintains checkpoint history
- Reports completion with summary

### QA / Reviewer

**Responsibility:** Validate work quality, catch issues, approve or request
rework.

```typescript
interface QARole {
  name: 'qa';

  capabilities: [
    'read_code',
    'run_tests',
    'review_artifacts',
    'approve_tasks',
    'request_rework',
    'write_review_comments',
    'read_memory_cores',
  ];

  does_not: [
    'write_code', // Only reviews
    'make_changes', // Requests changes instead
  ];

  reviews_against: [
    'task_requirements',
    'coding_standards', // From memory cores
    'security_checklist',
    'test_coverage',
  ];
}
```

**Behaviors:**

- Reviews completed tasks against requirements
- Checks for common issues from memory cores
- Approves or requests rework with specific feedback
- Flags potential security/performance issues
- Updates working memory with review status

### Researcher

**Responsibility:** Gather context, find relevant information, explore unknowns.

```typescript
interface ResearcherRole {
  name: 'researcher';

  capabilities: [
    'search_memory_cores',
    'traverse_knowledge_graph',
    'search_web',
    'read_documentation',
    'summarize_findings',
    'write_to_working_memory',
  ];

  does_not: [
    'write_code',
    'make_decisions', // Provides info for others to decide
  ];
}
```

**Behaviors:**

- Queries memory cores for related lessons
- Explores knowledge graph for connections
- Searches external resources if needed
- Summarizes findings in structured format
- Adds discoveries to working memory

**Example tasks:**

- "Find all past lessons about JWT implementation"
- "What patterns have we used for API versioning?"
- "Research best practices for X"

### Librarian

**Responsibility:** Curate memory cores, maintain knowledge quality.

```typescript
interface LibrarianRole {
  name: 'librarian';

  capabilities: [
    'read_memory_cores',
    'write_memory_cores',
    'create_entries',
    'link_entries',
    'merge_duplicates',
    'update_metadata',
    'flag_stale_content',
    'improve_tagging',
  ];

  responsibilities: [
    'knowledge_quality',
    'deduplication',
    'relationship_discovery',
    'freshness_maintenance',
  ];
}
```

**Behaviors:**

- Periodically scans for duplicate knowledge
- Discovers and creates links between entries
- Flags outdated or stale entries
- Improves tagging and categorization
- Promotes learnings from working memory
- Merges or supersedes conflicting entries

### Analyst

**Responsibility:** Review completed work with historical context, extract
insights.

```typescript
interface AnalystRole {
  name: 'analyst';

  capabilities: [
    'read_working_memory',
    'read_memory_cores',
    'compare_to_history',
    'identify_patterns',
    'suggest_improvements',
    'write_reports',
  ];

  outputs: [
    'retrospective_reports',
    'pattern_observations',
    'improvement_suggestions',
    'learning_candidates',
  ];
}
```

**Behaviors:**

- Reviews completed workflows
- Compares to past similar work
- Identifies what went well/poorly
- Suggests process improvements
- Extracts candidates for memory cores

## Role Assignment

How does the orchestrator choose which role for a task?

```typescript
interface TaskRoleMapping {
  // Task type to role mapping
  implement_feature: 'developer';
  fix_bug: 'developer';
  write_tests: 'developer';
  review_code: 'qa';
  security_review: 'qa';
  find_context: 'researcher';
  curate_knowledge: 'librarian';
  post_mortem: 'analyst';
}

// Or more sophisticated matching
function selectAgentForTask(task: Task): AgentRole {
  // Consider task requirements
  // Consider agent availability
  // Consider agent past performance on similar tasks
  // Consider workload balancing
}
```

## Agent Capabilities Matrix

| Capability            | Orchestrator | Developer | QA  | Researcher | Librarian | Analyst |
| --------------------- | ------------ | --------- | --- | ---------- | --------- | ------- |
| Create working memory | ✅           |           |     |            |           |         |
| Assign tasks          | ✅           |           |     |            |           |         |
| Write code            |              | ✅        |     |            |           |         |
| Run tests             |              | ✅        | ✅  |            |           |         |
| Approve tasks         |              |           | ✅  |            |           |         |
| Search memory cores   | ✅           | ✅        | ✅  | ✅         | ✅        | ✅      |
| Write memory cores    |              |           |     |            | ✅        |         |
| Own worktree          |              | ✅        |     |            |           |         |
| Git operations        |              | ✅        |     |            |           |         |
| Web search            |              |           |     | ✅         |           |         |

## Agent Instantiation

```typescript
// Create agent with specific role
const devAgent = await createAgent({
  role: 'developer',
  id: 'dev-001',
  worktree: '/worktrees/dev-001',
  logPath: '/logs/dev-001.log',
  workingMemoryRef: wm.id,
});

// Agent has role-specific system prompt
const systemPrompt = generateSystemPrompt({
  role: devAgent.role,
  capabilities: getRoleCapabilities('developer'),
  constraints: getRoleConstraints('developer'),
  context: await wm.getContextForAgent(devAgent.id),
});
```

## Role-Specific System Prompts

Each role gets a tailored system prompt:

```typescript
const developerSystemPrompt = `
You are a Developer agent working on: ${task.title}

Your capabilities:
- Read and write code in your worktree: ${worktree}
- Run tests and builds
- Query memory cores for patterns and lessons

Your constraints:
- Only work in your assigned worktree
- Never use destructive git commands (force push, hard reset)
- Follow patterns from memory cores when available
- Record decisions with clear rationale
- Report discoveries that might help others

Current context:
${workingMemoryContext}

Relevant patterns from memory cores:
${relevantPatterns}
`;
```

## Multi-Agent Communication

Agents don't talk directly to each other. They communicate through working
memory.

```
Developer writes → Working Memory ← Orchestrator reads
                                  ← QA reads (for review)
                                  ← Analyst reads (post-mortem)
```

This keeps interactions explicit, observable, and auditable.

---

## Gaps & Open Questions

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
