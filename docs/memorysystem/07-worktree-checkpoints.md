# 07 - Worktree Checkpoints

**Status:** Draft **Last Updated:** 2024-12-20

## Purpose

Give each agent an isolated workspace with full history. Enable non-destructive
operations and additive restoration. Agents can always recover, never lose work.

## Git Worktree Model

Each agent gets their own git worktree - an isolated working directory tied to a
branch.

```
main-repo/
├── .git/                     # Shared git database
├── src/                      # Main working directory
└── ...

worktrees/
├── dev-001/                  # Agent dev-001's worktree
│   ├── src/                  # Their own copy
│   └── ...
├── dev-002/                  # Agent dev-002's worktree
│   ├── src/
│   └── ...
└── qa-001/                   # QA agent's worktree
    └── ...
```

### Setup

```bash
# Create worktree for new agent
git worktree add worktrees/dev-001 -b agent/dev-001

# Agent works in their directory
cd worktrees/dev-001
# Make changes, commits, etc.

# Clean up when agent done
git worktree remove worktrees/dev-001
```

### Benefits

1. **Isolation** - Agents can't stomp on each other
2. **Full History** - Every change is tracked
3. **Easy Branching** - Each agent on own branch
4. **Shared Objects** - Efficient storage (git dedupes)
5. **Standard Tooling** - Use any git client

## Agent Git Operations

Agents have restricted git capabilities:

```typescript
interface AgentGitCapabilities {
  // Allowed
  status: true;
  diff: true;
  add: true;
  commit: true;
  log: true;
  show: true;
  branch_list: true;
  stash: true;
  stash_pop: true;

  // Restricted (need orchestrator approval)
  merge: 'needs_approval';
  rebase: 'needs_approval';
  cherry_pick: 'needs_approval';

  // Forbidden
  push_force: false;
  reset_hard: false;
  clean_force: false;
  branch_delete: false;
}
```

### Non-Destructive Principle

Agents NEVER destroy history. Instead:

```typescript
// ❌ NEVER: Destructive operations
git reset --hard HEAD~3
git push --force
git clean -fd

// ✅ ALWAYS: Additive operations
git revert <commit>           // Creates new commit undoing changes
git commit --fixup <commit>   // Mark for future squash
git stash                     // Save for later
```

## Checkpoint System

Explicit save points agents can return to.

```typescript
interface Checkpoint {
  id: string;
  created_at: Date;
  created_by: string; // Agent ID

  // Git state
  branch: string;
  commit: string;
  worktree_path: string;

  // Context
  task_id: string;
  description: string;
  trigger: 'manual' | 'periodic' | 'before_risky' | 'milestone';

  // Working state
  staged_changes: string[];
  unstaged_changes: string[];
  stash_ref?: string; // If dirty state was stashed
}
```

### Creating Checkpoints

```typescript
// Agent creates checkpoint before risky operation
async function createCheckpoint(opts: {
  description: string;
  trigger: CheckpointTrigger;
}): Promise<Checkpoint> {
  const checkpoint: Checkpoint = {
    id: generateId(),
    created_at: new Date(),
    created_by: currentAgent.id,
    branch: await git.currentBranch(),
    commit: await git.head(),
    worktree_path: currentAgent.worktree,
    task_id: currentTask.id,
    description: opts.description,
    trigger: opts.trigger,
    staged_changes: await git.stagedFiles(),
    unstaged_changes: await git.unstagedFiles(),
  };

  // Stash dirty state if any
  if (checkpoint.unstaged_changes.length > 0) {
    checkpoint.stash_ref = await git.stash(`checkpoint-${checkpoint.id}`);
  }

  await saveCheckpoint(checkpoint);
  return checkpoint;
}
```

### Automatic Checkpoints

```typescript
// Periodic checkpoints
const autoCheckpointConfig = {
  // Time-based
  interval: 5 * 60 * 1000, // Every 5 minutes

  // Event-based
  beforeRiskyOperation: true,
  afterSuccessfulCommit: true,
  beforeMerge: true,

  // Milestone-based
  onTaskComplete: true,
  onPhaseComplete: true,
};
```

## Restoration

Returning to a previous state additively.

### View History

```typescript
// Agent can see their history
async function getCheckpointHistory(agentId: string): Promise<Checkpoint[]> {
  return checkpoints
    .filter((c) => c.created_by === agentId)
    .sort((a, b) => b.created_at - a.created_at);
}

// Or git log for full commit history
async function getCommitHistory(worktree: string): Promise<Commit[]> {
  return git.log({ cwd: worktree, maxCount: 50 });
}
```

### Restore to Checkpoint

```typescript
async function restoreToCheckpoint(checkpointId: string): Promise<void> {
  const checkpoint = await getCheckpoint(checkpointId);

  // 1. Save current state first (never lose work)
  await createCheckpoint({
    description: `Auto-save before restore to ${checkpointId}`,
    trigger: 'before_restore',
  });

  // 2. Create restoration branch (additive, not destructive)
  const restorationBranch = `restore/${checkpointId}/${Date.now()}`;
  await git.checkout({
    startPoint: checkpoint.commit,
    newBranch: restorationBranch,
  });

  // 3. If checkpoint had stashed changes, apply them
  if (checkpoint.stash_ref) {
    await git.stashApply(checkpoint.stash_ref);
  }

  // 4. Record the restoration
  await recordRestoration({
    from: currentCheckpoint,
    to: checkpoint,
    restorationBranch,
  });
}
```

### Cherry-Pick Specific Changes

```typescript
// Bring specific commits from history without full restore
async function cherryPickChanges(commits: string[]): Promise<void> {
  // Create checkpoint first
  await createCheckpoint({
    description: `Before cherry-pick of ${commits.length} commits`,
    trigger: 'before_risky',
  });

  // Cherry-pick each (with conflict handling)
  for (const commit of commits) {
    try {
      await git.cherryPick(commit);
    } catch (conflict) {
      // Pause for resolution or abort
      throw new ConflictError(commit, conflict);
    }
  }
}
```

## Agent Logs

Every agent maintains full activity log.

```typescript
interface AgentLog {
  agentId: string;
  logPath: string;

  entries: LogEntry[];
}

interface LogEntry {
  timestamp: Date;
  type: 'action' | 'decision' | 'error' | 'checkpoint' | 'nudge';

  // What happened
  summary: string;
  details?: string;

  // Git context
  commit?: string;
  files_changed?: string[];

  // Links
  task_id?: string;
  checkpoint_id?: string;
}
```

### Log Usage

```typescript
// Agent logs significant actions
await log.action('Created token service', {
  files_changed: ['src/auth/token-service.ts'],
  commit: await git.head(),
});

await log.decision('Using jose library', {
  alternatives: ['jsonwebtoken', 'jwt-simple'],
  rationale: 'Better TypeScript support',
});

await log.error('Test failed', {
  error: testError.message,
  files_involved: ['src/auth/token-service.ts', 'src/auth/token.test.ts'],
});
```

### Log Review

```typescript
// Human or analyst can review
async function reviewAgentLog(agentId: string): Promise<void> {
  const log = await getAgentLog(agentId);

  // Find issues
  const errors = log.entries.filter((e) => e.type === 'error');
  const decisions = log.entries.filter((e) => e.type === 'decision');

  // Correlate with git history
  const timeline = buildTimeline(log, await git.log());

  // Identify patterns
  const patterns = analyzePatterns(log);
}
```

## Integration with Working Memory

Worktree state connects to working memory:

```typescript
// When agent completes task, record final state
await workingMemory.recordArtifact({
  type: 'code',
  path: 'src/auth/token-service.ts',
  description: 'JWT token generation',
  git_commit: await git.head(),
  checkpoint_id: latestCheckpoint.id,
  agent_worktree: agent.worktree,
});

// When merging to main, reference all contributing checkpoints
await workingMemory.recordMerge({
  target: 'main',
  sources: contributingCheckpoints,
  merge_commit: mergeCommit,
});
```

## Worktree Lifecycle

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. CREATION                                                     │
│    Agent starts task                                            │
│    └── Create worktree from main                                │
│    └── Initialize log                                           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ 2. ACTIVE WORK                                                  │
│    Agent makes changes                                          │
│    └── Regular commits                                          │
│    └── Automatic checkpoints                                    │
│    └── Log entries                                              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ 3. COMPLETION                                                   │
│    Task done                                                    │
│    └── Final checkpoint                                         │
│    └── PR or merge request                                      │
│    └── Worktree retained for review                             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ 4. CLEANUP (optional)                                           │
│    After review and merge                                       │
│    └── Archive logs and checkpoints                             │
│    └── Remove worktree                                          │
│    └── Delete branch (optional)                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Gaps & Open Questions

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
