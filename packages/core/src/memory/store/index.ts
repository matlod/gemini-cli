/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Store layer exports for memory system.
 */

export type {
  EmbeddingLineage,
  MemoryStore,
  StoredMemoryEntry,
  VectorSearchOptions,
  VectorSearchResult,
} from './store.js';

export {
  LanceDBStore,
  computeEmbeddingSpaceId,
  type EmbeddingSpaceConfig,
} from './lancedbStore.js';
