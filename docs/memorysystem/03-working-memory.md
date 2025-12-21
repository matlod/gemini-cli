# 03 - Working Memory

**Status:** Draft **Last Updated:** 2024-12-20

## Purpose

Working memory is **task-scoped shared context** that enables coordination
between an orchestrator and multiple worker agents during a workflow.

## Lifecycle

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. CREATION                                                     │
│    Orchestrator starts a task set                               │
│    └── Creates working memory instance                          │
│    └── Populates with initial context from memory cores         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ 2. ACTIVE USE                                                   │
│    Subagents read context, write results                        │
│    Orchestrator monitors, human can inject                      │
│    └── Task graph evolves                                       │
│    └── Decisions accumulate                                     │
│    └── Completion status updates                                │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ 3. COMPLETION                                                   │
│    All tasks done or workflow cancelled                         │
│    └── Extract learnings for memory cores                       │
│    └── Archive or discard working memory                        │
└─────────────────────────────────────────────────────────────────┘
```

## Data Structure

```typescript
interface WorkingMemory {
  id: string;
  name: string;
  created_at: Date;
  status: 'active' | 'completed' | 'cancelled' | 'archived';

  // Initial context
  goal: string; // What we're trying to accomplish
  constraints: string[]; // Boundaries, requirements
  memory_core_refs: string[]; // Which cores provided context

  // Task tracking
  tasks: TaskNode[];
  task_graph: TaskGraph; // Dependencies between tasks

  // Shared state
  decisions: Decision[]; // Choices made during work
  discoveries: Discovery[]; // Things learned during work
  artifacts: Artifact[]; // Files, outputs produced

  // Agent associations
  agent_contributions: AgentContribution[];

  // Human interaction
  nudges: Nudge[]; // Human injections
  approvals: Approval[]; // Human sign-offs
}
```

### Task Tracking

```typescript
interface TaskNode {
  id: string;
  title: string;
  description: string;

  // Status
  status:
    | 'pending'
    | 'assigned'
    | 'in_progress'
    | 'blocked'
    | 'review'
    | 'completed'
    | 'failed'
    | 'cancelled';

  // Assignment
  assigned_to?: string; // Agent ID
  assigned_at?: Date;

  // Dependencies
  depends_on: string[]; // Task IDs that must complete first
  blocks: string[]; // Task IDs waiting on this

  // Results
  result?: TaskResult;
  completed_at?: Date;

  // Review
  needs_review: boolean;
  reviewed_by?: string;
  review_status?: 'approved' | 'needs_rework' | 'rejected';
}

interface TaskGraph {
  nodes: Map<string, TaskNode>;
  edges: Array<{ from: string; to: string; type: 'depends_on' | 'blocks' }>;

  // Computed views
  ready(): TaskNode[]; // Tasks with all deps satisfied
  blocked(): TaskNode[]; // Tasks waiting on others
  inProgress(): TaskNode[]; // Currently being worked
  needsReview(): TaskNode[]; // Completed, awaiting review
}
```

### Shared State

```typescript
interface Decision {
  id: string;
  made_at: Date;
  made_by: string; // Agent or human

  question: string; // What was decided
  choice: string; // What was chosen
  alternatives: string[]; // What was rejected
  rationale: string; // Why this choice

  affects_tasks: string[]; // Which tasks this impacts
  reversible: boolean;
}

interface Discovery {
  id: string;
  discovered_at: Date;
  discovered_by: string;

  content: string; // What was learned
  type: 'constraint' | 'opportunity' | 'risk' | 'insight';

  affects_tasks: string[];
  promote_to_core?: string; // Suggested memory core
}

interface Artifact {
  id: string;
  created_at: Date;
  created_by: string;

  type: 'file' | 'code' | 'document' | 'config' | 'test';
  path: string; // Where it lives
  description: string;

  associated_task: string;
  version: number;
  checksum: string;
}
```

### Agent Contributions

```typescript
interface AgentContribution {
  agent_id: string;
  agent_role: AgentRole;

  // What this agent did
  tasks_completed: string[];
  decisions_made: string[];
  discoveries: string[];
  artifacts_created: string[];

  // Timestamps
  first_contribution: Date;
  last_contribution: Date;

  // For debugging/review
  log_ref: string; // Link to agent's full log
}
```

## Operations

### Orchestrator Operations

```typescript
// Create working memory for a task set
const wm = await workingMemory.create({
  name: 'Implement auth system',
  goal: 'Add JWT authentication to the API',
  constraints: ['Must use existing user table', 'No breaking changes'],
  memoryCores: ['auth-jwt', 'acme-app'],
});

// Add initial tasks
await wm.addTask({
  title: 'Design token schema',
  description: 'Define JWT claims and refresh token structure',
});

// Monitor for ready tasks
const ready = await wm.tasks.ready();

// Dispatch to worker
await wm.assignTask(taskId, agentId);

// Check what's done
const needsReview = await wm.tasks.needsReview();
```

### Worker Operations

```typescript
// Worker reads context for their task
const context = await wm.getContextForTask(taskId);
// Returns: goal, constraints, relevant decisions, discoveries, related artifacts

// Worker reports progress
await wm.updateTaskStatus(taskId, 'in_progress');

// Worker records a decision
await wm.recordDecision({
  question: 'Which JWT library to use?',
  choice: 'jose',
  alternatives: ['jsonwebtoken', 'jwt-simple'],
  rationale: 'jose is more modern, has better TypeScript support',
  affects_tasks: [taskId],
});

// Worker discovers something
await wm.recordDiscovery({
  content: "Existing user table has no 'refresh_token' column",
  type: 'constraint',
  affects_tasks: [taskId, otherTaskId],
});

// Worker creates artifact
await wm.recordArtifact({
  type: 'code',
  path: 'src/auth/token-service.ts',
  description: 'JWT token generation and validation',
  associated_task: taskId,
});

// Worker completes task
await wm.completeTask(taskId, {
  summary: 'Implemented token service with RS256 signing',
  next_steps: ['Add middleware', 'Write tests'],
});
```

### Human Operations

```typescript
// Human injects a nudge
await wm.injectNudge({
  target: 'agent-123', // Or 'orchestrator' or 'all'
  message: 'Actually, use HS256 for this internal service',
  priority: 'normal',
});

// Human approves a decision
await wm.approve(decisionId);

// Human reviews completed task
await wm.reviewTask(taskId, {
  status: 'approved',
  comments: 'Looks good, proceed',
});
```

## Persistence

Working memory needs to survive:

- Agent restarts
- Network issues
- Human taking a break

```typescript
// Options for persistence
interface PersistenceConfig {
  backend: 'file' | 'sqlite' | 'redis' | 'postgres';

  // For file backend
  path?: string; // e.g., .working-memory/

  // Auto-save
  saveInterval?: number; // ms between saves
  saveOnChange?: boolean; // Save after each mutation
}
```

## Promotion to Memory Cores

After workflow completes, extract valuable learnings:

```typescript
// Automated extraction
const candidates = await wm.extractLearningCandidates();

// Returns things like:
// - Decisions with clear rationale
// - Discoveries marked as insights
// - Patterns in successful task completions

// Human or Librarian reviews and promotes
for (const candidate of candidates) {
  if (shouldPromote(candidate)) {
    await memoryCores.addEntry(candidate.suggestedCore, candidate.asEntry());
  }
}

// Archive working memory
await wm.archive();
```

## Example Flow

```
Human: "Build auth system for the API"

1. Orchestrator creates Working Memory
   - Goal: "Build auth system for the API"
   - Queries memory cores: auth-jwt, acme-app
   - Creates initial tasks based on pattern

2. Orchestrator assigns "Design token schema" to Dev Agent

3. Dev Agent reads context, discovers constraint
   - Records: "User table has no refresh_token column"
   - Decides: "Add migration to add column"
   - Updates task status

4. Human injects nudge: "Don't modify user table, use separate token table"

5. Dev Agent sees nudge on next turn
   - Updates decision with new rationale
   - Adjusts approach

6. Dev Agent completes task
   - Creates artifact: schema/tokens.sql
   - Marks ready for review

7. Orchestrator sees completion
   - Assigns to QA Agent for review

8. QA approves, Orchestrator continues with next tasks
```

---

## Gaps & Open Questions

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
