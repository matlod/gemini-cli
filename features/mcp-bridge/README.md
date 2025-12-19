# MCP Bridge for Gemini CLI

Exposes Gemini CLI's A2A server as an MCP server for Claude Code. Use Gemini as your "intern" for grunt work or as a "senior peer" for second opinions.

## Architecture

```
Claude Code ──MCP (stdio)──▶ MCP Bridge ──HTTP──▶ A2A Server ──▶ Gemini 3.0
                             (this pkg)           (packages/     (Pro/Flash)
                                                   a2a-server/)
```

The A2A server (`packages/a2a-server/`) handles all Gemini interaction. This bridge translates MCP ↔ A2A.

## Quick Start

### Step 1: Build the MCP Bridge

```bash
cd features/mcp-bridge
npm install
npm run build
```

### Step 2: Login to Gemini CLI (One-Time)

```bash
# From project root
npm run cli

# Complete the OAuth flow in your browser
# This creates ~/.gemini/oauth_creds.json
# Press Ctrl+C after login completes
```

### Step 3: Start the A2A Server

```bash
# From project root - use fixed port and OAuth auth
CODER_AGENT_PORT=41242 USE_CCPA=true npm run start -w packages/a2a-server
```

**Important:** Keep this terminal running. The A2A server must be running for the MCP bridge to work.

### Step 4: Configure Claude Code

Copy the example settings file and customize:

```bash
cp .claude/settings.json.example ~/.claude/settings.json
# Edit ~/.claude/settings.json and replace the path placeholder
```

Or manually add to `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "gemini": {
      "command": "node",
      "args": ["/YOUR/PATH/TO/gemini-cli/features/mcp-bridge/dist/index.js"],
      "env": {
        "A2A_SERVER_URL": "http://localhost:41242"
      }
    }
  }
}
```

### Step 5: Restart Claude Code

Restart Claude Code to pick up the new MCP server configuration.

### Step 6: Verify

In Claude Code, the Gemini tools should now be available. Test with:
- `gemini_get_agent_capabilities_and_version` - Should return agent info

## Environment Variables

### A2A Server

| Variable | Default | Description |
|----------|---------|-------------|
| `CODER_AGENT_PORT` | `0` (random) | Fixed port for A2A server |
| `USE_CCPA` | - | Use OAuth credentials from CLI login |
| `GEMINI_API_KEY` | - | Alternative: use API key instead of OAuth |

### MCP Bridge

| Variable | Default | Description |
|----------|---------|-------------|
| `A2A_SERVER_URL` | `http://localhost:41242` | A2A server endpoint |
| `GEMINI_WORKSPACE` | Current directory | Default workspace for tasks |

## Tools

### Core Task Management

#### `gemini_delegate_task_to_assistant`
Send a task to Gemini. Returns response with any pending tool approvals.

```
gemini_delegate_task_to_assistant(
  task: "Find all auth files and summarize",
  workspace: "/project",      # optional
  autoExecute: false,         # YOLO mode
  sessionId: "abc"            # continue session
)
```

#### `gemini_approve_or_deny_pending_action`
Respond to pending tool confirmations.

```
gemini_approve_or_deny_pending_action(
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

#### `gemini_check_task_progress_and_status`
Get task status including available tools and MCP servers.

#### `gemini_cancel_running_task`
Cancel a running task.

#### `gemini_list_all_active_sessions`
List all active Gemini sessions.

### Consultation

#### `gemini_quick_consultation_for_second_opinion`
Quick sync consultation with Gemini (auto-execute mode).

```
gemini_quick_consultation_for_second_opinion(
  question: "Review this plan, any gaps?",
  context: "<plan details>"
)
```

### CLI Commands

#### `gemini_execute_cli_command`
Execute Gemini CLI commands.

```
gemini_execute_cli_command(command: "init")
gemini_execute_cli_command(command: "restore", args: ["list"])
gemini_execute_cli_command(command: "restore", args: ["checkpoint-name"])
gemini_execute_cli_command(command: "extensions", args: ["list"])
```

#### `gemini_list_available_cli_commands`
List available CLI commands.

### Discovery

#### `gemini_get_agent_capabilities_and_version`
Get Gemini agent capabilities, skills, and version. Good for testing connectivity.

## Use Cases

| Pattern | Model | Mode | Example |
|---------|-------|------|---------|
| Grunt work | Flash* | Async | Generate test fixtures |
| Context gathering | Flash* | Async | Find relevant files |
| Plan review | Pro* | Sync | Review implementation plan |
| Code review | Pro* | Sync | Check for bugs |
| Project init | - | Command | Create GEMINI.md |

*Note: Model selection is currently based on server settings (`~/.gemini/settings.json` → `general.previewFeatures`). Per-request model selection requires A2A server modification. See [MODEL_CONFIGURATION.md](./MODEL_CONFIGURATION.md).

## Response Format

Responses include:
- Session ID and state
- Gemini's thoughts (reasoning)
- Text content
- Tool results (success/error)
- Pending approvals (with callIds)
- Citations/sources
- Errors

## Troubleshooting

### "A2A server not reachable"
Start the A2A server:
```bash
CODER_AGENT_PORT=41242 USE_CCPA=true npm run start -w packages/a2a-server
```

### "Please provide a GEMINI_API_KEY or set USE_CCPA"
You haven't logged in yet. Run `npm run cli` and complete OAuth.

### "Session not found"
Sessions are in-memory. Restarting A2A server clears them.

### MCP server not appearing in Claude Code
1. Check `~/.claude/settings.json` has correct path
2. Restart Claude Code
3. Check A2A server is running on port 41242

## Development

```bash
npm run dev    # Run with tsx (hot reload)
npm run build  # Build for production
npm run start  # Run built version
```

## Related Documentation

- [SESSION_HANDOFF.md](./SESSION_HANDOFF.md) - Full project context
- [AUTHENTICATION.md](./AUTHENTICATION.md) - Auth options (OAuth vs API key)
- [MODEL_CONFIGURATION.md](./MODEL_CONFIGURATION.md) - Model selection details
