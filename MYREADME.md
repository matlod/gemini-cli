# Modded Gemini CLI

Fork of Google's Gemini CLI, modified to serve as an MCP server for Claude Code.

## Purpose

Transforms Gemini CLI into an "intern agent" that Claude Code can interface with:
- **Gemini 3.0 Flash** - Async grunt work, context gathering, data generation
- **Gemini 3.0 Pro** - Sync consultation, plan review, second opinions

## Quick Start

```bash
# 1. Install main project
npm install

# 2. Build & install MCP bridge
cd features/mcp-bridge && npm install && npm run build

# 3. Start A2A server
cd packages/a2a-server && npm run start
# Server: http://localhost:41242

# 4. Add to Claude Code settings (~/.claude/settings.json)
{
  "mcpServers": {
    "gemini": {
      "command": "node",
      "args": ["/path/to/gemini-cli/features/mcp-bridge/dist/index.js"],
      "env": {
        "A2A_SERVER_URL": "http://localhost:41242",
        "GEMINI_WORKSPACE": "/your/project"
      }
    }
  }
}
```

## MCP Tools

| Tool | Description |
|------|-------------|
| `gemini_task` | Delegate work to Gemini |
| `gemini_respond` | Approve/deny tool calls |
| `gemini_status` | Check task status |
| `gemini_cancel` | Cancel running task |
| `gemini_list_sessions` | List active sessions |
| `gemini_consult` | Quick consultation (auto-execute) |
| `gemini_command` | Execute CLI commands |
| `gemini_list_commands` | List CLI commands |
| `gemini_info` | Get agent info |

## Project Structure

```
gemini-cli/
├── features/               # Our mods (separate from upstream)
│   └── mcp-bridge/        # MCP-to-A2A translation layer
│       ├── src/
│       │   ├── index.ts   # MCP server (9 tools)
│       │   └── a2a-client.ts
│       └── SESSION_HANDOFF.md  # Context for future sessions
│
├── packages/              # Upstream Google code
│   ├── a2a-server/       # A2A HTTP server (fully built!)
│   ├── cli/              # Terminal UI
│   └── core/             # Business logic
│
├── ARCHITECTURE.md       # Full design doc
└── MYREADME.md          # This file
```

## Key Docs

- **[ARCHITECTURE.md](./ARCHITECTURE.md)** - Full design, A2A protocol details
- **[features/mcp-bridge/README.md](./features/mcp-bridge/README.md)** - Tool usage
- **[features/mcp-bridge/SESSION_HANDOFF.md](./features/mcp-bridge/SESSION_HANDOFF.md)** - Session continuity

## Architecture

```
Claude Code ──MCP──▶ MCP Bridge ──HTTP──▶ A2A Server ──▶ Gemini
             (stdio)  (features/)         (packages/)
```

The A2A server was already built by Google. We added a thin MCP translation layer.
