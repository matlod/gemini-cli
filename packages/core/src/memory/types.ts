/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Type definitions for the memory system.
 *
 * The memory system uses a hybrid architecture:
 * - Layer 1 (Static): Project context in system prompt (curated, refreshable)
 * - Layer 2 (Dynamic): Per-turn ephemeral injection via contentsToUse (NOT history)
 */

import type { Part } from '@google/genai';

/**
 * Scope of memory retrieval.
 * - 'project': Project-specific memories
 * - 'global': Cross-project memories
 */
export type MemoryScope = 'project' | 'global';

/**
 * A single memory search result.
 */
export interface MemoryHit {
  /** Unique identifier for this memory entry */
  id: string;
  /** The actual memory content text */
  text: string;
  /** Cosine similarity score (0-1, higher is more relevant) */
  score: number;
  /** Provenance information (file path, conversation, etc.) */
  source?: string;
  /** Approximate token count for budget management */
  tokenEstimate?: number;
}

/**
 * Options for retrieving relevant memories.
 */
export interface MemoryRetrieveOptions {
  /** AbortSignal for cancellation */
  signal?: AbortSignal;
  /** Scope of memory to search */
  scope?: MemoryScope;
  /** Minimum similarity threshold (default: 0.75) */
  minSimilarity?: number;
  /** Maximum candidates to retrieve (default: 50) */
  topK?: number;
}

/**
 * Options for searching memories via the search_memory tool.
 */
export interface MemorySearchOptions {
  /** Scope of memory to search */
  scope?: MemoryScope;
  /** Maximum results to return (default: 8) */
  limit?: number;
  /** AbortSignal for cancellation */
  signal?: AbortSignal;
}

/**
 * Configuration for the memory system.
 */
export interface MemoryConfig {
  /** Path to the LanceDB database */
  dbPath: string;
  /** Embedding configuration */
  embedding: EmbeddingConfig;
}

/**
 * Configuration for embedding generation.
 */
export interface EmbeddingConfig {
  /** Embedding provider ('ollama' | 'openai' | 'gemini') */
  provider: 'ollama' | 'openai' | 'gemini';
  /** Model name for embeddings */
  model: string;
  /** API endpoint (for ollama or custom providers) */
  endpoint?: string;
}

/**
 * Core interface for the memory manager.
 *
 * Provides access to both static (system prompt) and dynamic (ephemeral)
 * memory layers, as well as tool-based search for subagents.
 */
export interface MemoryCoreManager {
  /**
   * Get curated project context for the system prompt (Layer 1 - Static).
   *
   * This memory is loaded once and included in the system prompt.
   * It contains architecture, conventions, and golden paths.
   *
   * @param options - Optional configuration including AbortSignal
   * @returns Formatted string for system prompt injection
   */
  getProjectCoreMemory(options?: { signal?: AbortSignal }): Promise<string>;

  /**
   * Retrieve relevant memories for ephemeral injection (Layer 2 - Dynamic).
   *
   * Called on each turn to get contextually relevant memories.
   * Results are injected into contentsToUse, NOT addHistory().
   *
   * @param request - The current user request (string or Parts)
   * @param options - Retrieval options (signal, scope, similarity, topK)
   * @returns Ranked array of memory hits
   */
  retrieveRelevant(
    request: string | Part[],
    options?: MemoryRetrieveOptions,
  ): Promise<MemoryHit[]>;

  /**
   * Search memories via the search_memory tool (for subagents).
   *
   * Provides explicit tool access to the memory system.
   *
   * @param query - Search query string
   * @param options - Search options (scope, limit, signal)
   * @returns Array of memory hits
   */
  search(query: string, options?: MemorySearchOptions): Promise<MemoryHit[]>;
}
