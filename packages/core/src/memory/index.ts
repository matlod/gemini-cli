/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Public exports for the memory system.
 *
 * The memory system provides a hybrid architecture:
 * - Layer 1 (Static): Project context in system prompt
 * - Layer 2 (Dynamic): Per-turn ephemeral injection
 *
 * @example
 * ```typescript
 * import {
 *   type MemoryCoreManager,
 *   type MemoryHit,
 *   LanceDBMemoryCoreManager,
 *   formatMemoryHits,
 * } from './memory/index.js';
 *
 * // Create manager
 * const manager = new LanceDBMemoryCoreManager({
 *   dbPath: '/path/to/db',
 *   embedding: { provider: 'ollama', model: 'nomic-embed-text' },
 * });
 *
 * // Retrieve relevant memories
 * const hits = await manager.retrieveRelevant(userMessage, { signal });
 *
 * // Format for injection
 * const formatted = formatMemoryHits(hits);
 * ```
 */

// Type exports
export type {
  MemoryScope,
  MemoryHit,
  MemoryRetrieveOptions,
  MemorySearchOptions,
  MemoryConfig,
  EmbeddingConfig,
  MemoryCoreManager,
} from './types.js';

// Implementation exports
export { LanceDBMemoryCoreManager } from './MemoryCoreManager.js';

// Formatter exports
export {
  formatMemoryHits,
  sanitizeMemoryText,
  estimateTokens,
} from './formatters.js';
