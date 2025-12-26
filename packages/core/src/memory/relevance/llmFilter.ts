/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview LLM-based relevance filtering for memory retrieval.
 *
 * This module implements the "over-retrieve then filter" strategy:
 * 1. Vector search returns ~50 candidates (topK)
 * 2. LLM selects the 5-12 most relevant based on current context
 *
 * The LLM acts as a smart filter that understands context better than
 * pure vector similarity. This avoids arbitrary token caps while ensuring
 * only truly relevant memories are injected.
 *
 * ## Fallback Behavior
 *
 * If LLM filtering fails (timeout, parse error, abort):
 * - Fall back to top N by similarity score
 * - Log warning but never block the conversation
 *
 * ## Prompt Design
 *
 * The prompt is designed for deterministic, parseable output:
 * - Request strict JSON format
 * - Provide candidates as structured data
 * - Clear selection criteria
 */

import { debugLogger } from '../../utils/debugLogger.js';

/**
 * A candidate memory hit from vector search.
 */
export interface CandidateHit {
  /** Unique identifier */
  id: string;

  /** Similarity score from vector search (0-1) */
  score: number;

  /** First ~200 chars of text for prompt efficiency */
  textSnippet: string;

  /** Source/provenance information */
  source?: string;
}

/**
 * Result from LLM filtering.
 */
export interface LLMFilterResult {
  /** IDs of selected candidates */
  selectedIds: string[];

  /** Optional reasoning from the LLM */
  reasoning?: string;
}

/**
 * Options for LLM filtering.
 */
export interface LLMFilterOptions {
  /** Maximum number of candidates to select (default: 10) */
  maxSelect?: number;

  /** AbortSignal for cancellation */
  signal?: AbortSignal;

  /** Fallback count if LLM fails (default: 8) */
  fallbackCount?: number;
}

/**
 * Default configuration values.
 */
const DEFAULTS = {
  maxSelect: 10,
  fallbackCount: 8,
} as const;

/**
 * Expected JSON response format from LLM.
 */
interface LLMResponse {
  selected: string[];
  notes?: string;
}

/**
 * Build the filter prompt for the LLM.
 *
 * The prompt is designed to be:
 * - Deterministic (no creativity needed)
 * - Parseable (strict JSON output)
 * - Efficient (short snippets, not full text)
 *
 * @param query - The user's query/request
 * @param candidates - Candidate hits from vector search
 * @param maxSelect - Maximum candidates to select
 * @returns Prompt string for the LLM
 */
export function buildFilterPrompt(
  query: string,
  candidates: CandidateHit[],
  maxSelect: number,
): string {
  // Format candidates as a structured list
  const candidateList = candidates
    .map(
      (c) =>
        `- ID: ${c.id} | Score: ${c.score.toFixed(2)} | Source: ${c.source ?? 'unknown'}\n  Snippet: ${c.textSnippet}`,
    )
    .join('\n\n');

  return `You are a relevance filter for a memory retrieval system.

Given a user query and candidate memory entries, select the ones that are DIRECTLY relevant to the query. Only select entries that would genuinely help answer or complete the task.

## User Query
${query}

## Candidate Entries
${candidateList}

## Instructions
1. Review each candidate for relevance to the query
2. Select 0 to ${maxSelect} entries that are DIRECTLY helpful
3. Only select if the entry provides useful context or answers
4. Prefer higher similarity scores when relevance is equal
5. Return ONLY valid JSON, no other text

## Output Format (JSON only)
{"selected": ["id1", "id2"], "notes": "brief reasoning"}

If no entries are relevant, return:
{"selected": [], "notes": "none relevant to query"}`;
}

/**
 * Parse LLM response into structured result.
 *
 * @param response - Raw LLM response text
 * @returns Parsed result or null if invalid
 */
export function parseFilterResponse(response: string): LLMFilterResult | null {
  try {
    // Try to extract JSON from response
    // Handle cases where LLM wraps in markdown code blocks
    let jsonStr = response.trim();

    // Remove markdown code fences if present
    if (jsonStr.startsWith('```json')) {
      jsonStr = jsonStr.slice(7);
    } else if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.slice(3);
    }
    if (jsonStr.endsWith('```')) {
      jsonStr = jsonStr.slice(0, -3);
    }
    jsonStr = jsonStr.trim();

    const parsed = JSON.parse(jsonStr) as LLMResponse;

    // Validate structure
    if (!Array.isArray(parsed.selected)) {
      return null;
    }

    // Validate all selected are strings
    if (!parsed.selected.every((id) => typeof id === 'string')) {
      return null;
    }

    return {
      selectedIds: parsed.selected,
      reasoning: parsed.notes,
    };
  } catch {
    return null;
  }
}

/**
 * Filter candidates by relevance using an LLM.
 *
 * This is the main entry point for LLM-based filtering. It:
 * 1. Builds a prompt with the query and candidates
 * 2. Calls the LLM (provided as callback)
 * 3. Parses the response
 * 4. Falls back to score-based selection on failure
 *
 * @param query - The user's query/request
 * @param candidates - Candidate hits from vector search
 * @param llmCall - Function to call the LLM with a prompt
 * @param options - Filter options
 * @returns Selected candidate IDs
 *
 * @example
 * ```typescript
 * const selected = await filterByRelevance(
 *   'How do I handle JWT refresh?',
 *   candidates,
 *   async (prompt) => {
 *     const response = await geminiClient.generateContent(prompt);
 *     return response.text();
 *   },
 *   { maxSelect: 10 }
 * );
 * ```
 */
export async function filterByRelevance(
  query: string,
  candidates: CandidateHit[],
  llmCall: (prompt: string, signal?: AbortSignal) => Promise<string>,
  options?: LLMFilterOptions,
): Promise<LLMFilterResult> {
  const maxSelect = options?.maxSelect ?? DEFAULTS.maxSelect;
  const fallbackCount = options?.fallbackCount ?? DEFAULTS.fallbackCount;
  const signal = options?.signal;

  // If no candidates, nothing to filter
  if (candidates.length === 0) {
    return { selectedIds: [], reasoning: 'no candidates' };
  }

  // If few enough candidates, skip LLM and use all
  if (candidates.length <= maxSelect) {
    return {
      selectedIds: candidates.map((c) => c.id),
      reasoning: 'all candidates within limit',
    };
  }

  // Check for early abort
  if (signal?.aborted) {
    return fallbackToTopN(candidates, fallbackCount);
  }

  try {
    debugLogger.log(
      `LLMFilter: Filtering ${candidates.length} candidates (max ${maxSelect})`,
    );

    // Build prompt
    const prompt = buildFilterPrompt(query, candidates, maxSelect);

    // Call LLM
    const response = await llmCall(prompt, signal);

    // Check for abort after LLM call
    if (signal?.aborted) {
      return fallbackToTopN(candidates, fallbackCount);
    }

    // Parse response
    const result = parseFilterResponse(response);

    if (!result) {
      debugLogger.warn('LLMFilter: Failed to parse response, using fallback');
      return fallbackToTopN(candidates, fallbackCount);
    }

    // Validate selected IDs exist in candidates
    const candidateIdSet = new Set(candidates.map((c) => c.id));
    const validSelectedIds = result.selectedIds.filter((id) =>
      candidateIdSet.has(id),
    );

    if (validSelectedIds.length !== result.selectedIds.length) {
      debugLogger.warn(
        `LLMFilter: Some selected IDs not in candidates (${result.selectedIds.length - validSelectedIds.length} invalid)`,
      );
    }

    debugLogger.log(
      `LLMFilter: Selected ${validSelectedIds.length} of ${candidates.length} candidates`,
    );

    return {
      selectedIds: validSelectedIds,
      reasoning: result.reasoning,
    };
  } catch (error) {
    // Check if aborted
    if (signal?.aborted) {
      return fallbackToTopN(candidates, fallbackCount);
    }

    debugLogger.warn(
      `LLMFilter: Error during filtering: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );

    // Fallback to score-based selection
    return fallbackToTopN(candidates, fallbackCount);
  }
}

/**
 * Fallback to selecting top N candidates by similarity score.
 *
 * Used when LLM filtering fails.
 *
 * @param candidates - Candidate hits
 * @param count - Number to select
 * @returns Fallback result
 */
function fallbackToTopN(
  candidates: CandidateHit[],
  count: number,
): LLMFilterResult {
  // Sort by score descending and take top N
  const sorted = [...candidates].sort((a, b) => b.score - a.score);
  const selected = sorted.slice(0, count);

  return {
    selectedIds: selected.map((c) => c.id),
    reasoning: 'fallback to top scores',
  };
}
