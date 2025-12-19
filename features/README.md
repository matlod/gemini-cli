# Features (Mods)

This folder contains custom modifications to the Gemini CLI that are kept separate from upstream for easy maintenance.

## Structure

```
features/
├── mcp-bridge/     # MCP server for Claude Code integration
└── README.md       # This file
```

## Why a separate folder?

When the main Gemini CLI repo gets updates, we can:
1. Pull upstream changes easily
2. Keep our mods isolated
3. Avoid merge conflicts in core code
4. Track what we've added vs what's upstream

## Current Features

### mcp-bridge

Exposes Gemini CLI's A2A server as an MCP server that Claude Code can consume.

See [mcp-bridge/README.md](./mcp-bridge/README.md) for details.
