/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Ollama embedding client implementation.
 *
 * Uses Ollama's `/api/embed` endpoint for batch embedding generation.
 * This is the stable batch-capable endpoint (vs /api/embeddings which is
 * OpenAI-compatible but has different response shape).
 *
 * ## Endpoint
 *
 * POST http://localhost:11434/api/embed
 *
 * Request:
 * ```json
 * {
 *   "model": "nomic-embed-text",
 *   "input": ["text1", "text2", ...]
 * }
 * ```
 *
 * Response:
 * ```json
 * {
 *   "model": "nomic-embed-text",
 *   "embeddings": [[0.1, 0.2, ...], [0.3, 0.4, ...]]
 * }
 * ```
 *
 * ## Usage
 *
 * ```typescript
 * const client = new OllamaEmbeddings({
 *   baseUrl: 'http://localhost:11434',
 *   model: 'nomic-embed-text',
 *   dimension: 768,
 * });
 *
 * const vectors = await client.embed(['Hello world', 'Another text']);
 * ```
 */

import { debugLogger } from '../../utils/debugLogger.js';
import type { EmbeddingClient, EmbeddingConfig } from './embeddings.js';

/**
 * Response from Ollama /api/embed endpoint.
 */
interface OllamaEmbedResponse {
  model: string;
  embeddings: number[][];
}

/**
 * Default configuration values.
 */
const DEFAULTS = {
  batchSize: 32,
  timeoutMs: 30000,
} as const;

/**
 * Ollama embedding client using the /api/embed endpoint.
 *
 * Features:
 * - Batch embedding with automatic chunking
 * - AbortSignal support for cancellation
 * - Graceful error handling (returns empty on failure)
 */
export class OllamaEmbeddings implements EmbeddingClient {
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly dimension: number;
  private readonly batchSize: number;
  private readonly timeoutMs: number;

  /**
   * Create an Ollama embedding client.
   *
   * @param config - Embedding configuration
   */
  constructor(config: EmbeddingConfig) {
    // Remove trailing slash from base URL
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.model = config.model;
    this.dimension = config.dimension;
    this.batchSize = config.batchSize ?? DEFAULTS.batchSize;
    this.timeoutMs = config.timeoutMs ?? DEFAULTS.timeoutMs;
  }

  /**
   * Generate embeddings for multiple texts.
   *
   * Chunks texts according to batchSize and makes multiple requests if needed.
   *
   * @param texts - Texts to embed
   * @param signal - Optional AbortSignal for cancellation
   * @returns Array of embedding vectors
   */
  async embed(texts: string[], signal?: AbortSignal): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    // Check for early abort
    if (signal?.aborted) {
      return [];
    }

    try {
      const allEmbeddings: number[][] = [];

      // Process in batches
      for (let i = 0; i < texts.length; i += this.batchSize) {
        if (signal?.aborted) {
          return [];
        }

        const batch = texts.slice(i, i + this.batchSize);
        const batchEmbeddings = await this.embedBatch(batch, signal);

        if (signal?.aborted) {
          return [];
        }

        allEmbeddings.push(...batchEmbeddings);
      }

      return allEmbeddings;
    } catch (error) {
      if (signal?.aborted) {
        return [];
      }
      debugLogger.warn(
        `OllamaEmbeddings: embed failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      // Return empty vectors on failure (don't block the pipeline)
      return texts.map(() => new Array(this.dimension).fill(0));
    }
  }

  /**
   * Generate embedding for a single text.
   *
   * @param text - Text to embed
   * @param signal - Optional AbortSignal for cancellation
   * @returns Embedding vector
   */
  async embedOne(text: string, signal?: AbortSignal): Promise<number[]> {
    const results = await this.embed([text], signal);
    return results[0] ?? new Array(this.dimension).fill(0);
  }

  /**
   * Get the embedding dimension for this model.
   */
  getDimension(): number {
    return this.dimension;
  }

  /**
   * Get the model name being used.
   */
  getModel(): string {
    return this.model;
  }

  /**
   * Embed a single batch of texts.
   *
   * @param texts - Batch of texts (up to batchSize)
   * @param signal - Optional AbortSignal
   * @returns Embedding vectors
   */
  private async embedBatch(
    texts: string[],
    signal?: AbortSignal,
  ): Promise<number[][]> {
    const url = `${this.baseUrl}/api/embed`;

    debugLogger.log(
      `OllamaEmbeddings: Embedding batch of ${texts.length} texts`,
    );

    // Create timeout controller
    const timeoutController = new AbortController();
    const timeoutId = setTimeout(
      () => timeoutController.abort(),
      this.timeoutMs,
    );

    // Combine signals if provided
    const combinedSignal = signal
      ? this.combineSignals(signal, timeoutController.signal)
      : timeoutController.signal;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          input: texts,
        }),
        signal: combinedSignal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(
          `Ollama embed failed: ${response.status} ${response.statusText}`,
        );
      }

      const data = (await response.json()) as OllamaEmbedResponse;

      // Validate response
      if (!data.embeddings || !Array.isArray(data.embeddings)) {
        throw new Error('Invalid response: missing embeddings array');
      }

      if (data.embeddings.length !== texts.length) {
        throw new Error(
          `Response length mismatch: expected ${texts.length}, got ${data.embeddings.length}`,
        );
      }

      // Validate dimensions
      for (const embedding of data.embeddings) {
        if (embedding.length !== this.dimension) {
          debugLogger.warn(
            `OllamaEmbeddings: Dimension mismatch: expected ${this.dimension}, got ${embedding.length}`,
          );
        }
      }

      return data.embeddings;
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof Error && error.name === 'AbortError') {
        // Cancelled or timed out
        debugLogger.log('OllamaEmbeddings: Request aborted');
        return texts.map(() => new Array(this.dimension).fill(0));
      }

      throw error;
    }
  }

  /**
   * Combine multiple AbortSignals into one.
   *
   * Returns a signal that aborts if any of the input signals abort.
   */
  private combineSignals(...signals: AbortSignal[]): AbortSignal {
    const controller = new AbortController();

    for (const signal of signals) {
      if (signal.aborted) {
        controller.abort();
        return controller.signal;
      }
      signal.addEventListener('abort', () => controller.abort(), {
        once: true,
      });
    }

    return controller.signal;
  }
}
