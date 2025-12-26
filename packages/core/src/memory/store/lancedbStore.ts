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
 * - embedding: vector (dimension matches embedding model)
 * - embedding_provider: string (lineage tracking)
 * - embedding_model: string (lineage tracking)
 * - embedding_dim: number (lineage tracking)
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

import * as lancedb from '@lancedb/lancedb';
import { debugLogger } from '../../utils/debugLogger.js';
import type { MemoryScope } from '../types.js';
import type {
  MemoryStore,
  StoredMemoryEntry,
  VectorSearchOptions,
  VectorSearchResult,
} from './store.js';

/**
 * Base table name for memory entries in LanceDB.
 * Full table name includes embedding space suffix.
 */
const MEMORY_ENTRIES_TABLE_BASE = 'memory_entries';

/**
 * Configuration for the embedding space.
 * Used to namespace tables and avoid dimension mismatches.
 *
 * The full space ID is: provider|model|dimension|norm|version
 * This ensures vectors from different spaces are never mixed.
 */
export interface EmbeddingSpaceConfig {
  /** Embedding provider name (e.g., 'fastembed', 'ollama', 'openai') */
  provider: string;

  /** Embedding model name (e.g., 'fast-bge-small-en-v1.5') */
  model: string;

  /** Embedding dimension (e.g., 384, 768, 1536) */
  dimension: number;

  /** Normalization applied: 'none' | 'l2' (default: 'none') */
  norm?: 'none' | 'l2';

  /** Model version for tracking updates (default: 'v1') */
  version?: string;
}

/**
 * Compute a stable embedding space ID from config.
 * Format: provider|model|dim|norm|version
 */
export function computeEmbeddingSpaceId(config: EmbeddingSpaceConfig): string {
  const norm = config.norm ?? 'none';
  const version = config.version ?? 'v1';
  return `${config.provider}|${config.model}|${config.dimension}|${norm}|${version}`;
}

/**
 * Maximum IDs per delete batch to avoid query size limits.
 */
const DELETE_BATCH_SIZE = 200;

/**
 * LanceDB record shape matching our schema.
 * Includes index signature for LanceDB compatibility.
 *
 * Note: `norm` and `version` are NOT stored per-row. They are store-level
 * configuration encoded in the table name. The table name itself implies
 * the norm/version, so all rows in a table share the same norm/version.
 */
interface LanceDBRecord {
  [key: string]: unknown;
  id: string;
  scope: string;
  text: string;
  source: string | null;
  tags: string; // JSON array as string
  createdAt: number; // Unix timestamp ms
  updatedAt: number; // Unix timestamp ms
  embedding: number[];
  // Embedding lineage (per-row: provider, model, dim; table-level: norm, version)
  embedding_provider: string;
  embedding_model: string;
  embedding_dim: number;
}

/**
 * LanceDB search result with distance.
 */
interface LanceDBSearchResult extends LanceDBRecord {
  _distance: number;
}

/**
 * LanceDB implementation of the MemoryStore interface.
 *
 * Provides vector similarity search over memory entries using LanceDB's
 * embedded vector database.
 *
 * ## Embedding Space Isolation
 *
 * Each embedding space (provider + model + dimension + norm + version) gets its own table
 * to prevent mixing vectors from different embedding models. Table names
 * are automatically generated as:
 *
 * `memory_entries__{provider}__{model}__{dimension}__{norm}__{version}`
 *
 * Example: `memory_entries__fastembed__fast_bge_small_en_v1_5__384__none__v1`
 */
export class LanceDBStore implements MemoryStore {
  private readonly dbPath: string;
  private readonly embeddingSpace: EmbeddingSpaceConfig;
  private readonly spaceId: string;
  private readonly tableName: string;
  private db: lancedb.Connection | null = null;
  private table: lancedb.Table | null = null;
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  /**
   * Create a new LanceDB store.
   *
   * @param dbPath - Path to the LanceDB database directory
   * @param embeddingSpace - Embedding space configuration (provider, model, dimension, norm, version)
   */
  constructor(dbPath: string, embeddingSpace?: EmbeddingSpaceConfig) {
    this.dbPath = dbPath;
    // Default to fastembed with common dimension
    this.embeddingSpace = {
      provider: 'fastembed',
      model: 'fast-bge-small-en-v1.5',
      dimension: 384,
      norm: 'none',
      version: 'v1',
      ...embeddingSpace,
    };
    this.spaceId = computeEmbeddingSpaceId(this.embeddingSpace);
    this.tableName = this.generateTableName(this.embeddingSpace);
  }

  /**
   * Generate a table name from embedding space config.
   * Sanitizes all parts for safe table naming.
   * Includes norm and version for full isolation.
   */
  private generateTableName(space: EmbeddingSpaceConfig): string {
    // Sanitize: replace non-alphanumeric with underscore, lowercase
    const sanitize = (s: string): string =>
      s.toLowerCase().replace(/[^a-z0-9]/g, '_');

    const norm = space.norm ?? 'none';
    const version = space.version ?? 'v1';

    return `${MEMORY_ENTRIES_TABLE_BASE}__${sanitize(space.provider)}__${sanitize(space.model)}__${space.dimension}__${sanitize(norm)}__${sanitize(version)}`;
  }

  /**
   * Get the embedding space configuration for this store.
   */
  getEmbeddingSpace(): EmbeddingSpaceConfig {
    return { ...this.embeddingSpace };
  }

  /**
   * Get the stable embedding space ID (provider|model|dim|norm|version).
   */
  getSpaceId(): string {
    return this.spaceId;
  }

  /**
   * Get the table name used by this store.
   */
  getTableName(): string {
    return this.tableName;
  }

  /**
   * List all embedding spaces (tables) in the database.
   * Useful for debugging and migration.
   *
   * Note: Uses a local connection if store is not initialized,
   * to avoid mutating state as a side effect.
   */
  async listEmbeddingSpaces(): Promise<string[]> {
    // Use existing connection if available, otherwise create temporary one
    const db = this.db ?? (await lancedb.connect(this.dbPath));
    const tableNames = await db.tableNames();
    return tableNames.filter((name) =>
      name.startsWith(MEMORY_ENTRIES_TABLE_BASE),
    );
  }

  /**
   * Initialize the LanceDB connection and create tables if needed.
   *
   * Handles race conditions where multiple processes may try to create
   * the same table simultaneously: try open first, then create, then
   * retry open if create fails (table already exists).
   */
  async init(): Promise<void> {
    if (this.initialized) {
      return;
    }

    // Prevent concurrent init calls
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = this.doInit();
    return this.initPromise;
  }

  private async doInit(): Promise<void> {
    try {
      debugLogger.log(
        `LanceDBStore: Initializing at ${this.dbPath} (table: ${this.tableName}, space: ${this.spaceId})`,
      );

      // Connect to LanceDB (creates directory if not exists)
      this.db = await lancedb.connect(this.dbPath);

      // Try to open existing table first
      try {
        this.table = await this.db.openTable(this.tableName);
        debugLogger.log(
          `LanceDBStore: Opened existing table ${this.tableName}`,
        );
      } catch {
        // Table doesn't exist, try to create it
        try {
          const dim = this.embeddingSpace.dimension;
          const norm = this.embeddingSpace.norm ?? 'none';
          const version = this.embeddingSpace.version ?? 'v1';
          const placeholder: LanceDBRecord = {
            id: '__placeholder__',
            scope: 'project',
            text: '',
            source: null,
            tags: '[]',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            embedding: new Array(dim).fill(0),
            embedding_provider: this.embeddingSpace.provider,
            embedding_model: this.embeddingSpace.model,
            embedding_dim: dim,
          };

          this.table = await this.db.createTable(this.tableName, [placeholder]);

          // Delete the placeholder (use escapeString for consistency)
          await this.table.delete(
            `id = '${this.escapeString('__placeholder__')}'`,
          );
          debugLogger.log(
            `LanceDBStore: Created new table ${this.tableName} (dim=${dim}, norm=${norm}, version=${version})`,
          );
        } catch (createError) {
          // Create failed - another process may have created it, try open again
          debugLogger.log(
            `LanceDBStore: Create failed, retrying open: ${createError instanceof Error ? createError.message : 'Unknown'}`,
          );
          this.table = await this.db.openTable(this.tableName);
          debugLogger.log(
            `LanceDBStore: Opened table after create race ${this.tableName}`,
          );
        }
      }

      this.initialized = true;
      this.initPromise = null; // Clear promise on success for cleaner state
      debugLogger.log('LanceDBStore: Initialized successfully');
    } catch (error) {
      this.initPromise = null; // Clear promise on failure to allow retry
      debugLogger.warn(
        `LanceDBStore: Failed to initialize: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      throw error;
    }
  }

  /**
   * Add or update memory entries.
   *
   * LanceDB doesn't have native upsert, so we:
   * 1. Validate dimension and lineage match
   * 2. Delete existing entries by ID (chunked for performance)
   * 3. Add new entries
   *
   * @throws Error if any entry has wrong dimension or mismatched lineage
   */
  async upsert(entries: StoredMemoryEntry[]): Promise<void> {
    if (entries.length === 0) {
      return;
    }

    const table = this.getTable();
    const expectedDim = this.embeddingSpace.dimension;

    // Validate all entries before making any changes
    for (const entry of entries) {
      // Validate dimension
      if (entry.embedding.length !== expectedDim) {
        throw new Error(
          `Dimension mismatch: entry ${entry.id} has dimension ${entry.embedding.length}, ` +
            `but store expects ${expectedDim} (space: ${this.spaceId})`,
        );
      }

      // Validate lineage if provided
      const entryProvider = (
        entry as StoredMemoryEntry & { embedding_provider?: string }
      ).embedding_provider;
      const entryModel = (
        entry as StoredMemoryEntry & { embedding_model?: string }
      ).embedding_model;

      if (entryProvider && entryProvider !== this.embeddingSpace.provider) {
        throw new Error(
          `Provider mismatch: entry ${entry.id} has provider "${entryProvider}", ` +
            `but store expects "${this.embeddingSpace.provider}" (space: ${this.spaceId})`,
        );
      }
      if (entryModel && entryModel !== this.embeddingSpace.model) {
        throw new Error(
          `Model mismatch: entry ${entry.id} has model "${entryModel}", ` +
            `but store expects "${this.embeddingSpace.model}" (space: ${this.spaceId})`,
        );
      }
    }

    try {
      debugLogger.log(`LanceDBStore: Upserting ${entries.length} entries`);

      // Delete existing entries by ID using chunked IN(...) for performance
      const ids = entries.map((e) => e.id);
      await this.deleteByIds(ids, table);

      // Convert to LanceDB records
      const records: LanceDBRecord[] = entries.map((e) => ({
        id: e.id,
        scope: e.scope,
        text: e.text,
        source: e.source ?? null,
        tags: JSON.stringify(e.tags ?? []),
        createdAt: e.createdAt.getTime(),
        updatedAt: e.updatedAt.getTime(),
        embedding: e.embedding,
        // Use store config for lineage (already validated)
        embedding_provider: this.embeddingSpace.provider,
        embedding_model: this.embeddingSpace.model,
        embedding_dim: expectedDim,
      }));

      // Add new entries
      await table.add(records);

      debugLogger.log(`LanceDBStore: Upserted ${entries.length} entries`);
    } catch (error) {
      debugLogger.warn(
        `LanceDBStore: Upsert failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      throw error;
    }
  }

  /**
   * Delete entries by IDs using chunked IN(...) queries for performance.
   */
  private async deleteByIds(
    ids: string[],
    table: lancedb.Table,
  ): Promise<void> {
    if (ids.length === 0) {
      return;
    }

    // Process in batches to avoid query size limits
    for (let i = 0; i < ids.length; i += DELETE_BATCH_SIZE) {
      const batch = ids.slice(i, i + DELETE_BATCH_SIZE);

      // Escape IDs and build IN clause
      const escapedIds = batch.map((id) => `'${this.escapeString(id)}'`);
      const inClause = `id IN (${escapedIds.join(',')})`;

      await table.delete(inClause);
    }
  }

  /**
   * Escape a string for use in SQL predicates.
   */
  private escapeString(s: string): string {
    return s.replace(/'/g, "''");
  }

  /**
   * Delete a memory entry by ID.
   */
  async delete(id: string): Promise<void> {
    const table = this.getTable();

    try {
      debugLogger.log(`LanceDBStore: Deleting entry ${id}`);
      await table.delete(`id = '${this.escapeString(id)}'`);
    } catch (error) {
      debugLogger.warn(
        `LanceDBStore: Delete failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      throw error;
    }
  }

  /**
   * Delete all entries in a scope.
   */
  async deleteByScope(scope: MemoryScope): Promise<void> {
    const table = this.getTable();

    try {
      debugLogger.log(`LanceDBStore: Deleting all entries in scope ${scope}`);
      await table.delete(`scope = '${this.escapeString(scope)}'`);
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
   * @param queryVector - Query embedding vector
   * @param options - Search options
   * @returns Matched entries with similarity scores
   */
  async vectorSearch(
    queryVector: number[],
    options: VectorSearchOptions,
  ): Promise<VectorSearchResult[]> {
    // Check for early abort
    if (options.signal?.aborted) {
      return [];
    }

    const table = this.getTable();

    try {
      debugLogger.log(
        `LanceDBStore: Vector search topK=${options.topK}, scope=${options.scope ?? 'all'}`,
      );

      // Build the query
      let query = table.search(queryVector).limit(options.topK);

      // Apply scope filter if specified
      if (options.scope) {
        query = query.where(`scope = '${this.escapeString(options.scope)}'`);
      }

      // Execute search
      const results = (await query.toArray()) as LanceDBSearchResult[];

      if (options.signal?.aborted) {
        return [];
      }

      // Map to VectorSearchResult with both distance and score
      // LanceDB returns L2 distance by default
      // Score is a monotonic transform for ranking: 1 / (1 + distance)
      // Note: minScore is heuristic unless using cosine + L2-normalized vectors
      const mapped: VectorSearchResult[] = results.map((r) => ({
        id: r.id,
        scope: r.scope as MemoryScope,
        text: r.text,
        source: r.source ?? undefined,
        tags: this.parseTags(r.tags),
        createdAt: new Date(r.createdAt),
        updatedAt: new Date(r.updatedAt),
        embedding: r.embedding,
        distance: r._distance, // Raw distance from LanceDB
        score: 1 / (1 + r._distance), // Monotonic transform for ranking
      }));

      // Apply minScore filter if specified
      const filtered = options.minScore
        ? mapped.filter((r) => r.score >= options.minScore!)
        : mapped;

      debugLogger.log(
        `LanceDBStore: Vector search returned ${filtered.length} results`,
      );

      return filtered;
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
   */
  async getById(id: string): Promise<StoredMemoryEntry | undefined> {
    const table = this.getTable();

    try {
      const results = (await table
        .query()
        .where(`id = '${this.escapeString(id)}'`)
        .limit(1)
        .toArray()) as LanceDBRecord[];

      if (results.length === 0) {
        return undefined;
      }

      const r = results[0];
      return {
        id: r.id,
        scope: r.scope as MemoryScope,
        text: r.text,
        source: r.source ?? undefined,
        tags: this.parseTags(r.tags),
        createdAt: new Date(r.createdAt),
        updatedAt: new Date(r.updatedAt),
        embedding: r.embedding,
      };
    } catch (error) {
      debugLogger.warn(
        `LanceDBStore: GetById failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      return undefined;
    }
  }

  /**
   * Get all entries in a scope.
   */
  async listByScope(scope: MemoryScope): Promise<StoredMemoryEntry[]> {
    const table = this.getTable();

    try {
      const results = (await table
        .query()
        .where(`scope = '${this.escapeString(scope)}'`)
        .toArray()) as LanceDBRecord[];

      return results.map((r) => ({
        id: r.id,
        scope: r.scope as MemoryScope,
        text: r.text,
        source: r.source ?? undefined,
        tags: this.parseTags(r.tags),
        createdAt: new Date(r.createdAt),
        updatedAt: new Date(r.updatedAt),
        embedding: r.embedding,
      }));
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
      // LanceDB doesn't require explicit close, but we reset state
      this.db = null;
      this.table = null;
      this.initialized = false;
    } catch (error) {
      debugLogger.warn(
        `LanceDBStore: Close failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Ensure the store is initialized before operations.
   * @throws Error if not initialized
   */
  private ensureInitialized(): void {
    if (!this.initialized || !this.db || !this.table) {
      throw new Error('LanceDBStore not initialized. Call init() first.');
    }
  }

  /**
   * Get the table, throwing if not initialized.
   */
  private getTable(): lancedb.Table {
    this.ensureInitialized();
    return this.table!;
  }

  /**
   * Parse tags from JSON string.
   */
  private parseTags(tagsStr: string): string[] {
    try {
      return JSON.parse(tagsStr);
    } catch {
      return [];
    }
  }
}
