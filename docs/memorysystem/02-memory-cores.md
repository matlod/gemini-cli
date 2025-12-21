# 02 - Memory Cores

**Status:** Draft **Last Updated:** 2024-12-20

## Purpose

Memory cores are **curated, persistent knowledge bases** that compound learning
across projects and time. They solve the "starting from scratch" problem.

## Core Types

### Technology Cores

Knowledge about specific technologies, frameworks, languages.

```yaml
# Example: typescript-patterns.core
name: TypeScript Patterns
type: technology
tags: [typescript, patterns, best-practices]
entries:
  - id: ts-001
    title: 'Discriminated unions for state machines'
    content: |
      Use discriminated unions with a `kind` or `type` field
      for type-safe state machines...
    code_examples:
      - language: typescript
        source: |
          type State =
            | { kind: 'idle' }
            | { kind: 'loading' }
            | { kind: 'success', data: Data }
            | { kind: 'error', error: Error }
    lessons_learned:
      - 'Always exhaust the union in switch statements'
      - 'Use `assertNever` helper for compile-time exhaustiveness'
    related: [ts-002, ts-015]
    confidence: high
    source: 'gemini-cli project, 2024-12'
```

### Project Cores

Context specific to a project - decisions made, patterns used, gotchas.

```yaml
# Example: gemini-cli.core
name: Gemini CLI Project
type: project
tags: [gemini, mcp, a2a, cli]
entries:
  - id: gcli-001
    title: 'MCP config goes in .mcp.json, not settings.json'
    content: |
      Claude Code looks for MCP server config in .mcp.json
      at project root, NOT in settings.json...
    lesson_source: 'Debugging session 2024-12-20'
    related: [gcli-002]

  - id: gcli-002
    title: 'taskId/contextId must be ON message object'
    content: |
      A2A protocol requires taskId and contextId on the
      message object itself, not in params wrapper...
    code_examples:
      - language: typescript
        source: |
          // CORRECT
          params: { message: { taskId, contextId, ... } }
          // WRONG
          params: { taskId, contextId, message: {...} }
```

### Pattern Cores (Golden Architectures)

Reusable architectural patterns with full implementation guidance.

```yaml
# Example: auth-jwt-pattern.core
name: JWT Authentication Pattern
type: pattern
tags: [auth, jwt, security, api]
description: |
  Complete JWT-based authentication with refresh tokens,
  secure cookie storage, and token rotation.

components:
  - name: Token Generation
    code_path: patterns/auth-jwt/token-service.ts
    description: JWT signing with RS256, short-lived access tokens

  - name: Refresh Token Flow
    code_path: patterns/auth-jwt/refresh-flow.ts
    description: Secure refresh with rotation and revocation

  - name: Middleware
    code_path: patterns/auth-jwt/middleware.ts
    description: Express/Fastify middleware for route protection

lessons_learned:
  - 'Always use RS256, not HS256 for production'
  - 'Access tokens: 15 min, Refresh tokens: 7 days'
  - 'Store refresh tokens in httpOnly cookies, not localStorage'
  - 'Implement token rotation on refresh'

gotchas:
  - 'Clock skew between servers can cause premature expiration'
  - 'Remember to handle token refresh race conditions'

related_patterns: [session-management, oauth-integration]
```

### Personal/Team Cores

Preferences, conventions, team standards.

```yaml
# Example: team-conventions.core
name: Team Conventions
type: personal
entries:
  - id: conv-001
    title: 'Commit message format'
    content: 'Use conventional commits: feat:, fix:, docs:, etc.'

  - id: conv-002
    title: 'PR description template'
    content: "## Summary\n## Test Plan\n## Screenshots"
```

## Memory Core Structure

```
memory-cores/
├── technology/
│   ├── typescript-patterns.core/
│   │   ├── manifest.yaml       # Metadata, relationships
│   │   ├── entries/            # Individual knowledge entries
│   │   │   ├── ts-001.md
│   │   │   └── ts-002.md
│   │   └── examples/           # Code examples
│   │       └── state-machine.ts
│   └── mcp-lessons.core/
├── project/
│   ├── gemini-cli.core/
│   └── acme-app.core/
├── pattern/
│   ├── auth-jwt.core/
│   │   ├── manifest.yaml
│   │   ├── README.md           # Full pattern guide
│   │   └── src/                # Actual implementation
│   └── api-versioning.core/
└── personal/
    └── team-conventions.core/
```

## Entry Metadata

Every entry has rich metadata for retrieval:

```typescript
interface MemoryEntry {
  id: string;
  title: string;
  content: string; // Main knowledge content

  // Categorization
  tags: string[];
  type: 'lesson' | 'pattern' | 'gotcha' | 'example' | 'decision';

  // Relationships (graph edges)
  related: string[]; // Other entry IDs
  supersedes?: string; // Replaces older knowledge
  depends_on?: string[]; // Prerequisites

  // Quality signals
  confidence: 'high' | 'medium' | 'low';
  verified: boolean;
  last_verified?: Date;

  // Provenance
  source: string; // Where this came from
  created_at: Date;
  updated_at: Date;
  created_by: string; // Agent or human

  // Search optimization
  embedding?: number[]; // For semantic search
  keywords?: string[]; // For keyword search

  // Code
  code_examples?: CodeExample[];
}

interface CodeExample {
  language: string;
  source: string;
  file_path?: string; // If from actual file
  tested: boolean;
  works_with_versions?: string[]; // e.g., ["node>=18", "typescript>=5"]
}
```

## Operations

### Query

```typescript
// Semantic search
const results = await memoryCores.search({
  query: 'how to handle JWT refresh token rotation',
  cores: ['auth-jwt', 'security-patterns'],
  limit: 5,
});

// Graph traversal
const related = await memoryCores.traverse({
  startId: 'auth-001',
  depth: 2,
  relationTypes: ['related', 'depends_on'],
});

// Combined
const context = await memoryCores.getContext({
  task: 'implement user authentication',
  projectCore: 'acme-app',
  includePatterns: true,
});
```

### Curate

```typescript
// Add new entry (from working memory or manual)
await memoryCores.addEntry('gemini-cli', {
  title: 'Stale abort signals cause tool failures',
  content: 'When HTTP connection closes, abort signal persists...',
  type: 'gotcha',
  tags: ['mcp', 'a2a', 'debugging'],
  source: 'Debugging session 2024-12-20',
  confidence: 'high',
});

// Link entries
await memoryCores.link('gcli-005', 'gcli-002', 'related');

// Update confidence after verification
await memoryCores.verify('gcli-005', { verified: true });
```

### Promote from Working Memory

```typescript
// After task completion, extract learnings
const learnings = await workingMemory.extractLearnings(taskId);

// Curate into appropriate cores
for (const learning of learnings) {
  await memoryCores.addEntry(learning.suggestedCore, learning);
}
```

## Librarian Agent Role

The **Librarian** agent is responsible for:

1. **Curation** - Reviewing new entries, improving quality
2. **Deduplication** - Finding and merging duplicate knowledge
3. **Linking** - Discovering relationships between entries
4. **Maintenance** - Flagging stale knowledge, updating confidence
5. **Organization** - Suggesting better categorization

```typescript
// Librarian periodic tasks
await librarian.run({
  tasks: ['find-duplicates', 'suggest-links', 'flag-stale', 'improve-tagging'],
  cores: ['gemini-cli', 'typescript-patterns'],
});
```

## Bootstrap Strategy

How do we create the first memory cores?

1. **Extract from existing docs** - Parse SESSION_HANDOFF.md, README.md, etc.
2. **Import from conversations** - Extract learnings from past sessions
3. **Manual curation** - Human adds high-value entries
4. **Pattern from code** - Analyze existing good code for patterns

---

## Gaps & Open Questions

- [ ] What's the file format? YAML, JSON, Markdown, SQLite?
- [ ] How do we handle large code examples? Inline vs file reference?
- [ ] What's the embedding model and where does it run?
- [ ] How do we handle versioning of entries?
- [ ] What's the merge strategy when cores conflict?
- [ ] How do we garbage collect unused/stale entries?
- [ ] Should cores be git repos themselves for versioning?
- [ ] How do we share cores across machines/team members?
- [ ] What's the privacy model for personal vs shared cores?
- [ ] How do we handle code examples that become outdated?
- [ ] What's the indexing strategy for fast retrieval?
- [ ] How do we validate code examples still work?
