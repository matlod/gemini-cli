/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Tests for A2A Client
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { A2AClient, type A2ATaskResponse } from './a2a-client.js';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('A2AClient', () => {
  let client: A2AClient;

  beforeEach(() => {
    client = new A2AClient('http://localhost:41242');
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should use default URL if not provided', () => {
      const defaultClient = new A2AClient();
      expect(defaultClient).toBeDefined();
    });

    it('should use provided URL', () => {
      const customClient = new A2AClient('http://custom:8080');
      expect(customClient).toBeDefined();
    });
  });

  describe('getAgentCard', () => {
    it('should fetch agent card from well-known endpoint', async () => {
      const mockAgentCard = {
        name: 'Gemini SDLC Agent',
        version: '0.0.2',
        capabilities: { streaming: true },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockAgentCard),
      });

      const result = await client.getAgentCard();

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:41242/.well-known/agent-card.json',
      );
      expect(result).toEqual(mockAgentCard);
    });

    it('should throw error on failed fetch', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        statusText: 'Not Found',
      });

      await expect(client.getAgentCard()).rejects.toThrow(
        'Failed to get agent card: Not Found',
      );
    });
  });

  describe('healthCheck', () => {
    it('should return true when server is reachable', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      const result = await client.healthCheck();

      expect(result).toBe(true);
    });

    it('should return false when server is not reachable', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

      const result = await client.healthCheck();

      expect(result).toBe(false);
    });

    it('should return false when server returns error', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false });

      const result = await client.healthCheck();

      expect(result).toBe(false);
    });
  });

  describe('sendMessage', () => {
    it('should wrap message in JSON-RPC envelope', async () => {
      const mockSSE =
        'data: {"jsonrpc":"2.0","id":"1","result":{"kind":"status-update","status":{"state":"completed"}}}\n\n';

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(mockSSE),
      });

      await client.sendMessage('Hello', undefined, '/workspace');

      const callArgs = mockFetch.mock.calls[0];
      expect(callArgs[0]).toBe('http://localhost:41242/');
      expect(callArgs[1].method).toBe('POST');
      expect(callArgs[1].headers['Content-Type']).toBe('application/json');

      const body = JSON.parse(callArgs[1].body);
      expect(body.jsonrpc).toBe('2.0');
      expect(body.method).toBe('message/stream');
      expect(body.params.message.kind).toBe('message');
      expect(body.params.message.role).toBe('user');
      expect(body.params.message.parts[0].text).toBe('Hello');
      expect(body.params.message.metadata.coderAgent.workspacePath).toBe(
        '/workspace',
      );
    });

    it('should include taskId on message object when provided', async () => {
      const mockSSE = 'data: {"jsonrpc":"2.0","id":"1","result":{}}\n\n';

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(mockSSE),
      });

      await client.sendMessage('Continue', 'task-123', '/workspace');

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      // taskId must be on the message object for SDK session continuity
      expect(body.params.message.taskId).toBe('task-123');
    });

    it('should set autoExecute in metadata', async () => {
      const mockSSE = 'data: {"jsonrpc":"2.0","id":"1","result":{}}\n\n';

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(mockSSE),
      });

      await client.sendMessage('Run everything', undefined, '/workspace', true);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.params.message.metadata.coderAgent.autoExecute).toBe(true);
    });

    it('should throw error on failed request', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        statusText: 'Internal Server Error',
      });

      await expect(
        client.sendMessage('Hello', undefined, '/workspace'),
      ).rejects.toThrow('Failed to send message: Internal Server Error');
    });
  });

  describe('sendConfirmation', () => {
    it('should send tool confirmation with correct format', async () => {
      const mockSSE = 'data: {"jsonrpc":"2.0","id":"1","result":{}}\n\n';

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(mockSSE),
      });

      await client.sendConfirmation('task-123', 'call-456', 'proceed_once');

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.jsonrpc).toBe('2.0');
      expect(body.method).toBe('message/stream');
      // CRITICAL: taskId must be ON the message object, not at params level
      expect(body.params.message.taskId).toBe('task-123');
      expect(body.params.message.parts[0].kind).toBe('data');
      expect(body.params.message.parts[0].data.callId).toBe('call-456');
      expect(body.params.message.parts[0].data.outcome).toBe('proceed_once');
    });

    it('should include newContent for modify_with_editor', async () => {
      const mockSSE = 'data: {"jsonrpc":"2.0","id":"1","result":{}}\n\n';

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(mockSSE),
      });

      await client.sendConfirmation(
        'task-123',
        'call-456',
        'modify_with_editor',
        undefined,
        'new file content',
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.params.message.parts[0].data.newContent).toBe(
        'new file content',
      );
    });
  });

  describe('cancelTask', () => {
    it('should send cancel message', async () => {
      const mockSSE = 'data: {"jsonrpc":"2.0","id":"1","result":{}}\n\n';

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(mockSSE),
      });

      await client.cancelTask('task-123', 'context-456');

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.method).toBe('message/stream');
      // taskId must be ON the message object, not at params level
      expect(body.params.message.taskId).toBe('task-123');
      expect(body.params.message.contextId).toBe('context-456');
      expect(body.params.message.parts[0].text).toBe('/cancel');
    });
  });

  describe('parseSSEResponse', () => {
    it('should parse multiple SSE events', async () => {
      const mockSSE = [
        'data: {"jsonrpc":"2.0","id":"1","result":{"id":"task-1","status":{"state":"submitted"}}}\n\n',
        'data: {"jsonrpc":"2.0","id":"1","result":{"id":"task-1","status":{"state":"working"}}}\n\n',
        'data: {"jsonrpc":"2.0","id":"1","result":{"id":"task-1","status":{"state":"completed"}}}\n\n',
      ].join('');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(mockSSE),
      });

      const result = await client.sendMessage('test', undefined, '/workspace');

      expect(result).toHaveLength(3);
      expect(result[0].status.state).toBe('submitted');
      expect(result[1].status.state).toBe('working');
      expect(result[2].status.state).toBe('completed');
    });

    it('should skip malformed SSE events', async () => {
      const mockSSE = [
        'data: {"jsonrpc":"2.0","id":"1","result":{"status":{"state":"working"}}}\n\n',
        'data: not-valid-json\n\n',
        'data: {"jsonrpc":"2.0","id":"1","result":{"status":{"state":"completed"}}}\n\n',
      ].join('');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(mockSSE),
      });

      const result = await client.sendMessage('test', undefined, '/workspace');

      expect(result).toHaveLength(2);
    });

    it('should handle empty response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(''),
      });

      const result = await client.sendMessage('test', undefined, '/workspace');

      expect(result).toHaveLength(0);
    });
  });

  describe('parseEvents', () => {
    it('should extract text content from events', () => {
      const events: A2ATaskResponse[] = [
        {
          id: 'task-1',
          contextId: 'ctx-1',
          status: {
            state: 'working',
            message: {
              kind: 'message',
              role: 'agent',
              parts: [{ kind: 'text', text: 'Hello world' }],
              messageId: 'msg-1',
            },
          },
          metadata: { coderAgent: { kind: 'text-content' } },
        },
      ];

      const result = client.parseEvents(events);

      expect(result.textContent).toContain('Hello world');
    });

    it('should extract thoughts from events', () => {
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
                    subject: 'Planning',
                    description: 'Thinking about approach',
                  },
                },
              ],
              messageId: 'msg-1',
            },
          },
          metadata: { coderAgent: { kind: 'thought' } },
        },
      ];

      const result = client.parseEvents(events);

      expect(result.thoughts).toHaveLength(1);
      expect(result.thoughts[0].subject).toBe('Planning');
    });

    it('should identify pending approvals', () => {
      const events: A2ATaskResponse[] = [
        {
          id: 'task-1',
          contextId: 'ctx-1',
          status: {
            state: 'input-required',
            message: {
              kind: 'message',
              role: 'agent',
              parts: [
                {
                  kind: 'data',
                  data: {
                    // Real A2A format: callId is nested inside request object
                    request: {
                      callId: 'call-123',
                      name: 'write_file',
                      args: { path: '/tmp/test.txt', content: 'hello' },
                    },
                    status: 'awaiting_approval',
                    confirmationDetails: { type: 'write' },
                  },
                },
              ],
              messageId: 'msg-1',
            },
          },
          metadata: { coderAgent: { kind: 'tool-call-confirmation' } },
        },
      ];

      const result = client.parseEvents(events);

      expect(result.pendingApprovals).toHaveLength(1);
      expect(result.pendingApprovals[0].callId).toBe('call-123');
      expect(result.pendingApprovals[0].status).toBe('awaiting_approval');
    });

    it('should extract task state and IDs', () => {
      const events: A2ATaskResponse[] = [
        {
          id: 'task-123',
          contextId: 'ctx-456',
          status: { state: 'working' },
          metadata: { model: 'gemini-3-pro-preview' },
        },
        {
          id: 'task-123',
          contextId: 'ctx-456',
          status: { state: 'completed' },
          final: true,
        },
      ];

      const result = client.parseEvents(events);

      expect(result.taskId).toBe('task-123');
      expect(result.contextId).toBe('ctx-456');
      expect(result.taskState).toBe('completed');
      expect(result.model).toBe('gemini-3-pro-preview');
      expect(result.isFinal).toBe(true);
    });

    it('should extract citations', () => {
      const events: A2ATaskResponse[] = [
        {
          id: 'task-1',
          contextId: 'ctx-1',
          status: {
            state: 'working',
            message: {
              kind: 'message',
              role: 'agent',
              parts: [{ kind: 'text', text: 'https://example.com/source' }],
              messageId: 'msg-1',
            },
          },
          metadata: { coderAgent: { kind: 'citation' } },
        },
      ];

      const result = client.parseEvents(events);

      expect(result.citations).toContain('https://example.com/source');
    });

    it('should capture errors from metadata', () => {
      const events: A2ATaskResponse[] = [
        {
          id: 'task-1',
          contextId: 'ctx-1',
          status: { state: 'failed' },
          metadata: { error: 'Something went wrong' },
        },
      ];

      const result = client.parseEvents(events);

      expect(result.errors).toContain('Something went wrong');
    });

    it('should handle empty events array', () => {
      const result = client.parseEvents([]);

      expect(result.textContent).toHaveLength(0);
      expect(result.thoughts).toHaveLength(0);
      expect(result.toolCalls).toHaveLength(0);
      expect(result.pendingApprovals).toHaveLength(0);
      expect(result.taskState).toBeNull();
    });
  });

  describe('listCommands', () => {
    it('should fetch commands from endpoint', async () => {
      const mockCommands = [
        {
          name: 'init',
          description: 'Initialize project',
          arguments: [],
          subCommands: [],
        },
        {
          name: 'restore',
          description: 'Restore checkpoint',
          arguments: [],
          subCommands: [],
        },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ commands: mockCommands }),
      });

      const result = await client.listCommands();

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:41242/listCommands',
      );
      expect(result).toEqual(mockCommands);
    });
  });

  describe('executeCommand', () => {
    it('should execute command with args', async () => {
      const mockResult = { name: 'restore', data: { success: true } };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResult),
      });

      const result = await client.executeCommand('restore', ['checkpoint-1']);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:41242/executeCommand',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            command: 'restore',
            args: ['checkpoint-1'],
          }),
        }),
      );
      expect(result).toEqual(mockResult);
    });
  });
});

describe('JSON-RPC Envelope Format', () => {
  let client: A2AClient;

  beforeEach(() => {
    client = new A2AClient('http://localhost:41242');
    mockFetch.mockReset();
  });

  it('should generate unique request IDs', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve('') })
      .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve('') });

    await client.sendMessage('First', undefined, '/workspace');
    await client.sendMessage('Second', undefined, '/workspace');

    const body1 = JSON.parse(mockFetch.mock.calls[0][1].body);
    const body2 = JSON.parse(mockFetch.mock.calls[1][1].body);

    expect(body1.id).not.toBe(body2.id);
  });

  it('should generate unique message IDs', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve('') })
      .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve('') });

    await client.sendMessage('First', undefined, '/workspace');
    await client.sendMessage('Second', undefined, '/workspace');

    const body1 = JSON.parse(mockFetch.mock.calls[0][1].body);
    const body2 = JSON.parse(mockFetch.mock.calls[1][1].body);

    expect(body1.params.message.messageId).not.toBe(
      body2.params.message.messageId,
    );
  });
});
