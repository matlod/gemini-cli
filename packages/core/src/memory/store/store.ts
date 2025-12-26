/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Memory store interface for vector storage backends.
 *
 * This interface abstracts the storage layer, allowing different backends
 * (LanceDB, in-memory, etc.) to be swapped without changing the retrieval logic.
 *
 * @see ./lancedbStore.ts for the LanceDB implementation
 */

import type { MemoryScope } from '../types.js';

/**
 * Embedding lineage metadata for tracking vector provenance.
 * Critical for ensuring we never mix vectors from different embedding spaces.
 */
export interface EmbeddingLineage {
  /** Provider used: 'openai' | 'ollama' | 'fastembed' | 'endpoint' */
  embedding_provider: string;

  /** Model name (e.g., 'text-embedding-3-small', 'nomic-embed-text') */
  embedding_model: string;

  /** Vector dimension (e.g., 768, 1536) */
  embedding_dim: number;

  /** Normalization applied: 'none' | 'l2' */
  embedding_norm?: string;

  /** Optional version for tracking embedding model updates */
  embedding_version?: string;
}

/**
 * A memory entry as stored in the database.
 * Includes the embedding vector for similarity search.
 */
export interface StoredMemoryEntry extends Partial<EmbeddingLineage> {
  /** Unique identifier (ULID recommended) */
  id: string;

  /** Scope of the memory: 'project' or 'global' */
  scope: MemoryScope;

  /** The actual memory content text */
  text: string;

  /** Provenance information (file path, conversation, etc.) */
  source?: string;

  /** Tags for filtering and categorization */
  tags?: string[];

  /** When this entry was created */
  createdAt: Date;

  /** When this entry was last updated */
  updatedAt: Date;

  /** Vector embedding for similarity search */
  embedding: number[];
}

/**
 * Options for vector similarity search.
 */
export interface VectorSearchOptions {
  /** Maximum number of candidates to retrieve (over-retrieve for LLM filtering) */
  topK: number;

  /** Filter by memory scope */
  scope?: MemoryScope;

  /** Minimum similarity score threshold (0-1, optional) */
  minScore?: number;

  /** AbortSignal for cancellation */
  signal?: AbortSignal;
}

/**
 * Result from vector search, includes both raw distance and computed score.
 *
 * ## Distance vs Score
 *
 * - `distance`: Raw value from LanceDB (L2 distance by default)
 * - `score`: Monotonic transform for ranking: `1 / (1 + distance)`
 *
 * Use `score` for ranking and filtering. Use `distance` for debugging
 * or when you need the raw metric value.
 *
 * Note: `minScore` in options is heuristic unless you standardize on
 * cosine metric + L2-normalized embeddings across all providers.
 */
export interface VectorSearchResult extends StoredMemoryEntry {
  /**
   * Raw distance from LanceDB (L2 by default, lower is closer).
   * Use for debugging or when you need the raw metric value.
   */
  distance: number;

  /**
   * Computed similarity score (0-1, higher is more similar).
   * Monotonic transform: `1 / (1 + distance)`.
   * Use for ranking and filtering.
   */
  score: number;
}

/**
 * Interface for memory storage backends.
 *
 * Implementations must provide:
 * - Connection management (init/close)
 * - CRUD operations for memory entries
 * - Vector similarity search
 *
 * @example
 * ```typescript
 * const store = new LanceDBStore('/path/to/db');
 * await store.init();
 *
 * // Add entries
 * await store.upsert([{ id: '1', text: 'Always use async/await', ... }]);
 *
 * // Search
 * const results = await store.vectorSearch(queryVector, { topK: 50 });
 *
 * await store.close();
 * ```
 */
export interface MemoryStore {
  /**
   * Initialize the store connection.
   * Creates tables/indexes if they don't exist.
   *
   * @throws If connection fails (caller should handle gracefully)
   */
  init(): Promise<void>;

  /**
   * Add or update memory entries.
   * If an entry with the same ID exists, it will be replaced.
   *
   * @param entries - Entries to upsert (must include embeddings)
   */
  upsert(entries: StoredMemoryEntry[]): Promise<void>;

  /**
   * Delete a memory entry by ID.
   *
   * @param id - Entry ID to delete
   */
  delete(id: string): Promise<void>;

  /**
   * Delete all entries in a scope.
   *
   * @param scope - Scope to clear ('project' or 'global')
   */
  deleteByScope(scope: MemoryScope): Promise<void>;

  /**
   * Perform vector similarity search.
   *
   * This is the core retrieval operation. Returns candidates ranked by
   * similarity score for subsequent LLM filtering.
   *
   * @param queryVector - Embedding vector of the query
   * @param options - Search options (topK, scope filter, etc.)
   * @returns Matched entries with similarity scores
   */
  vectorSearch(
    queryVector: number[],
    options: VectorSearchOptions,
  ): Promise<VectorSearchResult[]>;

  /**
   * Get an entry by ID.
   *
   * @param id - Entry ID
   * @returns The entry or undefined if not found
   */
  getById(id: string): Promise<StoredMemoryEntry | undefined>;

  /**
   * Get all entries in a scope.
   *
   * @param scope - Scope to list
   * @returns All entries in the scope
   */
  listByScope(scope: MemoryScope): Promise<StoredMemoryEntry[]>;

  /**
   * Close the store connection gracefully.
   */
  close(): Promise<void>;
}
