# 05 - Orchestration

**Status:** Draft **Last Updated:** 2024-12-20

## Purpose

Coordinate async work across multiple agents with dynamic workflows, dependency
tracking, and human oversight integration.

## Core Concepts

### Task Graph

Tasks form a directed acyclic graph (DAG) with dependencies.

```
        ┌─────────────┐
        │   Design    │
        │   Schema    │
        └──────┬──────┘
               │
       ┌───────┴───────┐
       │               │
       ▼               ▼
┌─────────────┐ ┌─────────────┐
│  Implement  │ │   Write     │
│  Backend    │ │   Tests     │
└──────┬──────┘ └──────┬──────┘
       │               │
       └───────┬───────┘
               │
               ▼
        ┌─────────────┐
        │  Integration│
        │   Test      │
        └──────┬──────┘
               │
               ▼
        ┌─────────────┐
        │   Review    │
        └─────────────┘
```

```typescript
interface TaskGraph {
  tasks: Map<string, Task>;
  edges: Edge[];

  // Queries
  getReady(): Task[]; // No pending dependencies
  getBlocked(): Task[]; // Waiting on other tasks
  getInProgress(): Task[]; // Currently being worked
  getCriticalPath(): Task[]; // Longest dependency chain

  // Mutations
  addTask(task: Task): void;
  addDependency(from: string, to: string): void;
  completeTask(id: string): void;
  failTask(id: string, reason: string): void;
}
```

### Orchestrator Loop

The orchestrator runs a continuous loop:

```typescript
async function orchestratorLoop(workingMemory: WorkingMemory) {
  while (workingMemory.status === 'active') {
    // 1. Check for human nudges
    const nudges = await workingMemory.getPendingNudges();
    for (const nudge of nudges) {
      await handleNudge(nudge);
    }

    // 2. Check for completed tasks
    const completed = await workingMemory.getNewlyCompleted();
    for (const task of completed) {
      await handleCompletion(task);
    }

    // 3. Check for failed tasks
    const failed = await workingMemory.getFailedTasks();
    for (const task of failed) {
      await handleFailure(task);
    }

    // 4. Dispatch ready tasks
    const ready = await workingMemory.tasks.getReady();
    for (const task of ready) {
      if (!task.assigned) {
        await dispatchTask(task);
      }
    }

    // 5. Check for stuck tasks
    const stuck = await workingMemory.getStuckTasks();
    for (const task of stuck) {
      await handleStuck(task);
    }

    // 6. Brief pause before next iteration
    await sleep(pollInterval);
  }
}
```

### Task Dispatch

```typescript
async function dispatchTask(task: Task) {
  // 1. Select appropriate agent role
  const role = selectRoleForTask(task);

  // 2. Get or create agent
  const agent = await getOrCreateAgent(role);

  // 3. Prepare context
  const context = await prepareContext(task, workingMemory);

  // 4. Gather relevant memory core entries
  const memories = await queryMemoryCores(task);

  // 5. Assign task
  await workingMemory.assignTask(task.id, agent.id);

  // 6. Send to agent
  await agent.execute({
    task,
    context,
    memories,
    workingMemoryRef: workingMemory.id,
  });
}
```

### Completion Handling

```typescript
async function handleCompletion(task: Task) {
  const result = task.result;

  // 1. Record completion in working memory
  await workingMemory.recordCompletion(task.id, result);

  // 2. Check if needs review
  if (task.needsReview) {
    await scheduleReview(task);
    return;
  }

  // 3. Update dependent tasks
  const dependents = workingMemory.tasks.getDependents(task.id);
  for (const dep of dependents) {
    await checkIfReady(dep);
  }

  // 4. Check if workflow complete
  if (workingMemory.tasks.allComplete()) {
    await finalizeWorkflow();
  }

  // 5. Extract learnings for potential promotion
  await extractLearnings(task);
}
```

### Failure Handling

```typescript
async function handleFailure(task: Task) {
  const failure = task.failure;

  // 1. Record failure
  await workingMemory.recordFailure(task.id, failure);

  // 2. Determine strategy
  const strategy = determineFailureStrategy(failure);

  switch (strategy) {
    case 'retry':
      await retryTask(task);
      break;

    case 'reassign':
      await reassignTask(task, { differentAgent: true });
      break;

    case 'escalate':
      await escalateToHuman(task, failure);
      break;

    case 'skip':
      await skipTask(task);
      // May need to also skip dependents
      break;

    case 'abort':
      await abortWorkflow(failure);
      break;
  }
}
```

## Dynamic Workflow Evolution

Workflows aren't static. They evolve as work progresses.

### Task Discovery

Agents can discover new tasks during work:

```typescript
// Agent discovers new work needed
await workingMemory.suggestTask({
  title: 'Add migration for new column',
  description: 'Discovered need to add refresh_token column',
  reason: 'Required by token storage design',
  suggestedDependencies: ['design-schema'],
  suggestedDependents: ['implement-backend'],
});

// Orchestrator reviews and approves
await orchestrator.approveNewTask(suggestionId);
// Task graph updated dynamically
```

### Task Splitting

A task might be too big:

```typescript
// Agent realizes task is too large
await workingMemory.requestTaskSplit(taskId, {
  reason: 'Token service too complex for single task',
  suggestedSplits: [
    { title: 'Implement access token generation' },
    { title: 'Implement refresh token flow' },
    { title: 'Implement token validation' },
  ],
});
```

### Dependency Discovery

New dependencies might emerge:

```typescript
// Agent discovers dependency not in original plan
await workingMemory.addDiscoveredDependency({
  task: currentTaskId,
  dependsOn: 'some-other-task',
  reason: "Can't complete without the config module",
});
```

## Parallel Execution

Independent tasks run in parallel:

```
Time →
─────────────────────────────────────────────────────────────
Agent 1: ████ Design ████
Agent 2:                   ████ Implement Backend ████
Agent 3:                   ████ Write Tests ████████████████
Agent 4:                                            ████ QA ████
```

The orchestrator:

- Identifies independent task sets
- Assigns to available agents
- Monitors all concurrently
- Handles completions as they arrive

---

## Lessons Learned: Natural Orchestration Patterns

_These patterns emerged from reflecting on how documentation work was naturally
organized in DOCS_STRATEGY.md - a manual orchestration plan that revealed key
patterns._

### Pattern 1: Phased Execution with Review Checkpoints

Don't dispatch all tasks at once. Group into phases with human review between.

```typescript
interface Phase {
  id: string; // "phase-1", "phase-2"
  name: string; // "Foundation Alignment"
  tasks: Task[];

  // What must be true before this phase starts
  preconditions: PreconditionCheck[];

  // What must be reviewed before next phase
  reviewCheckpoint: ReviewCheckpoint;
}

interface ReviewCheckpoint {
  criteria: string[]; // Checklist items
  reviewer: 'human' | 'qa_agent' | 'auto';
  blocking: boolean; // Must pass before next phase
}

// Example from real orchestration:
const phases: Phase[] = [
  {
    id: 'phase-1',
    name: 'Foundation Alignment',
    tasks: [
      { id: 'P1-A', title: 'Update schema doc' },
      { id: 'P1-B', title: 'Update retrieval doc' },
      { id: 'P1-C', title: 'Create config doc' },
    ],
    preconditions: [
      { type: 'docs_exist', paths: ['12-technology-decisions.md'] },
    ],
    reviewCheckpoint: {
      criteria: [
        'Schema doc reflects LanceDB + LadybugDB',
        'Retrieval doc has concrete query examples',
        'Config schema is comprehensive',
        'No contradictions between docs',
      ],
      reviewer: 'human',
      blocking: true,
    },
  },
  {
    id: 'phase-2',
    name: 'Component Deep-Dive',
    tasks: [
      { id: 'P2-A', title: 'Enhance memory cores doc' },
      { id: 'P2-B', title: 'Enhance working memory doc' },
      // ...
    ],
    preconditions: [
      { type: 'phase_complete', phaseId: 'phase-1' },
      { type: 'checkpoint_passed', phaseId: 'phase-1' },
    ],
    reviewCheckpoint: {
      /* ... */
    },
  },
];
```

**Why this matters:** Catching issues between phases prevents error propagation.
Phase 2 work built on broken Phase 1 foundations wastes effort.

### Pattern 2: Task Instructions with Context Requirements

Each task needs explicit instructions AND what to read first.

```typescript
interface TaskInstructions {
  taskId: string;

  // What the agent must read before starting
  contextRequired: ContextRequirement[];

  // Specific actions to take
  actions: TaskAction[];

  // What success looks like
  expectedOutput: OutputSpec;

  // What NOT to do
  constraints: string[];
}

interface ContextRequirement {
  type: 'read_file' | 'query_memory' | 'check_state';
  target: string;
  reason: string; // Why this context matters
}

// Example from real task:
const taskInstructions: TaskInstructions = {
  taskId: 'P1-A',

  contextRequired: [
    {
      type: 'read_file',
      target: '12-technology-decisions.md',
      reason: 'Need LanceDB/LadybugDB context for schema updates',
    },
    {
      type: 'read_file',
      target: '10-data-schema.md',
      reason: 'Current state to understand what to change',
    },
  ],

  actions: [
    { action: 'remove', target: 'SQLite CREATE TABLE statements' },
    { action: 'add', content: 'LanceDB Pydantic models' },
    { action: 'add', content: 'LadybugDB Cypher DDL' },
    { action: 'keep', target: 'TypeScript interfaces' },
    { action: 'update', target: 'gaps section' },
  ],

  expectedOutput: {
    type: 'modified_file',
    path: '10-data-schema.md',
    mustContain: ['LanceModel', 'CREATE NODE TABLE'],
    mustNotContain: ['CREATE TABLE', 'sqlite'],
  },

  constraints: [
    'Do not remove TypeScript interfaces',
    'Preserve existing gap items, add new ones',
  ],
};
```

**Why this matters:** Agents with clear instructions and required context
produce consistent, predictable outputs. Vague instructions lead to drift.

### Pattern 3: Hierarchical Task IDs

Simple, hierarchical IDs enable easy tracking and reference.

```typescript
// Pattern: {Phase}-{Letter}
// P1-A, P1-B, P1-C  (Phase 1 tasks)
// P2-A, P2-B, P2-C, P2-D  (Phase 2 tasks)

interface TaskId {
  phase: number;
  sequence: string; // A, B, C, ...

  toString(): string; // "P1-A"

  // Relationships
  isInPhase(phase: number): boolean;
  dependsOn(): TaskId[];
}

// Benefits:
// - Immediately see which phase: "P2-B is blocked" → Phase 2 issue
// - Easy to reference in conversation: "Check P1-A output"
// - Natural ordering: P1 before P2
// - Parallel grouping visible: P1-A, P1-B, P1-C all in Phase 1
```

### Pattern 4: Progress Tracking Table

Maintain observable state for all tasks.

```typescript
interface ProgressTracker {
  entries: ProgressEntry[];

  update(taskId: string, status: TaskStatus, notes?: string): void;
  getByPhase(phase: number): ProgressEntry[];
  getBlocked(): ProgressEntry[];
  getInProgress(): ProgressEntry[];
}

interface ProgressEntry {
  phase: number;
  taskId: string;
  title: string;
  status:
    | 'pending'
    | 'in_progress'
    | 'blocked'
    | 'review'
    | 'complete'
    | 'failed';
  assignedAgent?: string;
  startedAt?: Date;
  completedAt?: Date;
  notes: string;
  blockedBy?: string[]; // Other task IDs
}

// Rendered as table for human visibility:
// | Phase | Task | Status | Agent | Notes |
// |-------|------|--------|-------|-------|
// | 1 | P1-A: Schema | complete | gemini-1 | Updated with LanceDB |
// | 1 | P1-B: Retrieval | in_progress | gemini-2 | Adding query examples |
// | 1 | P1-C: Config | pending | | Waiting for agent |
// | 2 | P2-A: Memory Cores | blocked | | Depends on P1-A, P1-B |
```

### Pattern 5: Partial Parallelism Within Phases

Not all tasks in a phase are independent. Some can run together, some must
sequence.

```typescript
interface PhaseExecution {
  parallel_groups: ParallelGroup[];
}

interface ParallelGroup {
  groupId: string;
  tasks: string[]; // Task IDs that can run together
  dependsOn?: string[]; // Previous group IDs that must complete
}

// Example from Phase 3:
const phase3Execution: PhaseExecution = {
  parallel_groups: [
    {
      groupId: 'P3-group-1',
      tasks: ['P3-A', 'P3-B'], // API Design + Bootstrap can run together
      dependsOn: [], // No internal dependencies
    },
    {
      groupId: 'P3-group-2',
      tasks: ['P3-C', 'P3-D'], // Orchestration + Human Interaction
      dependsOn: ['P3-group-1'], // Need API Design done first
    },
  ],
};

// Dispatch logic:
async function dispatchPhase(phase: PhaseExecution) {
  for (const group of phase.parallel_groups) {
    // Wait for dependencies
    await waitForGroups(group.dependsOn);

    // Dispatch all tasks in group simultaneously
    await Promise.all(group.tasks.map((taskId) => dispatchTask(taskId)));

    // Wait for this group to complete before next
    await waitForTasks(group.tasks);
  }
}
```

### Pattern 6: Review Checkpoint Criteria

Specific, verifiable checklist items - not vague "looks good".

```typescript
interface CheckpointCriteria {
  id: string;
  description: string;

  // How to verify
  verification: VerificationMethod;

  // Is this blocking?
  required: boolean;
}

type VerificationMethod =
  | { type: 'human_review' }
  | { type: 'file_contains'; path: string; patterns: string[] }
  | { type: 'file_not_contains'; path: string; patterns: string[] }
  | { type: 'files_consistent'; paths: string[]; check: string }
  | { type: 'agent_review'; role: 'qa' | 'analyst' };

// Example:
const phase1Checkpoint: CheckpointCriteria[] = [
  {
    id: 'schema-lancedb',
    description: 'Schema doc reflects LanceDB + LadybugDB',
    verification: {
      type: 'file_contains',
      path: '10-data-schema.md',
      patterns: ['LanceModel', 'CREATE NODE TABLE', 'LadybugDB'],
    },
    required: true,
  },
  {
    id: 'no-sqlite',
    description: 'No SQLite references remain',
    verification: {
      type: 'file_not_contains',
      path: '10-data-schema.md',
      patterns: ['CREATE TABLE', 'sqlite', 'SQLite'],
    },
    required: true,
  },
  {
    id: 'no-contradictions',
    description: 'No contradictions between docs',
    verification: { type: 'human_review' },
    required: true,
  },
];
```

### Pattern 7: Execution Commands as First-Class Output

Don't just describe what to do - provide the actual dispatch commands.

```typescript
interface ExecutionPlan {
  phases: PhaseExecutionPlan[];
}

interface PhaseExecutionPlan {
  phaseId: string;
  commands: DispatchCommand[];
  reviewCommand: ReviewCommand;
}

interface DispatchCommand {
  taskId: string;
  agentType: string;
  prompt: string; // Actual prompt to send
  parallel: boolean; // Can run with others
}

// Example output:
// Phase 1 Execution Commands:
//
// # Can run simultaneously via Gemini MCP
// Agent A: gemini_delegate_task({
//   task: "Update 10-data-schema.md: Read 12-technology-decisions.md first.
//          Remove SQLite schemas, add LanceDB Pydantic models and LadybugDB
//          Cypher DDL. Keep TypeScript interfaces.",
//   model: "pro"
// })
//
// Agent B: gemini_delegate_task({
//   task: "Update 08-retrieval-system.md: Read 12-technology-decisions.md first.
//          Replace generic examples with LanceDB .search() and LadybugDB Cypher
//          queries.",
//   model: "pro"
// })
```

### Pattern 8: Decision Logging with Rationale

Track decisions as they're made, not just final state.

```typescript
interface DecisionLog {
  entries: DecisionEntry[];

  record(decision: DecisionEntry): void;
  getByPhase(phase: string): DecisionEntry[];
  getAffecting(component: string): DecisionEntry[];
}

interface DecisionEntry {
  timestamp: Date;
  decision: string; // What was decided
  rationale: string; // Why
  alternatives?: string[]; // What was rejected
  affectedDocs: string[]; // Which docs to update
  madeBy: string; // Human or agent
  reversible: boolean;
}

// Example log:
// | Date | Decision | Rationale | Docs Updated |
// |------|----------|-----------|--------------|
// | 2024-12-20 | LanceDB for vectors | Embedded, serverless | 12-tech-decisions.md |
// | 2024-12-20 | LadybugDB for graph | Cypher, ACID | 12-tech-decisions.md |
// | 2024-12-20 | OpenAI-compatible API | Provider agnostic | 12-tech-decisions.md |

// Benefits:
// - Later phases/agents know WHY things are how they are
// - Can trace back when something seems wrong
// - Supports "undo" or "reconsider" workflows
```

### Pattern 9: Gap Tracking as Living Document

Maintain unknowns explicitly, update as work progresses.

```typescript
interface GapTracker {
  gaps: Gap[];

  add(gap: Gap): void;
  resolve(gapId: string, resolution: string): void;
  getByComponent(component: string): Gap[];
  getBlocking(): Gap[]; // Gaps that block work
}

interface Gap {
  id: string;
  component: string; // Which doc/area
  question: string; // The unknown
  status: 'open' | 'resolved' | 'wont_fix';
  blocking: boolean; // Does this block work?
  resolution?: string;
  resolvedAt?: Date;
}

// Pattern: Each doc has ## Gaps section at bottom
// Master gap doc (99-gaps-master.md) aggregates all
// Critical path gaps marked separately

// As decisions are made:
// - Update individual doc gaps
// - Update master gap doc
// - Mark blocking gaps as resolved
```

### Pattern 10: Context Building Before Task Dispatch

Orchestrator gathers context, doesn't assume agent will find it.

```typescript
async function prepareContextForTask(task: Task): Promise<TaskContext> {
  const context: TaskContext = {
    taskId: task.id,
    requiredReading: [],
    relevantDecisions: [],
    relatedGaps: [],
    previousOutputs: [],
  };

  // 1. Explicit dependencies from task definition
  for (const dep of task.contextRequired) {
    if (dep.type === 'read_file') {
      context.requiredReading.push({
        path: dep.target,
        reason: dep.reason,
        content: await readFile(dep.target), // Pre-fetch!
      });
    }
  }

  // 2. Decisions that affect this task
  context.relevantDecisions = decisionLog.getAffecting(task.component);

  // 3. Known gaps in this area
  context.relatedGaps = gapTracker.getByComponent(task.component);

  // 4. Outputs from dependent tasks
  for (const depTaskId of task.dependsOn) {
    const depTask = await getTask(depTaskId);
    if (depTask.status === 'complete') {
      context.previousOutputs.push({
        taskId: depTaskId,
        summary: depTask.result.summary,
        artifacts: depTask.result.artifacts,
      });
    }
  }

  return context;
}

// Agent receives FULL context, doesn't have to search for it
// This prevents:
// - Agent missing critical context
// - Agent reading stale versions
// - Inconsistent context across parallel agents
```

### Pattern 11: Output Specification with Validation

Define what success looks like, enable automated checking.

```typescript
interface OutputSpec {
  type: 'new_file' | 'modified_file' | 'report' | 'decision';

  // For files
  path?: string;

  // Validation rules
  mustContain?: string[]; // Required patterns
  mustNotContain?: string[]; // Forbidden patterns
  structureCheck?: StructureCheck; // Headings, sections

  // Quality gates
  minLength?: number;
  maxLength?: number;
  requiresGapsSection?: boolean;
}

interface StructureCheck {
  requiredSections: string[]; // e.g., ["## Purpose", "## Gaps"]
  allowedHeadingLevels: number[]; // e.g., [1, 2, 3]
}

// Automated validation after task completion:
async function validateOutput(task: Task): Promise<ValidationResult> {
  const spec = task.expectedOutput;
  const content = await readFile(spec.path);
  const issues: string[] = [];

  // Check required patterns
  for (const pattern of spec.mustContain || []) {
    if (!content.includes(pattern)) {
      issues.push(`Missing required content: ${pattern}`);
    }
  }

  // Check forbidden patterns
  for (const pattern of spec.mustNotContain || []) {
    if (content.includes(pattern)) {
      issues.push(`Contains forbidden content: ${pattern}`);
    }
  }

  // Check structure
  if (spec.structureCheck) {
    for (const section of spec.structureCheck.requiredSections) {
      if (!content.includes(section)) {
        issues.push(`Missing required section: ${section}`);
      }
    }
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}
```

### Pattern 12: Event-Driven Coordination

Instead of polling-based orchestration loop, use an event bus for reactive
coordination.

```typescript
interface EventBus {
  subscribe(event: WorkingMemoryEvent, handler: EventHandler): void;
  publish(event: WorkingMemoryEvent, payload: any): void;
  unsubscribe(event: WorkingMemoryEvent, handler: EventHandler): void;
}

type WorkingMemoryEvent =
  | 'task_completed'
  | 'task_failed'
  | 'task_blocked'
  | 'decision_made'
  | 'phase_transition'
  | 'checkpoint_evaluated'
  | 'gap_resolved'
  | 'nudge_received'
  | 'agent_idle';

// Event-driven orchestrator
class EventDrivenOrchestrator {
  constructor(
    private workingMemory: WorkingMemory,
    private eventBus: EventBus,
  ) {
    // Subscribe to relevant events
    eventBus.subscribe('task_completed', this.handleTaskCompleted.bind(this));
    eventBus.subscribe('task_failed', this.handleTaskFailed.bind(this));
    eventBus.subscribe('agent_idle', this.handleAgentIdle.bind(this));
    eventBus.subscribe('nudge_received', this.handleNudge.bind(this));
  }

  private async handleTaskCompleted(payload: {
    taskId: string;
    result: TaskResult;
  }) {
    const { taskId, result } = payload;

    // Record completion
    await this.workingMemory.recordCompletion(taskId, result);

    // Check if phase complete
    const phase = await this.workingMemory.getCurrentPhase();
    if (phase.tasks.every((t) => t.status === 'completed')) {
      this.eventBus.publish('phase_transition', { phaseId: phase.id });
    }

    // Unblock dependents
    const dependents = await this.workingMemory.tasks.getDependents(taskId);
    for (const dep of dependents) {
      if (await this.isReady(dep)) {
        this.eventBus.publish('agent_idle', { suggestedTask: dep.id });
      }
    }
  }

  private async handleAgentIdle(payload: {
    agentId: string;
    suggestedTask?: string;
  }) {
    // Find next task for idle agent
    const task = payload.suggestedTask
      ? await this.workingMemory.getTask(payload.suggestedTask)
      : await this.workingMemory.tasks.getNextReady();

    if (task) {
      await this.dispatchTask(task, payload.agentId);
    }
  }
}
```

**Why event-driven:**

- Eliminates polling overhead
- Immediate response to state changes
- Easier to add new event handlers
- Better for distributed orchestration
- Natural fit for async workflows

**Trade-offs:**

- More complex to debug (event traces needed)
- Event ordering can be tricky
- Need dead letter queue for failed handlers

### Pattern 13: Multi-Agent Checkpoint Coordination

Phase-wide snapshots that capture all agent states atomically for rollback.

```typescript
interface PhaseCheckpoint {
  id: string;
  phaseId: string;
  timestamp: Date;

  // Orchestrator state
  orchestratorState: {
    taskGraph: TaskGraph;
    decisions: Decision[];
    gaps: Gap[];
  };

  // All agent states
  agentCheckpoints: Map<string, AgentCheckpoint>;

  // Working memory snapshot
  workingMemorySnapshot: WorkingMemory;

  // Restore capability
  canRestore: boolean;
  restoreWarnings?: string[];
}

interface AgentCheckpoint {
  agentId: string;
  role: AgentRole;
  taskId: string;
  worktreeCheckpoint: {
    branch: string;
    commit: string;
    stashRef?: string;
  };
  logPosition: number;
}

async function createPhaseCheckpoint(phase: Phase): Promise<PhaseCheckpoint> {
  const agentCheckpoints = new Map<string, AgentCheckpoint>();

  // Request checkpoint from each active agent
  const activeAgents = await getAgentsInPhase(phase.id);
  await Promise.all(
    activeAgents.map(async (agent) => {
      const checkpoint = await requestAgentCheckpoint(agent.id);
      agentCheckpoints.set(agent.id, checkpoint);
    }),
  );

  // Snapshot orchestrator state
  const orchestratorState = {
    taskGraph: await workingMemory.tasks.snapshot(),
    decisions: await workingMemory.getDecisions(),
    gaps: await gapTracker.getAll(),
  };

  return {
    id: generateId(),
    phaseId: phase.id,
    timestamp: new Date(),
    orchestratorState,
    agentCheckpoints,
    workingMemorySnapshot: await workingMemory.snapshot(),
    canRestore: true,
  };
}

async function restorePhaseCheckpoint(
  checkpoint: PhaseCheckpoint,
): Promise<void> {
  // 1. Stop all agents
  await stopAllAgents();

  // 2. Restore each agent's worktree
  for (const [agentId, agentCheckpoint] of checkpoint.agentCheckpoints) {
    await restoreAgentWorktree(agentId, agentCheckpoint.worktreeCheckpoint);
  }

  // 3. Restore working memory
  await workingMemory.restore(checkpoint.workingMemorySnapshot);

  // 4. Restore orchestrator state
  await workingMemory.tasks.restore(checkpoint.orchestratorState.taskGraph);

  // 5. Resume agents
  await resumeAgents();
}
```

**Use cases:**

- Phase checkpoint failed → restore entire phase state
- Human requests "undo last phase"
- Recovery from orchestrator crash
- A/B testing different approaches (fork at checkpoint)

### Pattern 14: Role-Specific Validation

Different output validators per role - developers validate via tests, QA via
checklists.

```typescript
interface RoleValidator {
  role: AgentRole;
  validate(task: Task, output: any): Promise<ValidationResult>;
}

const roleValidators: Map<AgentRole, RoleValidator> = new Map([
  [
    'developer',
    {
      role: 'developer',
      async validate(task, output) {
        const issues: string[] = [];

        // Must have artifacts
        if (!output.artifacts || output.artifacts.length === 0) {
          issues.push('No artifacts produced');
        }

        // Run tests if code was modified
        if (output.artifacts?.some((a) => a.type === 'code')) {
          const testResult = await runTests(task.worktreePath);
          if (!testResult.passed) {
            issues.push(`Tests failed: ${testResult.failedCount} failures`);
          }
        }

        // Lint check
        const lintResult = await runLinter(task.worktreePath);
        if (lintResult.errors > 0) {
          issues.push(`Linter errors: ${lintResult.errors}`);
        }

        // Build check
        const buildResult = await runBuild(task.worktreePath);
        if (!buildResult.success) {
          issues.push(`Build failed: ${buildResult.error}`);
        }

        return { valid: issues.length === 0, issues };
      },
    },
  ],

  [
    'qa',
    {
      role: 'qa',
      async validate(task, output) {
        const issues: string[] = [];

        // Must have decision
        if (
          !output.decision ||
          !['approve', 'request_rework', 'reject'].includes(output.decision)
        ) {
          issues.push('Missing or invalid decision');
        }

        // Must have rationale
        if (!output.rationale || output.rationale.length < 50) {
          issues.push('Rationale too brief (min 50 chars)');
        }

        // If rejecting, must have specific issues
        if (
          output.decision === 'reject' &&
          (!output.issues || output.issues.length === 0)
        ) {
          issues.push('Rejection requires specific issues');
        }

        // Checklist completion
        if (task.checklist) {
          const unchecked = task.checklist.filter(
            (item) => !output.checkedItems?.includes(item.id),
          );
          if (unchecked.length > 0) {
            issues.push(
              `Unchecked items: ${unchecked.map((i) => i.label).join(', ')}`,
            );
          }
        }

        return { valid: issues.length === 0, issues };
      },
    },
  ],

  [
    'researcher',
    {
      role: 'researcher',
      async validate(task, output) {
        const issues: string[] = [];

        // Must have findings
        if (!output.findings || output.findings.length === 0) {
          issues.push('No findings reported');
        }

        // Must have sources
        if (!output.sources || output.sources.length === 0) {
          issues.push('No sources cited');
        }

        // Must answer the research question
        if (task.researchQuestion && !output.answer) {
          issues.push('Research question not answered');
        }

        return { valid: issues.length === 0, issues };
      },
    },
  ],

  [
    'librarian',
    {
      role: 'librarian',
      async validate(task, output) {
        const issues: string[] = [];

        // Entry operations must have valid entry
        if (task.type === 'curate_entry') {
          if (!output.entry || !output.entry.id) {
            issues.push('Invalid entry');
          }

          // No duplicates allowed
          const duplicates = await findDuplicates(output.entry);
          if (duplicates.length > 0) {
            issues.push(`Duplicate of: ${duplicates[0].id}`);
          }
        }

        return { valid: issues.length === 0, issues };
      },
    },
  ],
]);

// Dispatch validation based on role
async function validateTaskOutput(
  task: Task,
  output: any,
): Promise<ValidationResult> {
  const agent = await getAgent(task.assigned_to);
  const validator = roleValidators.get(agent.role);

  if (!validator) {
    // Default validation
    return { valid: true, issues: [] };
  }

  return validator.validate(task, output);
}
```

### Pattern 15: Cascading Priority Updates

Priority changes auto-promote blocking dependencies and log as decisions.

```typescript
interface PriorityUpdate {
  taskId: string;
  newPriority: number;
  reason: string;
  requestedBy: string; // Human or orchestrator
  cascadeToBlockers: boolean;
}

async function updatePriority(
  update: PriorityUpdate,
): Promise<PriorityUpdateResult> {
  const affectedTasks: string[] = [update.taskId];
  const originalPriorities: Map<string, number> = new Map();

  // Get current priority
  const task = await workingMemory.getTask(update.taskId);
  originalPriorities.set(task.id, task.priority);

  // Update target task
  await workingMemory.updateTaskPriority(update.taskId, update.newPriority);

  // Cascade to blockers if requested
  if (update.cascadeToBlockers) {
    const blockers = await getBlockingChain(update.taskId);

    for (const blocker of blockers) {
      originalPriorities.set(blocker.id, blocker.priority);

      // Promote blocker to at least the new priority
      if (blocker.priority < update.newPriority) {
        await workingMemory.updateTaskPriority(blocker.id, update.newPriority);
        affectedTasks.push(blocker.id);
      }
    }
  }

  // Check for priority inversion
  const inversions = await detectPriorityInversions();
  if (inversions.length > 0) {
    // Auto-fix inversions
    for (const inversion of inversions) {
      await workingMemory.updateTaskPriority(
        inversion.lowPriorityBlocker,
        inversion.highPriorityBlocked + 1,
      );
      affectedTasks.push(inversion.lowPriorityBlocker);
    }
  }

  // Log as decision
  await workingMemory.recordDecision({
    question: `Should task ${update.taskId} priority change to ${update.newPriority}?`,
    choice: 'Yes, with cascade',
    rationale: update.reason,
    alternatives: ['Change only target task', 'Reject priority change'],
    made_by: update.requestedBy,
    affects_tasks: affectedTasks,
    reversible: true,
    metadata: {
      type: 'priority_cascade',
      originalPriorities: Object.fromEntries(originalPriorities),
    },
  });

  return {
    success: true,
    affectedTasks,
    inversionsFixed: inversions.length,
    decision_id: decision.id,
  };
}

async function getBlockingChain(taskId: string): Promise<Task[]> {
  // Find all tasks that must complete before this one
  const blockers: Task[] = [];
  const visited = new Set<string>();

  async function traverse(id: string) {
    if (visited.has(id)) return;
    visited.add(id);

    const task = await workingMemory.getTask(id);
    for (const depId of task.depends_on) {
      const dep = await workingMemory.getTask(depId);
      if (dep.status !== 'completed') {
        blockers.push(dep);
        await traverse(depId);
      }
    }
  }

  await traverse(taskId);
  return blockers;
}

interface PriorityInversion {
  highPriorityBlocked: string; // High priority task waiting
  lowPriorityBlocker: string; // Low priority task blocking
  priorityGap: number;
}

async function detectPriorityInversions(): Promise<PriorityInversion[]> {
  const inversions: PriorityInversion[] = [];

  const blockedTasks = await workingMemory.tasks.getBlocked();
  for (const blocked of blockedTasks) {
    for (const blockerId of blocked.depends_on) {
      const blocker = await workingMemory.getTask(blockerId);
      if (
        blocker.status !== 'completed' &&
        blocker.priority < blocked.priority
      ) {
        inversions.push({
          highPriorityBlocked: blocked.id,
          lowPriorityBlocker: blocker.id,
          priorityGap: blocked.priority - blocker.priority,
        });
      }
    }
  }

  return inversions;
}
```

**Why cascading priority:**

- Prevents priority inversion deadlocks
- High-priority work automatically unblocks itself
- All priority changes logged as decisions (auditable)
- Can be reversed if needed (metadata stores originals)

### Pattern 16: Pre-Check Investigation

Before the main agent acts, run a read-only "investigator" pass using a
fast/cheap model to scan the codebase and inject relevant context.

```typescript
interface InvestigatorResult {
  relevantPatterns: CodePattern[]; // How we do similar things
  styleGuidelines: string[]; // Conventions to follow
  relatedCode: CodeSnippet[]; // Similar implementations
  potentialGotchas: string[]; // Known issues in this area
  suggestedApproach: string; // Recommendation based on context
}

interface InvestigatorConfig {
  maxSearchResults: number;
  includePatternDocs: boolean;
  includeTestExamples: boolean;
  contextTokenBudget: number;
}

async function runPreCheckInvestigation(
  task: Task,
  config: InvestigatorConfig,
): Promise<InvestigatorResult> {
  // 1. Semantic search for similar code patterns
  const relatedCode = await semanticSearch({
    query: task.description,
    types: ['code_snippet'],
    limit: config.maxSearchResults,
  });

  // 2. Find relevant patterns from memory cores
  const patterns = await findPatterns({
    concepts: extractConcepts(task.description),
    cores: ['common-patterns', task.projectCore],
  });

  // 3. Check for known gotchas in this area
  const gotchas = await findGotchas({
    files: task.affectedFiles,
    concepts: extractConcepts(task.description),
  });

  // 4. Get style guidelines for affected files
  const guidelines = await getStyleGuide(task.affectedFiles);

  // 5. Generate suggested approach (fast model)
  const approach = await fastModel.generate(`
    Given this task: ${task.description}

    Similar code in codebase:
    ${formatSnippets(relatedCode)}

    Relevant patterns:
    ${formatPatterns(patterns)}

    Known gotchas:
    ${gotchas.join('\n')}

    Suggest the best approach in 2-3 sentences.
  `);

  return {
    relevantPatterns: patterns,
    styleGuidelines: guidelines,
    relatedCode,
    potentialGotchas: gotchas,
    suggestedApproach: approach,
  };
}

// Inject into main agent's context
function buildAgentContext(
  task: Task,
  investigation: InvestigatorResult,
): string {
  return `
# PRE-CHECK INVESTIGATION RESULTS

## Suggested Approach
${investigation.suggestedApproach}

## Relevant Patterns (follow these)
${investigation.relevantPatterns.map((p) => `- ${p.name}: ${p.summary}`).join('\n')}

## Similar Code Examples
${investigation.relatedCode.map((c) => `### ${c.file}:${c.line}\n\`\`\`${c.language}\n${c.content}\n\`\`\``).join('\n\n')}

## Watch Out For
${investigation.potentialGotchas.map((g) => `- ⚠️ ${g}`).join('\n')}

## Style Guidelines
${investigation.styleGuidelines.map((s) => `- ${s}`).join('\n')}
  `;
}
```

**Why pre-check:**

- Prevents hallucinations by grounding in actual codebase patterns
- Reduces "reinventing the wheel" - finds existing solutions
- Cheap model does heavy lifting, expensive model gets clean context
- Surfaces gotchas before agent makes the mistake

### Pattern 17: Draft-Review-Commit Protocol

Three-phase write cycle: propose changes in memory, review against rules, commit
only if review passes.

```typescript
interface DraftChange {
  id: string;
  file: string;
  originalContent: string;
  proposedContent: string;
  description: string;
  agent: string;
}

interface ReviewResult {
  approved: boolean;
  issues: ReviewIssue[];
  suggestions: string[];
  ruleViolations: string[];
}

interface ReviewIssue {
  severity: 'error' | 'warning' | 'info';
  line?: number;
  message: string;
  rule?: string;
}

// The three phases
class DraftReviewCommit {
  private drafts: Map<string, DraftChange> = new Map();

  // Phase 1: DRAFT - Propose change, hold in memory
  async draft(change: Omit<DraftChange, 'id'>): Promise<string> {
    const id = generateId();
    this.drafts.set(id, { ...change, id });

    // Log the proposal
    await workingMemory.recordEvent({
      type: 'draft_proposed',
      draftId: id,
      file: change.file,
      agent: change.agent,
    });

    return id;
  }

  // Phase 2: REVIEW - Check against rules using fast model
  async review(draftId: string): Promise<ReviewResult> {
    const draft = this.drafts.get(draftId);
    if (!draft) throw new Error(`Draft ${draftId} not found`);

    const issues: ReviewIssue[] = [];
    const ruleViolations: string[] = [];

    // Check against governance rules
    const rules = await loadGovernanceRules();
    for (const rule of rules) {
      const violation = await checkRule(rule, draft);
      if (violation) {
        ruleViolations.push(violation);
        issues.push({
          severity: 'error',
          message: violation,
          rule: rule.name,
        });
      }
    }

    // Run linter/type checker on proposed content
    const lintResult = await lintContent(draft.proposedContent, draft.file);
    issues.push(...lintResult.issues);

    // Fast model review for patterns/style
    const aiReview = await fastModel.generate(`
      Review this code change for issues:

      FILE: ${draft.file}

      ORIGINAL:
      ${draft.originalContent}

      PROPOSED:
      ${draft.proposedContent}

      Check for:
      - Breaking changes
      - Security issues
      - Style inconsistencies
      - Missing error handling

      Output JSON: { issues: [], suggestions: [] }
    `);

    const parsed = JSON.parse(aiReview);
    issues.push(...parsed.issues);

    return {
      approved: issues.filter((i) => i.severity === 'error').length === 0,
      issues,
      suggestions: parsed.suggestions,
      ruleViolations,
    };
  }

  // Phase 3: COMMIT - Write to disk only if approved
  async commit(draftId: string, reviewResult: ReviewResult): Promise<boolean> {
    if (!reviewResult.approved) {
      await workingMemory.recordEvent({
        type: 'draft_rejected',
        draftId,
        issues: reviewResult.issues,
      });
      return false;
    }

    const draft = this.drafts.get(draftId);
    if (!draft) throw new Error(`Draft ${draftId} not found`);

    // Actually write the file
    await writeFile(draft.file, draft.proposedContent);

    // Record the commit
    await workingMemory.recordEvent({
      type: 'draft_committed',
      draftId,
      file: draft.file,
    });

    // Clean up
    this.drafts.delete(draftId);
    return true;
  }

  // Self-correction loop
  async draftReviewCommitLoop(
    change: Omit<DraftChange, 'id'>,
    maxAttempts: number = 3,
  ): Promise<boolean> {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const draftId = await this.draft(change);
      const review = await this.review(draftId);

      if (review.approved) {
        return await this.commit(draftId, review);
      }

      // Self-correct based on issues
      const correctedContent = await this.selfCorrect(
        change.proposedContent,
        review.issues,
      );
      change = { ...change, proposedContent: correctedContent };
    }

    return false; // Failed after max attempts
  }

  private async selfCorrect(
    content: string,
    issues: ReviewIssue[],
  ): Promise<string> {
    return await mainModel.generate(`
      Fix these issues in the code:

      ISSUES:
      ${issues.map((i) => `- [${i.severity}] ${i.message}`).join('\n')}

      CURRENT CODE:
      ${content}

      Output only the corrected code.
    `);
  }
}
```

**Why draft-review-commit:**

- Catches errors before they hit disk
- Self-correction loop reduces human intervention
- Audit trail of all proposed changes
- Governance rules enforced automatically

### Pattern 18: Failure Classification & Routing

When a tool fails, classify the error type to route the agent to the correct fix
path.

```typescript
type FailureType =
  | 'logic_error' // Code is wrong, fix the implementation
  | 'test_error' // Test is wrong/outdated, fix the test
  | 'env_error' // Environment issue (missing dep, wrong config)
  | 'type_error' // Type mismatch, fix types
  | 'style_error' // Lint/format issue, auto-fixable
  | 'timeout_error' // Operation too slow, optimize or increase limit
  | 'permission_error' // Access denied, escalate to human
  | 'unknown'; // Needs investigation

interface ClassifiedFailure {
  type: FailureType;
  confidence: number;
  evidence: string[];
  suggestedAction: FailureAction;
  affectedFiles: string[];
}

interface FailureAction {
  type: 'edit_code' | 'edit_test' | 'edit_config' | 'run_command' | 'escalate';
  target: string;
  suggestion: string;
}

async function classifyFailure(
  error: ToolError,
  context: TaskContext,
): Promise<ClassifiedFailure> {
  const evidence: string[] = [];

  // Pattern matching on error messages
  if (
    error.message.includes('expected') &&
    error.message.includes('received')
  ) {
    evidence.push('Assertion failure pattern detected');

    // Check if test expectations match current implementation
    const testFile = extractTestFile(error);
    const implFile = findImplementationFile(testFile);

    const testContent = await readFile(testFile);
    const implContent = await readFile(implFile);

    // Ask fast model to determine which is wrong
    const analysis = await fastModel.generate(`
      A test is failing. Determine if the bug is in the CODE or the TEST.

      TEST FILE (${testFile}):
      ${testContent}

      IMPLEMENTATION (${implFile}):
      ${implContent}

      ERROR:
      ${error.message}

      Output JSON: {
        bug_location: "test" | "code",
        confidence: 0-100,
        reason: "string"
      }
    `);

    const result = JSON.parse(analysis);
    evidence.push(result.reason);

    if (result.bug_location === 'test') {
      return {
        type: 'test_error',
        confidence: result.confidence / 100,
        evidence,
        suggestedAction: {
          type: 'edit_test',
          target: testFile,
          suggestion: `Update test expectations to match implementation`,
        },
        affectedFiles: [testFile],
      };
    } else {
      return {
        type: 'logic_error',
        confidence: result.confidence / 100,
        evidence,
        suggestedAction: {
          type: 'edit_code',
          target: implFile,
          suggestion: `Fix implementation to match expected behavior`,
        },
        affectedFiles: [implFile],
      };
    }
  }

  // Type errors
  if (
    error.message.includes('Type') &&
    error.message.includes('is not assignable')
  ) {
    return {
      type: 'type_error',
      confidence: 0.95,
      evidence: ['TypeScript type mismatch'],
      suggestedAction: {
        type: 'edit_code',
        target: extractFileFromError(error),
        suggestion: 'Fix type annotations or cast appropriately',
      },
      affectedFiles: [extractFileFromError(error)],
    };
  }

  // Environment errors
  if (
    error.message.includes('ENOENT') ||
    error.message.includes('MODULE_NOT_FOUND')
  ) {
    return {
      type: 'env_error',
      confidence: 0.9,
      evidence: ['Missing file or module'],
      suggestedAction: {
        type: 'run_command',
        target: 'npm install',
        suggestion: 'Install missing dependencies or create missing file',
      },
      affectedFiles: [],
    };
  }

  // Style errors (auto-fixable)
  if (error.source === 'eslint' || error.source === 'prettier') {
    return {
      type: 'style_error',
      confidence: 1.0,
      evidence: ['Linter/formatter error'],
      suggestedAction: {
        type: 'run_command',
        target: 'npm run lint:fix',
        suggestion: 'Auto-fix style issues',
      },
      affectedFiles: [extractFileFromError(error)],
    };
  }

  // Unknown - needs investigation
  return {
    type: 'unknown',
    confidence: 0.5,
    evidence: ['Could not classify error pattern'],
    suggestedAction: {
      type: 'escalate',
      target: 'human',
      suggestion: 'Manual investigation required',
    },
    affectedFiles: [],
  };
}

// Route to correct fix based on classification
async function routeFailureFix(
  failure: ClassifiedFailure,
  agent: Agent,
): Promise<Task> {
  const fixTask: Task = {
    id: generateId(),
    title: `Fix: ${failure.type}`,
    description: failure.suggestedAction.suggestion,
    status: 'pending',
    priority: 10, // High priority for fixes
    metadata: {
      failureType: failure.type,
      evidence: failure.evidence,
      confidence: failure.confidence,
    },
  };

  switch (failure.suggestedAction.type) {
    case 'edit_code':
    case 'edit_test':
      fixTask.assigned_to = agent.id; // Same agent fixes it
      fixTask.metadata.targetFile = failure.suggestedAction.target;
      break;

    case 'run_command':
      fixTask.title = `Run: ${failure.suggestedAction.target}`;
      fixTask.metadata.command = failure.suggestedAction.target;
      break;

    case 'escalate':
      fixTask.needs_review = true;
      fixTask.metadata.escalationReason = failure.evidence.join('; ');
      // Notify human
      await sendNudge({
        message: `Agent stuck on ${failure.type}: ${failure.evidence[0]}`,
        priority: 'high',
        target: 'orchestrator',
      });
      break;
  }

  return fixTask;
}
```

**Why failure classification:**

- Avoids "fix the test to pass the build" anti-pattern
- Routes agent to correct file (test vs implementation)
- Auto-fixes trivial issues (style, env)
- Escalates truly complex failures to humans

### Pattern 19: Topic-Based Context Compression

Instead of linear chat history, manage context as a database of topics that
expand/compress based on relevance.

```typescript
interface ContextTopic {
  id: string;
  name: string;
  status: 'active' | 'dormant' | 'archived';

  // Full content when active
  fullContext?: string;

  // Compressed when dormant
  summary: string;
  keyDecisions: string[];
  checklist: ChecklistItem[];

  // Metadata
  lastAccessedAt: Date;
  turnsSinceActive: number;
  tokenCount: number;
}

interface ChecklistItem {
  id: string;
  item: string;
  status: 'pending' | 'in_progress' | 'done';
}

interface ContextState {
  activeFocus: string;
  topics: Map<string, ContextTopic>;
  totalTokens: number;
  maxTokens: number;
}

class ContextCurator {
  constructor(
    private fastModel: Model,
    private state: ContextState,
  ) {}

  // Run periodically (every N turns) or when tokens near limit
  async curate(recentMessages: Message[]): Promise<void> {
    // 1. Identify topics in recent messages
    const topicsInMessages = await this.extractTopics(recentMessages);

    // 2. Update topic activity
    for (const topic of this.state.topics.values()) {
      if (topicsInMessages.includes(topic.id)) {
        topic.turnsSinceActive = 0;
        topic.lastAccessedAt = new Date();
        topic.status = 'active';
      } else {
        topic.turnsSinceActive++;
      }
    }

    // 3. Compress dormant topics (not discussed in 5+ turns)
    for (const topic of this.state.topics.values()) {
      if (topic.turnsSinceActive >= 5 && topic.status === 'active') {
        await this.compressTopic(topic);
      }
    }

    // 4. Archive old dormant topics
    for (const topic of this.state.topics.values()) {
      if (topic.turnsSinceActive >= 20 && topic.status === 'dormant') {
        topic.status = 'archived';
        // Save to long-term memory
        await this.archiveToMemoryCore(topic);
      }
    }

    // 5. Extract key decisions and checklist updates
    await this.updateKeyDecisions(recentMessages);
  }

  private async compressTopic(topic: ContextTopic): Promise<void> {
    if (!topic.fullContext) return;

    // Use fast model to compress
    const compression = await this.fastModel.generate(`
      Compress this context into a structured summary.

      FULL CONTEXT:
      ${topic.fullContext}

      Output JSON:
      {
        "summary": "1-2 sentence summary of net result",
        "keyDecisions": ["decision 1", "decision 2"],
        "checklist": [
          {"item": "task description", "status": "done|pending|in_progress"}
        ]
      }
    `);

    const parsed = JSON.parse(compression);
    topic.summary = parsed.summary;
    topic.keyDecisions = parsed.keyDecisions;
    topic.checklist = parsed.checklist;
    topic.status = 'dormant';

    // Clear full context to save tokens
    const savedTokens = topic.tokenCount;
    topic.fullContext = undefined;
    topic.tokenCount = this.countTokens(topic.summary);

    this.state.totalTokens -= savedTokens - topic.tokenCount;
  }

  // Restore a compressed topic to full detail
  async restoreTopic(topicId: string): Promise<ContextTopic> {
    const topic = this.state.topics.get(topicId);
    if (!topic) throw new Error(`Topic ${topicId} not found`);

    if (topic.status === 'archived') {
      // Retrieve from memory core
      const archived = await this.retrieveFromMemoryCore(topicId);
      topic.fullContext = archived.fullContext;
    }

    topic.status = 'active';
    topic.turnsSinceActive = 0;
    topic.lastAccessedAt = new Date();

    return topic;
  }

  // Render context for agent prompt
  renderForAgent(): string {
    const activeTopics = [...this.state.topics.values()].filter(
      (t) => t.status === 'active',
    );
    const dormantTopics = [...this.state.topics.values()].filter(
      (t) => t.status === 'dormant',
    );

    return `
# CURRENT CONTEXT STATE
**Focus:** ${this.state.activeFocus}

## Active Context (Detailed)
${activeTopics
  .map(
    (t) => `
### ${t.name}
${t.fullContext || t.summary}

**Key Decisions:**
${t.keyDecisions.map((d) => `- ${d}`).join('\n')}

**Checklist:**
${t.checklist.map((c) => `- [${c.status === 'done' ? 'x' : ' '}] ${c.item}`).join('\n')}
`,
  )
  .join('\n')}

## Dormant Context (Compressed)
${dormantTopics
  .map(
    (t) =>
      `- **${t.name}:** ${t.summary} *(ID: ${t.id} - use restore_context to expand)*`,
  )
  .join('\n')}

## Token Usage
Active: ${this.state.totalTokens} / ${this.state.maxTokens} tokens
    `;
  }

  private async extractTopics(messages: Message[]): Promise<string[]> {
    // Use fast model to identify which topics are being discussed
    const result = await this.fastModel.generate(`
      Which topics are being discussed in these messages?

      MESSAGES:
      ${messages.map((m) => m.content).join('\n\n')}

      KNOWN TOPICS:
      ${[...this.state.topics.keys()].join(', ')}

      Output JSON array of topic IDs: ["topic_id", ...]
    `);

    return JSON.parse(result);
  }

  private async updateKeyDecisions(messages: Message[]): Promise<void> {
    const decisions = await this.fastModel.generate(`
      Extract any KEY DECISIONS made in these messages.
      A key decision is an architectural choice, technology selection, or approach commitment.

      MESSAGES:
      ${messages.map((m) => m.content).join('\n\n')}

      Output JSON: [{"topic": "topic_id", "decision": "what was decided"}]
    `);

    for (const { topic: topicId, decision } of JSON.parse(decisions)) {
      const topic = this.state.topics.get(topicId);
      if (topic && !topic.keyDecisions.includes(decision)) {
        topic.keyDecisions.push(decision);
      }
    }
  }
}
```

**Why topic-based compression:**

- Infinite project memory without context window explosion
- Key decisions never lost in compression
- Agent can "open the file cabinet" to recall dormant topics
- Visual clarity - only see what's currently relevant
- Checklist items persist across compression cycles

---

## Checkpointing

Save workflow state for recovery:

```typescript
interface WorkflowCheckpoint {
  timestamp: Date;
  workingMemorySnapshot: WorkingMemory;
  taskStates: Map<string, TaskState>;
  agentStates: Map<string, AgentState>;

  // What triggered this checkpoint
  trigger: 'periodic' | 'before_risky_operation' | 'human_requested';
}

// Periodic checkpointing
setInterval(async () => {
  await saveCheckpoint('periodic');
}, checkpointInterval);

// Before risky operations
await saveCheckpoint('before_risky_operation');
await riskyOperation();
```

## Coordination Patterns

### Fork-Join

Multiple parallel tasks that must all complete:

```
         ┌─── Task A ───┐
Start ───┼─── Task B ───┼─── Join ─── Continue
         └─── Task C ───┘
```

```typescript
// Create fork-join structure
const forkJoin = createForkJoin({
  tasks: [taskA, taskB, taskC],
  joinTask: continueTask,
  joinCondition: 'all', // or 'any' or custom
});
```

### Pipeline

Sequential stages with handoff:

```
Stage 1 ──▶ Stage 2 ──▶ Stage 3
 (Dev)      (Test)      (QA)
```

### Saga

Long-running workflow with compensation:

```typescript
// Each step has a compensating action
const saga = createSaga([
  { action: createUser, compensate: deleteUser },
  { action: setupBilling, compensate: cancelBilling },
  { action: sendWelcome, compensate: null }, // Can't unsend
]);

// On failure, run compensations in reverse
```

## Human Injection Points

Where humans can intervene:

```typescript
interface InjectionPoint {
  // Before task starts
  beforeTask: (task: Task) => Promise<'proceed' | 'modify' | 'skip'>;

  // After task completes
  afterTask: (task: Task, result: Result) => Promise<'accept' | 'rework'>;

  // On failure
  onFailure: (task: Task, error: Error) => Promise<FailureStrategy>;

  // Anytime (async nudge)
  nudge: (message: string, target: string) => Promise<void>;

  // Priority override
  reprioritize: (taskIds: string[], priority: Priority) => Promise<void>;
}
```

## Metrics and Observability

Track orchestration health:

```typescript
interface OrchestrationMetrics {
  // Task metrics
  tasksTotal: number;
  tasksCompleted: number;
  tasksFailed: number;
  tasksInProgress: number;
  tasksBlocked: number;

  // Time metrics
  averageTaskDuration: number;
  longestRunningTask: Task;
  estimatedTimeToCompletion: number;

  // Agent metrics
  agentUtilization: Map<string, number>;
  agentsIdle: number;
  agentsBusy: number;

  // Health
  stuckTasks: Task[];
  blockedChains: Task[][]; // Tasks blocked by other blocked tasks
}
```

---

## Gaps & Open Questions

### Original Gaps

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

### New Gaps from Lessons Learned Reflection

**Phasing & Checkpoints:**

- [ ] How granular should phases be? (risk of too many checkpoints = slow)
- [ ] Can phases be skipped if preconditions are met another way?
- [ ] What's the rollback strategy if a phase checkpoint fails?
- [ ] How do we handle partial phase completion? (2/3 tasks done, 1 failed)

**Task Instructions:**

- [ ] How do we version task instruction templates?
- [ ] What if required context is too large for agent context window?
- [ ] How do we handle conflicting instructions from different sources?
- [ ] Should task instructions be stored in memory cores for reuse?

**Progress Tracking:**

- [ ] What's the persistence format for progress state?
- [ ] How do we handle progress state after orchestrator restart?
- [ ] Real-time vs polling for progress updates?
- [ ] How do we visualize blocked dependency chains?

**Validation:**

- [ ] Who writes the output specs? (Human? Orchestrator? Both?)
- [ ] How do we handle validation failures? (Auto-retry? Escalate?)
- [ ] Can agents self-validate before reporting complete?
- [ ] What's the validation strategy for creative/open-ended outputs?

**Context Building:**

- [ ] How do we cache pre-fetched context across parallel tasks?
- [ ] What's the context freshness guarantee? (stale context risk)
- [ ] How do we handle context conflicts? (two sources disagree)
- [ ] Token budget management when context is large?

**Meta-Orchestration:**

- [ ] Can orchestration patterns themselves be stored in memory cores?
- [ ] How do we learn from past orchestration runs? (improve future plans)
- [ ] Should the orchestrator consult memory cores for similar past workflows?
