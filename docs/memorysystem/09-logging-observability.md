# 09 - Logging and Observability

**Status:** Draft **Last Updated:** 2024-12-20

## Purpose

Make the system transparent. Every agent action, decision, and state change
should be traceable. Enable debugging, auditing, and learning from past runs.

## Logging Levels

### Agent-Level Logs

Each agent maintains their own log.

```typescript
interface AgentLogEntry {
  timestamp: Date;
  agent_id: string;
  level: 'debug' | 'info' | 'warn' | 'error';

  // Categorization
  category: 'action' | 'decision' | 'tool_use' | 'memory' | 'git' | 'error';

  // Content
  message: string;
  details?: Record<string, any>;

  // Context
  task_id?: string;
  working_memory_id?: string;

  // Correlation
  trace_id: string; // For distributed tracing
  span_id?: string;
  parent_span_id?: string;
}
```

**Log Categories:**

```typescript
// Action logs
await log.action('Created token service file', {
  file: 'src/auth/token-service.ts',
  lines_added: 142,
});

// Decision logs
await log.decision('Selected jose library for JWT', {
  alternatives: ['jsonwebtoken', 'jwt-simple'],
  rationale: 'Modern API, better TypeScript support',
  confidence: 'high',
});

// Tool use logs
await log.toolUse('Bash', {
  command: 'npm test',
  exit_code: 0,
  duration_ms: 3400,
});

// Memory access logs
// NOTE: Dynamic memory is ephemeral (injected per-turn, not stored in history).
// Log the retrieval operation, not "used_entries" (source of truth is re-retrieval).
await log.memory('Retrieved context for turn', {
  query: 'refresh token rotation',
  results_count: 3,
  retrieval_duration_ms: 145,
  injected_tokens: 420, // How much was injected this turn
  // Entries are ephemeral - logged for debugging, not as persistent state
});

// Git operation logs
await log.git('Committed changes', {
  commit: 'abc123',
  message: 'Implement token service',
  files_changed: ['src/auth/token-service.ts'],
});

// Error logs
await log.error('Test failed', {
  error: error.message,
  stack: error.stack,
  context: { test_file: 'token.test.ts' },
});
```

### Orchestration-Level Logs

System-wide coordination events.

```typescript
interface OrchestrationLogEntry {
  timestamp: Date;
  level: 'info' | 'warn' | 'error';

  category: 'dispatch' | 'completion' | 'failure' | 'coordination' | 'human';

  message: string;
  details?: Record<string, any>;

  // Context
  task_set_id: string;
  working_memory_id: string;

  // Involved parties
  agent_ids?: string[];
  task_ids?: string[];
}
```

**Examples:**

```typescript
await orchLog.dispatch('Assigned task to agent', {
  task_id: 'task-123',
  agent_id: 'dev-001',
  role: 'developer',
});

await orchLog.completion('Task completed', {
  task_id: 'task-123',
  agent_id: 'dev-001',
  duration_ms: 45000,
  result: 'success',
});

await orchLog.human('Received nudge from human', {
  nudge_id: 'nudge-456',
  target: 'dev-001',
  priority: 'high',
});
```

### Memory-Level Logs

Changes to memory cores and working memory.

```typescript
interface MemoryLogEntry {
  timestamp: Date;

  category: 'read' | 'write' | 'link' | 'promote' | 'search';

  // What changed
  core_id?: string;
  entry_id?: string;
  working_memory_id?: string;

  // Who changed it
  agent_id: string;

  // Details
  operation: string;
  changes?: Record<string, any>;
}
```

## Structured Logging

All logs are structured for querying.

```typescript
// Log output format
{
  "timestamp": "2024-12-20T14:32:15.123Z",
  "level": "info",
  "agent_id": "dev-001",
  "category": "action",
  "message": "Created token service file",
  "details": {
    "file": "src/auth/token-service.ts",
    "lines_added": 142
  },
  "trace_id": "abc123",
  "task_id": "task-456",
  "working_memory_id": "wm-789"
}
```

### Log Storage

```typescript
interface LogStorageConfig {
  // Where to store
  backend: 'file' | 'sqlite' | 'elasticsearch' | 'loki';

  // Retention
  retention_days: number;

  // Rotation
  max_file_size_mb: number;
  max_files: number;

  // Paths
  agent_logs_path: string; // e.g., ./logs/agents/
  orchestration_log_path: string;
  memory_log_path: string;
}
```

## Distributed Tracing

Track operations across agents.

```typescript
interface Trace {
  trace_id: string;

  // Root span
  root_span: Span;

  // All spans in this trace
  spans: Span[];
}

interface Span {
  span_id: string;
  parent_span_id?: string;

  // What
  operation: string;

  // When
  start_time: Date;
  end_time?: Date;
  duration_ms?: number;

  // Who
  agent_id?: string;
  service?: string;

  // Status
  status: 'ok' | 'error';
  error?: Error;

  // Tags
  tags: Record<string, string>;

  // Events within span
  events: SpanEvent[];
}

// Example trace for a task
// Task-123 [orchestrator]
// ├── dispatch [orchestrator]
// ├── query-memory [dev-001]
// │   └── semantic-search [retrieval]
// ├── implement [dev-001]
// │   ├── read-file [dev-001]
// │   ├── write-file [dev-001]
// │   └── commit [dev-001]
// └── complete [orchestrator]
```

## Metrics

Quantitative measurements.

```typescript
interface Metrics {
  // Counters
  tasks_completed_total: Counter;
  tasks_failed_total: Counter;
  nudges_received_total: Counter;
  memory_queries_total: Counter;

  // Gauges
  active_agents: Gauge;
  pending_tasks: Gauge;
  blocked_tasks: Gauge;
  memory_entries_count: Gauge;

  // Histograms
  task_duration_seconds: Histogram;
  memory_query_duration_seconds: Histogram;
  agent_response_time_seconds: Histogram;

  // Summaries
  tokens_used_per_task: Summary;
}

// Collection
metrics.tasks_completed_total.inc({ agent: 'dev-001', role: 'developer' });
metrics.task_duration_seconds.observe(45.2, { task_type: 'implement' });
```

## Dashboards

Visual monitoring.

```typescript
interface DashboardPanel {
  title: string;
  type: 'timeseries' | 'table' | 'stat' | 'logs' | 'trace';
  query: string;
}

// Example dashboard
const orchestrationDashboard = {
  title: 'Orchestration Overview',
  panels: [
    {
      title: 'Tasks by Status',
      type: 'stat',
      query: 'task_status_counts',
    },
    {
      title: 'Task Completion Rate',
      type: 'timeseries',
      query: 'rate(tasks_completed_total[5m])',
    },
    {
      title: 'Agent Utilization',
      type: 'timeseries',
      query: 'agent_busy_seconds / agent_total_seconds',
    },
    {
      title: 'Recent Errors',
      type: 'logs',
      query: "level='error' | last 100",
    },
  ],
};
```

## Alerting

Proactive notifications.

```typescript
interface AlertRule {
  name: string;
  condition: string; // e.g., "task_stuck_duration > 10m"
  severity: 'warning' | 'critical';

  // What to do
  actions: AlertAction[];

  // Debounce
  for: string; // e.g., "5m" = must be true for 5 min
}

const alertRules: AlertRule[] = [
  {
    name: 'Task Stuck',
    condition: 'task_in_progress_duration > 30m',
    severity: 'warning',
    actions: [{ type: 'notify_human' }],
    for: '5m',
  },
  {
    name: 'Agent Error Rate',
    condition: 'rate(agent_errors[5m]) > 0.5',
    severity: 'critical',
    actions: [{ type: 'notify_human' }, { type: 'pause_agent' }],
    for: '2m',
  },
  {
    name: 'Memory Core Corruption',
    condition: 'memory_validation_failures > 0',
    severity: 'critical',
    actions: [{ type: 'notify_human', priority: 'immediate' }],
    for: '0s',
  },
];
```

## Audit Trail

Immutable record for compliance/debugging.

```typescript
interface AuditEntry {
  id: string;
  timestamp: Date;

  // What happened
  action: string;
  resource_type: string;
  resource_id: string;

  // Who did it
  actor_type: 'agent' | 'human' | 'system';
  actor_id: string;

  // Before/after
  previous_state?: any;
  new_state?: any;

  // Why
  reason?: string;

  // Integrity
  hash: string; // Hash of entry for tamper detection
  previous_hash: string; // Hash chain
}
```

## Log Queries

Search and filter logs.

```typescript
interface LogQuery {
  // Time range
  from: Date;
  to: Date;

  // Filters
  agent_ids?: string[];
  levels?: string[];
  categories?: string[];
  task_ids?: string[];

  // Search
  text_search?: string;

  // Pagination
  limit?: number;
  offset?: number;

  // Ordering
  order_by?: 'timestamp' | 'level';
  order_dir?: 'asc' | 'desc';
}

// Example queries
// "What did dev-001 do in the last hour?"
await logs.query({
  from: hourAgo,
  to: now,
  agent_ids: ['dev-001'],
});

// "Show all errors related to task-123"
await logs.query({
  task_ids: ['task-123'],
  levels: ['error'],
});

// "Find all memory queries for JWT"
await logs.query({
  categories: ['memory'],
  text_search: 'JWT',
});
```

## Debug Mode

Enhanced logging for troubleshooting.

```typescript
interface DebugConfig {
  // Enabled
  enabled: boolean;

  // What to capture
  capture_prompts: boolean; // Full LLM prompts
  capture_responses: boolean; // Full LLM responses
  capture_tool_io: boolean; // Tool input/output
  capture_memory_content: boolean; // Full memory entries

  // Where to capture
  agents?: string[]; // Specific agents or 'all'
  tasks?: string[]; // Specific tasks

  // Output
  output: 'file' | 'console' | 'both';
}

// Enable debug for specific agent
await debug.enable({
  agents: ['dev-001'],
  capture_prompts: true,
  capture_responses: true,
});
```

---

## Gaps & Open Questions

- [ ] What's the log format standard? OpenTelemetry? Custom?
- [ ] How do we handle sensitive data in logs (API keys, secrets)?
- [ ] What's the log aggregation strategy for distributed setup?
- [ ] How do we correlate logs with git commits?
- [ ] What's the retention policy for different log types?
- [ ] How do we handle log volume at scale?
- [ ] Should we support log streaming to external systems?
- [ ] What's the log backup and recovery strategy?
- [ ] How do we handle timezone in logs?
- [ ] What's the log access control model?
- [ ] How do we prevent log tampering in audit trail?
- [ ] What's the storage cost estimation for logs?
- [ ] How do we sample logs for high-traffic operations?
- [ ] Should we support log anonymization for sharing?
