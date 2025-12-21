# 11 - Code Index

**Status:** Draft **Last Updated:** 2024-12-20

## Purpose

Index codebases for semantic search - our own repos, curated SOTA examples, and
reference implementations. Memory cores link to specific code locations rather
than duplicating code.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                       Memory Cores                              │
│  "For JWT refresh, see the golden path in auth-reference..."   │
│                              │                                  │
│                              │ references                       │
│                              ▼                                  │
├─────────────────────────────────────────────────────────────────┤
│                       Code Index                                │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │ Private     │  │ Reference   │  │ SOTA        │             │
│  │ Repos       │  │ Codebases   │  │ Examples    │             │
│  │ (via PAT)   │  │ (curated)   │  │ (community) │             │
│  └─────────────┘  └─────────────┘  └─────────────┘             │
│         │                │                │                     │
│         └────────────────┼────────────────┘                     │
│                          ▼                                      │
│              ┌─────────────────────┐                           │
│              │   Unified Search    │                           │
│              │   (semantic + AST)  │                           │
│              └─────────────────────┘                           │
└─────────────────────────────────────────────────────────────────┘
```

## Codebase Registry

Track which repos are indexed and how.

```typescript
interface CodebaseRegistry {
  codebases: Codebase[];
}

interface Codebase {
  // Identity
  id: string;
  name: string;
  description: string;

  // Source
  source: CodebaseSource;

  // Classification
  type: CodebaseType;
  technologies: string[]; // e.g., ['typescript', 'react', 'jwt']
  domains: string[]; // e.g., ['auth', 'api', 'frontend']

  // Quality signals
  quality: 'reference' | 'good' | 'example';
  curated_by?: string; // Who added this as reference
  notes?: string; // Why it's valuable

  // State
  indexed: boolean;
  last_indexed?: Date;
  index_version?: number;

  // Stats
  file_count?: number;
  symbol_count?: number;
}

type CodebaseSource =
  | {
      type: 'github';
      owner: string;
      repo: string;
      branch?: string;
      auth?: 'pat' | 'public';
    }
  | { type: 'local'; path: string }
  | { type: 'gitlab'; project: string; auth?: 'token' }
  | { type: 'url'; clone_url: string };

type CodebaseType =
  | 'private' // Our own repos
  | 'reference' // Curated high-quality examples
  | 'sota' // State-of-the-art implementations
  | 'community'; // Popular open source
```

## Golden Paths

Curated paths through code that demonstrate best practices.

```typescript
interface GoldenPath {
  // Identity
  id: string;
  name: string;
  description: string;

  // What it teaches
  concept: string; // e.g., "JWT refresh token rotation"
  technologies: string[];
  difficulty: 'beginner' | 'intermediate' | 'advanced';

  // The path itself
  steps: GoldenPathStep[];

  // Source
  codebase_id: string; // Which codebase this is in
  base_path?: string; // Starting directory

  // Quality
  verified: boolean;
  last_verified?: Date;
  works_with: VersionConstraint[];

  // Links
  related_entries: string[]; // Memory core entries that reference this
  prerequisites?: string[]; // Other golden paths to understand first
}

interface GoldenPathStep {
  order: number;
  title: string;
  description: string; // What to learn from this step

  // Code reference
  file: string; // Path in codebase
  start_line?: number;
  end_line?: number;
  symbol?: string; // Function/class name

  // Content (cached from index)
  code_snippet?: string;
  language?: string;

  // Annotations
  key_concepts: string[]; // Things to notice
  gotchas?: string[]; // Common mistakes
}
```

**Example Golden Path:**

```yaml
id: jwt-refresh-rotation
name: 'JWT Refresh Token Rotation'
description: 'How to implement secure token refresh with rotation'
concept: 'jwt-refresh-rotation'
technologies: [typescript, express, jose]
difficulty: intermediate
codebase_id: auth-reference-impl

steps:
  - order: 1
    title: 'Token Service Interface'
    description: 'Start with the type definitions for tokens'
    file: src/auth/types.ts
    start_line: 15
    end_line: 42
    key_concepts:
      - 'Access token is short-lived (15 min)'
      - 'Refresh token includes rotation counter'

  - order: 2
    title: 'Token Generation'
    description: 'How tokens are created with proper claims'
    file: src/auth/token-service.ts
    symbol: generateTokenPair
    key_concepts:
      - 'RS256 signing for production'
      - 'jti claim for revocation tracking'
    gotchas:
      - "Don't use HS256 - shared secret is risky"

  - order: 3
    title: 'Refresh Flow'
    description: 'The rotation happens here'
    file: src/auth/token-service.ts
    symbol: refreshTokens
    key_concepts:
      - 'Invalidate old refresh token'
      - 'Issue new pair atomically'
      - 'Detect reuse attacks'

  - order: 4
    title: 'Middleware Integration'
    description: 'How it hooks into Express'
    file: src/middleware/auth.ts
    symbol: requireAuth
    key_concepts:
      - 'Access token in Authorization header'
      - 'Refresh token in httpOnly cookie'

related_entries:
  - jwt-security-lessons
  - auth-gotchas-collection
```

## Code Index Structure

How we index code for search.

```typescript
interface CodeIndex {
  codebase_id: string;

  // File-level index
  files: IndexedFile[];

  // Symbol-level index (AST-extracted)
  symbols: IndexedSymbol[];

  // Semantic index
  embeddings: CodeEmbedding[];
}

interface IndexedFile {
  path: string;
  language: string;
  size_bytes: number;
  last_modified: Date;

  // Content hash for change detection
  content_hash: string;

  // Extracted metadata
  imports: string[];
  exports: string[];
}

interface IndexedSymbol {
  id: string;
  file_path: string;

  // Symbol info
  name: string;
  kind: SymbolKind;
  signature?: string; // e.g., function signature
  documentation?: string; // JSDoc, docstring, etc.

  // Location
  start_line: number;
  end_line: number;
  start_column: number;
  end_column: number;

  // Relationships
  parent?: string; // Containing class/module
  children?: string[]; // Methods, nested functions
  references?: SymbolReference[]; // Where it's used
  calls?: string[]; // What it calls (for call graph)
}

type SymbolKind =
  | 'function'
  | 'method'
  | 'class'
  | 'interface'
  | 'type'
  | 'variable'
  | 'constant'
  | 'module'
  | 'enum';

interface SymbolReference {
  file_path: string;
  line: number;
  column: number;
  context: 'import' | 'call' | 'type' | 'extend' | 'implement';
}

interface CodeEmbedding {
  id: string;

  // What was embedded
  source_type: 'file' | 'symbol' | 'chunk';
  source_id: string; // File path or symbol ID

  // The embedding
  embedding: number[];

  // Context for retrieval
  content_preview: string; // First N chars for display
  technologies: string[]; // Detected from code
}
```

## Indexing Pipeline

How code gets indexed.

```typescript
interface IndexingPipeline {
  // 1. Fetch code
  fetch(codebase: Codebase): Promise<FetchResult>;

  // 2. Parse AST and extract symbols
  extractSymbols(files: File[]): Promise<IndexedSymbol[]>;

  // 3. Generate embeddings
  embedCode(symbols: IndexedSymbol[]): Promise<CodeEmbedding[]>;

  // 4. Store in index
  store(index: CodeIndex): Promise<void>;

  // 5. Link to memory cores
  linkToMemoryCores(index: CodeIndex): Promise<void>;
}
```

### GitHub Integration

```typescript
interface GitHubConfig {
  // Authentication
  pat?: string;                   // Personal access token for private repos
  app_id?: string;                // GitHub App for org access

  // Rate limiting
  requests_per_hour: number;
  concurrent_requests: number;

  // Caching
  cache_dir: string;
  cache_ttl_hours: number;
}

// Fetch from GitHub
async function fetchFromGitHub(
  source: { owner: string; repo: string; branch?: string },
  config: GitHubConfig
): Promise<FetchResult> {
  const octokit = new Octokit({ auth: config.pat });

  // Get tree
  const tree = await octokit.git.getTree({
    owner: source.owner,
    repo: source.repo,
    tree_sha: source.branch || 'main',
    recursive: 'true'
  });

  // Filter to code files
  const codeFiles = tree.data.tree.filter(item =>
    item.type === 'blob' && isCodeFile(item.path)
  );

  // Fetch content (with rate limiting)
  const files = await fetchWithRateLimit(codeFiles, config);

  return { files, metadata: { ... } };
}
```

## Search Capabilities

### Semantic Code Search

```typescript
// Find code that implements a concept
const results = await codeIndex.semanticSearch({
  query: 'implement rate limiting with sliding window',
  codebases: ['production-api', 'reference-patterns'],
  languages: ['typescript', 'go'],
  limit: 10,
});

// Returns ranked code snippets with context
// [
//   {
//     codebase: 'reference-patterns',
//     file: 'src/middleware/rate-limiter.ts',
//     symbol: 'slidingWindowRateLimiter',
//     score: 0.92,
//     snippet: 'export function slidingWindowRateLimiter...',
//     context: { before: 5, after: 5 }  // lines of context
//   },
//   ...
// ]
```

### Symbol Search

```typescript
// Find by symbol name (fuzzy)
const results = await codeIndex.symbolSearch({
  query: 'TokenService',
  kind: ['class', 'interface'],
  codebases: ['*'], // all indexed
});

// Find implementations of an interface
const impls = await codeIndex.findImplementations({
  interface: 'AuthProvider',
  codebase: 'production-api',
});

// Find callers of a function
const callers = await codeIndex.findCallers({
  symbol: 'validateToken',
  codebase: 'production-api',
});
```

### Combined with Memory Cores

```typescript
// Query that spans knowledge + code
async function findContextForTask(task: string): Promise<CombinedContext> {
  // 1. Search memory cores for relevant knowledge
  const knowledge = await memoryCores.search({
    query: task,
    types: ['lesson', 'pattern', 'gotcha'],
  });

  // 2. Get golden paths from matching entries
  const goldenPaths = knowledge
    .flatMap((k) => k.related_golden_paths)
    .filter(unique);

  // 3. Search code index for additional examples
  const codeExamples = await codeIndex.semanticSearch({
    query: task,
    limit: 5,
  });

  // 4. Combine and rank
  return {
    knowledge,
    goldenPaths,
    codeExamples,
    summary: await generateSummary(knowledge, goldenPaths, codeExamples),
  };
}
```

## Memory Core Integration

How entries reference code.

```typescript
interface MemoryEntry {
  // ... existing fields ...

  // Code references (NEW)
  code_refs?: CodeReference[];
  golden_paths?: string[]; // Golden path IDs
}

interface CodeReference {
  // What codebase
  codebase_id: string;

  // Location
  file_path: string;
  start_line?: number;
  end_line?: number;
  symbol?: string;

  // Why it's referenced
  relevance: string; // e.g., "Shows the refresh token rotation"

  // Cached content (for display without fetch)
  cached_snippet?: string;
  cached_at?: Date;
}
```

**Example entry with code refs:**

```yaml
id: jwt-refresh-lesson-001
title: 'Always rotate refresh tokens on use'
type: lesson
content: |
  When a refresh token is used, issue a new refresh token
  and invalidate the old one. This limits the damage from
  token theft - attacker can only use it once before it's
  invalid.

code_refs:
  - codebase_id: auth-reference-impl
    file_path: src/auth/token-service.ts
    symbol: refreshTokens
    relevance: 'Reference implementation of rotation'

  - codebase_id: our-production-api
    file_path: src/services/auth/refresh.ts
    start_line: 45
    end_line: 78
    relevance: 'How we do it in production'

golden_paths:
  - jwt-refresh-rotation

related:
  - jwt-security-lessons
  - auth-token-storage
```

## Curation Workflow

How we add reference codebases.

```typescript
// 1. Human identifies a good codebase
await codebaseRegistry.propose({
  name: "jose-examples",
  source: { type: 'github', owner: 'panva', repo: 'jose' },
  type: 'reference',
  technologies: ['typescript', 'jwt', 'jose'],
  domains: ['auth', 'crypto'],
  notes: "Official jose library examples - gold standard for JWT"
});

// 2. Librarian reviews and approves
await codebaseRegistry.approve('jose-examples', {
  curated_by: 'librarian-001',
  quality: 'reference'
});

// 3. Index is triggered
await indexingPipeline.index('jose-examples');

// 4. Create golden paths for key concepts
await goldenPaths.create({
  name: "JWT Signing with jose",
  codebase_id: 'jose-examples',
  steps: [ ... ]
});

// 5. Link to memory core entries
await memoryCores.link('jwt-signing-lesson', {
  code_ref: { codebase_id: 'jose-examples', ... }
});
```

## Keeping Index Fresh

```typescript
interface RefreshConfig {
  // Polling
  check_interval_hours: number;

  // Triggers
  on_push_webhook: boolean; // GitHub webhook on push
  on_release: boolean; // Re-index on new release

  // Incremental
  incremental: boolean; // Only re-index changed files
}

// Scheduled refresh
async function refreshIndex(codebase_id: string): Promise<void> {
  const codebase = await registry.get(codebase_id);

  // Check for changes
  const changes = await detectChanges(codebase);

  if (changes.length === 0) {
    return; // Nothing to do
  }

  // Incremental re-index
  for (const change of changes) {
    if (change.type === 'added' || change.type === 'modified') {
      await reindexFile(codebase_id, change.path);
    } else if (change.type === 'deleted') {
      await removeFromIndex(codebase_id, change.path);
    }
  }

  // Update golden paths if affected
  await updateAffectedGoldenPaths(codebase_id, changes);
}
```

---

## Gaps & Open Questions

- [ ] How do we handle large repos? (e.g., monorepos with 100k files)
- [ ] What's the storage footprint for code index?
- [ ] How do we handle rate limiting for GitHub API?
- [ ] Should we store full code or just metadata + fetch on demand?
- [ ] How do we detect breaking changes in golden paths?
- [ ] What's the auth model for accessing private repos in team setting?
- [ ] How do we handle binary files and generated code?
- [ ] Should we index dependencies (node_modules, etc.)?
- [ ] How do we handle code that's been removed but referenced?
- [ ] What's the versioning strategy for indexed code? (specific commit?)
- [ ] How do we handle multiple languages in same codebase?
- [ ] Should we support code snippets that span multiple files?
- [ ] How do we rank code quality automatically?
- [ ] What's the story for indexing notebooks (Jupyter)?
