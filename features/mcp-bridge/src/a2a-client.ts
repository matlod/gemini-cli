/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A2A Client - Full HTTP client for communicating with Gemini CLI A2A server
 * Covers the complete A2A protocol surface + Gemini CLI extensions
 */

// ============================================================================
// Types
// ============================================================================

export interface A2ATaskResponse {
  id: string;
  contextId: string;
  kind?: string;
  status: {
    state: TaskState;
    message?: A2AMessage;
    timestamp?: string;
  };
  final?: boolean;
  metadata?: {
    coderAgent?: {
      kind: CoderAgentEventKind;
    };
    model?: string;
    userTier?: string;
    traceId?: string;
    error?: string;
  };
}

export type TaskState =
  | 'submitted'
  | 'working'
  | 'input-required'
  | 'completed'
  | 'failed'
  | 'canceled';

export type CoderAgentEventKind =
  | 'tool-call-confirmation'
  | 'tool-call-update'
  | 'text-content'
  | 'state-change'
  | 'thought'
  | 'citation'
  | 'agent-settings';

export interface A2AMessage {
  kind: 'message';
  role: 'user' | 'agent';
  parts: A2APart[];
  messageId: string;
  taskId?: string;
  contextId?: string;
  metadata?: Record<string, unknown>;
}

export interface A2APart {
  kind: 'text' | 'data' | 'file';
  text?: string;
  data?: unknown;
  file?: { name: string; mimeType: string; bytes: string };
}

export interface TaskMetadata {
  id: string;
  contextId: string;
  taskState: TaskState;
  model: string;
  mcpServers: Array<{
    name: string;
    status: string;
    tools: Array<{
      name: string;
      description: string;
      parameterSchema?: unknown;
    }>;
  }>;
  availableTools: Array<{
    name: string;
    description: string;
    parameterSchema?: unknown;
  }>;
}

export interface AgentCard {
  name: string;
  description: string;
  url: string;
  provider: { organization: string; url: string };
  protocolVersion: string;
  version: string;
  capabilities: {
    streaming: boolean;
    pushNotifications: boolean;
    stateTransitionHistory: boolean;
  };
  defaultInputModes: string[];
  defaultOutputModes: string[];
  skills: Array<{
    id: string;
    name: string;
    description: string;
    tags: string[];
    examples: string[];
    inputModes: string[];
    outputModes: string[];
  }>;
}

export interface CommandInfo {
  name: string;
  description: string;
  arguments: Array<{ name: string; description: string; isRequired?: boolean }>;
  subCommands: CommandInfo[];
}

export interface CommandResult {
  name: string;
  data: unknown;
}

export type ToolConfirmationOutcome =
  | 'proceed_once'
  | 'cancel'
  | 'proceed_always'
  | 'proceed_always_tool'
  | 'proceed_always_server'
  | 'modify_with_editor';

export interface ToolCallInfo {
  callId: string;
  name: string;
  status:
    | 'validating'
    | 'scheduled'
    | 'awaiting_approval'
    | 'executing'
    | 'success'
    | 'error'
    | 'cancelled';
  args?: Record<string, unknown>;
  tool?: {
    name: string;
    displayName?: string;
    description?: string;
  };
  confirmationDetails?: {
    type: string;
    message?: string;
  };
}

export interface ThoughtInfo {
  subject: string;
  description: string;
}

export interface ParsedEvents {
  textContent: string[];
  thoughts: ThoughtInfo[];
  citations: string[];
  toolCalls: ToolCallInfo[];
  pendingApprovals: ToolCallInfo[];
  taskState: TaskState | null;
  taskId: string | null;
  contextId: string | null;
  model: string | null;
  errors: string[];
  isFinal: boolean;
}

// ============================================================================
// A2A Client
// ============================================================================

export class A2AClient {
  private baseUrl: string;

  constructor(baseUrl: string = 'http://localhost:41242') {
    this.baseUrl = baseUrl;
  }

  // ==========================================================================
  // Agent Discovery
  // ==========================================================================

  /**
   * Get agent card (capabilities and metadata)
   */
  async getAgentCard(): Promise<AgentCard> {
    const response = await fetch(`${this.baseUrl}/.well-known/agent-card.json`);
    if (!response.ok) {
      throw new Error(`Failed to get agent card: ${response.statusText}`);
    }
    return response.json();
  }

  /**
   * Check if A2A server is running
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(
        `${this.baseUrl}/.well-known/agent-card.json`,
      );
      return response.ok;
    } catch {
      return false;
    }
  }

  // ==========================================================================
  // Task Management
  // ==========================================================================

  /**
   * Create a new task (without sending a message)
   */
  async createTask(
    workspacePath: string,
    autoExecute: boolean = false,
    contextId?: string,
  ): Promise<string> {
    const response = await fetch(`${this.baseUrl}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contextId,
        agentSettings: {
          kind: 'agent-settings',
          workspacePath,
          autoExecute,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to create task: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Get task metadata/status
   */
  async getTaskStatus(taskId: string): Promise<TaskMetadata> {
    const response = await fetch(`${this.baseUrl}/tasks/${taskId}/metadata`);

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(`Task ${taskId} not found`);
      }
      throw new Error(`Failed to get task status: ${response.statusText}`);
    }

    const data = await response.json();
    return data.metadata;
  }

  /**
   * List all tasks
   */
  async listTasks(): Promise<TaskMetadata[]> {
    const response = await fetch(`${this.baseUrl}/tasks/metadata`);

    if (response.status === 204) {
      return [];
    }

    if (response.status === 501) {
      // Only supported with InMemoryTaskStore
      return [];
    }

    if (!response.ok) {
      throw new Error(`Failed to list tasks: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Cancel a task
   * Note: Cancellation is handled via the executor, we send a cancel message
   */
  async cancelTask(
    taskId: string,
    contextId?: string,
  ): Promise<A2ATaskResponse[]> {
    // Send a cancel signal via message with special handling
    // The A2A server handles cancellation through the executor
    const messageId = crypto.randomUUID();
    const requestId = crypto.randomUUID();

    // Build the message object
    const messageObj: Record<string, unknown> = {
      kind: 'message',
      role: 'user',
      parts: [{ kind: 'text', text: '/cancel' }],
      messageId,
      taskId,
    };

    if (contextId) {
      messageObj.contextId = contextId;
    }

    // Build params - taskId is already on message object, not needed here
    const params: Record<string, unknown> = {
      message: messageObj,
    };

    // Wrap in JSON-RPC envelope
    const body = {
      jsonrpc: '2.0',
      id: requestId,
      method: 'message/stream',
      params,
    };

    const response = await fetch(`${this.baseUrl}/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    return this.parseSSEResponse(await response.text());
  }

  // ==========================================================================
  // Messaging
  // ==========================================================================

  /**
   * Send a message to a task and collect SSE events
   * Uses JSON-RPC format with method: "message/stream"
   */
  async sendMessage(
    message: string,
    taskId?: string,
    workspacePath?: string,
    autoExecute: boolean = false,
    contextId?: string,
    model?: string,
  ): Promise<A2ATaskResponse[]> {
    const messageId = crypto.randomUUID();
    const requestId = crypto.randomUUID();

    // Build the message object
    // NOTE: taskId and contextId must be ON the message object for session continuity
    const messageObj: Record<string, unknown> = {
      kind: 'message',
      role: 'user',
      parts: [{ kind: 'text', text: message }],
      messageId,
    };

    // Add taskId to message if continuing a conversation
    if (taskId) {
      messageObj.taskId = taskId;
    }

    // Add contextId to message if provided
    if (contextId) {
      messageObj.contextId = contextId;
    }

    // Add metadata with workspace settings and model directly to message
    // NOTE: metadata must be ON the message object (like taskId/contextId) for the executor to read it
    if (workspacePath) {
      messageObj.metadata = {
        coderAgent: {
          kind: 'agent-settings',
          workspacePath,
          autoExecute,
          model,
        },
      };
    }

    // Build params
    const params: Record<string, unknown> = {
      message: messageObj,
    };

    // Wrap in JSON-RPC envelope
    const body = {
      jsonrpc: '2.0',
      id: requestId,
      method: 'message/stream',
      params,
    };

    const response = await fetch(`${this.baseUrl}/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Failed to send message: ${response.statusText}`);
    }

    return this.parseSSEResponse(await response.text());
  }

  /**
   * Send a message with streaming callback
   * Uses JSON-RPC format with method: "message/stream"
   */
  async sendMessageStreaming(
    message: string,
    onEvent: (event: A2ATaskResponse) => void,
    taskId?: string,
    workspacePath?: string,
    autoExecute: boolean = false,
    contextId?: string,
    model?: string,
  ): Promise<void> {
    const messageId = crypto.randomUUID();
    const requestId = crypto.randomUUID();

    // Build the message object
    // NOTE: taskId and contextId must be ON the message object for session continuity
    const messageObj: Record<string, unknown> = {
      kind: 'message',
      role: 'user',
      parts: [{ kind: 'text', text: message }],
      messageId,
    };

    // Add taskId to message if continuing a conversation
    if (taskId) {
      messageObj.taskId = taskId;
    }

    // Add contextId to message if provided
    if (contextId) {
      messageObj.contextId = contextId;
    }

    // Add metadata with workspace settings and model directly to message
    if (workspacePath) {
      messageObj.metadata = {
        coderAgent: {
          kind: 'agent-settings',
          workspacePath,
          autoExecute,
          model,
        },
      };
    }

    // Build params
    const params: Record<string, unknown> = {
      message: messageObj,
    };

    // Wrap in JSON-RPC envelope
    const body = {
      jsonrpc: '2.0',
      id: requestId,
      method: 'message/stream',
      params,
    };

    const response = await fetch(`${this.baseUrl}/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Failed to send message: ${response.statusText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n\n');
      buffer = lines.pop() || '';

      for (const chunk of lines) {
        if (!chunk.trim()) continue;
        const dataLine = chunk
          .split('\n')
          .find((line) => line.startsWith('data: '));
        if (dataLine) {
          try {
            const json = JSON.parse(dataLine.substring(6));
            if (json.result) {
              onEvent(json.result);
            }
          } catch {
            // Skip malformed events
          }
        }
      }
    }
  }

  /**
   * Send a tool confirmation response
   * Uses JSON-RPC format with method: "message/stream"
   */
  async sendConfirmation(
    taskId: string,
    callId: string,
    outcome: ToolConfirmationOutcome,
    contextId?: string,
    newContent?: string, // For modify_with_editor
    workspacePath?: string, // Workspace for metadata
  ): Promise<A2ATaskResponse[]> {
    const messageId = crypto.randomUUID();
    const requestId = crypto.randomUUID();

    const data: Record<string, unknown> = { callId, outcome };
    if (outcome === 'modify_with_editor' && newContent !== undefined) {
      data.newContent = newContent;
    }

    // Build the message object with data part
    // CRITICAL: taskId and contextId must be ON the message object, not at params level
    const messageObj: Record<string, unknown> = {
      kind: 'message',
      role: 'user',
      parts: [{ kind: 'data', data }],
      messageId,
      taskId,  // ON the message, not params!
    };

    if (contextId) {
      messageObj.contextId = contextId;  // ON the message, not params!
    }

    // Include metadata like regular messages - server may need this for execution context
    if (workspacePath) {
      messageObj.metadata = {
        coderAgent: {
          kind: 'agent-settings',
          workspacePath,
          autoExecute: false, // Manual confirmation = not auto-executing
        },
      };
    }

    // Build params
    const params: Record<string, unknown> = {
      message: messageObj,
    };

    // Wrap in JSON-RPC envelope
    const body = {
      jsonrpc: '2.0',
      id: requestId,
      method: 'message/stream',
      params,
    };

    const response = await fetch(`${this.baseUrl}/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Failed to send confirmation: ${response.statusText}`);
    }

    return this.parseSSEResponse(await response.text());
  }

  // ==========================================================================
  // Commands (Gemini CLI Extensions)
  // ==========================================================================

  /**
   * List available commands
   */
  async listCommands(): Promise<CommandInfo[]> {
    const response = await fetch(`${this.baseUrl}/listCommands`);

    if (!response.ok) {
      throw new Error(`Failed to list commands: ${response.statusText}`);
    }

    const data = await response.json();
    return data.commands || [];
  }

  /**
   * Execute a command
   */
  async executeCommand(
    command: string,
    args: string[] = [],
  ): Promise<CommandResult> {
    const response = await fetch(`${this.baseUrl}/executeCommand`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command, args }),
    });

    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ error: response.statusText }));
      throw new Error(
        error.error || `Failed to execute command: ${response.statusText}`,
      );
    }

    return response.json();
  }

  /**
   * Execute a streaming command
   */
  async executeCommandStreaming(
    command: string,
    args: string[] = [],
    onEvent: (event: A2ATaskResponse) => void,
  ): Promise<CommandResult> {
    const response = await fetch(`${this.baseUrl}/executeCommand`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({ command, args }),
    });

    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ error: response.statusText }));
      throw new Error(
        error.error || `Failed to execute command: ${response.statusText}`,
      );
    }

    // Check if streaming response
    const contentType = response.headers.get('content-type');
    if (contentType?.includes('text/event-stream')) {
      const events = this.parseSSEResponse(await response.text());
      events.forEach(onEvent);
      return { name: command, data: events };
    }

    return response.json();
  }

  // ==========================================================================
  // Helpers
  // ==========================================================================

  /**
   * Parse SSE response text into events
   */
  private parseSSEResponse(text: string): A2ATaskResponse[] {
    const events: A2ATaskResponse[] = [];

    for (const chunk of text.split('\n\n')) {
      if (!chunk.trim()) continue;
      const dataLine = chunk
        .split('\n')
        .find((line) => line.startsWith('data: '));
      if (dataLine) {
        try {
          const json = JSON.parse(dataLine.substring(6));
          if (json.result) {
            events.push(json.result);
          }
        } catch {
          // Skip malformed events
        }
      }
    }

    return events;
  }

  /**
   * Parse events into structured data
   */
  parseEvents(events: A2ATaskResponse[]): ParsedEvents {
    const result: ParsedEvents = {
      textContent: [],
      thoughts: [],
      citations: [],
      toolCalls: [],
      pendingApprovals: [],
      taskState: null,
      taskId: null,
      contextId: null,
      model: null,
      errors: [],
      isFinal: false,
    };

    for (const event of events) {
      // Track task info
      if (event.id) result.taskId = event.id;
      if (event.contextId) result.contextId = event.contextId;
      if (event.metadata?.model) result.model = event.metadata.model;
      if (event.metadata?.error) result.errors.push(event.metadata.error);
      if (event.final) result.isFinal = true;
      if (event.status?.state) result.taskState = event.status.state;

      const coderAgent = event.metadata?.coderAgent;
      const message = event.status?.message;

      if (!coderAgent || !message) continue;

      switch (coderAgent.kind) {
        case 'text-content':
          for (const part of message.parts) {
            if (part.text) result.textContent.push(part.text);
          }
          break;

        case 'thought':
          for (const part of message.parts) {
            if (part.data && typeof part.data === 'object') {
              const thought = part.data as ThoughtInfo;
              if (thought.subject || thought.description) {
                result.thoughts.push(thought);
              }
            }
          }
          break;

        case 'citation':
          for (const part of message.parts) {
            if (part.text) result.citations.push(part.text);
          }
          break;

        case 'tool-call-update':
        case 'tool-call-confirmation':
          for (const part of message.parts) {
            if (part.data && typeof part.data === 'object') {
              const rawData = part.data as Record<string, unknown>;
              // A2A server sends: { request: { callId, name, args }, status, confirmationDetails, tool }
              // We need to flatten this to match our ToolCallInfo interface
              const request = rawData.request as Record<string, unknown> | undefined;
              const toolInfo: ToolCallInfo = {
                callId: (request?.callId as string) || (rawData.callId as string) || '',
                name: (request?.name as string) || (rawData.name as string) || '',
                status: rawData.status as ToolCallInfo['status'],
                args: request?.args as Record<string, unknown>,
                tool: rawData.tool as ToolCallInfo['tool'],
                confirmationDetails: rawData.confirmationDetails as ToolCallInfo['confirmationDetails'],
              };
              result.toolCalls.push(toolInfo);
              if (toolInfo.status === 'awaiting_approval') {
                result.pendingApprovals.push(toolInfo);
              }
            }
          }
          break;
      }
    }

    return result;
  }
}
