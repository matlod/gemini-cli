# MCP Bridge for Gemini CLI

Exposes Gemini CLI's A2A server as an MCP server for Claude Code.

## Architecture

```
Claude Code ──MCP (stdio)──▶ MCP Bridge ──HTTP──▶ A2A Server ──▶ Gemini 3.0
```

The A2A server (`packages/a2a-server/`) handles all Gemini interaction. This bridge translates MCP ↔ A2A.

## Setup

```bash
# 1. Install & build bridge
cd features/mcp-bridge
npm install
npm run build

# 2. Start A2A server (separate terminal)
cd packages/a2a-server
npm run start
# Server: http://localhost:41242

# 3. Configure Claude Code (~/.claude/settings.json)
{
  "mcpServers": {
    "gemini": {
      "command": "node",
      "args": ["/path/to/gemini-cli/features/mcp-bridge/dist/index.js"],
      "env": {
        "A2A_SERVER_URL": "http://localhost:41242",
        "GEMINI_WORKSPACE": "/path/to/your/project"
      }
    }
  }
}
```

## Tools

### Core Task Management

#### `gemini_task`
Send a task to Gemini. Returns response with any pending tool approvals.

```
gemini_task(
  task: "Find all auth files and summarize",
  workspace: "/project",      # optional
  autoExecute: false,         # YOLO mode
  sessionId: "abc"            # continue session
)
```

#### `gemini_respond`
Respond to pending tool confirmations.

```
gemini_respond(
  sessionId: "abc",
  callId: "tool-call-id",
  decision: "approve"         # see decisions below
  editedContent: "..."        # only for decision="edit"
)
```

**Decisions:**
- `approve` - Execute once
- `deny` - Don't execute
- `trust_always` - Trust all future calls
- `trust_tool` - Trust this tool type
- `trust_server` - Trust this MCP server
- `edit` - Modify file content before saving

#### `gemini_status`
Get task status including available tools and MCP servers.

#### `gemini_cancel`
Cancel a running task.

#### `gemini_list_sessions`
List all active Gemini sessions.

### Consultation

#### `gemini_consult`
Quick sync consultation with Gemini (auto-execute mode).

```
gemini_consult(
  question: "Review this plan, any gaps?",
  context: "<plan details>"
)
```

### CLI Commands

#### `gemini_command`
Execute Gemini CLI commands.

```
gemini_command(command: "init")
gemini_command(command: "restore list")
gemini_command(command: "restore", args: ["checkpoint-name"])
gemini_command(command: "extensions list")
```

#### `gemini_list_commands`
List available CLI commands.

### Discovery

#### `gemini_info`
Get Gemini agent capabilities, skills, and version.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `A2A_SERVER_URL` | `http://localhost:41242` | A2A server endpoint |
| `GEMINI_WORKSPACE` | Current directory | Default workspace |

## Use Cases

| Pattern | Model | Mode | Example |
|---------|-------|------|---------|
| Grunt work | Flash | Async | Generate test fixtures |
| Context gathering | Flash | Async | Find relevant files |
| Plan review | Pro | Sync | Review implementation plan |
| Code review | Pro | Sync | Check for bugs |
| Project init | - | Command | Create GEMINI.md |

## Response Format

Responses include:
- Session ID and state
- Gemini's thoughts (reasoning)
- Text content
- Tool results (success/error)
- Pending approvals (with callIds)
- Citations/sources
- Errors

## Development

```bash
npm run dev    # Run with tsx (hot reload)
npm run build  # Build for production
npm run start  # Run built version
```
