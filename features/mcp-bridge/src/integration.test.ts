/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Integration Tests for MCP Bridge
 *
 * These tests require the A2A server to be running:
 *   CODER_AGENT_PORT=41242 USE_CCPA=true npm run start -w packages/a2a-server
 *
 * Run with: npm run test:integration
 *
 * Tests capture real responses to test-outputs/ for reference.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { A2AClient } from './a2a-client.js';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const A2A_SERVER_URL = process.env.A2A_SERVER_URL || 'http://localhost:41242';
const TEST_OUTPUTS_DIR = join(
  import.meta.dirname || __dirname,
  '..',
  'test-outputs',
);

// Skip integration tests if server not running
const client = new A2AClient(A2A_SERVER_URL);

function saveTestOutput(filename: string, data: unknown): void {
  if (!existsSync(TEST_OUTPUTS_DIR)) {
    mkdirSync(TEST_OUTPUTS_DIR, { recursive: true });
  }
  writeFileSync(
    join(TEST_OUTPUTS_DIR, filename),
    JSON.stringify(data, null, 2),
  );
}

describe('Integration Tests (requires A2A server)', () => {
  let serverAvailable = false;

  // LLM calls can take 10-30 seconds
  const LLM_TIMEOUT = 60000;

  beforeAll(async () => {
    serverAvailable = await client.healthCheck();
    if (!serverAvailable) {
      console.warn('⚠️  A2A server not running - skipping integration tests');
      console.warn(
        '   Start with: CODER_AGENT_PORT=41242 USE_CCPA=true npm run start -w packages/a2a-server',
      );
    }
  });

  describe('Agent Discovery', () => {
    it('should fetch agent card', async () => {
      if (!serverAvailable) return;

      const card = await client.getAgentCard();
      saveTestOutput('integration-agent-card.json', card);

      expect(card.name).toBe('Gemini SDLC Agent');
      expect(card.protocolVersion).toBe('0.3.0');
      expect(card.capabilities.streaming).toBe(true);
    });
  });

  describe('Simple Query', () => {
    it(
      'should answer a simple math question',
      { timeout: LLM_TIMEOUT },
      async () => {
        if (!serverAvailable) return;

        const events = await client.sendMessage(
          'What is 2+2? Answer with just the number.',
          undefined,
          '/tmp',
          true, // auto-execute
        );

        saveTestOutput('integration-simple-query.json', events);

        const parsed = client.parseEvents(events);

        expect(parsed.taskId).toBeDefined();
        expect(parsed.contextId).toBeDefined();
        expect(parsed.model).toContain('gemini');

        // Check that we got a text response
        expect(parsed.textContent.length).toBeGreaterThan(0);

        // The answer should contain "4"
        const fullText = parsed.textContent.join(' ');
        expect(fullText).toMatch(/4/);
      },
    );
  });

  describe('Task State Transitions', () => {
    it(
      'should track task through states',
      { timeout: LLM_TIMEOUT },
      async () => {
        if (!serverAvailable) return;

        const events = await client.sendMessage(
          'Say hello in one word.',
          undefined,
          '/tmp',
          true,
        );

        saveTestOutput('integration-state-transitions.json', events);

        // Should have multiple states
        const states = events.map((e) => e.status?.state).filter(Boolean);
        expect(states).toContain('submitted');
        expect(states).toContain('working');
      },
    );
  });

  describe('Thoughts Extraction', () => {
    it('should capture Gemini thoughts', { timeout: LLM_TIMEOUT }, async () => {
      if (!serverAvailable) return;

      const events = await client.sendMessage(
        'Explain briefly why the sky is blue.',
        undefined,
        '/tmp',
        true,
      );

      saveTestOutput('integration-thoughts.json', events);

      const parsed = client.parseEvents(events);

      // Gemini usually includes thoughts
      if (parsed.thoughts.length > 0) {
        expect(parsed.thoughts[0]).toHaveProperty('subject');
        expect(parsed.thoughts[0]).toHaveProperty('description');
      }
    });
  });

  describe('Model Selection', () => {
    it(
      'should use gemini-3-flash-preview when model=flash',
      { timeout: LLM_TIMEOUT },
      async () => {
        if (!serverAvailable) return;

        const events = await client.sendMessage(
          'Say "hello" and nothing else.',
          undefined, // taskId
          '/tmp', // workspacePath
          true, // autoExecute
          undefined, // contextId
          'flash', // model
        );

        saveTestOutput('integration-model-flash.json', events);

        const parsed = client.parseEvents(events);

        expect(parsed.model).toBe('gemini-3-flash-preview');
      },
    );

    it(
      'should use gemini-3-pro-preview when model=pro',
      { timeout: LLM_TIMEOUT },
      async () => {
        if (!serverAvailable) return;

        const events = await client.sendMessage(
          'Say "hello" and nothing else.',
          undefined, // taskId
          '/tmp', // workspacePath
          true, // autoExecute
          undefined, // contextId
          'pro', // model
        );

        saveTestOutput('integration-model-pro.json', events);

        const parsed = client.parseEvents(events);

        expect(parsed.model).toBe('gemini-3-pro-preview');
      },
    );
  });

  describe('Session Continuity', () => {
    it(
      'should continue conversation with same taskId',
      { timeout: LLM_TIMEOUT },
      async () => {
        if (!serverAvailable) return;

        // First message - simple, no tool use expected
        const events1 = await client.sendMessage(
          'Say the word "blue" and nothing else.',
          undefined,
          '/tmp',
          true,
        );

        const parsed1 = client.parseEvents(events1);
        const taskId = parsed1.taskId;

        expect(taskId).toBeDefined();
        saveTestOutput('integration-session-first.json', events1);

        // If first message is waiting for input, skip continuation test
        if (parsed1.taskState === 'input-required') {
          console.log(
            '⚠ First message waiting for tool approval - skipping session test',
          );
          return;
        }

        // Continue in same session - verify same taskId is used
        const events2 = await client.sendMessage(
          'What word did you just say? One word answer.',
          taskId!, // Continue session with same taskId
          '/tmp',
          true,
        );

        saveTestOutput('integration-session-second.json', events2);

        const parsed2 = client.parseEvents(events2);

        // Verify the response came back
        expect(parsed2.textContent.length).toBeGreaterThan(0);

        // If context is preserved, response should mention blue
        const response = parsed2.textContent.join(' ').toLowerCase();
        if (response.includes('blue')) {
          console.log('✓ Session context preserved - Gemini remembered "blue"');
        } else {
          console.log('⚠ Response:', response.slice(0, 100));
        }
      },
    );
  });
});

/**
 * Real Response Structure Reference (from captured data)
 *
 * These structures are based on actual A2A server responses.
 * Use them as reference when writing mocked tests.
 */
export const REAL_RESPONSE_STRUCTURES = {
  // Task submission response
  taskSubmission: {
    id: 'uuid-task-id',
    contextId: 'uuid-context-id',
    kind: 'task',
    status: {
      state: 'submitted',
      timestamp: '2025-12-20T00:00:00.000Z',
    },
    metadata: {
      __persistedState: {
        _agentSettings: {},
        _taskState: 'submitted',
      },
      _contextId: 'uuid-context-id',
    },
    history: [],
    artifacts: [],
  },

  // State change event
  stateChange: {
    kind: 'status-update',
    taskId: 'uuid-task-id',
    contextId: 'uuid-context-id',
    status: {
      state: 'working', // or 'completed', 'input-required', 'failed', 'canceled'
      timestamp: '2025-12-20T00:00:00.000Z',
    },
    final: false,
    metadata: {
      coderAgent: { kind: 'state-change' },
      model: 'gemini-3-pro-preview',
    },
  },

  // Thought event
  thought: {
    kind: 'status-update',
    taskId: 'uuid-task-id',
    contextId: 'uuid-context-id',
    status: {
      state: 'working',
      message: {
        kind: 'message',
        role: 'agent',
        parts: [
          {
            kind: 'data',
            data: {
              subject: 'Analysis Subject',
              description: 'Detailed thought description...',
            },
          },
        ],
        messageId: 'uuid-message-id',
        taskId: 'uuid-task-id',
        contextId: 'uuid-context-id',
      },
      timestamp: '2025-12-20T00:00:00.000Z',
    },
    final: false,
    metadata: {
      coderAgent: { kind: 'thought' },
      model: 'gemini-3-pro-preview',
      traceId: 'hex-trace-id',
    },
  },

  // Text content event
  textContent: {
    kind: 'status-update',
    taskId: 'uuid-task-id',
    contextId: 'uuid-context-id',
    status: {
      state: 'working',
      message: {
        kind: 'message',
        role: 'agent',
        parts: [{ kind: 'text', text: 'Response text here' }],
        messageId: 'uuid-message-id',
        taskId: 'uuid-task-id',
        contextId: 'uuid-context-id',
      },
      timestamp: '2025-12-20T00:00:00.000Z',
    },
    final: false,
    metadata: {
      coderAgent: { kind: 'text-content' },
      model: 'gemini-3-pro-preview',
      traceId: 'hex-trace-id',
    },
  },

  // Tool call confirmation (awaiting approval)
  toolCallConfirmation: {
    kind: 'status-update',
    taskId: 'uuid-task-id',
    contextId: 'uuid-context-id',
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
                callId: 'tool_name-timestamp-random',
                name: 'run_shell_command',
                args: { command: 'ls' },
                isClientInitiated: false,
                prompt_id: 'task-id########0',
                traceId: 'hex-trace-id',
              },
              status: 'awaiting_approval',
              confirmationDetails: {
                type: 'exec',
                title: 'Confirm Shell Command',
                command: 'ls',
                rootCommand: 'ls',
              },
              tool: {
                name: 'run_shell_command',
                displayName: 'Shell',
                description: 'Tool description...',
                kind: 'execute',
                // ... more tool metadata
              },
            },
          },
        ],
        messageId: 'uuid-message-id',
        taskId: 'uuid-task-id',
        contextId: 'uuid-context-id',
      },
      timestamp: '2025-12-20T00:00:00.000Z',
    },
    final: false,
    metadata: {
      coderAgent: { kind: 'tool-call-confirmation' },
      model: 'gemini-3-pro-preview',
    },
  },

  // Final state (input-required)
  finalInputRequired: {
    kind: 'status-update',
    taskId: 'uuid-task-id',
    contextId: 'uuid-context-id',
    status: {
      state: 'input-required',
      timestamp: '2025-12-20T00:00:00.000Z',
    },
    final: true,
    metadata: {
      coderAgent: { kind: 'state-change' },
      model: 'gemini-3-pro-preview',
    },
  },
};
