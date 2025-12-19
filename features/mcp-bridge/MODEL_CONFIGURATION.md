# Model Configuration - Technical Analysis

**Status:** Research complete, A2A server fork likely needed for per-request model selection.

## Executive Summary

The A2A server currently selects models at **startup time** based on settings, not per-request. To support the "Flash for grunt work, Pro for consultation" pattern, we need to modify the A2A server to accept a `model` parameter in `AgentSettings`.

---

## Available Models

From `packages/core/src/config/models.ts`:

### Preview Models (Gemini 3)
```typescript
PREVIEW_GEMINI_MODEL = 'gemini-3-pro-preview'
PREVIEW_GEMINI_FLASH_MODEL = 'gemini-3-flash-preview'
PREVIEW_GEMINI_MODEL_AUTO = 'auto-gemini-3'
```

### Default Models (Gemini 2.5)
```typescript
DEFAULT_GEMINI_MODEL = 'gemini-2.5-pro'
DEFAULT_GEMINI_FLASH_MODEL = 'gemini-2.5-flash'
DEFAULT_GEMINI_FLASH_LITE_MODEL = 'gemini-2.5-flash-lite'
DEFAULT_GEMINI_MODEL_AUTO = 'auto-gemini-2.5'
```

### Model Aliases
```typescript
GEMINI_MODEL_ALIAS_PRO = 'pro'
GEMINI_MODEL_ALIAS_FLASH = 'flash'
GEMINI_MODEL_ALIAS_FLASH_LITE = 'flash-lite'
GEMINI_MODEL_ALIAS_AUTO = 'auto'
```

---

## Current Model Selection Flow

### 1. Settings Load
**File:** `packages/a2a-server/src/config/settings.ts`

Settings are loaded hierarchically:
```
~/.gemini/settings.json          (user-level)
{workspace}/.gemini/settings.json (project-level, overrides user)
```

### 2. Config Creation
**File:** `packages/a2a-server/src/config/config.ts` (lines 42-44)

```typescript
model: settings.general?.previewFeatures
  ? PREVIEW_GEMINI_MODEL   // 'gemini-3-pro-preview'
  : DEFAULT_GEMINI_MODEL,  // 'gemini-2.5-pro'
```

### 3. AgentSettings Interface
**File:** `packages/a2a-server/src/types.ts` (lines 46-50)

```typescript
export interface AgentSettings {
  kind: CoderAgentEvent.StateAgentSettingsEvent;
  workspacePath: string;
  autoExecute?: boolean;
  // NOTE: No 'model' field exists!
}
```

---

## The Gap

### What We Want
| Use Case | Desired Model | Mode |
|----------|--------------|------|
| Grunt work (delegate) | Flash (fast, cheap) | Async, interactive |
| Consultation (review) | Pro (smart) | Sync, auto-execute |

### What Exists
- Model is set **once** when A2A server starts
- Based on `settings.general.previewFeatures` flag
- All tasks use the same model
- No per-request model selection

### Current AgentSettings (sent per-request)
```typescript
{
  kind: 'agent-settings',
  workspacePath: '/path/to/project',
  autoExecute: true  // Only controls approval flow, not model
}
```

---

## Key Files Reference

| File | Purpose |
|------|---------|
| `packages/core/src/config/models.ts` | Model constants and resolution logic |
| `packages/a2a-server/src/config/config.ts` | Config creation, model selection |
| `packages/a2a-server/src/config/settings.ts` | Settings loading from JSON files |
| `packages/a2a-server/src/types.ts` | AgentSettings interface definition |
| `packages/a2a-server/src/agent/executor.ts` | Task creation, uses AgentSettings |
| `packages/a2a-server/src/http/app.ts` | HTTP endpoints, receives AgentSettings |

---

## Proposed Fix: Add Model to AgentSettings

### 1. Update Types
**File:** `packages/a2a-server/src/types.ts`

```typescript
export interface AgentSettings {
  kind: CoderAgentEvent.StateAgentSettingsEvent;
  workspacePath: string;
  autoExecute?: boolean;
  model?: string;  // NEW: 'flash' | 'pro' | specific model name
}
```

### 2. Update Config Creation
**File:** `packages/a2a-server/src/config/config.ts`

```typescript
export async function loadConfig(
  settings: Settings,
  extensionLoader: ExtensionLoader,
  taskId: string,
  requestedModel?: string,  // NEW parameter
): Promise<Config> {
  // ...
  const configParams: ConfigParameters = {
    // ...
    model: resolveModel(requestedModel, settings),  // NEW: per-request model
    // ...
  };
}

function resolveModel(requested?: string, settings?: Settings): string {
  if (requested) {
    // Map aliases to actual model names
    switch (requested) {
      case 'flash':
        return settings?.general?.previewFeatures
          ? PREVIEW_GEMINI_FLASH_MODEL
          : DEFAULT_GEMINI_FLASH_MODEL;
      case 'pro':
        return settings?.general?.previewFeatures
          ? PREVIEW_GEMINI_MODEL
          : DEFAULT_GEMINI_MODEL;
      default:
        return requested;  // Allow specific model names
    }
  }
  // Fallback to settings-based selection
  return settings?.general?.previewFeatures
    ? PREVIEW_GEMINI_MODEL
    : DEFAULT_GEMINI_MODEL;
}
```

### 3. Update Executor
**File:** `packages/a2a-server/src/agent/executor.ts`

Pass `agentSettings.model` to `loadConfig()`:

```typescript
private async getConfig(
  agentSettings: AgentSettings,
  taskId: string,
): Promise<Config> {
  // ...
  return loadConfig(settings, extensions, taskId, agentSettings.model);
}
```

---

## MCP Bridge Changes Needed

### After A2A Server Fix

**File:** `features/mcp-bridge/src/index.ts`

Add `model` parameter to tools:

```typescript
{
  name: 'gemini_delegate_task_to_assistant',
  inputSchema: {
    properties: {
      // ... existing ...
      model: {
        type: 'string',
        enum: ['flash', 'pro', 'flash-lite'],
        description: 'Model tier: "flash" for grunt work, "pro" for complex tasks',
        default: 'flash',
      },
    },
  },
},
{
  name: 'gemini_quick_consultation_for_second_opinion',
  inputSchema: {
    properties: {
      // ... existing ...
      model: {
        type: 'string',
        enum: ['flash', 'pro'],
        description: 'Model tier for consultation',
        default: 'pro',
      },
    },
  },
},
```

**File:** `features/mcp-bridge/src/a2a-client.ts`

Pass model in agentSettings:

```typescript
if (workspacePath) {
  body.metadata = {
    coderAgent: {
      kind: 'agent-settings',
      workspacePath,
      autoExecute,
      model,  // NEW
    },
  };
}
```

---

## Configuration Locations Summary

### A2A Server Settings
```
~/.gemini/settings.json
{workspace}/.gemini/settings.json
```

Example:
```json
{
  "general": {
    "previewFeatures": true
  }
}
```

### Claude Code MCP Config
```
~/.claude/settings.json
{project}/.claude/settings.json
```

Example:
```json
{
  "mcpServers": {
    "gemini": {
      "command": "node",
      "args": ["/path/to/mcp-bridge/dist/index.js"],
      "env": {
        "A2A_SERVER_URL": "http://localhost:41242",
        "GEMINI_WORKSPACE": "/path/to/project"
      }
    }
  }
}
```

### Project Instructions (CLAUDE.md)
```
{project}/CLAUDE.md
```

This file is for AI instructions, not configuration. Could document:
- When to use Flash vs Pro
- Project-specific delegation patterns
- Which tasks are good for the intern

---

## Implementation Priority

1. **Phase 1 (Current):** Ship with same-model limitation, document clearly
2. **Phase 2 (Fork):** Modify A2A server to accept model in AgentSettings
3. **Phase 3 (Polish):** Update MCP bridge to pass model, add smart defaults

---

## Testing the Current Behavior

```bash
# Check what model A2A server is using
curl http://localhost:41242/.well-known/agent-card.json | jq '.skills'

# The model is determined by settings at startup
# Look in ~/.gemini/settings.json for:
# { "general": { "previewFeatures": true/false } }
```

---

## Related Documentation

- [SESSION_HANDOFF.md](./SESSION_HANDOFF.md) - Full project context
- [README.md](./README.md) - MCP bridge usage
- [ARCHITECTURE.md](../ARCHITECTURE.md) - System design
