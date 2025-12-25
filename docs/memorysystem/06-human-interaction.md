# 06 - Human Interaction

**Status:** Draft **Last Updated:** 2024-12-20

## Purpose

Enable humans to observe, guide, and correct multi-agent workflows without
disrupting work. Nudges should arrive at the right moment in the right agent's
context.

## Interaction Modes

### 1. Watch Mode

Observe what's happening across all agents.

```bash
# Terminal UI showing real-time status
$ memory-system watch --task-set auth-impl

┌─ Auth Implementation ────────────────────────────────────────┐
│ Status: Active    Tasks: 3/7    Agents: 2 working, 1 idle   │
├──────────────────────────────────────────────────────────────┤
│ ✓ Design schema              [dev-001]   2m ago             │
│ ● Implement backend          [dev-001]   Working...         │
│ ● Write tests                [dev-002]   Working...         │
│ ○ Integration test           [waiting on: backend, tests]   │
│ ○ Security review            [waiting on: integration]      │
│ ○ Documentation              [pending]                      │
│ ○ Final review               [pending]                      │
├──────────────────────────────────────────────────────────────┤
│ Recent activity:                                             │
│ 14:32 dev-001: Queried auth-jwt memory core                 │
│ 14:31 dev-002: Created test file src/auth/token.test.ts     │
│ 14:30 dev-001: Decision - use jose library for JWT          │
└──────────────────────────────────────────────────────────────┘
Commands: [n]udge  [p]riority  [a]pprove  [d]etail  [q]uit
```

### 2. Nudge Injection

Send a message to influence an agent's next turn.

```typescript
interface Nudge {
  id: string;
  created_at: Date;

  // Targeting
  target: 'orchestrator' | 'all' | string; // Agent ID

  // Content
  message: string;

  // Urgency
  priority: 'low' | 'normal' | 'high' | 'critical';

  // Timing
  delivery: 'next_turn' | 'immediate' | 'when_idle';

  // Tracking
  delivered: boolean;
  delivered_at?: Date;
  acknowledged: boolean;
}
```

**Nudge Types:**

```typescript
// Course correction
await nudge({
  target: 'dev-001',
  message: 'Actually, use HS256 not RS256 for this internal service',
  priority: 'normal',
  delivery: 'next_turn',
});

// Additional context
await nudge({
  target: 'dev-001',
  message: 'FYI: The auth module also needs to support API keys, not just JWT',
  priority: 'low',
});

// Stop/redirect
await nudge({
  target: 'dev-001',
  message: "STOP. Wrong approach. Let's discuss before continuing.",
  priority: 'critical',
  delivery: 'immediate',
});

// Broadcast to all
await nudge({
  target: 'all',
  message: 'Heads up: Production incident, pausing non-critical work',
  priority: 'high',
});
```

**Injection into Agent Context:**

> **Note (2024-12-25):** Like dynamic memory, nudges are injected
> **ephemerally** into `contentsToUse` for the current turn only. They are NOT
> added to chat history via `addHistory()`. This prevents accumulation and
> ensures clean context per turn.

```typescript
// When agent starts next turn, nudges are injected into contentsToUse (EPHEMERAL)
// NOT added to chat history - this prevents accumulation
function buildAgentContext(agent: Agent): string {
  const pendingNudges = await getNudgesForAgent(agent.id);

  let context = '';

  if (pendingNudges.length > 0) {
    context += '=== HUMAN MESSAGES ===\n';
    for (const nudge of pendingNudges) {
      context += `[${nudge.priority}] ${nudge.message}\n`;
      await markNudgeDelivered(nudge.id);
    }
    context += '======================\n\n';
  }

  context += buildRegularContext(agent);
  // This context is injected via contentsToUse, NOT addHistory()
  return context;
}
```

### 3. Approval Gates

Some actions require human approval before proceeding.

```typescript
interface ApprovalGate {
  id: string;

  // What needs approval
  action: string;
  description: string;
  proposed_by: string; // Agent ID

  // Context for decision
  context: string;
  risk_level: 'low' | 'medium' | 'high';

  // Status
  status: 'pending' | 'approved' | 'rejected';
  decided_by?: string;
  decided_at?: Date;
  decision_reason?: string;
}
```

**When gates are triggered:**

```typescript
// Configured approval requirements
const approvalConfig = {
  // Always require approval for:
  destructive_operations: true,
  external_api_calls: true,
  file_deletions: true,
  database_migrations: true,

  // Conditional approval:
  large_changes: { threshold: 500, unit: 'lines' },
  new_dependencies: true,
  security_sensitive: true,
};
```

**Approval flow:**

```
Agent proposes action
       │
       ▼
  Gate triggered?
       │
  ┌────┴────┐
  │         │
  No        Yes
  │         │
  ▼         ▼
Execute   Queue for
          approval
              │
              ▼
         Notify human
              │
              ▼
         Human decides
              │
         ┌────┴────┐
         │         │
      Approved  Rejected
         │         │
         ▼         ▼
      Execute   Notify agent
                (with reason)
```

### 4. Priority Override

Change what gets worked on.

```typescript
// Pause everything, focus on this
await prioritize({
  highPriority: ['security-fix'],
  pause: ['feature-work', 'docs'],
  reason: 'Security vulnerability reported',
});

// Reorder queue
await reorder({
  taskOrder: ['task-C', 'task-A', 'task-B'],
  reason: 'Stakeholder requested C first',
});

// Cancel task
await cancel({
  task: 'task-D',
  reason: 'Requirements changed, no longer needed',
});
```

### 5. Takeover

Human takes direct control of an agent's task.

```typescript
// Agent stuck or human wants to do it themselves
await takeover({
  task: 'implement-auth',
  from: 'dev-001',
  mode: 'pause_agent', // or 'continue_parallel'
});

// Human works on it...

// Hand back
await handback({
  task: 'implement-auth',
  to: 'dev-001',
  context: 'I fixed the config issue, you can continue with the token flow',
});
```

## Notification System

Keep human informed of important events.

```typescript
interface Notification {
  id: string;
  timestamp: Date;

  // Categorization
  type:
    | 'completion'
    | 'failure'
    | 'approval_needed'
    | 'stuck'
    | 'milestone'
    | 'info';
  severity: 'info' | 'warning' | 'error' | 'critical';

  // Content
  title: string;
  message: string;

  // Context
  task_id?: string;
  agent_id?: string;

  // Actions
  actions?: NotificationAction[];

  // State
  read: boolean;
  dismissed: boolean;
}

interface NotificationAction {
  label: string;
  action: 'approve' | 'reject' | 'retry' | 'view' | 'nudge';
  params?: Record<string, any>;
}
```

**Notification channels:**

```typescript
const notificationConfig = {
  // Where to send
  channels: {
    terminal: true, // Show in watch mode
    desktop: true, // OS notifications
    slack: '#team-channel', // Slack webhook
    email: false, // Too noisy usually
  },

  // What to send where
  routing: {
    approval_needed: ['terminal', 'desktop'],
    failure: ['terminal', 'desktop', 'slack'],
    completion: ['terminal'],
    milestone: ['terminal', 'slack'],
  },
};
```

## Context-Aware Injection

Nudges need to arrive at the right moment with the right context.

### Timing Strategies

```typescript
type DeliveryStrategy =
  | 'next_turn' // Wait for agent's next iteration
  | 'immediate' // Interrupt current work
  | 'when_idle' // When agent finishes current task
  | 'before_task' // Before specific task starts
  | 'after_task'; // After specific task ends

// Example: Don't interrupt coding, wait for natural break
await nudge({
  target: 'dev-001',
  message: "When you're done with current file, also add logging",
  delivery: 'when_idle',
});
```

### Context Building

Nudges are injected with appropriate framing:

```typescript
function injectNudge(nudge: Nudge, context: AgentContext): string {
  // Frame based on priority
  let prefix = '';
  switch (nudge.priority) {
    case 'critical':
      prefix = '🚨 URGENT FROM HUMAN: ';
      break;
    case 'high':
      prefix = '⚠️ IMPORTANT: ';
      break;
    case 'normal':
      prefix = '📝 Human note: ';
      break;
    case 'low':
      prefix = 'FYI: ';
      break;
  }

  return `${prefix}${nudge.message}`;
}
```

### Agent Response to Nudges

Agents are instructed to handle nudges:

```typescript
const agentInstructions = `
When you see a message from the human:
1. Acknowledge you received it
2. If it changes your approach, explain what you'll do differently
3. If you disagree or need clarification, ask
4. If it's just FYI, note it and continue

For URGENT messages:
- Stop current work immediately
- Address the urgent matter first
- Resume previous work only after urgent matter resolved
`;
```

## Escalation Path

When agents need human help:

```typescript
interface Escalation {
  id: string;
  from: string; // Agent ID

  // What's the problem
  type: 'stuck' | 'confused' | 'needs_decision' | 'error';
  description: string;

  // Context
  task_id: string;
  attempted: string[]; // What agent tried

  // Status
  status: 'pending' | 'acknowledged' | 'resolved';
}

// Agent can escalate
await escalate({
  type: 'needs_decision',
  description: 'Should we break backward compatibility to fix this properly?',
  task_id: currentTask,
  attempted: ['Tried to fix without breaking compat, too complex'],
});
```

---

## Gaps & Open Questions

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
