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
    name: 'gemini_delegate_task_to_assistant',
    description: `Delegate a task to Gemini AI to work on asynchronously. Use Gemini as your "intern" or assistant for grunt work.

PURPOSE: Offload time-consuming or repetitive tasks to Gemini while you continue other work. Gemini (powered by Gemini 3.0 Flash) excels at:
- Searching and analyzing large codebases ("Find all files related to authentication")
- Generating boilerplate or test data ("Create 20 test fixtures for the User model")
- Bulk operations ("Add TypeScript types to all functions in src/utils/")
- Initial code reviews ("Look for obvious bugs in these files")
- Research tasks ("Summarize how error handling works in this project")

WORKFLOW:
1. Call this tool with your task description
2. Gemini works on it and may request approvals for file edits, shell commands, etc.
3. If approvals are pending, use 'gemini_approve_or_deny_pending_action' to respond
4. Check progress with 'gemini_check_task_progress_and_status' if needed
5. Gemini returns results when complete

WHEN TO USE vs gemini_quick_consultation_for_second_opinion:
- Use THIS tool for tasks that require Gemini to DO something (search, edit, generate)
- Use consultation tool for quick questions where you just want Gemini's OPINION

Returns: Session ID, Gemini's response, and any pending tool approvals that need your decision.`,
    inputSchema: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description: 'Detailed description of what you want Gemini to do. Be specific about scope, files, and expected output format.',
        },
        workspace: {
          type: 'string',
          description: 'Absolute path to the working directory for this task. Defaults to GEMINI_WORKSPACE env var or current directory.',
        },
        autoExecute: {
          type: 'boolean',
          description: 'If true, Gemini will automatically execute all tool calls without asking for approval (YOLO mode). Use with caution. Default: false',
        },
        sessionId: {
          type: 'string',
          description: 'Provide a previous session ID to continue an existing conversation with context preserved.',
        },
      },
      required: ['task'],
    },
  },
  {
    name: 'gemini_approve_or_deny_pending_action',
    description: `Respond to a pending tool approval request from Gemini. Use this when Gemini is blocked waiting for your permission to execute an action.

PURPOSE: Gemini asks for approval before executing potentially impactful operations like:
- Writing or editing files
- Running shell commands
- Making API calls
- Deleting or moving files

WHEN TO USE: After calling 'gemini_delegate_task_to_assistant', if the response shows "PENDING DECISIONS" with a callId, you must use this tool to approve or deny before Gemini can continue.

DECISION OPTIONS:
- "approve" → Execute this specific action once, then ask again for future actions
- "deny" → Do not execute this action, Gemini will try alternative approaches
- "trust_always" → Trust ALL future tool calls in this session (use sparingly)
- "trust_tool" → Trust all future calls to THIS TYPE of tool (e.g., all file reads)
- "trust_server" → Trust all tools from the MCP server making this request
- "edit" → For file edits only: modify the proposed content before saving (provide editedContent)

TYPICAL FLOW:
1. Gemini proposes: "I want to run 'grep -r auth src/'"
2. You approve with decision="approve"
3. Gemini executes and continues working
4. Gemini proposes: "I want to edit src/auth.ts"
5. You review and approve, or use "edit" to modify the changes first`,
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: {
          type: 'string',
          description: 'The session ID from the original gemini_delegate_task_to_assistant call',
        },
        callId: {
          type: 'string',
          description: 'The specific tool call ID to respond to (from the PENDING DECISIONS section)',
        },
        decision: {
          type: 'string',
          enum: ['approve', 'deny', 'trust_always', 'trust_tool', 'trust_server', 'edit'],
          description: 'Your decision for this pending action',
        },
        editedContent: {
          type: 'string',
          description: 'When decision is "edit": provide the modified file content you want saved instead of what Gemini proposed',
        },
      },
      required: ['sessionId', 'callId', 'decision'],
    },
  },
  {
    name: 'gemini_check_task_progress_and_status',
    description: `Check the current status and progress of a Gemini task session.

PURPOSE: Monitor what Gemini is doing, see available tools, and check if the task is still running, waiting for input, or completed.

RETURNS:
- Current task state (working, input-required, completed, failed)
- Model being used (Flash or Pro)
- List of tools available to Gemini in this session
- Connected MCP servers and their status

USE CASES:
- Check if a long-running task is still working
- See what tools Gemini has access to
- Debug why a task might be stuck
- Verify task completion before moving on`,
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: {
          type: 'string',
          description: 'The session ID to check status for',
        },
      },
      required: ['sessionId'],
    },
  },
  {
    name: 'gemini_cancel_running_task',
    description: `Cancel and terminate a running Gemini task session.

PURPOSE: Stop a Gemini task that is taking too long, going in the wrong direction, or no longer needed.

EFFECTS:
- Immediately stops the task
- Cleans up the session
- Any pending work is discarded
- The session ID becomes invalid

USE WHEN:
- Task is taking too long and you want to try a different approach
- You realize the task instructions were wrong
- The task is stuck or producing errors
- You no longer need the results`,
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: {
          type: 'string',
          description: 'The session ID of the task to cancel',
        },
      },
      required: ['sessionId'],
    },
  },
  {
    name: 'gemini_list_all_active_sessions',
    description: `List all currently active Gemini task sessions with their status.

PURPOSE: See all ongoing Gemini tasks, useful when managing multiple parallel delegations or recovering context after interruption.

RETURNS for each session:
- Session ID (use with other tools)
- Current state (working, waiting, completed)
- Model being used

USE CASES:
- Find a session ID you forgot
- Check how many parallel tasks are running
- Clean up old sessions
- Resume work after context switch`,
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },

  // ==========================================================================
  // Consultation Tool (Sync, for second opinions)
  // ==========================================================================
  {
    name: 'gemini_quick_consultation_for_second_opinion',
    description: `Get a quick second opinion or consultation from Gemini without starting a full task session.

PURPOSE: Use Gemini as a "senior peer" to review your work, validate approaches, or get fresh perspective. This is a synchronous call that returns immediately with Gemini's response.

BEST FOR:
- "Does this implementation plan look complete? What am I missing?"
- "Review this code for potential bugs or edge cases"
- "I'm choosing between approach A and B - what are the tradeoffs?"
- "Is this the idiomatic way to do X in this codebase?"
- "Sanity check: does this architecture make sense?"

HOW IT DIFFERS FROM gemini_delegate_task_to_assistant:
- Consultation is for OPINIONS and REVIEW (Gemini thinks and responds)
- Task delegation is for WORK (Gemini searches, edits, generates)
- Consultation runs in auto-execute mode (no approval prompts)
- Consultation doesn't maintain session state

TIPS:
- Provide rich context in the 'context' field (code snippets, file contents, plans)
- Ask specific questions rather than vague ones
- Use for validation before committing to an approach`,
    inputSchema: {
      type: 'object',
      properties: {
        question: {
          type: 'string',
          description: 'Your question or what you want Gemini to review. Be specific about what kind of feedback you want.',
        },
        context: {
          type: 'string',
          description: 'Supporting context: code snippets, implementation plans, file contents, error messages, etc. The more context, the better the consultation.',
        },
      },
      required: ['question'],
    },
  },

  // ==========================================================================
  // CLI Command Tools (Gemini CLI Extensions)
  // ==========================================================================
  {
    name: 'gemini_execute_cli_command',
    description: `Execute a Gemini CLI built-in command for project management and configuration.

PURPOSE: Access Gemini CLI's project management features like initialization, checkpoints, and extensions.

AVAILABLE COMMANDS:

"init" - Analyze the current project and create a GEMINI.md file
  - Scans project structure, dependencies, and patterns
  - Creates tailored instructions for Gemini when working in this project
  - Run once per project to improve Gemini's context

"restore list" - List all available checkpoints
  - Shows saved states you can restore to

"restore <name>" - Restore project to a specific checkpoint
  - Reverts files to a previously saved state
  - Use args: ["checkpoint-name"] to specify which checkpoint

"extensions list" - List installed Gemini CLI extensions
  - Shows available plugins and their status

EXAMPLES:
- Initialize project: command="init"
- List checkpoints: command="restore", args=["list"]
- Restore checkpoint: command="restore", args=["before-refactor"]
- List extensions: command="extensions", args=["list"]`,
    inputSchema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The command name to execute: "init", "restore", or "extensions"',
        },
        args: {
          type: 'array',
          items: { type: 'string' },
          description: 'Arguments for the command, e.g., ["list"] for "restore list" or ["checkpoint-name"] for restore',
        },
      },
      required: ['command'],
    },
  },
  {
    name: 'gemini_list_available_cli_commands',
    description: `List all available Gemini CLI commands with their descriptions and arguments.

PURPOSE: Discover what CLI commands are available in this Gemini installation.

USE WHEN:
- You want to see what project management features are available
- You're unsure of the exact command name or syntax
- You want to explore Gemini CLI's capabilities

Returns a structured list of commands with:
- Command name and description
- Required and optional arguments
- Subcommands if applicable`,
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },

  // ==========================================================================
  // Agent Discovery
  // ==========================================================================
  {
    name: 'gemini_get_agent_capabilities_and_version',
    description: `Get detailed information about the Gemini agent's capabilities, version, and available skills.

PURPOSE: Discover what this Gemini instance can do and verify connectivity to the A2A server.

RETURNS:
- Agent name and version
- Provider information
- Protocol version (A2A)
- Capability flags (streaming, push notifications, etc.)
- List of skills with descriptions

USE CASES:
- Verify the MCP bridge is connected to the A2A server
- Check what version of Gemini is running
- Discover available skills and capabilities
- Debug connectivity issues (this is a good "ping" test)

TIP: Call this first when setting up to verify everything is working.`,
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
    sections.push('\nUse gemini_approve_or_deny_pending_action to respond to these.');
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
    if (name !== 'gemini_get_agent_capabilities_and_version') {
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
      // gemini_delegate_task_to_assistant
      // ======================================================================
      case 'gemini_delegate_task_to_assistant': {
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
      // gemini_approve_or_deny_pending_action
      // ======================================================================
      case 'gemini_approve_or_deny_pending_action': {
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
      // gemini_check_task_progress_and_status
      // ======================================================================
      case 'gemini_check_task_progress_and_status': {
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
      // gemini_cancel_running_task
      // ======================================================================
      case 'gemini_cancel_running_task': {
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
      // gemini_list_all_active_sessions
      // ======================================================================
      case 'gemini_list_all_active_sessions': {
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
      // gemini_quick_consultation_for_second_opinion
      // ======================================================================
      case 'gemini_quick_consultation_for_second_opinion': {
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
      // gemini_execute_cli_command
      // ======================================================================
      case 'gemini_execute_cli_command': {
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
      // gemini_list_available_cli_commands
      // ======================================================================
      case 'gemini_list_available_cli_commands': {
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
      // gemini_get_agent_capabilities_and_version
      // ======================================================================
      case 'gemini_get_agent_capabilities_and_version': {
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
