/**
 * Scenario Tests for MCP Bridge
 *
 * Tests real-world usage patterns for delegating work to Gemini as a subagent/intern:
 * - Model switching mid-session
 * - Multiple sessions with different models
 * - Context clearing and session reset
 * - File reading and Q&A workflows
 * - Typical grunt work scenarios
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { A2AClient, type A2ATaskResponse } from './a2a-client.js';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create a mock SSE response with the given events
 */
function createMockSSE(events: Partial<A2ATaskResponse>[]): string {
  return events
    .map((event, i) => {
      const fullEvent = {
        id: event.id || `task-${i}`,
        contextId: event.contextId || `ctx-${i}`,
        status: event.status || { state: 'working' },
        metadata: event.metadata || {},
        ...event,
      };
      return `data: {"jsonrpc":"2.0","id":"${i}","result":${JSON.stringify(fullEvent)}}\n\n`;
    })
    .join('');
}

/**
 * Create a mock text content event
 */
function createTextEvent(text: string, taskId = 'task-1', contextId = 'ctx-1'): Partial<A2ATaskResponse> {
  return {
    id: taskId,
    contextId,
    status: {
      state: 'working',
      message: {
        kind: 'message',
        role: 'agent',
        parts: [{ kind: 'text', text }],
        messageId: `msg-${Date.now()}`,
      },
    },
    metadata: { coderAgent: { kind: 'text-content' } },
  };
}

/**
 * Create a mock thought event
 */
function createThoughtEvent(subject: string, description: string, taskId = 'task-1'): Partial<A2ATaskResponse> {
  return {
    id: taskId,
    contextId: 'ctx-1',
    status: {
      state: 'working',
      message: {
        kind: 'message',
        role: 'agent',
        parts: [{ kind: 'data', data: { subject, description } }],
        messageId: `msg-${Date.now()}`,
      },
    },
    metadata: { coderAgent: { kind: 'thought' } },
  };
}

/**
 * Create a mock completed event
 */
function createCompletedEvent(taskId = 'task-1', contextId = 'ctx-1', model = 'gemini-3-pro-preview'): Partial<A2ATaskResponse> {
  return {
    id: taskId,
    contextId,
    status: { state: 'completed' },
    final: true,
    metadata: { model },
  };
}

/**
 * Create a mock pending approval event
 */
function createPendingApprovalEvent(
  callId: string,
  toolName: string,
  message: string,
  taskId = 'task-1'
): Partial<A2ATaskResponse> {
  return {
    id: taskId,
    contextId: 'ctx-1',
    status: {
      state: 'input-required',
      message: {
        kind: 'message',
        role: 'agent',
        parts: [{
          kind: 'data',
          data: {
            callId,
            name: toolName,
            status: 'awaiting_approval',
            tool: { name: toolName, displayName: toolName },
            confirmationDetails: { type: 'user-confirmation', message },
          },
        }],
        messageId: `msg-${Date.now()}`,
      },
    },
    metadata: { coderAgent: { kind: 'tool-call-confirmation' } },
  };
}

// ============================================================================
// Model Switching Tests
// ============================================================================

describe('Model Switching Scenarios', () => {
  let client: A2AClient;

  beforeEach(() => {
    client = new A2AClient('http://localhost:41242');
    mockFetch.mockReset();
  });

  describe('Model parameter in requests (future feature)', () => {
    it('should support model field in AgentSettings metadata', async () => {
      // This test documents the expected behavior when model selection is added
      // Currently, model is determined at A2A server startup, not per-request

      const mockSSE = createMockSSE([
        createTextEvent('Using Flash model for this task'),
        createCompletedEvent('task-1', 'ctx-1', 'gemini-3-flash-preview'),
      ]);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(mockSSE),
      });

      const events = await client.sendMessage(
        'Quick task for Flash',
        undefined,
        '/workspace',
        true
      );

      const parsed = client.parseEvents(events);

      // Document expected behavior - model should be trackable from response
      expect(parsed.model).toBe('gemini-3-flash-preview');
    });

    it('should track model changes across session events', async () => {
      // When model switching is supported, we should see the model change reflected
      const mockSSE = createMockSSE([
        {
          id: 'task-1',
          contextId: 'ctx-1',
          status: { state: 'working' },
          metadata: { model: 'gemini-3-pro-preview' }
        },
        createTextEvent('Analyzing code...'),
        createCompletedEvent('task-1', 'ctx-1', 'gemini-3-pro-preview'),
      ]);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(mockSSE),
      });

      const events = await client.sendMessage('Analyze this code', undefined, '/workspace');
      const parsed = client.parseEvents(events);

      expect(parsed.model).toBe('gemini-3-pro-preview');
      expect(parsed.taskState).toBe('completed');
    });
  });

  describe('Different models for different use cases', () => {
    it('should use Flash for grunt work tasks', async () => {
      // Simulating a task that should ideally use Flash (fast, cheap)
      const mockSSE = createMockSSE([
        createThoughtEvent('Searching codebase', 'Looking for auth-related files'),
        createTextEvent('Found 15 files related to authentication:\n- src/auth/login.ts\n- src/auth/logout.ts\n...'),
        createCompletedEvent('task-grunt', 'ctx-1', 'gemini-3-flash-preview'),
      ]);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(mockSSE),
      });

      const events = await client.sendMessage(
        'Find all files related to authentication',
        undefined,
        '/workspace',
        true
      );

      const parsed = client.parseEvents(events);
      expect(parsed.thoughts).toHaveLength(1);
      expect(parsed.textContent.length).toBeGreaterThan(0);
    });

    it('should use Pro for complex analysis tasks', async () => {
      // Simulating a task that should ideally use Pro (smart, thorough)
      const mockSSE = createMockSSE([
        createThoughtEvent('Deep Analysis', 'Reviewing architecture patterns and potential issues'),
        createTextEvent('## Security Analysis\n\n### Findings:\n1. SQL injection risk in user input handling\n2. Missing rate limiting on auth endpoints\n3. Credentials stored in plaintext config'),
        createCompletedEvent('task-analysis', 'ctx-1', 'gemini-3-pro-preview'),
      ]);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(mockSSE),
      });

      const events = await client.sendMessage(
        'Review this codebase for security vulnerabilities',
        undefined,
        '/workspace',
        true
      );

      const parsed = client.parseEvents(events);
      expect(parsed.textContent.join('')).toContain('Security Analysis');
    });
  });
});

// ============================================================================
// Session Management Tests
// ============================================================================

describe('Session Management Scenarios', () => {
  let client: A2AClient;

  beforeEach(() => {
    client = new A2AClient('http://localhost:41242');
    mockFetch.mockReset();
  });

  describe('Multiple independent sessions', () => {
    it('should maintain separate context for each session', async () => {
      // Session 1: Code search task
      const session1SSE = createMockSSE([
        createTextEvent('Found 5 auth files', 'task-session1', 'ctx-session1'),
        createCompletedEvent('task-session1', 'ctx-session1'),
      ]);

      // Session 2: Different task
      const session2SSE = createMockSSE([
        createTextEvent('Generated 10 test fixtures', 'task-session2', 'ctx-session2'),
        createCompletedEvent('task-session2', 'ctx-session2'),
      ]);

      mockFetch
        .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(session1SSE) })
        .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(session2SSE) });

      // Start both sessions
      const events1 = await client.sendMessage('Find auth files', undefined, '/workspace');
      const events2 = await client.sendMessage('Generate test fixtures', undefined, '/workspace');

      const parsed1 = client.parseEvents(events1);
      const parsed2 = client.parseEvents(events2);

      // Verify sessions are independent
      expect(parsed1.taskId).toBe('task-session1');
      expect(parsed2.taskId).toBe('task-session2');
      expect(parsed1.contextId).not.toBe(parsed2.contextId);
    });

    it('should continue conversation within same session', async () => {
      // First message in session
      const firstSSE = createMockSSE([
        createTextEvent('Found auth.ts file', 'task-1', 'ctx-1'),
        createCompletedEvent('task-1', 'ctx-1'),
      ]);

      // Follow-up in same session
      const followupSSE = createMockSSE([
        createTextEvent('The auth.ts file contains JWT validation logic', 'task-1', 'ctx-1'),
        createCompletedEvent('task-1', 'ctx-1'),
      ]);

      mockFetch
        .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(firstSSE) })
        .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(followupSSE) });

      // Start session
      const events1 = await client.sendMessage('Find the auth file', undefined, '/workspace');
      const parsed1 = client.parseEvents(events1);

      // Continue same session (pass taskId)
      const events2 = await client.sendMessage(
        'What does it do?',
        parsed1.taskId!, // Continue the session
        '/workspace'
      );
      const parsed2 = client.parseEvents(events2);

      // Same task ID indicates continued conversation
      expect(parsed2.taskId).toBe(parsed1.taskId);
    });
  });

  describe('Session listing', () => {
    it('should list all active tasks', async () => {
      const mockTasks = [
        { id: 'task-1', contextId: 'ctx-1', taskState: 'working', model: 'gemini-3-pro-preview' },
        { id: 'task-2', contextId: 'ctx-2', taskState: 'input-required', model: 'gemini-3-flash-preview' },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockTasks),
      });

      const tasks = await client.listTasks();

      expect(tasks).toHaveLength(2);
      expect(tasks[0].taskState).toBe('working');
      expect(tasks[1].taskState).toBe('input-required');
    });

    it('should handle empty session list', async () => {
      mockFetch.mockResolvedValueOnce({
        status: 204,
        ok: true,
      });

      const tasks = await client.listTasks();
      expect(tasks).toHaveLength(0);
    });
  });

  describe('Session cleanup', () => {
    it('should cancel a running task', async () => {
      const mockSSE = createMockSSE([
        { id: 'task-1', contextId: 'ctx-1', status: { state: 'canceled' }, final: true },
      ]);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(mockSSE),
      });

      const events = await client.cancelTask('task-1', 'ctx-1');
      const parsed = client.parseEvents(events);

      expect(parsed.taskState).toBe('canceled');
      expect(parsed.isFinal).toBe(true);
    });
  });
});

// ============================================================================
// Context Clearing Tests
// ============================================================================

describe('Context Clearing Scenarios', () => {
  let client: A2AClient;

  beforeEach(() => {
    client = new A2AClient('http://localhost:41242');
    mockFetch.mockReset();
  });

  describe('Starting fresh sessions', () => {
    it('should start new session without taskId for clean context', async () => {
      const mockSSE = createMockSSE([
        createTextEvent('Starting fresh analysis', 'new-task', 'new-ctx'),
        createCompletedEvent('new-task', 'new-ctx'),
      ]);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(mockSSE),
      });

      // Not passing taskId starts a fresh session
      const events = await client.sendMessage(
        'Analyze this fresh',
        undefined, // No taskId = new session
        '/workspace'
      );

      const parsed = client.parseEvents(events);
      expect(parsed.taskId).toBe('new-task');
    });

    it('should preserve context when passing existing taskId', async () => {
      const mockSSE = createMockSSE([
        createTextEvent('Continuing from where we left off'),
        createCompletedEvent('existing-task', 'existing-ctx'),
      ]);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(mockSSE),
      });

      const events = await client.sendMessage(
        'Continue the analysis',
        'existing-task', // Passing taskId continues session
        '/workspace'
      );

      // Verify taskId was sent on the message object (not in params root)
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.params.message.taskId).toBe('existing-task');
    });
  });

  describe('Clearing context by canceling and restarting', () => {
    it('should cancel old session and start fresh', async () => {
      // Cancel the old session
      const cancelSSE = createMockSSE([
        { id: 'old-task', contextId: 'old-ctx', status: { state: 'canceled' }, final: true },
      ]);

      // Start fresh
      const freshSSE = createMockSSE([
        createTextEvent('Starting with clean slate', 'fresh-task', 'fresh-ctx'),
        createCompletedEvent('fresh-task', 'fresh-ctx'),
      ]);

      mockFetch
        .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(cancelSSE) })
        .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(freshSSE) });

      // Cancel old
      await client.cancelTask('old-task', 'old-ctx');

      // Start fresh
      const events = await client.sendMessage('Start fresh', undefined, '/workspace');
      const parsed = client.parseEvents(events);

      expect(parsed.taskId).toBe('fresh-task');
      expect(parsed.contextId).toBe('fresh-ctx');
    });
  });
});

// ============================================================================
// File Reading and Q&A Tests
// ============================================================================

describe('File Reading and Q&A Scenarios', () => {
  let client: A2AClient;

  beforeEach(() => {
    client = new A2AClient('http://localhost:41242');
    mockFetch.mockReset();
  });

  describe('Reading files and answering questions', () => {
    it('should read a file and summarize its contents', async () => {
      const mockSSE = createMockSSE([
        createThoughtEvent('Reading file', 'Analyzing src/auth/login.ts'),
        createTextEvent(`## Summary of src/auth/login.ts

This file handles user authentication:
- \`login()\` - Validates credentials against database
- \`validateToken()\` - Checks JWT validity
- \`refreshSession()\` - Extends session timeout

Key dependencies: bcrypt, jsonwebtoken`),
        createCompletedEvent(),
      ]);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(mockSSE),
      });

      const events = await client.sendMessage(
        'Read src/auth/login.ts and summarize what it does',
        undefined,
        '/workspace',
        true
      );

      const parsed = client.parseEvents(events);
      expect(parsed.textContent.join('')).toContain('login()');
      expect(parsed.textContent.join('')).toContain('validateToken()');
    });

    it('should answer specific questions about file contents', async () => {
      const mockSSE = createMockSSE([
        createThoughtEvent('Analyzing', 'Looking for error handling patterns'),
        createTextEvent(`The file uses try-catch blocks for error handling:

1. **Database errors**: Caught in \`login()\`, returns 500 status
2. **Invalid credentials**: Returns 401 with generic message
3. **Token errors**: Caught in \`validateToken()\`, triggers re-auth

Best practice: Errors are logged but not exposed to clients.`),
        createCompletedEvent(),
      ]);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(mockSSE),
      });

      const events = await client.sendMessage(
        'How does src/auth/login.ts handle errors?',
        undefined,
        '/workspace',
        true
      );

      const parsed = client.parseEvents(events);
      expect(parsed.textContent.join('')).toContain('try-catch');
    });

    it('should read multiple files and compare them', async () => {
      const mockSSE = createMockSSE([
        createThoughtEvent('Multi-file analysis', 'Comparing auth implementations'),
        createTextEvent(`## Comparison: login.ts vs logout.ts

| Aspect | login.ts | logout.ts |
|--------|----------|-----------|
| Session handling | Creates new | Destroys existing |
| Token management | Issues JWT | Invalidates JWT |
| Error handling | Verbose | Simple |
| Lines of code | 150 | 45 |

**Recommendation**: logout.ts could benefit from the same error handling patterns used in login.ts.`),
        createCompletedEvent(),
      ]);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(mockSSE),
      });

      const events = await client.sendMessage(
        'Compare src/auth/login.ts and src/auth/logout.ts - what are the differences?',
        undefined,
        '/workspace',
        true
      );

      const parsed = client.parseEvents(events);
      expect(parsed.textContent.join('')).toContain('Comparison');
    });
  });

  describe('Searching codebase and explaining results', () => {
    it('should find files matching a pattern and explain them', async () => {
      const mockSSE = createMockSSE([
        createThoughtEvent('Searching', 'Looking for test files'),
        createTextEvent(`Found 12 test files matching pattern \`*.test.ts\`:

**Unit Tests (8 files)**:
- \`src/auth/login.test.ts\` - Authentication tests
- \`src/api/users.test.ts\` - User CRUD tests
...

**Integration Tests (4 files)**:
- \`tests/integration/auth.test.ts\` - E2E auth flow
...

Coverage: Unit tests cover core logic, integration tests cover API flows.`),
        createCompletedEvent(),
      ]);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(mockSSE),
      });

      const events = await client.sendMessage(
        'Find all test files and categorize them',
        undefined,
        '/workspace',
        true
      );

      const parsed = client.parseEvents(events);
      expect(parsed.textContent.join('')).toContain('test files');
    });
  });
});

// ============================================================================
// Grunt Work Scenarios (Intern Tasks)
// ============================================================================

describe('Grunt Work Scenarios (Intern Tasks)', () => {
  let client: A2AClient;

  beforeEach(() => {
    client = new A2AClient('http://localhost:41242');
    mockFetch.mockReset();
  });

  describe('Code search tasks', () => {
    it('should search for specific patterns across codebase', async () => {
      const mockSSE = createMockSSE([
        createThoughtEvent('Searching', 'Looking for console.log statements'),
        createTextEvent(`Found 23 instances of \`console.log\` across 8 files:

**High Priority (production code)**:
- src/api/server.ts:45 - \`console.log('Server starting')\`
- src/auth/login.ts:78 - \`console.log('Login attempt', email)\`

**Low Priority (test/dev code)**:
- tests/helpers.ts:12 - Debug logging
...

Recommendation: Remove the 2 high-priority logs before production.`),
        createCompletedEvent(),
      ]);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(mockSSE),
      });

      const events = await client.sendMessage(
        'Find all console.log statements that should be removed before production',
        undefined,
        '/workspace',
        true
      );

      const parsed = client.parseEvents(events);
      expect(parsed.textContent.join('')).toContain('console.log');
    });
  });

  describe('Test fixture generation', () => {
    it('should generate test data based on schema', async () => {
      const mockSSE = createMockSSE([
        createThoughtEvent('Generating', 'Creating User test fixtures'),
        createTextEvent(`Generated 10 User fixtures:

\`\`\`typescript
export const userFixtures = [
  { id: 1, email: 'john@example.com', name: 'John Doe', role: 'admin' },
  { id: 2, email: 'jane@example.com', name: 'Jane Smith', role: 'user' },
  // ... 8 more
];
\`\`\`

Fixtures include:
- 2 admins, 8 regular users
- Mix of verified/unverified emails
- Various edge cases (long names, special characters)`),
        createCompletedEvent(),
      ]);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(mockSSE),
      });

      const events = await client.sendMessage(
        'Generate 10 test fixtures for the User model with various edge cases',
        undefined,
        '/workspace',
        true
      );

      const parsed = client.parseEvents(events);
      expect(parsed.textContent.join('')).toContain('fixtures');
    });
  });

  describe('Bulk code modifications', () => {
    it('should plan bulk type additions', async () => {
      const mockSSE = createMockSSE([
        createThoughtEvent('Analysis', 'Finding untyped functions'),
        createTextEvent(`Found 15 functions missing TypeScript types in src/utils/:

1. \`formatDate(date)\` → \`formatDate(date: Date): string\`
2. \`parseConfig(data)\` → \`parseConfig(data: unknown): Config\`
3. \`validateEmail(email)\` → \`validateEmail(email: string): boolean\`
...

Ready to apply these type annotations. Approve to proceed.`),
        createPendingApprovalEvent('call-1', 'edit_file', 'Add types to src/utils/date.ts'),
        { id: 'task-1', contextId: 'ctx-1', status: { state: 'input-required' }, final: true },
      ]);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(mockSSE),
      });

      const events = await client.sendMessage(
        'Add TypeScript types to all functions in src/utils/',
        undefined,
        '/workspace',
        false // Need approval for edits
      );

      const parsed = client.parseEvents(events);
      expect(parsed.pendingApprovals.length).toBeGreaterThan(0);
      expect(parsed.taskState).toBe('input-required');
    });
  });

  describe('Code review tasks', () => {
    it('should review code for common issues', async () => {
      const mockSSE = createMockSSE([
        createThoughtEvent('Reviewing', 'Checking for common issues'),
        createTextEvent(`## Code Review: src/api/users.ts

### Issues Found:

**Critical**:
- Line 45: SQL injection vulnerability in user query
- Line 78: Unhandled promise rejection

**Medium**:
- Line 23: Magic number should be a constant
- Line 56: Duplicate code with src/api/admin.ts

**Minor**:
- Line 12: Unused import
- Line 89: Console.log left in

### Recommendations:
1. Use parameterized queries
2. Add try-catch around async operations`),
        createCompletedEvent(),
      ]);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(mockSSE),
      });

      const events = await client.sendMessage(
        'Review src/api/users.ts for bugs and code quality issues',
        undefined,
        '/workspace',
        true
      );

      const parsed = client.parseEvents(events);
      expect(parsed.textContent.join('')).toContain('Issues Found');
    });
  });

  describe('Research tasks', () => {
    it('should summarize how a feature works', async () => {
      const mockSSE = createMockSSE([
        createThoughtEvent('Research', 'Tracing error handling flow'),
        createTextEvent(`## Error Handling Architecture

### Flow:
1. **API Layer** (src/api/): Express error middleware catches all errors
2. **Service Layer** (src/services/): Business logic throws typed errors
3. **Data Layer** (src/db/): Database errors wrapped in DatabaseError

### Error Types:
- \`ValidationError\`: User input issues (400)
- \`AuthError\`: Authentication failures (401)
- \`NotFoundError\`: Resource missing (404)
- \`DatabaseError\`: DB connection/query issues (500)

### Logging:
All errors logged to src/utils/logger.ts with stack traces in dev mode.`),
        createCompletedEvent(),
      ]);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(mockSSE),
      });

      const events = await client.sendMessage(
        'Summarize how error handling works in this project',
        undefined,
        '/workspace',
        true
      );

      const parsed = client.parseEvents(events);
      expect(parsed.textContent.join('')).toContain('Error Handling');
    });
  });

  describe('Documentation tasks', () => {
    it('should generate documentation for a module', async () => {
      const mockSSE = createMockSSE([
        createThoughtEvent('Documenting', 'Analyzing auth module'),
        createTextEvent(`## Auth Module Documentation

### Overview
The auth module handles user authentication and session management.

### Files
| File | Purpose |
|------|---------|
| login.ts | Handle login flow |
| logout.ts | Handle logout |
| middleware.ts | Auth middleware |
| types.ts | Type definitions |

### Key Functions

#### \`login(email, password)\`
Authenticates user and returns JWT token.

#### \`validateSession(token)\`
Checks if session is valid and not expired.`),
        createCompletedEvent(),
      ]);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(mockSSE),
      });

      const events = await client.sendMessage(
        'Generate documentation for the auth module',
        undefined,
        '/workspace',
        true
      );

      const parsed = client.parseEvents(events);
      expect(parsed.textContent.join('')).toContain('Documentation');
    });
  });
});

// ============================================================================
// Tool Approval Workflow Tests
// ============================================================================

describe('Tool Approval Workflows', () => {
  let client: A2AClient;

  beforeEach(() => {
    client = new A2AClient('http://localhost:41242');
    mockFetch.mockReset();
  });

  describe('Approval flow', () => {
    it('should handle single tool approval', async () => {
      // Initial task that needs approval
      const taskSSE = createMockSSE([
        createThoughtEvent('Planning', 'Going to edit the file'),
        createPendingApprovalEvent('call-123', 'write_file', 'Write to src/config.ts'),
        { id: 'task-1', contextId: 'ctx-1', status: { state: 'input-required' }, final: true },
      ]);

      // After approval
      const approvedSSE = createMockSSE([
        createTextEvent('File updated successfully'),
        createCompletedEvent(),
      ]);

      mockFetch
        .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(taskSSE) })
        .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(approvedSSE) });

      // Send task
      const events1 = await client.sendMessage('Update the config file', undefined, '/workspace', false);
      const parsed1 = client.parseEvents(events1);

      expect(parsed1.pendingApprovals).toHaveLength(1);
      expect(parsed1.pendingApprovals[0].callId).toBe('call-123');

      // Send approval
      const events2 = await client.sendConfirmation('task-1', 'call-123', 'proceed_once');
      const parsed2 = client.parseEvents(events2);

      expect(parsed2.taskState).toBe('completed');
    });

    it('should handle denial and alternative approach', async () => {
      // Initial approach denied
      const denySSE = createMockSSE([
        createTextEvent('Understood. Let me try a different approach.'),
        createThoughtEvent('Replanning', 'User denied file edit, will suggest alternative'),
        createTextEvent('Instead of editing, I can show you the changes to make manually.'),
        createCompletedEvent(),
      ]);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(denySSE),
      });

      const events = await client.sendConfirmation('task-1', 'call-123', 'cancel');
      const parsed = client.parseEvents(events);

      expect(parsed.taskState).toBe('completed');
      expect(parsed.textContent.join('')).toContain('different approach');
    });

    it('should handle edit with modified content', async () => {
      const editedSSE = createMockSSE([
        createTextEvent('Applied your edited version successfully'),
        createCompletedEvent(),
      ]);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(editedSSE),
      });

      const events = await client.sendConfirmation(
        'task-1',
        'call-123',
        'modify_with_editor',
        undefined,
        'const config = { debug: false, env: "production" };' // User's edited content
      );

      // Verify request format
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.params.message.parts[0].data.outcome).toBe('modify_with_editor');
      expect(body.params.message.parts[0].data.newContent).toBe('const config = { debug: false, env: "production" };');
    });

    it('should handle trust_always for auto-approve', async () => {
      const trustedSSE = createMockSSE([
        createTextEvent('Great! Auto-approving all future tool calls in this session.'),
        createTextEvent('Editing 5 files...'),
        createCompletedEvent(),
      ]);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(trustedSSE),
      });

      const events = await client.sendConfirmation('task-1', 'call-123', 'proceed_always');
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);

      expect(body.params.message.parts[0].data.outcome).toBe('proceed_always');
    });
  });
});

// ============================================================================
// Error Handling Scenarios
// ============================================================================

describe('Error Handling Scenarios', () => {
  let client: A2AClient;

  beforeEach(() => {
    client = new A2AClient('http://localhost:41242');
    mockFetch.mockReset();
  });

  describe('Task failures', () => {
    it('should handle task failure gracefully', async () => {
      const failedSSE = createMockSSE([
        createThoughtEvent('Error', 'Unable to access file'),
        {
          id: 'task-1',
          contextId: 'ctx-1',
          status: { state: 'failed' },
          final: true,
          metadata: { error: 'ENOENT: no such file or directory' },
        },
      ]);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(failedSSE),
      });

      const events = await client.sendMessage('Read nonexistent.ts', undefined, '/workspace');
      const parsed = client.parseEvents(events);

      expect(parsed.taskState).toBe('failed');
      expect(parsed.errors).toContain('ENOENT: no such file or directory');
    });
  });

  describe('Network errors', () => {
    it('should throw on connection failure', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

      await expect(
        client.sendMessage('Hello', undefined, '/workspace')
      ).rejects.toThrow('Connection refused');
    });

    it('should handle server errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        statusText: 'Internal Server Error',
      });

      await expect(
        client.sendMessage('Hello', undefined, '/workspace')
      ).rejects.toThrow('Failed to send message: Internal Server Error');
    });
  });
});

// ============================================================================
// Consultation Scenarios (Quick Questions)
// ============================================================================

describe('Consultation Scenarios', () => {
  let client: A2AClient;

  beforeEach(() => {
    client = new A2AClient('http://localhost:41242');
    mockFetch.mockReset();
  });

  describe('Quick second opinions', () => {
    it('should provide code review feedback', async () => {
      const mockSSE = createMockSSE([
        createThoughtEvent('Reviewing', 'Analyzing the implementation'),
        createTextEvent(`## Review Feedback

**Looks Good**:
- Clean separation of concerns
- Good error handling

**Suggestions**:
- Consider adding input validation on line 23
- The retry logic could use exponential backoff

**Overall**: Solid implementation, minor improvements possible.`),
        createCompletedEvent(),
      ]);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(mockSSE),
      });

      const events = await client.sendMessage(
        'Review this code:\n\nfunction fetchData() { ... }',
        undefined,
        '/workspace',
        true // Auto-execute for consultations
      );

      const parsed = client.parseEvents(events);
      expect(parsed.textContent.join('')).toContain('Review Feedback');
    });

    it('should compare implementation approaches', async () => {
      const mockSSE = createMockSSE([
        createTextEvent(`## Comparison: Approach A vs B

**Approach A (Redux)**:
- Pros: Mature, great devtools
- Cons: Boilerplate, learning curve

**Approach B (Zustand)**:
- Pros: Simple, minimal boilerplate
- Cons: Smaller ecosystem

**Recommendation**: For a small-medium app, Zustand. For enterprise, Redux.`),
        createCompletedEvent(),
      ]);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(mockSSE),
      });

      const events = await client.sendMessage(
        'Should I use Redux or Zustand for state management?',
        undefined,
        '/workspace',
        true
      );

      const parsed = client.parseEvents(events);
      expect(parsed.textContent.join('')).toContain('Recommendation');
    });
  });
});
