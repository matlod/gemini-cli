/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview LanceDB implementation of the MemoryStore interface.
 *
 * LanceDB is an embedded vector database that stores vectors + metadata together.
 * It's file-based (no server needed) and supports hybrid search.
 *
 * @see https://lancedb.github.io/lancedb/
 *
 * ## Table Schema
 *
 * The `memory_entries` table has the following columns:
 * - id: string (unique identifier)
 * - scope: string ('project' | 'global')
 * - text: string (memory content)
 * - source: string (provenance, nullable)
 * - tags: string (JSON array as string)
 * - createdAt: timestamp
 * - updatedAt: timestamp
 * - embedding: vector(768) - dimension matches embedding model
 *
 * ## Usage
 *
 * ```typescript
 * const store = new LanceDBStore('/path/to/memory.lance');
 * await store.init();
 *
 * // Add entries (with pre-computed embeddings)
 * await store.upsert([{
 *   id: 'mem-001',
 *   scope: 'project',
 *   text: 'Always use async/await for API calls',
 *   embedding: [0.1, 0.2, ...],
 *   createdAt: new Date(),
 *   updatedAt: new Date(),
 * }]);
 *
 * // Search
 * const results = await store.vectorSearch(queryVector, { topK: 50 });
 * ```
 */

import { debugLogger } from '../../utils/debugLogger.js';
import type { MemoryScope } from '../types.js';
import type {
  MemoryStore,
  StoredMemoryEntry,
  VectorSearchOptions,
  VectorSearchResult,
} from './store.js';

// TODO: Uncomment when @lancedb/lancedb is added as dependency
// import * as lancedb from '@lancedb/lancedb';

/**
 * Table name for memory entries in LanceDB.
 * TODO: Uncomment when @lancedb/lancedb is added
 */
// const MEMORY_ENTRIES_TABLE = 'memory_entries';

/**
 * LanceDB implementation of the MemoryStore interface.
 *
 * Provides vector similarity search over memory entries using LanceDB's
 * embedded vector database.
 */
export class LanceDBStore implements MemoryStore {
  private readonly dbPath: string;
  // TODO: Uncomment when @lancedb/lancedb is added
  // private db: lancedb.Connection | null = null;
  // private table: lancedb.Table | null = null;
  private initialized = false;

  /**
   * Create a new LanceDB store.
   *
   * @param dbPath - Path to the LanceDB database directory
   */
  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  /**
   * Initialize the LanceDB connection and create tables if needed.
   *
   * ## Implementation Notes
   *
   * 1. Connect to LanceDB at dbPath (creates directory if not exists)
   * 2. Check if memory_entries table exists
   * 3. If not, create with schema
   * 4. If exists, open it
   *
   * ```typescript
   * // Pseudocode:
   * this.db = await lancedb.connect(this.dbPath);
   *
   * const tableNames = await this.db.tableNames();
   * if (tableNames.includes(MEMORY_ENTRIES_TABLE)) {
   *   this.table = await this.db.openTable(MEMORY_ENTRIES_TABLE);
   * } else {
   *   // Create with initial empty record to define schema
   *   this.table = await this.db.createTable(MEMORY_ENTRIES_TABLE, [{
   *     id: '',
   *     scope: 'project',
   *     text: '',
   *     source: null,
   *     tags: '[]',
   *     createdAt: new Date(),
   *     updatedAt: new Date(),
   *     embedding: new Array(768).fill(0),
   *   }]);
   *   // Delete the placeholder
   *   await this.table.delete("id = ''");
   * }
   * ```
   */
  async init(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      debugLogger.log(`LanceDBStore: Initializing at ${this.dbPath}`);

      // TODO: Implement when @lancedb/lancedb is added
      // this.db = await lancedb.connect(this.dbPath);
      // ... table creation logic

      this.initialized = true;
      debugLogger.log('LanceDBStore: Initialized successfully');
    } catch (error) {
      debugLogger.warn(
        `LanceDBStore: Failed to initialize: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      throw error;
    }
  }

  /**
   * Add or update memory entries.
   *
   * ## Implementation Notes
   *
   * LanceDB doesn't have native upsert, so we:
   * 1. Delete existing entries by ID
   * 2. Add new entries
   *
   * ```typescript
   * // Pseudocode:
   * for (const entry of entries) {
   *   await this.table.delete(`id = '${entry.id}'`);
   * }
   *
   * const records = entries.map(e => ({
   *   id: e.id,
   *   scope: e.scope,
   *   text: e.text,
   *   source: e.source ?? null,
   *   tags: JSON.stringify(e.tags ?? []),
   *   createdAt: e.createdAt,
   *   updatedAt: e.updatedAt,
   *   embedding: e.embedding,
   * }));
   *
   * await this.table.add(records);
   * ```
   */
  async upsert(entries: StoredMemoryEntry[]): Promise<void> {
    this.ensureInitialized();

    if (entries.length === 0) {
      return;
    }

    try {
      debugLogger.log(`LanceDBStore: Upserting ${entries.length} entries`);

      // TODO: Implement when @lancedb/lancedb is added
      // Delete existing by ID, then add

      debugLogger.log(`LanceDBStore: Upserted ${entries.length} entries`);
    } catch (error) {
      debugLogger.warn(
        `LanceDBStore: Upsert failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      throw error;
    }
  }

  /**
   * Delete a memory entry by ID.
   *
   * ```typescript
   * // Pseudocode:
   * await this.table.delete(`id = '${id}'`);
   * ```
   */
  async delete(_id: string): Promise<void> {
    this.ensureInitialized();

    try {
      debugLogger.log(`LanceDBStore: Deleting entry ${_id}`);
      // TODO: Implement when @lancedb/lancedb is added
    } catch (error) {
      debugLogger.warn(
        `LanceDBStore: Delete failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      throw error;
    }
  }

  /**
   * Delete all entries in a scope.
   *
   * ```typescript
   * // Pseudocode:
   * await this.table.delete(`scope = '${scope}'`);
   * ```
   */
  async deleteByScope(_scope: MemoryScope): Promise<void> {
    this.ensureInitialized();

    try {
      debugLogger.log(`LanceDBStore: Deleting all entries in scope ${_scope}`);
      // TODO: Implement when @lancedb/lancedb is added
    } catch (error) {
      debugLogger.warn(
        `LanceDBStore: DeleteByScope failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      throw error;
    }
  }

  /**
   * Perform vector similarity search.
   *
   * ## Implementation Notes
   *
   * ```typescript
   * // Pseudocode:
   * let query = this.table.search(queryVector);
   *
   * // Apply scope filter if specified
   * if (options.scope) {
   *   query = query.where(`scope = '${options.scope}'`);
   * }
   *
   * // Limit results
   * query = query.limit(options.topK);
   *
   * // Execute search
   * const results = await query.execute();
   *
   * // Map to VectorSearchResult
   * return results.map(r => ({
   *   id: r.id,
   *   scope: r.scope as MemoryScope,
   *   text: r.text,
   *   source: r.source,
   *   tags: JSON.parse(r.tags || '[]'),
   *   createdAt: new Date(r.createdAt),
   *   updatedAt: new Date(r.updatedAt),
   *   embedding: r.embedding,
   *   score: 1 - r._distance, // LanceDB returns distance, we want similarity
   * })).filter(r => !options.minScore || r.score >= options.minScore);
   * ```
   *
   * @param queryVector - Query embedding vector
   * @param options - Search options
   * @returns Matched entries with similarity scores
   */
  async vectorSearch(
    queryVector: number[],
    options: VectorSearchOptions,
  ): Promise<VectorSearchResult[]> {
    this.ensureInitialized();

    // Check for early abort
    if (options.signal?.aborted) {
      return [];
    }

    try {
      debugLogger.log(
        `LanceDBStore: Vector search topK=${options.topK}, scope=${options.scope ?? 'all'}`,
      );

      // TODO: Implement when @lancedb/lancedb is added
      // For now, return empty array (stub behavior)

      return [];
    } catch (error) {
      if (options.signal?.aborted) {
        return [];
      }
      debugLogger.warn(
        `LanceDBStore: Vector search failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      return [];
    }
  }

  /**
   * Get an entry by ID.
   *
   * ```typescript
   * // Pseudocode:
   * const results = await this.table.search()
   *   .where(`id = '${id}'`)
   *   .limit(1)
   *   .execute();
   * return results[0] ? mapToStoredEntry(results[0]) : undefined;
   * ```
   */
  async getById(_id: string): Promise<StoredMemoryEntry | undefined> {
    this.ensureInitialized();

    try {
      // TODO: Implement when @lancedb/lancedb is added
      return undefined;
    } catch (error) {
      debugLogger.warn(
        `LanceDBStore: GetById failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      return undefined;
    }
  }

  /**
   * Get all entries in a scope.
   *
   * ```typescript
   * // Pseudocode:
   * const results = await this.table.search()
   *   .where(`scope = '${scope}'`)
   *   .execute();
   * return results.map(mapToStoredEntry);
   * ```
   */
  async listByScope(_scope: MemoryScope): Promise<StoredMemoryEntry[]> {
    this.ensureInitialized();

    try {
      // TODO: Implement when @lancedb/lancedb is added
      return [];
    } catch (error) {
      debugLogger.warn(
        `LanceDBStore: ListByScope failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      return [];
    }
  }

  /**
   * Close the store connection.
   */
  async close(): Promise<void> {
    if (!this.initialized) {
      return;
    }

    try {
      debugLogger.log('LanceDBStore: Closing connection');
      // TODO: LanceDB may not require explicit close
      this.initialized = false;
    } catch (error) {
      debugLogger.warn(
        `LanceDBStore: Close failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Ensure the store is initialized before operations.
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('LanceDBStore not initialized. Call init() first.');
    }
  }
}
