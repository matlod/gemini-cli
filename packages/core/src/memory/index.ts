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
 * ## Architecture
 *
 * ```
 * Query → Embed → Vector Search (over-retrieve) → LLM Filter → MemoryHit[]
 *                                                      ↓
 *                                             formatMemoryHits()
 *                                                      ↓
 *                                             Inject into user message
 * ```
 *
 * @example
 * ```typescript
 * import {
 *   LanceDBMemoryCoreManager,
 *   LanceDBStore,
 *   OllamaEmbeddings,
 *   formatMemoryHits,
 * } from './memory/index.js';
 *
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
 *   llmCall: async (prompt) => geminiClient.generateContent(prompt),
 * });
 *
 * // Initialize and retrieve
 * await manager.init();
 * const hits = await manager.retrieveRelevant(userMessage, { signal });
 * const formatted = formatMemoryHits(hits);
 * ```
 */

// =============================================================================
// Type exports
// =============================================================================

export type {
  MemoryScope,
  MemoryHit,
  MemoryRetrieveOptions,
  MemorySearchOptions,
  MemoryConfig,
  EmbeddingConfig as MemoryEmbeddingConfig,
  MemoryCoreManager,
} from './types.js';

// =============================================================================
// Manager exports
// =============================================================================

export {
  LanceDBMemoryCoreManager,
  type MemoryCoreManagerOptions,
} from './MemoryCoreManager.js';

// =============================================================================
// Formatter exports
// =============================================================================

export {
  formatMemoryHits,
  sanitizeMemoryText,
  estimateTokens,
} from './formatters.js';

// =============================================================================
// Store exports
// =============================================================================

export type {
  EmbeddingLineage,
  EmbeddingSpaceConfig,
  MemoryStore,
  StoredMemoryEntry,
  VectorSearchOptions,
  VectorSearchResult,
} from './store/index.js';

export { LanceDBStore, computeEmbeddingSpaceId } from './store/index.js';

// =============================================================================
// Embeddings exports
// =============================================================================

export type {
  EmbeddingClient,
  EmbeddingConfig,
  EmbeddingProvider,
  FastEmbedConfig,
  ProviderInfo,
} from './embeddings/index.js';

export {
  EmbeddingProviderFactory,
  FastEmbedEmbeddings,
  OllamaEmbeddings,
} from './embeddings/index.js';

// =============================================================================
// Relevance filter exports
// =============================================================================

export type {
  CandidateHit,
  LLMFilterResult,
  LLMFilterOptions,
} from './relevance/index.js';

export {
  filterByRelevance,
  buildFilterPrompt,
  parseFilterResponse,
} from './relevance/index.js';
