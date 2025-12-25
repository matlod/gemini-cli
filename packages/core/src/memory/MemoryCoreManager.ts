/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview LanceDB-backed implementation of MemoryCoreManager.
 *
 * This is the main implementation of the memory system, providing:
 * - Static layer: Curated project memory for system prompt
 * - Dynamic layer: Vector similarity search for ephemeral injection
 * - Tool access: Search interface for subagent tools
 *
 * Implementation phases:
 * - Phase 1 (current): Stub implementation with pseudocode
 * - Phase 2: Integration with config and geminiChat
 * - Phase 3: Full LanceDB implementation with embeddings
 *
 * Key guards to implement:
 * - Check signal.aborted before/after async operations
 * - Log warnings on error, never throw (don't block conversation)
 * - Return empty results on error
 */

import type { Part } from '@google/genai';
import { debugLogger } from '../utils/debugLogger.js';
import type {
  MemoryConfig,
  MemoryCoreManager,
  MemoryHit,
  MemoryRetrieveOptions,
  MemorySearchOptions,
} from './types.js';
// MemoryScope will be used in Phase 3 for getTableName()

/**
 * LanceDB-backed implementation of the memory core manager.
 *
 * Provides vector similarity search over project and global memories.
 * Uses embeddings from configurable providers (ollama, openai, gemini).
 *
 * @example
 * ```typescript
 * const manager = new LanceDBMemoryCoreManager({
 *   dbPath: '/home/user/.gemini/memory.lance',
 *   embedding: {
 *     provider: 'ollama',
 *     model: 'nomic-embed-text',
 *     endpoint: 'http://localhost:11434',
 *   },
 * });
 *
 * // Get static project memory for system prompt
 * const projectMemory = await manager.getProjectCoreMemory();
 *
 * // Get dynamic memories for current turn
 * const hits = await manager.retrieveRelevant(userMessage, {
 *   signal,
 *   minSimilarity: 0.75,
 *   topK: 50,
 * });
 * ```
 */
export class LanceDBMemoryCoreManager implements MemoryCoreManager {
  // TODO (Phase 3): Add these properties when implementing LanceDB
  // private readonly dbPath: string;
  // private readonly config: MemoryConfig;
  // private db: lancedb.Connection;
  // private table: lancedb.Table;

  /**
   * Create a new LanceDB memory manager.
   *
   * @param config - Memory configuration including DB path and embedding settings
   */
  constructor(_config: MemoryConfig) {
    // TODO (Phase 3): Store config for LanceDB connection
    // this.dbPath = config.dbPath;
    // this.config = config;
  }

  /**
   * Get curated project context for the system prompt (Layer 1 - Static).
   *
   * PSEUDOCODE:
   * 1. Check if signal is aborted → return ''
   * 2. Open LanceDB connection (lazy init)
   * 3. Read curated project memory from 'project_core' table
   * 4. Format as markdown string
   * 5. Return formatted string for system prompt
   * 6. On error: log warning, return empty string (don't block)
   *
   * @param options - Optional configuration including AbortSignal
   * @returns Formatted string for system prompt injection
   */
  async getProjectCoreMemory(options?: {
    signal?: AbortSignal;
  }): Promise<string> {
    // Check for early abort
    if (options?.signal?.aborted) {
      return '';
    }

    try {
      // TODO (Phase 3): Implement LanceDB retrieval
      // 1. await this.ensureConnection();
      // 2. const coreTable = await this.db.openTable('project_core');
      // 3. const entries = await coreTable.search([]).limit(100).execute();
      // 4. return entries.map(e => e.text).join('\n\n');

      debugLogger.log('getProjectCoreMemory: stub implementation');
      return '';
    } catch (error) {
      // Log warning but don't throw - never block the conversation
      debugLogger.warn(
        `Failed to load project core memory: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      return '';
    }
  }

  /**
   * Retrieve relevant memories for ephemeral injection (Layer 2 - Dynamic).
   *
   * PSEUDOCODE:
   * 1. Check if signal is aborted → return []
   * 2. Convert request to query string (handle Part[] case)
   * 3. Generate embedding for query using configured provider
   * 4. Search LanceDB with topK (default 50) candidates
   * 5. Filter results by minSimilarity (default 0.75)
   * 6. Map to MemoryHit[] with scores and sources
   * 7. Sort by score descending
   * 8. Return ranked hits
   * 9. On error: log warning, return [] (don't block)
   *
   * @param request - The current user request (string or Parts)
   * @param options - Retrieval options
   * @returns Ranked array of memory hits
   */
  async retrieveRelevant(
    request: string | Part[],
    options?: MemoryRetrieveOptions,
  ): Promise<MemoryHit[]> {
    const {
      signal,
      scope = 'project',
      minSimilarity = 0.75,
      topK = 50,
    } = options ?? {};

    // Check for early abort
    if (signal?.aborted) {
      return [];
    }

    try {
      // Convert request to query string
      const query = this.extractQueryText(request);
      if (!query) {
        return [];
      }

      // TODO (Phase 3): Implement vector search
      // 1. const embedding = await this.generateEmbedding(query);
      // 2. if (signal?.aborted) return [];
      // 3. const table = await this.db.openTable(this.getTableName(scope));
      // 4. const results = await table.search(embedding)
      //      .limit(topK)
      //      .execute();
      // 5. return results
      //      .filter(r => r._distance >= minSimilarity)
      //      .map(r => ({
      //        id: r.id,
      //        text: r.text,
      //        score: r._distance,
      //        source: r.source,
      //        tokenEstimate: r.token_estimate,
      //      }));

      debugLogger.log(
        `retrieveRelevant: stub - query="${query.slice(0, 50)}...", scope=${scope}, topK=${topK}, minSim=${minSimilarity}`,
      );
      return [];
    } catch (error) {
      // Check if aborted - don't log if intentionally cancelled
      if (signal?.aborted) {
        return [];
      }
      // Log warning but don't throw - never block the conversation
      debugLogger.warn(
        `Memory retrieval failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      return [];
    }
  }

  /**
   * Search memories via the search_memory tool (for subagents).
   *
   * PSEUDOCODE:
   * 1. Check if signal is aborted → return []
   * 2. Generate embedding for query
   * 3. Search with limit (default 8)
   * 4. Map to MemoryHit[]
   * 5. Return hits
   * 6. On error: log warning, return []
   *
   * @param query - Search query string
   * @param options - Search options
   * @returns Array of memory hits
   */
  async search(
    query: string,
    options?: MemorySearchOptions,
  ): Promise<MemoryHit[]> {
    const { scope = 'project', limit = 8, signal } = options ?? {};

    // Check for early abort
    if (signal?.aborted) {
      return [];
    }

    try {
      // TODO (Phase 3): Implement search
      // Reuse retrieveRelevant with limit instead of topK
      // 1. const embedding = await this.generateEmbedding(query);
      // 2. if (signal?.aborted) return [];
      // 3. const table = await this.db.openTable(this.getTableName(scope));
      // 4. const results = await table.search(embedding).limit(limit).execute();
      // 5. return results.map(r => ({
      //      id: r.id,
      //      text: r.text,
      //      score: r._distance,
      //      source: r.source,
      //    }));

      debugLogger.log(
        `search: stub - query="${query.slice(0, 50)}...", scope=${scope}, limit=${limit}`,
      );
      return [];
    } catch (error) {
      // Check if aborted
      if (signal?.aborted) {
        return [];
      }
      debugLogger.warn(
        `Memory search failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      return [];
    }
  }

  // ============================================================================
  // Private helper methods
  // ============================================================================

  /**
   * Extract text from a request (string or Part[]).
   *
   * @param request - String or array of Parts
   * @returns Extracted text query
   */
  private extractQueryText(request: string | Part[]): string {
    if (typeof request === 'string') {
      return request;
    }

    // Extract text from Parts
    const textParts = request
      .filter((part): part is Part & { text: string } => 'text' in part)
      .map((part) => part.text);

    return textParts.join(' ').trim();
  }

  // TODO (Phase 3): Uncomment when implementing LanceDB
  // /**
  //  * Get the table name for a given scope.
  //  *
  //  * @param scope - Memory scope
  //  * @returns Table name in LanceDB
  //  */
  // private getTableName(scope: MemoryScope): string {
  //   return scope === 'global' ? 'global_memory' : 'project_memory';
  // }

  // ============================================================================
  // TODO (Phase 3): LanceDB connection and embedding methods
  // ============================================================================

  // private async ensureConnection(): Promise<void> {
  //   if (!this.db) {
  //     this.db = await lancedb.connect(this.dbPath);
  //   }
  // }

  // private async generateEmbedding(text: string): Promise<number[]> {
  //   const { provider, model, endpoint } = this.config.embedding;
  //   switch (provider) {
  //     case 'ollama':
  //       return this.generateOllamaEmbedding(text, model, endpoint);
  //     case 'openai':
  //       return this.generateOpenAIEmbedding(text, model);
  //     case 'gemini':
  //       return this.generateGeminiEmbedding(text, model);
  //     default:
  //       throw new Error(`Unknown embedding provider: ${provider}`);
  //   }
  // }

  // private async generateOllamaEmbedding(
  //   text: string,
  //   model: string,
  //   endpoint = 'http://localhost:11434',
  // ): Promise<number[]> {
  //   const response = await fetch(`${endpoint}/api/embeddings`, {
  //     method: 'POST',
  //     headers: { 'Content-Type': 'application/json' },
  //     body: JSON.stringify({ model, prompt: text }),
  //   });
  //   const data = await response.json();
  //   return data.embedding;
  // }
}
