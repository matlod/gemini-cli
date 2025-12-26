/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Embeddings layer exports for memory system.
 */

export type { EmbeddingClient, EmbeddingConfig } from './embeddings.js';

export { OllamaEmbeddings } from './ollamaEmbeddings.js';
export {
  FastEmbedEmbeddings,
  type FastEmbedConfig,
} from './fastembedEmbeddings.js';
export {
  EmbeddingProviderFactory,
  type EmbeddingProvider,
  type ProviderInfo,
} from './embeddingProviderFactory.js';
