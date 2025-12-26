/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Embedding provider factory with automatic detection.
 *
 * Implements a "provider ladder" that selects the best available
 * embedding provider based on environment configuration and availability.
 *
 * ## Provider Ladder (Detection Order)
 *
 * | Priority | Provider  | Detection                   | Notes                               |
 * | -------- | --------- | --------------------------- | ----------------------------------- |
 * | 1        | OpenAI    | `OPENAI_API_KEY` exists     | Hosted, no setup                    |
 * | 2        | Ollama    | `localhost:11434` reachable | Best local quality (Qwen3/nomic)    |
 * | 3        | FastEmbed | Always available            | npm fallback, ONNX-based, no daemon |
 * | 4        | Endpoint  | `EMBED_BASE_URL` set        | Power user opt-in (vLLM/TEI)        |
 *
 * ## Environment Variables
 *
 * - `EMBED_PROVIDER`: Force specific provider ('auto'|'openai'|'ollama'|'fastembed'|'endpoint')
 * - `EMBED_MODEL`: Override default model for the provider
 * - `EMBED_BASE_URL`: Base URL for endpoint provider
 * - `OPENAI_API_KEY`: OpenAI API key (enables OpenAI provider)
 * - `OLLAMA_HOST`: Ollama host (default: http://localhost:11434)
 *
 * ## Usage
 *
 * ```typescript
 * const factory = new EmbeddingProviderFactory();
 * const client = await factory.createClient();
 *
 * console.log(`Using provider: ${factory.getActiveProvider()}`);
 * ```
 */

import { debugLogger } from '../../utils/debugLogger.js';
import type { EmbeddingClient } from './embeddings.js';
import { OllamaEmbeddings } from './ollamaEmbeddings.js';
import { FastEmbedEmbeddings } from './fastembedEmbeddings.js';

/**
 * Supported embedding providers.
 */
export type EmbeddingProvider =
  | 'auto'
  | 'openai'
  | 'ollama'
  | 'fastembed'
  | 'endpoint';

/**
 * Provider detection result.
 */
export interface ProviderInfo {
  provider: EmbeddingProvider;
  model: string;
  dimension: number;
  available: boolean;
  reason?: string;
}

/**
 * Default models for each provider.
 */
const DEFAULT_MODELS: Record<EmbeddingProvider, string> = {
  auto: 'auto',
  openai: 'text-embedding-3-small',
  ollama: 'nomic-embed-text',
  fastembed: 'fast-bge-small-en-v1.5',
  endpoint: 'nomic-embed-text',
};

/**
 * Default dimensions for known models.
 */
const MODEL_DIMENSIONS: Record<string, number> = {
  // OpenAI
  'text-embedding-3-small': 1536,
  'text-embedding-3-large': 3072,
  'text-embedding-ada-002': 1536,
  // Ollama / local models
  'nomic-embed-text': 768,
  'mxbai-embed-large': 1024,
  'all-minilm': 384,
  // FastEmbed
  'fast-all-MiniLM-L6-v2': 384,
  'fast-bge-base-en': 768,
  'fast-bge-base-en-v1.5': 768,
  'fast-bge-small-en': 384,
  'fast-bge-small-en-v1.5': 384,
};

/**
 * Timeout for availability checks (ms).
 */
const AVAILABILITY_CHECK_TIMEOUT = 3000;

/**
 * Factory for creating embedding clients with automatic provider detection.
 */
export class EmbeddingProviderFactory {
  private activeProvider: EmbeddingProvider | null = null;
  private activeModel: string | null = null;
  private activeDimension: number | null = null;

  /**
   * Create an embedding client using the provider ladder.
   *
   * **Local-first order** (to avoid surprise network calls):
   * 1. Check for explicit EMBED_PROVIDER env var
   * 2. Try Ollama if reachable (best local quality)
   * 3. Fall back to FastEmbed (no daemon, always works)
   * 4. Try OpenAI only if OPENAI_API_KEY exists AND local options failed
   *
   * To force OpenAI: set EMBED_PROVIDER=openai
   *
   * @returns Configured embedding client
   */
  async createClient(): Promise<EmbeddingClient> {
    const explicitProvider = process.env['EMBED_PROVIDER'] as
      | EmbeddingProvider
      | undefined;
    const explicitModel = process.env['EMBED_MODEL'];

    // If provider is explicitly set (not 'auto'), use it directly
    if (explicitProvider && explicitProvider !== 'auto') {
      debugLogger.log(
        `EmbeddingProviderFactory: Using explicit provider: ${explicitProvider}`,
      );
      return this.createProviderClient(explicitProvider, explicitModel);
    }

    // Auto-detect: LOCAL-FIRST order to avoid surprise network calls
    debugLogger.log(
      'EmbeddingProviderFactory: Auto-detecting provider (local-first)...',
    );

    // 1. Try Ollama first (best local quality)
    const ollamaAvailable = await this.checkOllamaAvailability();
    if (ollamaAvailable) {
      try {
        const client = await this.createProviderClient('ollama', explicitModel);
        debugLogger.log(
          'EmbeddingProviderFactory: Using Ollama (local, reachable)',
        );
        return client;
      } catch (error) {
        debugLogger.warn(
          `EmbeddingProviderFactory: Ollama failed: ${error instanceof Error ? error.message : 'Unknown'}`,
        );
      }
    }

    // 2. Try custom endpoint if EMBED_BASE_URL is set (local vLLM/TEI)
    if (process.env['EMBED_BASE_URL']) {
      try {
        const client = await this.createProviderClient(
          'endpoint',
          explicitModel,
        );
        debugLogger.log(
          'EmbeddingProviderFactory: Using endpoint (EMBED_BASE_URL set)',
        );
        return client;
      } catch (error) {
        debugLogger.warn(
          `EmbeddingProviderFactory: Endpoint (${process.env['EMBED_BASE_URL']}) failed: ` +
            `${error instanceof Error ? error.message : 'Unknown'}; falling through to FastEmbed`,
        );
      }
    }

    // 3. Fall back to FastEmbed (always available, no daemon)
    // Log loudly if OpenAI key exists but wasn't used (local-first preference)
    if (process.env['OPENAI_API_KEY']) {
      debugLogger.log(
        'EmbeddingProviderFactory: OPENAI_API_KEY is set but EMBED_PROVIDER=auto; ' +
          'using local FastEmbed instead. Set EMBED_PROVIDER=openai to use OpenAI.',
      );
    }
    debugLogger.log(
      'EmbeddingProviderFactory: Using FastEmbed (local, no daemon required)',
    );
    return this.createProviderClient('fastembed', explicitModel);
  }

  /**
   * Create a client for a specific provider.
   */
  private async createProviderClient(
    provider: EmbeddingProvider,
    modelOverride?: string,
  ): Promise<EmbeddingClient> {
    const model = modelOverride ?? DEFAULT_MODELS[provider];
    const dimension = MODEL_DIMENSIONS[model] ?? 768;

    this.activeProvider = provider;
    this.activeModel = model;
    this.activeDimension = dimension;

    switch (provider) {
      case 'openai':
        return this.createOpenAIClient(model, dimension);

      case 'ollama':
        return this.createOllamaClient(model, dimension);

      case 'fastembed':
        return this.createFastEmbedClient(model);

      case 'endpoint':
        return this.createEndpointClient(model, dimension);

      default:
        throw new Error(`Unknown provider: ${provider}`);
    }
  }

  /**
   * Create an OpenAI embedding client.
   * Uses the Ollama-compatible endpoint format for simplicity.
   */
  private async createOpenAIClient(
    model: string,
    dimension: number,
  ): Promise<EmbeddingClient> {
    // For OpenAI, we use a simple fetch-based client that's compatible
    // with the EmbeddingClient interface
    return new OpenAIEmbeddings({
      apiKey: process.env['OPENAI_API_KEY']!,
      model,
      dimension,
    });
  }

  /**
   * Create an Ollama embedding client.
   */
  private async createOllamaClient(
    model: string,
    dimension: number,
  ): Promise<EmbeddingClient> {
    const baseUrl = process.env['OLLAMA_HOST'] ?? 'http://localhost:11434';
    return new OllamaEmbeddings({
      baseUrl,
      model,
      dimension,
    });
  }

  /**
   * Create a FastEmbed client.
   */
  private async createFastEmbedClient(model: string): Promise<EmbeddingClient> {
    // Use lazy initialization to avoid blocking on model download
    const client = FastEmbedEmbeddings.createLazy({
      model,
      showDownloadProgress: false,
    });
    this.activeDimension = client.getDimension();
    return client;
  }

  /**
   * Create a custom endpoint client (vLLM, TEI, etc.).
   * Uses Ollama-compatible API format.
   */
  private async createEndpointClient(
    model: string,
    dimension: number,
  ): Promise<EmbeddingClient> {
    const baseUrl = process.env['EMBED_BASE_URL']!;
    return new OllamaEmbeddings({
      baseUrl,
      model,
      dimension,
    });
  }

  /**
   * Check if Ollama is available at the configured host.
   */
  private async checkOllamaAvailability(): Promise<boolean> {
    const host = process.env['OLLAMA_HOST'] ?? 'http://localhost:11434';

    try {
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        AVAILABILITY_CHECK_TIMEOUT,
      );

      const response = await fetch(`${host}/api/tags`, {
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (response.ok) {
        debugLogger.log('EmbeddingProviderFactory: Ollama is available');
        return true;
      }

      return false;
    } catch {
      debugLogger.log('EmbeddingProviderFactory: Ollama not reachable');
      return false;
    }
  }

  /**
   * Get the active provider after createClient has been called.
   */
  getActiveProvider(): EmbeddingProvider | null {
    return this.activeProvider;
  }

  /**
   * Get the active model after createClient has been called.
   */
  getActiveModel(): string | null {
    return this.activeModel;
  }

  /**
   * Get the active dimension after createClient has been called.
   */
  getActiveDimension(): number | null {
    return this.activeDimension;
  }

  /**
   * Get provider info for debugging/status.
   */
  getProviderInfo(): ProviderInfo | null {
    if (!this.activeProvider || !this.activeModel) {
      return null;
    }

    return {
      provider: this.activeProvider,
      model: this.activeModel,
      dimension: this.activeDimension ?? 768,
      available: true,
    };
  }
}

/**
 * Simple OpenAI embedding client.
 */
class OpenAIEmbeddings implements EmbeddingClient {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly dimension: number;

  constructor(config: { apiKey: string; model: string; dimension: number }) {
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.dimension = config.dimension;
  }

  async embed(texts: string[], signal?: AbortSignal): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    if (signal?.aborted) {
      return [];
    }

    try {
      const response = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          input: texts,
        }),
        signal,
      });

      if (!response.ok) {
        throw new Error(`OpenAI API error: ${response.status}`);
      }

      const data = (await response.json()) as {
        data: Array<{ embedding: number[] }>;
      };

      return data.data.map((d) => d.embedding);
    } catch (error) {
      if (signal?.aborted) {
        return [];
      }
      debugLogger.warn(
        `OpenAIEmbeddings: embed failed: ${error instanceof Error ? error.message : 'Unknown'}`,
      );
      return texts.map(() => new Array(this.dimension).fill(0));
    }
  }

  async embedOne(text: string, signal?: AbortSignal): Promise<number[]> {
    const results = await this.embed([text], signal);
    return results[0] ?? new Array(this.dimension).fill(0);
  }

  getDimension(): number {
    return this.dimension;
  }

  getModel(): string {
    return this.model;
  }
}
