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
 * ## Architecture
 *
 * The retrieval pipeline follows "over-retrieve then filter":
 * 1. Embed query using configured embedding provider
 * 2. Vector search to get ~50 candidates (over-retrieve)
 * 3. LLM filters to 5-12 most relevant based on context
 * 4. Return filtered hits for injection
 *
 * ## Implementation Status
 *
 * - Phase 1: ✅ Types, formatters, stub implementation
 * - Phase 2: ✅ Integration with config and geminiChat
 * - Phase 3: 🔄 LanceDB + embeddings + LLM filter (in progress)
 *
 * ## Key Guards
 *
 * - Check signal.aborted before/after async operations
 * - Log warnings on error, never throw (don't block conversation)
 * - Return empty results on error
 * - Fallback to score-based selection if LLM filter fails
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
import type { EmbeddingClient } from './embeddings/embeddings.js';
import type { MemoryStore, VectorSearchResult } from './store/store.js';
import { filterByRelevance, type CandidateHit } from './relevance/llmFilter.js';

// Default embedding dimension for nomic-embed-text
const DEFAULT_EMBEDDING_DIMENSION = 768;

/**
 * Options for initializing the MemoryCoreManager.
 */
export interface MemoryCoreManagerOptions {
  /** Memory store implementation */
  store: MemoryStore;

  /** Embedding client implementation */
  embeddings: EmbeddingClient;

  /**
   * LLM call function for relevance filtering.
   * If not provided, falls back to score-based selection.
   */
  llmCall?: (prompt: string, signal?: AbortSignal) => Promise<string>;
}

/**
 * LanceDB-backed implementation of the memory core manager.
 *
 * Provides vector similarity search over project and global memories.
 * Uses the "over-retrieve then filter with LLM" strategy for relevance.
 *
 * @example
 * ```typescript
 * // Create components
 * const store = new LanceDBStore('/path/to/memory.lance');
 * const embeddings = new OllamaEmbeddings({
 *   baseUrl: 'http://localhost:11434',
 *   model: 'nomic-embed-text',
 *   dimension: 768,
 * });
 *
 * // Create manager
 * const manager = new LanceDBMemoryCoreManager({
 *   store,
 *   embeddings,
 *   llmCall: async (prompt, signal) => {
 *     const response = await geminiClient.generateContent(prompt);
 *     return response.text();
 *   },
 * });
 *
 * // Initialize
 * await manager.init();
 *
 * // Retrieve memories
 * const hits = await manager.retrieveRelevant(userMessage, {
 *   signal,
 *   topK: 50,
 * });
 * ```
 */
export class LanceDBMemoryCoreManager implements MemoryCoreManager {
  private readonly store: MemoryStore;
  private readonly embeddings: EmbeddingClient;
  private readonly llmCall?: (
    prompt: string,
    signal?: AbortSignal,
  ) => Promise<string>;
  private initialized = false;

  /**
   * Create a new LanceDB memory manager.
   *
   * @param options - Manager options including store, embeddings, and LLM call
   */
  constructor(options: MemoryCoreManagerOptions) {
    this.store = options.store;
    this.embeddings = options.embeddings;
    this.llmCall = options.llmCall;
  }

  /**
   * Legacy constructor support for MemoryConfig.
   * Creates a manager with uninitialized store/embeddings for backward compatibility.
   *
   * @deprecated Use the options-based constructor instead
   */
  static fromConfig(_config: MemoryConfig): LanceDBMemoryCoreManager {
    // This is a stub for backward compatibility during migration
    // Real initialization will be done via the options constructor
    debugLogger.warn(
      'LanceDBMemoryCoreManager.fromConfig: Using stub - migrate to options constructor',
    );

    // Create a no-op manager that returns empty results
    return new LanceDBMemoryCoreManager({
      store: createNoOpStore(),
      embeddings: createNoOpEmbeddings(),
    });
  }

  /**
   * Initialize the manager and underlying store.
   *
   * Must be called before using retrieval methods.
   */
  async init(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      debugLogger.log('LanceDBMemoryCoreManager: Initializing');
      await this.store.init();
      this.initialized = true;
      debugLogger.log('LanceDBMemoryCoreManager: Initialized successfully');
    } catch (error) {
      debugLogger.warn(
        `LanceDBMemoryCoreManager: Failed to initialize: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      // Don't throw - allow graceful degradation
    }
  }

  /**
   * Get curated project context for the system prompt (Layer 1 - Static).
   *
   * Retrieves high-confidence, curated memories for inclusion in the
   * system prompt. This is loaded once and remains stable across turns.
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
      if (!this.initialized) {
        debugLogger.log(
          'getProjectCoreMemory: Not initialized, returning empty',
        );
        return '';
      }

      // Get all project-scoped entries (curated core memory)
      const entries = await this.store.listByScope('project');

      if (options?.signal?.aborted || entries.length === 0) {
        return '';
      }

      // Format as markdown list
      const formatted = entries
        .map((entry) => {
          const source = entry.source ? ` _(${entry.source})_` : '';
          return `- ${entry.text}${source}`;
        })
        .join('\n');

      return formatted;
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
   * This is the main retrieval method. It:
   * 1. Embeds the query
   * 2. Over-retrieves candidates via vector search (topK=50)
   * 3. Uses LLM to filter to most relevant (5-12)
   * 4. Returns filtered hits for injection
   *
   * @param request - The current user request (string or Parts)
   * @param options - Retrieval options
   * @returns Ranked array of memory hits
   */
  async retrieveRelevant(
    request: string | Part[],
    options?: MemoryRetrieveOptions,
  ): Promise<MemoryHit[]> {
    const { signal, scope = 'project', topK = 50 } = options ?? {};

    // Check for early abort
    if (signal?.aborted) {
      return [];
    }

    try {
      if (!this.initialized) {
        debugLogger.log('retrieveRelevant: Not initialized, returning empty');
        return [];
      }

      // 1. Extract query text
      const query = this.extractQueryText(request);
      if (!query) {
        return [];
      }

      debugLogger.log(
        `retrieveRelevant: query="${query.slice(0, 50)}...", scope=${scope}, topK=${topK}`,
      );

      // 2. Generate embedding for query
      const queryVector = await this.embeddings.embedOne(query, signal);
      if (signal?.aborted) {
        return [];
      }

      // Check if we got a valid embedding
      if (!queryVector || queryVector.length === 0) {
        debugLogger.warn(
          'retrieveRelevant: Failed to generate query embedding',
        );
        return [];
      }

      // 3. Vector search (over-retrieve)
      const candidates = await this.store.vectorSearch(queryVector, {
        topK,
        scope,
        signal,
      });

      if (signal?.aborted || candidates.length === 0) {
        return [];
      }

      debugLogger.log(
        `retrieveRelevant: Got ${candidates.length} candidates from vector search`,
      );

      // 4. LLM filter (if available) or fallback to score-based
      let selectedIds: string[];

      if (this.llmCall) {
        const candidateHits: CandidateHit[] = candidates.map((c) => ({
          id: c.id,
          score: c.score,
          textSnippet: c.text.slice(0, 200),
          source: c.source,
        }));

        const filterResult = await filterByRelevance(
          query,
          candidateHits,
          this.llmCall,
          { maxSelect: 10, signal },
        );

        selectedIds = filterResult.selectedIds;
        debugLogger.log(
          `retrieveRelevant: LLM filter selected ${selectedIds.length} (${filterResult.reasoning ?? 'no reason'})`,
        );
      } else {
        // No LLM call - use top 8 by score
        selectedIds = candidates.slice(0, 8).map((c) => c.id);
        debugLogger.log(
          `retrieveRelevant: No LLM filter, using top ${selectedIds.length} by score`,
        );
      }

      if (signal?.aborted) {
        return [];
      }

      // 5. Map selected IDs back to full MemoryHit
      const selectedSet = new Set(selectedIds);
      const hits: MemoryHit[] = candidates
        .filter((c) => selectedSet.has(c.id))
        .map((c) => ({
          id: c.id,
          text: c.text,
          score: c.score,
          source: c.source,
        }));

      return hits;
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
   * Simpler than retrieveRelevant - no LLM filtering, just returns
   * top matches by similarity score.
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
      if (!this.initialized) {
        debugLogger.log('search: Not initialized, returning empty');
        return [];
      }

      debugLogger.log(
        `search: query="${query.slice(0, 50)}...", scope=${scope}, limit=${limit}`,
      );

      // Generate embedding
      const queryVector = await this.embeddings.embedOne(query, signal);
      if (signal?.aborted || !queryVector || queryVector.length === 0) {
        return [];
      }

      // Vector search (no LLM filter for tool-based search)
      const results = await this.store.vectorSearch(queryVector, {
        topK: limit,
        scope,
        signal,
      });

      // Map to MemoryHit
      return results.map((r) => ({
        id: r.id,
        text: r.text,
        score: r.score,
        source: r.source,
      }));
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

  /**
   * Close the manager and underlying store.
   */
  async close(): Promise<void> {
    if (!this.initialized) {
      return;
    }

    try {
      await this.store.close();
      this.initialized = false;
    } catch (error) {
      debugLogger.warn(
        `Failed to close memory manager: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
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
}

// ============================================================================
// No-op implementations for backward compatibility
// ============================================================================

/**
 * Create a no-op store for backward compatibility.
 */
function createNoOpStore(): MemoryStore {
  return {
    async init(): Promise<void> {},
    async upsert(): Promise<void> {},
    async delete(): Promise<void> {},
    async deleteByScope(): Promise<void> {},
    async vectorSearch(): Promise<VectorSearchResult[]> {
      return [];
    },
    async getById(): Promise<undefined> {
      return undefined;
    },
    async listByScope(): Promise<[]> {
      return [];
    },
    async close(): Promise<void> {},
  };
}

/**
 * Create a no-op embeddings client for backward compatibility.
 */
function createNoOpEmbeddings(): EmbeddingClient {
  return {
    async embed(): Promise<number[][]> {
      return [];
    },
    async embedOne(): Promise<number[]> {
      return new Array(DEFAULT_EMBEDDING_DIMENSION).fill(0);
    },
    getDimension(): number {
      return DEFAULT_EMBEDDING_DIMENSION;
    },
    getModel(): string {
      return 'none';
    },
  };
}
