/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview FastEmbed embedding client implementation.
 *
 * Uses fastembed npm package for CPU-based embeddings with ONNX runtime.
 * This is the zero-friction fallback when Ollama or API-based providers
 * are not available.
 *
 * ## Supported Models
 *
 * - AllMiniLML6V2: 384 dimensions, fastest
 * - BGESmallEN: 384 dimensions, good quality
 * - BGEBaseEN: 768 dimensions, best quality
 * - BGESmallENV15: 384 dimensions, improved version
 * - BGEBaseENV15: 768 dimensions, improved version
 *
 * ## Usage
 *
 * ```typescript
 * const client = await FastEmbedEmbeddings.create({
 *   model: 'fast-bge-small-en-v1.5',
 * });
 *
 * const vectors = await client.embed(['Hello world', 'Another text']);
 * ```
 */

import { FlagEmbedding, EmbeddingModel } from 'fastembed';
import { debugLogger } from '../../utils/debugLogger.js';
import type { EmbeddingClient } from './embeddings.js';

/**
 * Model dimensions for known FastEmbed models.
 */
const MODEL_DIMENSIONS: Record<string, number> = {
  'fast-all-MiniLM-L6-v2': 384,
  'fast-bge-base-en': 768,
  'fast-bge-base-en-v1.5': 768,
  'fast-bge-small-en': 384,
  'fast-bge-small-en-v1.5': 384,
  'fast-bge-small-zh-v1.5': 512,
  'fast-multilingual-e5-large': 1024,
};

/**
 * Default model to use.
 */
const DEFAULT_MODEL = EmbeddingModel.BGESmallENV15;

/**
 * Configuration for FastEmbed client.
 */
export interface FastEmbedConfig {
  /** Model name (from EmbeddingModel enum values) */
  model?: string;

  /** Cache directory for model files */
  cacheDir?: string;

  /** Whether to show download progress (default: false) */
  showDownloadProgress?: boolean;

  /** Maximum sequence length (default: 512) */
  maxLength?: number;
}

/**
 * FastEmbed embedding client using ONNX runtime.
 *
 * Features:
 * - CPU-based, no GPU required
 * - No daemon needed (unlike Ollama)
 * - Models downloaded automatically on first use
 * - Async generator for efficient batching
 */
export class FastEmbedEmbeddings implements EmbeddingClient {
  private readonly model: string;
  private readonly dimension: number;
  private embedding: FlagEmbedding | null = null;
  private initPromise: Promise<void> | null = null;
  private config: FastEmbedConfig;

  /**
   * Create a FastEmbed client.
   * Note: Use the static `create` method for async initialization.
   */
  private constructor(config: FastEmbedConfig) {
    this.config = config;
    this.model = config.model ?? DEFAULT_MODEL;
    this.dimension = MODEL_DIMENSIONS[this.model] ?? 384;
  }

  /**
   * Create and initialize a FastEmbed client.
   *
   * @param config - Configuration options
   * @returns Initialized FastEmbed client
   */
  static async create(
    config: FastEmbedConfig = {},
  ): Promise<FastEmbedEmbeddings> {
    const client = new FastEmbedEmbeddings(config);
    await client.init();
    return client;
  }

  /**
   * Create a FastEmbed client with lazy initialization.
   * The model will be loaded on first embed call.
   *
   * @param config - Configuration options
   * @returns FastEmbed client (not yet initialized)
   */
  static createLazy(config: FastEmbedConfig = {}): FastEmbedEmbeddings {
    return new FastEmbedEmbeddings(config);
  }

  /**
   * Initialize the embedding model (downloads if needed).
   */
  private async init(): Promise<void> {
    if (this.embedding) {
      return;
    }

    // Prevent concurrent initialization
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = this.doInit();
    return this.initPromise;
  }

  private async doInit(): Promise<void> {
    try {
      debugLogger.log(`FastEmbedEmbeddings: Initializing model ${this.model}`);

      // Map string model to enum
      const modelEnum = this.getModelEnum(this.model);

      this.embedding = await FlagEmbedding.init({
        model: modelEnum,
        cacheDir: this.config.cacheDir,
        showDownloadProgress: this.config.showDownloadProgress ?? false,
        maxLength: this.config.maxLength ?? 512,
      });

      debugLogger.log('FastEmbedEmbeddings: Model initialized successfully');
    } catch (error) {
      debugLogger.warn(
        `FastEmbedEmbeddings: Failed to initialize: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      throw error;
    }
  }

  /**
   * Generate embeddings for multiple texts.
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

    // Ensure initialized
    await this.init();

    if (!this.embedding) {
      debugLogger.warn('FastEmbedEmbeddings: Not initialized');
      return texts.map(() => new Array(this.dimension).fill(0));
    }

    try {
      const allEmbeddings: number[][] = [];

      // Use the async generator to get embeddings in batches
      const generator = this.embedding.embed(texts);

      for await (const batch of generator) {
        if (signal?.aborted) {
          return [];
        }
        allEmbeddings.push(...batch);
      }

      return allEmbeddings;
    } catch (error) {
      if (signal?.aborted) {
        return [];
      }
      debugLogger.warn(
        `FastEmbedEmbeddings: embed failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      // Return zero vectors on failure
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
    // Check for early abort
    if (signal?.aborted) {
      return new Array(this.dimension).fill(0);
    }

    // Ensure initialized
    await this.init();

    if (!this.embedding) {
      return new Array(this.dimension).fill(0);
    }

    try {
      // Use queryEmbed for single queries (optimized path)
      return await this.embedding.queryEmbed(text);
    } catch (error) {
      if (signal?.aborted) {
        return new Array(this.dimension).fill(0);
      }
      debugLogger.warn(
        `FastEmbedEmbeddings: embedOne failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      return new Array(this.dimension).fill(0);
    }
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
   * Map string model name to EmbeddingModel enum.
   */
  private getModelEnum(
    model: string,
  ): Exclude<EmbeddingModel, EmbeddingModel.CUSTOM> {
    switch (model) {
      case 'fast-all-MiniLM-L6-v2':
        return EmbeddingModel.AllMiniLML6V2;
      case 'fast-bge-base-en':
        return EmbeddingModel.BGEBaseEN;
      case 'fast-bge-base-en-v1.5':
        return EmbeddingModel.BGEBaseENV15;
      case 'fast-bge-small-en':
        return EmbeddingModel.BGESmallEN;
      case 'fast-bge-small-en-v1.5':
        return EmbeddingModel.BGESmallENV15;
      case 'fast-bge-small-zh-v1.5':
        return EmbeddingModel.BGESmallZH;
      case 'fast-multilingual-e5-large':
        return EmbeddingModel.MLE5Large;
      default:
        debugLogger.warn(
          `FastEmbedEmbeddings: Unknown model ${model}, using default`,
        );
        return DEFAULT_MODEL;
    }
  }
}
