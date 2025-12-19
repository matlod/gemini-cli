#!/usr/bin/env node
/**
 * MCP Bridge - Full A2A Coverage
 *
 * Exposes Gemini CLI A2A server as an MCP server for Claude Code
 * with complete API surface coverage.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import {
  A2AClient,
  type A2ATaskResponse,
  type ParsedEvents,
  type ToolConfirmationOutcome,
} from './a2a-client.js';

// ============================================================================
// Configuration
// ============================================================================

const A2A_SERVER_URL = process.env.A2A_SERVER_URL || 'http://localhost:41242';
const DEFAULT_WORKSPACE = process.env.GEMINI_WORKSPACE || process.cwd();

// ============================================================================
// State
// ============================================================================

const a2aClient = new A2AClient(A2A_SERVER_URL);

// Track active sessions: sessionId -> { taskId, contextId }
const sessions = new Map<string, { taskId: string; contextId: string }>();

// ============================================================================
// Tool Definitions - Full A2A Coverage
// ============================================================================

const tools: Tool[] = [
  // ==========================================================================
  // Core Task Tools
  // ==========================================================================
  {
    name: 'gemini_task',
    description: `Send a task to Gemini and get the response. Use this to delegate work to Gemini as an "intern".

Gemini will work on the task and may request tool confirmations (file edits, shell commands, etc).
Returns the response including any pending decisions that need your input.

Examples:
- "Find all authentication-related files and summarize the patterns"
- "Generate 10 test fixtures for the User model"
- "Review this code for potential bugs"`,
    inputSchema: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description: 'The task or question for Gemini to work on',
        },
        workspace: {
          type: 'string',
          description: 'Working directory for Gemini (defaults to GEMINI_WORKSPACE or cwd)',
        },
        autoExecute: {
          type: 'boolean',
          description: 'Auto-approve all tool calls (YOLO mode). Default: false',
        },
        sessionId: {
          type: 'string',
          description: 'Session ID to continue a previous conversation',
        },
      },
      required: ['task'],
    },
  },
  {
    name: 'gemini_respond',
    description: `Respond to a pending tool confirmation from Gemini.

Use this when Gemini is waiting for approval to execute a tool.

Decisions:
- approve: Execute this tool once
- deny: Don't execute this tool
- trust_always: Trust all future tool calls in this session
- trust_tool: Trust this type of tool for the session
- trust_server: Trust all tools from this MCP server
- edit: Modify the file content before saving (for file edits only)`,
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: {
          type: 'string',
          description: 'The session ID from the original task',
        },
        callId: {
          type: 'string',
          description: 'The tool call ID to respond to',
        },
        decision: {
          type: 'string',
          enum: ['approve', 'deny', 'trust_always', 'trust_tool', 'trust_server', 'edit'],
          description: 'Your decision for this tool call',
        },
        editedContent: {
          type: 'string',
          description: 'Modified file content (only for decision="edit")',
        },
      },
      required: ['sessionId', 'callId', 'decision'],
    },
  },
  {
    name: 'gemini_status',
    description: 'Get the status of a Gemini task/session including available tools and MCP servers.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: {
          type: 'string',
          description: 'The session ID to check',
        },
      },
      required: ['sessionId'],
    },
  },
  {
    name: 'gemini_cancel',
    description: 'Cancel a running Gemini task.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: {
          type: 'string',
          description: 'The session ID to cancel',
        },
      },
      required: ['sessionId'],
    },
  },
  {
    name: 'gemini_list_sessions',
    description: 'List all active Gemini sessions with their status.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },

  // ==========================================================================
  // Consultation Tool (Sync, for second opinions)
  // ==========================================================================
  {
    name: 'gemini_consult',
    description: `Quick consultation with Gemini for a second opinion.

Use this for:
- Plan review before implementation
- Architecture decisions
- Getting fresh perspective on complex problems
- Code review

This runs in auto-execute mode for faster response.`,
    inputSchema: {
      type: 'object',
      properties: {
        question: {
          type: 'string',
          description: 'Your question or request for Gemini',
        },
        context: {
          type: 'string',
          description: 'Additional context (code, plans, etc)',
        },
      },
      required: ['question'],
    },
  },

  // ==========================================================================
  // CLI Command Tools (Gemini CLI Extensions)
  // ==========================================================================
  {
    name: 'gemini_command',
    description: `Execute a Gemini CLI command.

Available commands:
- init: Analyze the project and create a tailored GEMINI.md file
- restore <checkpoint>: Restore to a previous checkpoint
- restore list: List available checkpoints
- extensions list: List installed extensions`,
    inputSchema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The command to execute (e.g., "init", "restore list")',
        },
        args: {
          type: 'array',
          items: { type: 'string' },
          description: 'Arguments for the command',
        },
      },
      required: ['command'],
    },
  },
  {
    name: 'gemini_list_commands',
    description: 'List all available Gemini CLI commands.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },

  // ==========================================================================
  // Agent Discovery
  // ==========================================================================
  {
    name: 'gemini_info',
    description: 'Get information about the Gemini agent including capabilities, skills, and version.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

// ============================================================================
// Response Formatting
// ============================================================================

/**
 * Format parsed events into a readable response
 */
function formatParsedEvents(parsed: ParsedEvents): string {
  const sections: string[] = [];

  // Task info header
  if (parsed.taskId) {
    sections.push(`Session: ${parsed.taskId}`);
    if (parsed.model) sections[0] += ` | Model: ${parsed.model}`;
    if (parsed.taskState) sections[0] += ` | State: ${parsed.taskState}`;
  }

  // Thoughts (Gemini's reasoning)
  if (parsed.thoughts.length > 0) {
    sections.push('\n📭 THOUGHTS:');
    for (const thought of parsed.thoughts) {
      if (thought.subject) sections.push(`  • ${thought.subject}`);
      if (thought.description) sections.push(`    ${thought.description}`);
    }
  }

  // Main content
  if (parsed.textContent.length > 0) {
    sections.push('\n' + parsed.textContent.join('\n\n'));
  }

  // Tool call updates
  const completedTools = parsed.toolCalls.filter(t =>
    ['success', 'error', 'cancelled'].includes(t.status)
  );
  if (completedTools.length > 0) {
    sections.push('\n🔧 TOOL RESULTS:');
    for (const tool of completedTools) {
      const icon = tool.status === 'success' ? '✓' : tool.status === 'error' ? '✗' : '⊘';
      sections.push(`  ${icon} ${tool.name || tool.callId}: ${tool.status}`);
    }
  }

  // Pending approvals
  if (parsed.pendingApprovals.length > 0) {
    sections.push('\n⏳ PENDING DECISIONS:');
    for (const tool of parsed.pendingApprovals) {
      sections.push(`  • callId: ${tool.callId}`);
      sections.push(`    Tool: ${tool.tool?.displayName || tool.name || 'unknown'}`);
      if (tool.confirmationDetails?.message) {
        sections.push(`    Message: ${tool.confirmationDetails.message}`);
      }
    }
    sections.push('\nUse gemini_respond to approve or deny these tool calls.');
  }

  // Citations
  if (parsed.citations.length > 0) {
    sections.push('\n📚 SOURCES:');
    for (const citation of parsed.citations) {
      sections.push(`  • ${citation}`);
    }
  }

  // Errors
  if (parsed.errors.length > 0) {
    sections.push('\n❌ ERRORS:');
    for (const error of parsed.errors) {
      sections.push(`  • ${error}`);
    }
  }

  // Status indicator
  if (parsed.isFinal) {
    if (parsed.taskState === 'input-required') {
      sections.push('\n[Gemini is waiting for input or decisions]');
    } else if (parsed.taskState === 'completed') {
      sections.push('\n[Task completed]');
    } else if (parsed.taskState === 'failed') {
      sections.push('\n[Task failed]');
    }
  }

  return sections.join('\n') || '[No response content]';
}

/**
 * Format raw events (fallback)
 */
function formatEvents(events: A2ATaskResponse[]): string {
  const parsed = a2aClient.parseEvents(events);
  return formatParsedEvents(parsed);
}

/**
 * Map decision strings to A2A outcomes
 */
function mapDecision(decision: string): ToolConfirmationOutcome {
  switch (decision) {
    case 'approve': return 'proceed_once';
    case 'deny': return 'cancel';
    case 'trust_always': return 'proceed_always';
    case 'trust_tool': return 'proceed_always_tool';
    case 'trust_server': return 'proceed_always_server';
    case 'edit': return 'modify_with_editor';
    default: return 'proceed_once';
  }
}

// ============================================================================
// MCP Server Setup
// ============================================================================

const server = new Server(
  {
    name: 'gemini-bridge',
    version: '0.2.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Handle tool listing
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    // Health check for most operations
    if (name !== 'gemini_info') {
      const isHealthy = await a2aClient.healthCheck();
      if (!isHealthy) {
        return {
          content: [{
            type: 'text',
            text: `Error: A2A server not reachable at ${A2A_SERVER_URL}\n\nStart it with:\n  cd packages/a2a-server && npm run start`,
          }],
        };
      }
    }

    switch (name) {
      // ======================================================================
      // gemini_task
      // ======================================================================
      case 'gemini_task': {
        const task = args?.task as string;
        const workspace = (args?.workspace as string) || DEFAULT_WORKSPACE;
        const autoExecute = (args?.autoExecute as boolean) || false;
        const existingSessionId = args?.sessionId as string | undefined;

        const session = existingSessionId ? sessions.get(existingSessionId) : undefined;

        const events = await a2aClient.sendMessage(
          task,
          session?.taskId,
          workspace,
          autoExecute,
          session?.contextId
        );

        const parsed = a2aClient.parseEvents(events);

        // Track session
        if (parsed.taskId) {
          const sessionId = existingSessionId || parsed.taskId;
          sessions.set(sessionId, {
            taskId: parsed.taskId,
            contextId: parsed.contextId || parsed.taskId,
          });
        }

        return {
          content: [{ type: 'text', text: formatParsedEvents(parsed) }],
        };
      }

      // ======================================================================
      // gemini_respond
      // ======================================================================
      case 'gemini_respond': {
        const sessionId = args?.sessionId as string;
        const callId = args?.callId as string;
        const decision = args?.decision as string;
        const editedContent = args?.editedContent as string | undefined;

        const session = sessions.get(sessionId);
        if (!session) {
          return {
            content: [{ type: 'text', text: `Error: Session "${sessionId}" not found.\n\nActive sessions: ${Array.from(sessions.keys()).join(', ') || 'none'}` }],
          };
        }

        const outcome = mapDecision(decision);
        const events = await a2aClient.sendConfirmation(
          session.taskId,
          callId,
          outcome,
          session.contextId,
          outcome === 'modify_with_editor' ? editedContent : undefined
        );

        return {
          content: [{ type: 'text', text: formatEvents(events) }],
        };
      }

      // ======================================================================
      // gemini_status
      // ======================================================================
      case 'gemini_status': {
        const sessionId = args?.sessionId as string;
        const session = sessions.get(sessionId);

        if (!session) {
          return {
            content: [{ type: 'text', text: `Error: Session "${sessionId}" not found` }],
          };
        }

        const status = await a2aClient.getTaskStatus(session.taskId);

        const lines = [
          `Task ID: ${status.id}`,
          `Context ID: ${status.contextId}`,
          `State: ${status.taskState}`,
          `Model: ${status.model}`,
          '',
          `Available Tools (${status.availableTools.length}):`,
          ...status.availableTools.slice(0, 20).map(t => `  • ${t.name}: ${t.description?.slice(0, 60) || 'No description'}...`),
          status.availableTools.length > 20 ? `  ... and ${status.availableTools.length - 20} more` : '',
          '',
          `MCP Servers (${status.mcpServers.length}):`,
          ...status.mcpServers.map(s => `  • ${s.name} (${s.status}): ${s.tools.length} tools`),
        ];

        return {
          content: [{ type: 'text', text: lines.filter(Boolean).join('\n') }],
        };
      }

      // ======================================================================
      // gemini_cancel
      // ======================================================================
      case 'gemini_cancel': {
        const sessionId = args?.sessionId as string;
        const session = sessions.get(sessionId);

        if (!session) {
          return {
            content: [{ type: 'text', text: `Error: Session "${sessionId}" not found` }],
          };
        }

        const events = await a2aClient.cancelTask(session.taskId, session.contextId);
        sessions.delete(sessionId);

        return {
          content: [{ type: 'text', text: `Session ${sessionId} cancelled.\n\n${formatEvents(events)}` }],
        };
      }

      // ======================================================================
      // gemini_list_sessions
      // ======================================================================
      case 'gemini_list_sessions': {
        const tasks = await a2aClient.listTasks();

        if (tasks.length === 0) {
          return {
            content: [{ type: 'text', text: 'No active sessions.' }],
          };
        }

        const lines = ['Active Sessions:', ''];
        for (const task of tasks) {
          const localSession = Array.from(sessions.entries()).find(
            ([, v]) => v.taskId === task.id
          );
          lines.push(`• ${localSession?.[0] || task.id}`);
          lines.push(`  State: ${task.taskState} | Model: ${task.model}`);
          lines.push('');
        }

        return {
          content: [{ type: 'text', text: lines.join('\n') }],
        };
      }

      // ======================================================================
      // gemini_consult
      // ======================================================================
      case 'gemini_consult': {
        const question = args?.question as string;
        const context = args?.context as string | undefined;

        const fullMessage = context
          ? `${question}\n\n---\nContext:\n${context}`
          : question;

        // Auto-execute for quick consultations
        const events = await a2aClient.sendMessage(
          fullMessage,
          undefined,
          DEFAULT_WORKSPACE,
          true
        );

        return {
          content: [{ type: 'text', text: formatEvents(events) }],
        };
      }

      // ======================================================================
      // gemini_command
      // ======================================================================
      case 'gemini_command': {
        const command = args?.command as string;
        const cmdArgs = (args?.args as string[]) || [];

        try {
          const result = await a2aClient.executeCommand(command, cmdArgs);

          let output = `Command: ${command}\n\n`;
          if (typeof result.data === 'string') {
            output += result.data;
          } else {
            output += JSON.stringify(result.data, null, 2);
          }

          return {
            content: [{ type: 'text', text: output }],
          };
        } catch (error) {
          return {
            content: [{ type: 'text', text: `Command failed: ${error instanceof Error ? error.message : String(error)}` }],
          };
        }
      }

      // ======================================================================
      // gemini_list_commands
      // ======================================================================
      case 'gemini_list_commands': {
        const commands = await a2aClient.listCommands();

        if (commands.length === 0) {
          return {
            content: [{ type: 'text', text: 'No commands available.' }],
          };
        }

        const formatCmd = (cmd: typeof commands[0], indent = 0): string[] => {
          const prefix = '  '.repeat(indent);
          const lines = [`${prefix}• ${cmd.name}: ${cmd.description}`];
          if (cmd.arguments && cmd.arguments.length > 0) {
            for (const arg of cmd.arguments) {
              lines.push(`${prefix}    arg: ${arg.name}${arg.isRequired ? ' (required)' : ''} - ${arg.description}`);
            }
          }
          if (cmd.subCommands && cmd.subCommands.length > 0) {
            for (const sub of cmd.subCommands) {
              lines.push(...formatCmd(sub, indent + 1));
            }
          }
          return lines;
        };

        const lines = ['Available Commands:', ''];
        for (const cmd of commands) {
          lines.push(...formatCmd(cmd));
          lines.push('');
        }

        return {
          content: [{ type: 'text', text: lines.join('\n') }],
        };
      }

      // ======================================================================
      // gemini_info
      // ======================================================================
      case 'gemini_info': {
        try {
          const card = await a2aClient.getAgentCard();

          const lines = [
            `${card.name} v${card.version}`,
            `${card.description}`,
            '',
            `Provider: ${card.provider.organization} (${card.provider.url})`,
            `Protocol: A2A v${card.protocolVersion}`,
            `Endpoint: ${card.url}`,
            '',
            'Capabilities:',
            `  • Streaming: ${card.capabilities.streaming}`,
            `  • Push Notifications: ${card.capabilities.pushNotifications}`,
            `  • State History: ${card.capabilities.stateTransitionHistory}`,
            '',
            'Skills:',
            ...card.skills.map(s => `  • ${s.name}: ${s.description}`),
          ];

          return {
            content: [{ type: 'text', text: lines.join('\n') }],
          };
        } catch {
          return {
            content: [{ type: 'text', text: `A2A server not available at ${A2A_SERVER_URL}` }],
          };
        }
      }

      // ======================================================================
      // Unknown tool
      // ======================================================================
      default:
        return {
          content: [{ type: 'text', text: `Unknown tool: ${name}` }],
        };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: `Error: ${message}` }],
    };
  }
});

// ============================================================================
// Start Server
// ============================================================================

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Gemini MCP Bridge v0.2.0 started');
  console.error(`A2A Server: ${A2A_SERVER_URL}`);
  console.error(`Workspace: ${DEFAULT_WORKSPACE}`);
}

main().catch(console.error);
