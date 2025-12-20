/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * MCP Tool Handler Tests
 *
 * Tests the MCP server tool handlers that wrap the A2A client.
 * These tests verify the integration layer between MCP protocol and A2A.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { A2AClient, type A2ATaskResponse } from './a2a-client.js';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// ============================================================================
// Helper Functions
// ============================================================================

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

// ============================================================================
// Response Formatting Tests
// ============================================================================

describe('Response Formatting', () => {
  let client: A2AClient;

  beforeEach(() => {
    client = new A2AClient('http://localhost:41242');
    mockFetch.mockReset();
  });

  describe('ParsedEvents structure', () => {
    it('should have all required fields initialized', () => {
      const parsed = client.parseEvents([]);

      expect(parsed).toHaveProperty('textContent');
      expect(parsed).toHaveProperty('thoughts');
      expect(parsed).toHaveProperty('citations');
      expect(parsed).toHaveProperty('toolCalls');
      expect(parsed).toHaveProperty('pendingApprovals');
      expect(parsed).toHaveProperty('taskState');
      expect(parsed).toHaveProperty('taskId');
      expect(parsed).toHaveProperty('contextId');
      expect(parsed).toHaveProperty('model');
      expect(parsed).toHaveProperty('errors');
      expect(parsed).toHaveProperty('isFinal');
    });

    it('should initialize arrays as empty', () => {
      const parsed = client.parseEvents([]);

      expect(parsed.textContent).toEqual([]);
      expect(parsed.thoughts).toEqual([]);
      expect(parsed.citations).toEqual([]);
      expect(parsed.toolCalls).toEqual([]);
      expect(parsed.pendingApprovals).toEqual([]);
      expect(parsed.errors).toEqual([]);
    });

    it('should initialize nullable fields as null', () => {
      const parsed = client.parseEvents([]);

      expect(parsed.taskState).toBeNull();
      expect(parsed.taskId).toBeNull();
      expect(parsed.contextId).toBeNull();
      expect(parsed.model).toBeNull();
    });

    it('should initialize isFinal as false', () => {
      const parsed = client.parseEvents([]);
      expect(parsed.isFinal).toBe(false);
    });
  });

  describe('Text content extraction', () => {
    it('should extract multiple text parts', () => {
      const events: A2ATaskResponse[] = [
        {
          id: 'task-1',
          contextId: 'ctx-1',
          status: {
            state: 'working',
            message: {
              kind: 'message',
              role: 'agent',
              parts: [
                { kind: 'text', text: 'First paragraph' },
                { kind: 'text', text: 'Second paragraph' },
              ],
              messageId: 'msg-1',
            },
          },
          metadata: { coderAgent: { kind: 'text-content' } },
        },
      ];

      const parsed = client.parseEvents(events);
      expect(parsed.textContent).toHaveLength(2);
      expect(parsed.textContent[0]).toBe('First paragraph');
      expect(parsed.textContent[1]).toBe('Second paragraph');
    });

    it('should handle events without text', () => {
      const events: A2ATaskResponse[] = [
        {
          id: 'task-1',
          contextId: 'ctx-1',
          status: {
            state: 'working',
            message: {
              kind: 'message',
              role: 'agent',
              parts: [{ kind: 'data', data: { some: 'data' } }],
              messageId: 'msg-1',
            },
          },
          metadata: { coderAgent: { kind: 'text-content' } },
        },
      ];

      const parsed = client.parseEvents(events);
      expect(parsed.textContent).toHaveLength(0);
    });
  });

  describe('Thought extraction', () => {
    it('should extract thoughts with subject and description', () => {
      const events: A2ATaskResponse[] = [
        {
          id: 'task-1',
          contextId: 'ctx-1',
          status: {
            state: 'working',
            message: {
              kind: 'message',
              role: 'agent',
              parts: [
                {
                  kind: 'data',
                  data: {
                    subject: 'Analysis',
                    description: 'Reviewing the code structure',
                  },
                },
              ],
              messageId: 'msg-1',
            },
          },
          metadata: { coderAgent: { kind: 'thought' } },
        },
      ];

      const parsed = client.parseEvents(events);
      expect(parsed.thoughts).toHaveLength(1);
      expect(parsed.thoughts[0]).toEqual({
        subject: 'Analysis',
        description: 'Reviewing the code structure',
      });
    });

    it('should skip thoughts without subject or description', () => {
      const events: A2ATaskResponse[] = [
        {
          id: 'task-1',
          contextId: 'ctx-1',
          status: {
            state: 'working',
            message: {
              kind: 'message',
              role: 'agent',
              parts: [{ kind: 'data', data: { unrelated: 'field' } }],
              messageId: 'msg-1',
            },
          },
          metadata: { coderAgent: { kind: 'thought' } },
        },
      ];

      const parsed = client.parseEvents(events);
      expect(parsed.thoughts).toHaveLength(0);
    });
  });

  describe('Tool call tracking', () => {
    it('should track tool calls with different statuses', () => {
      const events: A2ATaskResponse[] = [
        {
          id: 'task-1',
          contextId: 'ctx-1',
          status: {
            state: 'working',
            message: {
              kind: 'message',
              role: 'agent',
              parts: [
                {
                  kind: 'data',
                  data: {
                    request: {
                      callId: 'call-1',
                      name: 'read_file',
                      args: {},
                    },
                    status: 'success',
                  },
                },
              ],
              messageId: 'msg-1',
            },
          },
          metadata: { coderAgent: { kind: 'tool-call-update' } },
        },
        {
          id: 'task-1',
          contextId: 'ctx-1',
          status: {
            state: 'working',
            message: {
              kind: 'message',
              role: 'agent',
              parts: [
                {
                  kind: 'data',
                  data: {
                    request: {
                      callId: 'call-2',
                      name: 'write_file',
                      args: {},
                    },
                    status: 'awaiting_approval',
                  },
                },
              ],
              messageId: 'msg-2',
            },
          },
          metadata: { coderAgent: { kind: 'tool-call-confirmation' } },
        },
      ];

      const parsed = client.parseEvents(events);
      expect(parsed.toolCalls).toHaveLength(2);
      expect(parsed.pendingApprovals).toHaveLength(1);
      expect(parsed.pendingApprovals[0].callId).toBe('call-2');
    });
  });
});

// ============================================================================
// Edge Cases
// ============================================================================

describe('Edge Cases', () => {
  let client: A2AClient;

  beforeEach(() => {
    client = new A2AClient('http://localhost:41242');
    mockFetch.mockReset();
  });

  describe('Large responses', () => {
    it('should handle many events', async () => {
      // Create 100 events
      const events = Array.from({ length: 100 }, (_, i) => ({
        id: 'task-1',
        contextId: 'ctx-1',
        status: {
          state: i === 99 ? 'completed' : 'working',
          message: {
            kind: 'message',
            role: 'agent',
            parts: [{ kind: 'text', text: `Event ${i}` }],
            messageId: `msg-${i}`,
          },
        },
        final: i === 99,
        metadata: { coderAgent: { kind: 'text-content' } },
      }));

      const mockSSE = createMockSSE(events as Partial<A2ATaskResponse>[]);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(mockSSE),
      });

      const result = await client.sendMessage(
        'Large task',
        undefined,
        '/workspace',
      );
      const parsed = client.parseEvents(result);

      expect(parsed.textContent).toHaveLength(100);
      expect(parsed.isFinal).toBe(true);
    });

    it('should handle very long text content', () => {
      const longText = 'x'.repeat(100000); // 100KB of text
      const events: A2ATaskResponse[] = [
        {
          id: 'task-1',
          contextId: 'ctx-1',
          status: {
            state: 'completed',
            message: {
              kind: 'message',
              role: 'agent',
              parts: [{ kind: 'text', text: longText }],
              messageId: 'msg-1',
            },
          },
          final: true,
          metadata: { coderAgent: { kind: 'text-content' } },
        },
      ];

      const parsed = client.parseEvents(events);
      expect(parsed.textContent[0]).toHaveLength(100000);
    });
  });

  describe('Malformed data', () => {
    it('should handle events without coderAgent metadata', () => {
      const events: A2ATaskResponse[] = [
        {
          id: 'task-1',
          contextId: 'ctx-1',
          status: { state: 'working' },
          metadata: {}, // No coderAgent
        },
      ];

      const parsed = client.parseEvents(events);
      expect(parsed.taskId).toBe('task-1');
      expect(parsed.textContent).toHaveLength(0);
    });

    it('should handle events without status message', () => {
      const events: A2ATaskResponse[] = [
        {
          id: 'task-1',
          contextId: 'ctx-1',
          status: { state: 'working' }, // No message
          metadata: { coderAgent: { kind: 'text-content' } },
        },
      ];

      const parsed = client.parseEvents(events);
      expect(parsed.taskState).toBe('working');
      expect(parsed.textContent).toHaveLength(0);
    });

    it('should skip SSE lines without data prefix', async () => {
      const malformedSSE = [
        'event: status',
        'data: {"jsonrpc":"2.0","id":"1","result":{"id":"task-1","contextId":"ctx-1","status":{"state":"completed"},"final":true}}',
        '',
        'comment: this is ignored',
        '',
      ].join('\n');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(malformedSSE),
      });

      const events = await client.sendMessage('test', undefined, '/workspace');
      const parsed = client.parseEvents(events);

      expect(parsed.taskState).toBe('completed');
    });
  });

  describe('State transitions', () => {
    it('should track state through transitions', () => {
      const events: A2ATaskResponse[] = [
        { id: 'task-1', contextId: 'ctx-1', status: { state: 'submitted' } },
        { id: 'task-1', contextId: 'ctx-1', status: { state: 'working' } },
        {
          id: 'task-1',
          contextId: 'ctx-1',
          status: { state: 'input-required' },
        },
        { id: 'task-1', contextId: 'ctx-1', status: { state: 'working' } },
        {
          id: 'task-1',
          contextId: 'ctx-1',
          status: { state: 'completed' },
          final: true,
        },
      ];

      const parsed = client.parseEvents(events);
      // Final state should be the last one
      expect(parsed.taskState).toBe('completed');
      expect(parsed.isFinal).toBe(true);
    });

    it('should handle failed state', () => {
      const events: A2ATaskResponse[] = [
        { id: 'task-1', contextId: 'ctx-1', status: { state: 'working' } },
        {
          id: 'task-1',
          contextId: 'ctx-1',
          status: { state: 'failed' },
          final: true,
          metadata: { error: 'Task failed due to error' },
        },
      ];

      const parsed = client.parseEvents(events);
      expect(parsed.taskState).toBe('failed');
      expect(parsed.errors).toContain('Task failed due to error');
    });
  });
});

// ============================================================================
// Workspace Handling Tests
// ============================================================================

describe('Workspace Handling', () => {
  let client: A2AClient;

  beforeEach(() => {
    client = new A2AClient('http://localhost:41242');
    mockFetch.mockReset();
  });

  it('should include workspace in metadata', async () => {
    const mockSSE = createMockSSE([
      {
        id: 'task-1',
        contextId: 'ctx-1',
        status: { state: 'completed' },
        final: true,
      },
    ]);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(mockSSE),
    });

    await client.sendMessage('test', undefined, '/path/to/workspace', false);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.params.message.metadata.coderAgent.workspacePath).toBe(
      '/path/to/workspace',
    );
  });

  it('should include autoExecute setting', async () => {
    const mockSSE = createMockSSE([
      {
        id: 'task-1',
        contextId: 'ctx-1',
        status: { state: 'completed' },
        final: true,
      },
    ]);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(mockSSE),
    });

    await client.sendMessage('test', undefined, '/workspace', true);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.params.message.metadata.coderAgent.autoExecute).toBe(true);
  });

  it('should work without workspace (no metadata)', async () => {
    const mockSSE = createMockSSE([
      {
        id: 'task-1',
        contextId: 'ctx-1',
        status: { state: 'completed' },
        final: true,
      },
    ]);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(mockSSE),
    });

    await client.sendMessage('test');

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.params.metadata).toBeUndefined();
  });
});

// ============================================================================
// CLI Command Tests
// ============================================================================

describe('CLI Command Handling', () => {
  let client: A2AClient;

  beforeEach(() => {
    client = new A2AClient('http://localhost:41242');
    mockFetch.mockReset();
  });

  describe('listCommands', () => {
    it('should return empty array when no commands available', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ commands: [] }),
      });

      const commands = await client.listCommands();
      expect(commands).toEqual([]);
    });

    it('should return full command info with subcommands', async () => {
      const mockCommands = [
        {
          name: 'restore',
          description: 'Restore checkpoints',
          arguments: [],
          subCommands: [
            {
              name: 'list',
              description: 'List checkpoints',
              arguments: [],
              subCommands: [],
            },
          ],
        },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ commands: mockCommands }),
      });

      const commands = await client.listCommands();
      expect(commands[0].subCommands).toHaveLength(1);
      expect(commands[0].subCommands[0].name).toBe('list');
    });
  });

  describe('executeCommand', () => {
    it('should handle command with no args', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ name: 'init', data: { success: true } }),
      });

      await client.executeCommand('init');

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.command).toBe('init');
      expect(body.args).toEqual([]);
    });

    it('should throw on command failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        statusText: 'Bad Request',
        json: () => Promise.resolve({ error: 'Unknown command' }),
      });

      await expect(client.executeCommand('unknown')).rejects.toThrow(
        'Unknown command',
      );
    });
  });
});

// ============================================================================
// Health Check and Agent Card Tests
// ============================================================================

describe('Discovery and Health', () => {
  let client: A2AClient;

  beforeEach(() => {
    client = new A2AClient('http://localhost:41242');
    mockFetch.mockReset();
  });

  describe('healthCheck', () => {
    it('should return true when agent card accessible', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      const healthy = await client.healthCheck();
      expect(healthy).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:41242/.well-known/agent-card.json',
      );
    });

    it('should return false on network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const healthy = await client.healthCheck();
      expect(healthy).toBe(false);
    });

    it('should return false on non-200 response', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });

      const healthy = await client.healthCheck();
      expect(healthy).toBe(false);
    });
  });

  describe('getAgentCard', () => {
    it('should parse full agent card', async () => {
      const mockCard = {
        name: 'Gemini SDLC Agent',
        version: '0.0.2',
        description: 'An agent for development',
        provider: { organization: 'Google', url: 'https://google.com' },
        protocolVersion: '0.3.0',
        capabilities: {
          streaming: true,
          pushNotifications: false,
          stateTransitionHistory: true,
        },
        skills: [
          {
            id: 'code-gen',
            name: 'Code Generation',
            description: 'Generates code',
          },
        ],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockCard),
      });

      const card = await client.getAgentCard();
      expect(card.name).toBe('Gemini SDLC Agent');
      expect(card.capabilities.streaming).toBe(true);
      expect(card.skills).toHaveLength(1);
    });

    it('should throw on failed fetch', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        statusText: 'Service Unavailable',
      });

      await expect(client.getAgentCard()).rejects.toThrow(
        'Failed to get agent card: Service Unavailable',
      );
    });
  });
});

// ============================================================================
// Citation Handling
// ============================================================================

describe('Citation Handling', () => {
  let client: A2AClient;

  beforeEach(() => {
    client = new A2AClient('http://localhost:41242');
    mockFetch.mockReset();
  });

  it('should extract citations from events', () => {
    const events: A2ATaskResponse[] = [
      {
        id: 'task-1',
        contextId: 'ctx-1',
        status: {
          state: 'working',
          message: {
            kind: 'message',
            role: 'agent',
            parts: [
              { kind: 'text', text: 'https://docs.example.com/api' },
              { kind: 'text', text: 'https://github.com/example/repo' },
            ],
            messageId: 'msg-1',
          },
        },
        metadata: { coderAgent: { kind: 'citation' } },
      },
    ];

    const parsed = client.parseEvents(events);
    expect(parsed.citations).toHaveLength(2);
    expect(parsed.citations).toContain('https://docs.example.com/api');
    expect(parsed.citations).toContain('https://github.com/example/repo');
  });
});

// ============================================================================
// Streaming Callback Tests
// ============================================================================

describe('Streaming Callbacks', () => {
  let client: A2AClient;

  beforeEach(() => {
    client = new A2AClient('http://localhost:41242');
    mockFetch.mockReset();
  });

  it('should call onEvent for each SSE event', async () => {
    const chunks = [
      'data: {"jsonrpc":"2.0","id":"1","result":{"id":"task-1","status":{"state":"working"}}}\n\n',
      'data: {"jsonrpc":"2.0","id":"2","result":{"id":"task-1","status":{"state":"completed"},"final":true}}\n\n',
    ];

    const mockBody = {
      getReader: () => {
        let index = 0;
        return {
          read: async () => {
            if (index < chunks.length) {
              const chunk = chunks[index++];
              return { done: false, value: new TextEncoder().encode(chunk) };
            }
            return { done: true, value: undefined };
          },
        };
      },
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      body: mockBody,
    });

    const events: A2ATaskResponse[] = [];
    await client.sendMessageStreaming(
      'test',
      (event) => events.push(event),
      undefined,
      '/workspace',
    );

    expect(events).toHaveLength(2);
    expect(events[0].status.state).toBe('working');
    expect(events[1].status.state).toBe('completed');
  });
});
