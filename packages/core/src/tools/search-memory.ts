/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Search memory tool for subagent access to memory cores.
 *
 * This tool allows subagents to search project memory for relevant patterns,
 * conventions, or past solutions. It's part of the hybrid memory architecture:
 *
 * - Layer 1 (Static): Project context in system prompt
 * - Layer 2 (Dynamic): Per-turn ephemeral injection
 * - Tool Access (this): Explicit search for subagents
 *
 * Subagents don't receive per-turn ephemeral injection, so they can use this
 * tool to fetch relevant context when needed.
 */

import type { MessageBus } from '../confirmation-bus/message-bus.js';
import type { ToolInvocation, ToolResult } from './tools.js';
import { BaseDeclarativeTool, BaseToolInvocation, Kind } from './tools.js';
import type { Config } from '../config/config.js';
import { SEARCH_MEMORY_TOOL_NAME } from './tool-names.js';
import { debugLogger } from '../utils/debugLogger.js';
import type { MemoryScope } from '../memory/types.js';

/**
 * Parameters for the SearchMemoryTool
 */
export interface SearchMemoryToolParams {
  /**
   * The search query - what to look for in memory
   */
  query: string;

  /**
   * Scope of memory to search: 'project' or 'global'
   */
  scope?: MemoryScope;

  /**
   * Maximum number of results to return (default: 8)
   */
  limit?: number;
}

/**
 * Invocation class for the search_memory tool
 */
class SearchMemoryToolInvocation extends BaseToolInvocation<
  SearchMemoryToolParams,
  ToolResult
> {
  constructor(
    private config: Config,
    params: SearchMemoryToolParams,
    messageBus?: MessageBus,
    _toolName?: string,
    _toolDisplayName?: string,
  ) {
    super(params, messageBus, _toolName, _toolDisplayName);
  }

  getDescription(): string {
    const scopeStr = this.params.scope ? ` in ${this.params.scope} memory` : '';
    return `Searching${scopeStr}: "${this.params.query.slice(0, 50)}${this.params.query.length > 50 ? '...' : ''}"`;
  }

  async execute(signal: AbortSignal): Promise<ToolResult> {
    const memoryCoreManager = this.config.getMemoryCoreManager();

    if (!memoryCoreManager) {
      return {
        llmContent: 'Memory system is not configured.',
        returnDisplay: 'Memory not available',
      };
    }

    try {
      const hits = await memoryCoreManager.search(this.params.query, {
        scope: this.params.scope,
        limit: this.params.limit ?? 8,
        signal,
      });

      if (hits.length === 0) {
        return {
          llmContent: `No relevant memory found for query: "${this.params.query}"`,
          returnDisplay: 'No results',
        };
      }

      // Format results as a bullet list
      const formattedHits = hits
        .map((hit) => {
          const source = hit.source ? ` (source: ${hit.source})` : '';
          const score = hit.score.toFixed(2);
          return `• [${score}] ${hit.text}${source}`;
        })
        .join('\n');

      const resultMessage = `Found ${hits.length} relevant memories:\n\n${formattedHits}`;

      debugLogger.log(
        `search_memory: ${hits.length} results for "${this.params.query.slice(0, 30)}..."`,
      );

      return {
        llmContent: resultMessage,
        returnDisplay: `Found ${hits.length} memories`,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      debugLogger.warn(`search_memory error: ${errorMessage}`);

      return {
        llmContent: `Error searching memory: ${errorMessage}`,
        returnDisplay: 'Search failed',
      };
    }
  }
}

/**
 * Search memory tool for subagent access to memory cores.
 *
 * Allows subagents to search project memory for relevant patterns,
 * conventions, or past solutions.
 */
export class SearchMemoryTool extends BaseDeclarativeTool<
  SearchMemoryToolParams,
  ToolResult
> {
  static readonly Name = SEARCH_MEMORY_TOOL_NAME;

  constructor(
    private config: Config,
    messageBus?: MessageBus,
  ) {
    super(
      SearchMemoryTool.Name,
      'SearchMemory',
      'Search project memory for relevant patterns, conventions, or past solutions. Use this when you need context about how things are typically done in this project or codebase.',
      Kind.Search,
      {
        properties: {
          query: {
            description:
              'What to search for in memory (e.g., "error handling patterns", "authentication flow", "testing conventions")',
            type: 'string',
          },
          scope: {
            description:
              "Scope of memory to search: 'project' for current project context, 'global' for cross-project patterns. Defaults to 'project'.",
            type: 'string',
            enum: ['project', 'global'],
          },
          limit: {
            description: 'Maximum number of results to return. Defaults to 8.',
            type: 'number',
          },
        },
        required: ['query'],
        type: 'object',
      },
      true, // requiresApproval
      false, // requiresSandbox
      messageBus,
    );
  }

  /**
   * Validates the parameters for the tool.
   */
  protected override validateToolParamValues(
    params: SearchMemoryToolParams,
  ): string | null {
    if (
      !params.query ||
      typeof params.query !== 'string' ||
      params.query.trim() === ''
    ) {
      return "The 'query' parameter cannot be empty.";
    }

    if (
      params.scope &&
      params.scope !== 'project' &&
      params.scope !== 'global'
    ) {
      return "The 'scope' parameter must be either 'project' or 'global'.";
    }

    if (params.limit !== undefined) {
      if (typeof params.limit !== 'number' || params.limit < 1) {
        return "The 'limit' parameter must be a positive number.";
      }
      if (params.limit > 50) {
        return "The 'limit' parameter cannot exceed 50.";
      }
    }

    return null;
  }

  protected createInvocation(
    params: SearchMemoryToolParams,
    messageBus?: MessageBus,
    _toolName?: string,
    _toolDisplayName?: string,
  ): ToolInvocation<SearchMemoryToolParams, ToolResult> {
    return new SearchMemoryToolInvocation(
      this.config,
      params,
      messageBus,
      _toolName,
      _toolDisplayName,
    );
  }
}
