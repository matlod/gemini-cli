/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Embedding client interface for generating vector embeddings.
 *
 * This interface abstracts embedding generation, allowing different providers
 * (Ollama, OpenAI, etc.) to be swapped without changing the retrieval logic.
 *
 * @see ./ollamaEmbeddings.ts for the Ollama implementation
 */

/**
 * Configuration for an embedding client.
 */
export interface EmbeddingConfig {
  /** Base URL for the embedding API (e.g., 'http://localhost:11434') */
  baseUrl: string;

  /** Model name to use for embeddings (e.g., 'nomic-embed-text') */
  model: string;

  /** Dimension of the embedding vectors (e.g., 768 for nomic-embed-text) */
  dimension: number;

  /** Maximum texts per request (default: 32) */
  batchSize?: number;

  /** Request timeout in milliseconds (default: 30000) */
  timeoutMs?: number;
}

/**
 * Interface for embedding generation clients.
 *
 * Implementations must provide:
 * - Batch embedding generation
 * - Single text convenience method
 * - Dimension info for schema validation
 *
 * @example
 * ```typescript
 * const client = new OllamaEmbeddings({
 *   baseUrl: 'http://localhost:11434',
 *   model: 'nomic-embed-text',
 *   dimension: 768,
 * });
 *
 * // Single text
 * const vector = await client.embedOne('How to handle JWT refresh?');
 *
 * // Batch
 * const vectors = await client.embed([
 *   'Pattern for error handling',
 *   'API versioning best practices',
 * ]);
 * ```
 */
export interface EmbeddingClient {
  /**
   * Generate embeddings for multiple texts.
   *
   * Handles batching internally based on batchSize config.
   *
   * @param texts - Texts to embed
   * @param signal - Optional AbortSignal for cancellation
   * @returns Array of embedding vectors (same order as input)
   */
  embed(texts: string[], signal?: AbortSignal): Promise<number[][]>;

  /**
   * Generate embedding for a single text.
   *
   * Convenience wrapper around embed() for single queries.
   *
   * @param text - Text to embed
   * @param signal - Optional AbortSignal for cancellation
   * @returns Embedding vector
   */
  embedOne(text: string, signal?: AbortSignal): Promise<number[]>;

  /**
   * Get the embedding dimension for this model.
   *
   * Used for schema validation and vector operations.
   *
   * @returns Dimension of embedding vectors
   */
  getDimension(): number;

  /**
   * Get the model name being used.
   *
   * @returns Model identifier
   */
  getModel(): string;
}
