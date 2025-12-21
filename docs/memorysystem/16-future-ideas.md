# 16 - Future Ideas & Patterns

**Status:** Ideas/Research **Last Updated:** 2024-12-21

## Purpose

Collection of advanced patterns and UX ideas for future implementation. These
are proven concepts from various agentic systems that could enhance the memory
system.

---

## Governance & Safety

### Constitution File

A read-only governance file containing hard-coded rules that agents must follow.

```yaml
# .memory/constitution.yaml
rules:
  - name: no_delete_tests
    description: 'Never delete a test to fix the build'
    severity: block
    pattern: "delete.*\\.test\\."

  - name: no_new_deps_without_approval
    description: 'No new dependencies without human approval'
    severity: require_approval
    pattern: 'npm install|yarn add|pip install'

  - name: no_modify_protected
    description: 'Never modify protected files'
    severity: block
    protected_paths:
      - '*.lock'
      - '.env*'
      - 'credentials.*'

  - name: preserve_backwards_compat
    description: 'Breaking changes require approval'
    severity: require_approval
    check: 'breaking_change_detector'

  - name: security_patterns
    description: 'No hardcoded secrets'
    severity: block
    patterns:
      - "password\\s*=\\s*['\"]"
      - "api_key\\s*=\\s*['\"]"
      - "secret\\s*=\\s*['\"]"
```

**Implementation:**

- Injected into both investigator and main agent system prompts
- Checked in Draft-Review-Commit flow (Pattern 17)
- Violations block commits, log decisions

---

## Smart Tools

### Validated Write

Write files only after passing validation (lint, type-check, syntax).

```typescript
interface ValidatedWriteResult {
  success: boolean;
  file: string;
  validationErrors?: ValidationError[];
  autoFixed?: boolean;
}

async function writeFileValidated(
  path: string,
  content: string,
  options?: { autoFix?: boolean },
): Promise<ValidatedWriteResult> {
  // 1. Detect language from extension
  const language = detectLanguage(path);

  // 2. Run syntax/lint check BEFORE writing
  const validation = await validate(content, language);

  if (!validation.valid) {
    if (options?.autoFix && validation.autoFixable) {
      // Auto-fix and retry
      const fixed = await autoFix(content, language);
      return writeFileValidated(path, fixed, { autoFix: false });
    }

    // Return errors for agent self-correction
    return {
      success: false,
      file: path,
      validationErrors: validation.errors.map((e) => ({
        line: e.line,
        column: e.column,
        message: e.message,
        rule: e.rule,
        fixable: e.fixable,
      })),
    };
  }

  // 3. Only write if valid
  await fs.writeFile(path, content);
  return { success: true, file: path };
}
```

**Why:**

- Catches syntax errors immediately
- Agent gets line-specific feedback
- Reduces "write garbage, debug later" loops

### Windowed File Reader

Prevent agents from loading entire large files into context.

```typescript
interface WindowedReadResult {
  content: string;
  totalLines: number;
  window: { start: number; end: number };
  hasMore: boolean;
  suggestedNextWindow?: { start: number; end: number };
}

async function readFileWindowed(
  path: string,
  options: {
    startLine?: number;
    endLine?: number;
    maxLines?: number;
    around?: { line: number; context: number }; // Read N lines around target
  },
): Promise<WindowedReadResult> {
  const maxLines = options.maxLines || 100;

  // Read file stats first
  const lines = (await fs.readFile(path, 'utf-8')).split('\n');
  const totalLines = lines.length;

  let start: number, end: number;

  if (options.around) {
    // Center window around target line
    start = Math.max(0, options.around.line - options.around.context);
    end = Math.min(totalLines, options.around.line + options.around.context);
  } else {
    start = options.startLine || 0;
    end = options.endLine || Math.min(start + maxLines, totalLines);
  }

  // Enforce max window size
  if (end - start > maxLines) {
    end = start + maxLines;
  }

  const content = lines.slice(start, end).join('\n');

  return {
    content,
    totalLines,
    window: { start, end },
    hasMore: end < totalLines,
    suggestedNextWindow:
      end < totalLines
        ? { start: end, end: Math.min(end + maxLines, totalLines) }
        : undefined,
  };
}
```

**Why:**

- Preserves context window tokens
- Forces targeted reading
- Agent learns to navigate large files

### Pattern Finder

Dedicated tool for finding "how we do X" in the codebase.

```typescript
interface PatternMatch {
  file: string;
  function: string;
  lines: { start: number; end: number };
  snippet: string;
  relevance: number;
  explanation: string;
}

async function findPattern(
  query: string, // e.g., "how do we handle HTTP retries"
  options?: {
    scope?: string; // e.g., "src/shared"
    language?: string;
    maxResults?: number;
  },
): Promise<PatternMatch[]> {
  // 1. Semantic search in code snippets
  const semanticMatches = await searchCodeSnippets({
    query,
    scope: options?.scope,
    language: options?.language,
    limit: 20,
  });

  // 2. Ask fast model to rank by relevance to the query
  const ranked = await fastModel.generate(`
    Rank these code snippets by how well they demonstrate: "${query}"

    SNIPPETS:
    ${semanticMatches
      .map(
        (m, i) => `
    [${i}] ${m.file}:${m.function}
    \`\`\`
    ${m.snippet}
    \`\`\`
    `,
      )
      .join('\n')}

    Output JSON: [
      { "index": 0, "relevance": 0.95, "explanation": "Shows retry logic with exponential backoff" },
      ...
    ]
  `);

  // 3. Return top matches with explanations
  const rankings = JSON.parse(ranked);
  return rankings
    .filter((r) => r.relevance > 0.5)
    .slice(0, options?.maxResults || 5)
    .map((r) => ({
      ...semanticMatches[r.index],
      relevance: r.relevance,
      explanation: r.explanation,
    }));
}
```

**Why:**

- Golden paths lite - find examples on demand
- Reduces hallucination - grounds in actual code
- Teaches agent the project's conventions

---

## UX Ideas

### Interactive Spec Enforcer

Force users to answer architectural questions before starting a project.

```typescript
interface SpecQuestion {
  id: string;
  question: string;
  type: 'choice' | 'text' | 'confirm';
  options?: string[];
  required: boolean;
  dependsOn?: { questionId: string; answer: string };
}

const specQuestions: SpecQuestion[] = [
  {
    id: 'runtime',
    question: 'What runtime environment?',
    type: 'choice',
    options: ['Node.js', 'Bun', 'Deno', 'Browser'],
    required: true,
  },
  {
    id: 'framework',
    question: 'Which web framework?',
    type: 'choice',
    options: ['Express', 'Fastify', 'Hono', 'None'],
    required: true,
    dependsOn: { questionId: 'runtime', answer: 'Node.js' },
  },
  {
    id: 'database',
    question: 'Database choice?',
    type: 'choice',
    options: ['PostgreSQL', 'SQLite', 'MongoDB', 'None'],
    required: true,
  },
  {
    id: 'auth_method',
    question: 'How will users authenticate?',
    type: 'choice',
    options: ['JWT', 'Session cookies', 'OAuth only', 'No auth needed'],
    required: true,
  },
  {
    id: 'constraints',
    question: 'Any specific constraints or requirements?',
    type: 'text',
    required: false,
  },
];

async function runSpecEnforcer(): Promise<SpecDocument> {
  const answers: Record<string, string> = {};

  for (const q of specQuestions) {
    // Check dependency
    if (q.dependsOn && answers[q.dependsOn.questionId] !== q.dependsOn.answer) {
      continue;
    }

    const answer = await promptUser(q);
    answers[q.id] = answer;
  }

  // Generate SPEC.md from answers
  const specDoc = await generateSpec(answers);
  await fs.writeFile('docs/SPEC.md', specDoc);

  return specDoc;
}
```

**Output: `docs/SPEC.md`**

```markdown
# Project Specification

## Runtime

Node.js v20+

## Architecture

- Framework: Fastify
- Database: PostgreSQL with Prisma ORM
- Auth: JWT with refresh tokens

## Constraints

- Must support multi-tenancy
- API versioning required

## Source of Truth

This document was generated during project initialization. Any changes require
updating this spec first.
```

**Why:**

- Forces upfront decisions
- Reduces "what should I use?" mid-project
- Creates referenceable source of truth

### Thinking Indicators

Visual feedback showing what phase the agent is in.

```typescript
type AgentPhase =
  | 'investigating' // Pre-check investigation
  | 'planning' // Deciding approach
  | 'drafting' // Writing code (in memory)
  | 'reviewing' // Self-review phase
  | 'writing' // Actually writing to disk
  | 'testing' // Running tests
  | 'waiting'; // Waiting for human input

interface ThinkingIndicator {
  phase: AgentPhase;
  detail: string;
  progress?: number; // 0-100 for multi-step operations
}

function renderThinkingIndicator(indicator: ThinkingIndicator): string {
  const icons = {
    investigating: '🔍',
    planning: '🧠',
    drafting: '✏️',
    reviewing: '👀',
    writing: '💾',
    testing: '🧪',
    waiting: '⏳',
  };

  const progressBar =
    indicator.progress !== undefined
      ? ` [${'█'.repeat(indicator.progress / 10)}${'░'.repeat(10 - indicator.progress / 10)}]`
      : '';

  return `${icons[indicator.phase]} ${indicator.detail}${progressBar}`;
}

// Usage in CLI
function showThinking(indicator: ThinkingIndicator) {
  process.stdout.write(`\r${renderThinkingIndicator(indicator)}   `);
}

// Example output:
// 🔍 Searching for similar patterns in codebase...
// 🧠 Planning approach: JWT with refresh tokens
// ✏️ Drafting: src/auth/token-service.ts
// 👀 Self-reviewing draft for issues...
// 💾 Writing: src/auth/token-service.ts [██████████]
```

**Why:**

- User knows what's happening
- Distinguishes cheap model work from expensive model work
- Reduces "is it stuck?" anxiety

---

## State Persistence

### Crash Recovery State

Save current phase and task list to disk for crash recovery.

```typescript
interface PersistentState {
  version: string;
  savedAt: Date;

  // Current phase
  phase: 'planning' | 'coding' | 'debugging' | 'reviewing';
  phaseStartedAt: Date;

  // Active task list
  tasks: {
    id: string;
    title: string;
    status: 'pending' | 'in_progress' | 'done' | 'blocked';
    assignedTo?: string;
  }[];

  // Last checkpoint
  lastCheckpoint: {
    id: string;
    timestamp: Date;
    description: string;
  };

  // Context state (compressed)
  contextState: {
    activeFocus: string;
    dormantTopics: string[]; // Just IDs, full content in memory core
  };

  // Pending drafts (not yet committed)
  pendingDrafts: {
    file: string;
    draftId: string;
    status: 'drafted' | 'reviewing';
  }[];
}

class StatePersistence {
  private statePath = '.memory/state.json';

  async save(state: PersistentState): Promise<void> {
    state.savedAt = new Date();
    await fs.writeFile(this.statePath, JSON.stringify(state, null, 2));
  }

  async load(): Promise<PersistentState | null> {
    try {
      const content = await fs.readFile(this.statePath, 'utf-8');
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  async recover(): Promise<RecoveryPlan> {
    const state = await this.load();
    if (!state) {
      return { canRecover: false, reason: 'No saved state found' };
    }

    // Check if state is fresh enough
    const ageMs = Date.now() - new Date(state.savedAt).getTime();
    if (ageMs > 24 * 60 * 60 * 1000) {
      // 24 hours
      return {
        canRecover: false,
        reason: 'State too old',
        staleState: state,
      };
    }

    // Build recovery plan
    return {
      canRecover: true,
      state,
      suggestedActions: [
        `Resume phase: ${state.phase}`,
        `Active tasks: ${state.tasks.filter((t) => t.status === 'in_progress').length}`,
        `Pending drafts: ${state.pendingDrafts.length}`,
        `Last checkpoint: ${state.lastCheckpoint.description}`,
      ],
    };
  }
}
```

**Why:**

- CLI can crash/restart without losing context
- Shows user exactly where things left off
- Pending drafts can be reviewed after crash

---

## Advanced Patterns

### Immutability Lock

Prevent agents from editing files outside the active task scope during
refactoring.

```typescript
interface ImmutabilityLock {
  enabled: boolean;
  allowedPaths: string[];
  reason: string;
  lockedAt: Date;
  lockedBy: string; // Task ID or 'orchestrator'
}

class FileAccessController {
  private lock: ImmutabilityLock | null = null;

  enableLock(allowedPaths: string[], reason: string, lockedBy: string) {
    this.lock = {
      enabled: true,
      allowedPaths,
      reason,
      lockedAt: new Date(),
      lockedBy,
    };
  }

  disableLock() {
    this.lock = null;
  }

  canWrite(path: string): { allowed: boolean; reason?: string } {
    if (!this.lock || !this.lock.enabled) {
      return { allowed: true };
    }

    const isAllowed = this.lock.allowedPaths.some((allowed) =>
      minimatch(path, allowed),
    );

    if (!isAllowed) {
      return {
        allowed: false,
        reason: `File locked: ${this.lock.reason}. Allowed paths: ${this.lock.allowedPaths.join(', ')}`,
      };
    }

    return { allowed: true };
  }
}

// Usage during refactoring
async function refactorWithLock(task: RefactorTask) {
  // Lock to only files being refactored
  fileController.enableLock(
    task.targetFiles,
    'Refactoring in progress - only target files editable',
    task.id,
  );

  try {
    await executeRefactor(task);
  } finally {
    fileController.disableLock();
  }
}
```

**Why:**

- Prevents scope creep during focused refactoring
- Agent can't "fix" unrelated files
- Clear boundaries for each task

### Synchronous Interceptor Middleware

Wrap all write/command operations with safety checks.

```typescript
type ToolInterceptor = (
  toolName: string,
  args: any,
  proceed: () => Promise<any>,
) => Promise<any>;

const safetyInterceptor: ToolInterceptor = async (toolName, args, proceed) => {
  // Check writes
  if (toolName === 'write_file') {
    const { path, content } = args;

    // Check immutability lock
    const canWrite = fileController.canWrite(path);
    if (!canWrite.allowed) {
      throw new ToolError(`Blocked: ${canWrite.reason}`);
    }

    // Check constitution rules
    const violations = await checkConstitution(path, content);
    if (violations.length > 0) {
      throw new ToolError(`Constitution violation: ${violations[0].rule}`);
    }

    // Run safety review (fast model)
    const safetyResult = await fastModel.generate(`
      Is this file change safe to make?

      FILE: ${path}
      CONTENT:
      ${content.slice(0, 1000)}...

      Check for:
      - Accidental deletion of important code
      - Security vulnerabilities
      - Breaking changes

      Output JSON: { "safe": true/false, "reason": "..." }
    `);

    const safety = JSON.parse(safetyResult);
    if (!safety.safe) {
      // Log but allow with warning
      console.warn(`⚠️ Safety warning: ${safety.reason}`);
    }
  }

  // Check commands
  if (toolName === 'run_command') {
    const { command } = args;

    // Block dangerous commands
    const dangerous = ['rm -rf', 'DROP TABLE', 'format c:', 'sudo'];
    if (dangerous.some((d) => command.includes(d))) {
      throw new ToolError(`Blocked dangerous command: ${command}`);
    }
  }

  // Proceed if all checks pass
  return proceed();
};

// Register interceptor
toolRunner.use(safetyInterceptor);
```

**Why:**

- Last line of defense against destructive operations
- Applies to ALL tools uniformly
- Can be extended with new safety rules

---

## Integration with Memory System

These patterns integrate with the core memory system:

| Pattern           | Memory System Integration                             |
| ----------------- | ----------------------------------------------------- |
| Constitution      | Stored in memory core, injected into agent context    |
| Validated Write   | Failures logged to working memory, trigger Pattern 18 |
| Pattern Finder    | Queries code index and golden paths                   |
| Spec Enforcer     | Creates entries in project memory core                |
| Crash Recovery    | Persists working memory state to disk                 |
| Immutability Lock | Scoped by task in working memory                      |
| Topic Compression | Moves archived topics to memory cores                 |

---

---

## Token Budget Management

Proactively manage context window before hitting limits.

```typescript
interface TokenBudget {
  total: number; // Model's context limit
  reserved: {
    systemPrompt: number; // Fixed overhead
    responseBuffer: number; // Room for model output
  };
  used: {
    context: number; // Current context injection
    history: number; // Conversation history
    codeSnippets: number; // Embedded code
  };
  available: number; // What's left for new content
  compressionThreshold: number; // When to start compressing (e.g., 80%)
}

class TokenBudgetManager {
  constructor(private budget: TokenBudget) {}

  canAdd(tokens: number): boolean {
    return this.budget.available >= tokens;
  }

  shouldCompress(): boolean {
    const usedPercent =
      (this.budget.total - this.budget.available) / this.budget.total;
    return usedPercent >= this.budget.compressionThreshold;
  }

  async makeRoom(neededTokens: number): Promise<void> {
    while (this.budget.available < neededTokens) {
      // Find least relevant content to compress/remove
      const candidate = await this.findCompressionCandidate();
      await this.compress(candidate);
    }
  }

  private async findCompressionCandidate(): Promise<CompressibleContent> {
    // Priority: oldest dormant topics > old history > large code snippets
    // Never compress: active topic, key decisions, recent errors
  }
}

// Usage: Check budget before adding context
if (budgetManager.shouldCompress()) {
  await contextCurator.curate(recentMessages);
}

if (!budgetManager.canAdd(newContext.tokens)) {
  await budgetManager.makeRoom(newContext.tokens);
}
```

**Why proactive:**

- Prevents mid-task context death
- Graceful degradation, not sudden amnesia
- Prioritizes what to keep vs discard

---

## Automatic Gotcha Injection

When agent touches a file, automatically surface known issues.

```typescript
interface FileGotcha {
  file: string;
  gotchas: {
    type: 'past_failure' | 'known_issue' | 'complexity_warning';
    message: string;
    line?: number;
    occurrences: number; // How many times agents hit this
    lastHit: Date;
  }[];
  relatedPatterns: string[]; // Golden paths that apply
}

async function getGotchasForFile(filePath: string): Promise<FileGotcha> {
  // 1. Check memory core for known issues with this file
  const knownIssues = await memoryCore.search({
    type: 'gotcha',
    filter: { affects_file: filePath },
  });

  // 2. Check working memory for recent failures on this file
  const recentFailures = await workingMemory.getFailures({
    file: filePath,
    since: daysAgo(7),
  });

  // 3. Check code complexity
  const complexity = await analyzeComplexity(filePath);

  // 4. Find related golden paths
  const patterns = await findGoldenPaths({ file: filePath });

  return {
    file: filePath,
    gotchas: [
      ...knownIssues.map((i) => ({
        type: 'known_issue',
        message: i.content,
        line: i.line,
        occurrences: i.hit_count,
        lastHit: i.last_hit,
      })),
      ...recentFailures.map((f) => ({
        type: 'past_failure',
        message: `Previous agent failed here: ${f.error}`,
        line: f.line,
        occurrences: 1,
        lastHit: f.timestamp,
      })),
      ...(complexity.score > 0.8
        ? [
            {
              type: 'complexity_warning',
              message: `High complexity (${complexity.score}). Consider breaking down.`,
              occurrences: 0,
              lastHit: new Date(),
            },
          ]
        : []),
    ],
    relatedPatterns: patterns.map((p) => p.id),
  };
}

// Inject into agent context before file operations
function formatGotchaWarning(gotcha: FileGotcha): string {
  if (gotcha.gotchas.length === 0) return '';

  return `
⚠️ KNOWN ISSUES WITH ${gotcha.file}:
${gotcha.gotchas.map((g) => `- [${g.type}] ${g.message}${g.line ? ` (line ${g.line})` : ''}`).join('\n')}

📚 Related patterns: ${gotcha.relatedPatterns.join(', ') || 'none'}
  `;
}
```

**Why automatic:**

- Agent doesn't need to ask "any gotchas here?"
- Past failures prevent repeat mistakes
- Surfaces patterns at exactly the right moment

---

## External Documentation Fetching

When agent references unknown external APIs, fetch docs on demand.

```typescript
interface ExternalDocSource {
  name: string;
  pattern: RegExp; // Match import/usage
  docUrl: (pkg: string, version?: string) => string;
  parser: (html: string) => DocContent;
}

const docSources: ExternalDocSource[] = [
  {
    name: 'npm',
    pattern: /from ['"](@?\w[\w\-\/]+)['"]/,
    docUrl: (pkg) => `https://www.npmjs.com/package/${pkg}`,
    parser: parseNpmReadme,
  },
  {
    name: 'python-pypi',
    pattern: /^(?:from|import) (\w+)/,
    docUrl: (pkg) => `https://pypi.org/project/${pkg}/`,
    parser: parsePypiPage,
  },
  {
    name: 'mdn',
    pattern: /\b(fetch|Promise|Array|Map|Set)\b/,
    docUrl: (api) =>
      `https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/${api}`,
    parser: parseMdn,
  },
];

async function fetchExternalDocs(
  code: string,
  context: TaskContext,
): Promise<DocInjection[]> {
  const injections: DocInjection[] = [];

  for (const source of docSources) {
    const matches = code.matchAll(source.pattern);
    for (const match of matches) {
      const pkg = match[1];

      // Check if we already know this package
      const cached = await docCache.get(pkg);
      if (cached) {
        injections.push(cached);
        continue;
      }

      // Check if it's in our codebase (don't fetch docs for internal)
      if (await isInternalPackage(pkg)) continue;

      // Fetch and cache
      try {
        const url = source.docUrl(pkg);
        const html = await fetch(url);
        const docs = source.parser(await html.text());

        const injection = {
          package: pkg,
          summary: docs.summary,
          keyApis: docs.apis.slice(0, 10), // Top 10 APIs
          examples: docs.examples.slice(0, 3),
          gotchas: docs.gotchas,
          version: docs.version,
        };

        await docCache.set(pkg, injection, { ttl: days(7) });
        injections.push(injection);
      } catch (e) {
        // Package docs not found, continue
      }
    }
  }

  return injections;
}
```

**Why fetch on demand:**

- Can't pre-cache every package
- Gets current docs for version in use
- Reduces hallucination on external APIs

---

## Undo Stack (Beyond Git)

Fine-grained undo without git archaeology.

```typescript
interface Operation {
  id: string;
  timestamp: Date;
  type: 'file_write' | 'file_delete' | 'command' | 'decision';
  agent: string;
  task: string;

  // For file operations
  file?: string;
  before?: string; // Content before change
  after?: string; // Content after change

  // For commands
  command?: string;
  output?: string;

  // Reversibility
  reversible: boolean;
  reverseOperation?: () => Promise<void>;
}

class UndoStack {
  private operations: Operation[] = [];
  private undoneOperations: Operation[] = []; // For redo

  async record(op: Omit<Operation, 'id' | 'timestamp'>): Promise<void> {
    this.operations.push({
      ...op,
      id: generateId(),
      timestamp: new Date(),
    });

    // Clear redo stack on new operation
    this.undoneOperations = [];

    // Persist to disk
    await this.save();
  }

  async undo(): Promise<Operation | null> {
    const op = this.operations.pop();
    if (!op) return null;

    if (!op.reversible) {
      throw new Error(`Operation ${op.id} is not reversible`);
    }

    // Execute reverse
    if (op.type === 'file_write' && op.before !== undefined) {
      await fs.writeFile(op.file!, op.before);
    } else if (op.reverseOperation) {
      await op.reverseOperation();
    }

    this.undoneOperations.push(op);
    await this.save();
    return op;
  }

  async redo(): Promise<Operation | null> {
    const op = this.undoneOperations.pop();
    if (!op) return null;

    // Re-execute
    if (op.type === 'file_write' && op.after !== undefined) {
      await fs.writeFile(op.file!, op.after);
    }

    this.operations.push(op);
    await this.save();
    return op;
  }

  async undoTo(operationId: string): Promise<Operation[]> {
    const undone: Operation[] = [];
    while (this.operations.length > 0) {
      const last = this.operations[this.operations.length - 1];
      if (last.id === operationId) break;

      const op = await this.undo();
      if (op) undone.push(op);
    }
    return undone;
  }

  // Group operations by task for easier navigation
  getOperationsByTask(): Map<string, Operation[]> {
    const byTask = new Map<string, Operation[]>();
    for (const op of this.operations) {
      const existing = byTask.get(op.task) || [];
      existing.push(op);
      byTask.set(op.task, existing);
    }
    return byTask;
  }
}

// Usage
await undoStack.record({
  type: 'file_write',
  agent: 'dev-001',
  task: 'P1-A',
  file: 'src/auth/token.ts',
  before: originalContent,
  after: newContent,
  reversible: true,
});

// Later: "undo last 3 changes"
await undoStack.undo();
await undoStack.undo();
await undoStack.undo();
```

**Why beyond git:**

- Git commits are coarse (many files, one commit)
- Undo stack is per-operation
- Easier to "undo just that one file change"
- Works with uncommitted changes

---

## Live Watch Mode Dashboard

Real-time visibility into system state.

```typescript
interface DashboardState {
  // System
  phase: string;
  activeFocus: string;
  tokenUsage: { used: number; total: number };

  // Agents
  agents: {
    id: string;
    role: string;
    status: 'working' | 'idle' | 'blocked';
    currentTask?: string;
    lastAction?: string;
  }[];

  // Tasks
  taskGraph: {
    id: string;
    title: string;
    status: string;
    dependencies: string[];
  }[];

  // Context
  contextTopics: {
    id: string;
    name: string;
    status: 'active' | 'dormant';
    tokens: number;
  }[];

  // Events (last N)
  recentEvents: {
    timestamp: Date;
    type: string;
    message: string;
  }[];
}

class WatchModeDashboard {
  private state: DashboardState;
  private refreshInterval: number = 1000;

  async render(): Promise<string> {
    return `
┌─────────────────────────────────────────────────────────────────────┐
│ MEMORY SYSTEM                                          ${this.clock()} │
├─────────────────────────────────────────────────────────────────────┤
│ Phase: ${this.state.phase.padEnd(15)} Focus: ${this.state.activeFocus.padEnd(25)} │
│ Tokens: ${this.progressBar(this.state.tokenUsage)} │
├──────────────────────────────┬──────────────────────────────────────┤
│ AGENTS                       │ CONTEXT                              │
│ ${this.renderAgents()}       │ ${this.renderContext()}              │
├──────────────────────────────┴──────────────────────────────────────┤
│ TASK GRAPH                                                          │
│ ${this.renderTaskGraph()}                                           │
├─────────────────────────────────────────────────────────────────────┤
│ EVENTS                                                              │
${this.renderEvents()}
└─────────────────────────────────────────────────────────────────────┘
    `;
  }

  private progressBar(usage: { used: number; total: number }): string {
    const pct = usage.used / usage.total;
    const filled = Math.floor(pct * 20);
    const bar = '█'.repeat(filled) + '░'.repeat(20 - filled);
    const color = pct > 0.9 ? 'red' : pct > 0.7 ? 'yellow' : 'green';
    return `[${bar}] ${usage.used}/${usage.total}`;
  }

  private renderAgents(): string {
    return this.state.agents
      .map((a) => {
        const icon =
          a.status === 'working' ? '⚙️' : a.status === 'idle' ? '💤' : '🚫';
        return `${icon} ${a.role}: ${a.status}`;
      })
      .join('\n│ ');
  }

  private renderTaskGraph(): string {
    // ASCII art task graph
    return this.state.taskGraph
      .map((t) => {
        const icon =
          t.status === 'completed'
            ? '✅'
            : t.status === 'in_progress'
              ? '🔄'
              : t.status === 'blocked'
                ? '⏸️'
                : '⏳';
        return `${icon} ${t.id}: ${t.title.slice(0, 30)}`;
      })
      .join('\n│ ');
  }
}

// CLI integration
async function watchMode() {
  const dashboard = new WatchModeDashboard();

  while (true) {
    console.clear();
    console.log(await dashboard.render());
    await sleep(1000);
  }
}
```

**Why live dashboard:**

- Know what's happening without reading logs
- Spot stuck agents immediately
- Token budget visible at a glance
- Human can intervene at right moment

---

## Gaps & Open Questions

- [ ] How do constitution rules interact with human overrides?
- [ ] Should validated write auto-fix be on by default?
- [ ] How to handle multi-file refactors with immutability lock?
- [ ] State persistence format: JSON vs SQLite?
- [ ] Safety interceptor false positive handling?
- [ ] Pattern finder relevance threshold tuning?
- [ ] Token budget - how to measure tokens accurately across models?
- [ ] External doc fetching - rate limiting, caching strategy?
- [ ] Undo stack - max size before pruning?
- [ ] Dashboard - TUI library choice (blessed, ink, etc.)?
