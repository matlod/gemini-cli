# Authentication - Technical Analysis

**Goal:** Use CLI account auth (OAuth login) instead of API key for A2A server.

---

## Summary

The A2A server **already supports** using CLI OAuth credentials. You just need to:

1. **Login via CLI first:** `gemini` (completes OAuth browser flow)
2. **Start A2A server with:** `USE_CCPA=true`

The server will automatically use cached credentials from `~/.gemini/oauth_creds.json`.

---

## Auth Types

From `packages/core/src/core/contentGenerator.ts`:

```typescript
export enum AuthType {
  LOGIN_WITH_GOOGLE = 'oauth-personal',     // Browser OAuth, cached to ~/.gemini/oauth_creds.json
  USE_GEMINI = 'gemini-api-key',            // GEMINI_API_KEY env var
  USE_VERTEX_AI = 'vertex-ai',              // Google Cloud Vertex AI
  LEGACY_CLOUD_SHELL = 'cloud-shell',       // Cloud Shell environment
  COMPUTE_ADC = 'compute-default-credentials', // GCE metadata server
}
```

---

## A2A Server Auth Selection

From `packages/a2a-server/src/config/config.ts` (lines 102-125):

```typescript
if (process.env['USE_CCPA']) {
  // Uses cached OAuth credentials from ~/.gemini/oauth_creds.json
  await config.refreshAuth(AuthType.LOGIN_WITH_GOOGLE);

} else if (process.env['GEMINI_API_KEY']) {
  // Uses API key from environment
  await config.refreshAuth(AuthType.USE_GEMINI);

} else {
  throw new Error('Please provide a GEMINI_API_KEY or set USE_CCPA.');
}
```

---

## OAuth Credential Storage

### File Location
```
~/.gemini/oauth_creds.json
```

From `packages/core/src/config/storage.ts`:
```typescript
static getOAuthCredsPath(): string {
  return path.join(Storage.getGlobalGeminiDir(), OAUTH_FILE);
  // → ~/.gemini/oauth_creds.json
}
```

### Contents
```json
{
  "access_token": "ya29...",
  "refresh_token": "1//...",
  "scope": "https://www.googleapis.com/auth/cloud-platform ...",
  "token_type": "Bearer",
  "expiry_date": 1234567890000
}
```

### How CLI Creates It

From `packages/core/src/code_assist/oauth2.ts`:

1. **Browser flow** (`authWithWeb`): Opens browser → Google OAuth → Callback server
2. **Manual flow** (`authWithUserCode`): Prints URL → User enters code manually
3. **Credentials cached**: Saved to `~/.gemini/oauth_creds.json`
4. **Auto-refresh**: `refresh_token` used to get new `access_token` when expired

---

## Key Files Reference

| File | Purpose |
|------|---------|
| `packages/core/src/code_assist/oauth2.ts` | OAuth flow, credential caching |
| `packages/core/src/config/storage.ts` | Storage paths (oauth_creds.json) |
| `packages/core/src/core/contentGenerator.ts` | AuthType enum, content generator |
| `packages/a2a-server/src/config/config.ts` | A2A server auth selection |

---

## Setup Instructions

### Option 1: CLI Account Auth (Recommended)

```bash
# 1. Login via CLI (one-time, creates ~/.gemini/oauth_creds.json)
cd /path/to/gemini-cli
npm run cli

# Complete browser OAuth flow...

# 2. Start A2A server with USE_CCPA and fixed port
CODER_AGENT_PORT=41242 USE_CCPA=true npm run start -w packages/a2a-server

# 3. Start MCP bridge (in another terminal)
A2A_SERVER_URL=http://localhost:41242 node features/mcp-bridge/dist/index.js
```

**Important:** Set `CODER_AGENT_PORT` for a fixed port. Without it, the server picks a random port each time.

### Option 2: API Key

```bash
# Start A2A server with API key
GEMINI_API_KEY=your-api-key npm run start -w packages/a2a-server
```

---

## MCP Bridge Configuration

Update Claude Code settings (`~/.claude/settings.json`):

```json
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

Note: The MCP bridge itself doesn't need auth - it just talks to the A2A server over HTTP.

---

## Environment Variables

### A2A Server

| Variable | Purpose |
|----------|---------|
| `CODER_AGENT_PORT` | Fixed port (e.g., 41242). Default: 0 (random) |
| `USE_CCPA` | Set to any value to use cached OAuth credentials |
| `GEMINI_API_KEY` | API key (alternative to OAuth) |
| `CODER_AGENT_WORKSPACE_PATH` | Default workspace for commands |
| `GOOGLE_APPLICATION_CREDENTIALS` | Path to service account JSON (for USE_CCPA) |
| `GOOGLE_CLOUD_PROJECT` | GCP project ID (logged but not required for OAuth) |

### MCP Bridge

| Variable | Purpose |
|----------|---------|
| `A2A_SERVER_URL` | A2A server endpoint (default: http://localhost:41242) |
| `GEMINI_WORKSPACE` | Default workspace path for tasks |

---

## Troubleshooting

### "Please provide a GEMINI_API_KEY or set USE_CCPA"

A2A server doesn't have auth configured. Either:
- Set `USE_CCPA=true` and ensure you've logged in via CLI first
- Set `GEMINI_API_KEY=your-key`

### "Cached credentials are not valid"

OAuth token expired and couldn't refresh. Re-login:
```bash
rm ~/.gemini/oauth_creds.json
npm run cli  # Complete OAuth flow again
```

### Check if logged in

```bash
cat ~/.gemini/oauth_creds.json | jq '.refresh_token'
# Should show a refresh token if logged in
```

---

## Security Notes

1. **OAuth credentials are sensitive** - `~/.gemini/oauth_creds.json` should be `chmod 600`
2. **Don't commit credentials** - File is in home directory, not project
3. **Token refresh** - The CLI automatically refreshes expired tokens
4. **Encrypted storage** - Set `FORCE_ENCRYPTED_FILE=true` for encrypted credential storage

---

## Related Files

- [MODEL_CONFIGURATION.md](./MODEL_CONFIGURATION.md) - Model selection analysis
- [SESSION_HANDOFF.md](./SESSION_HANDOFF.md) - Full project context
