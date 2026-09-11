// embeddings — OpenAI-compatible POST {EMBEDDINGS_BASE_URL}/v1/embeddings.
// The batching + error mapping live in jobCore (shared with the runner).
import type { CoreDeps } from '../jobCore.ts';
import { embedTexts } from '../jobCore.ts';
import { env } from '../deps.ts';

export function embeddingsConfigured(): boolean {
  return !!env('EMBEDDINGS_API_KEY');
}

export function embeddingsModel(): string {
  return env('EMBEDDINGS_MODEL') || 'text-embedding-3-small';
}

export function embed(deps: CoreDeps, inputs: string[]): Promise<{ vectors: number[][]; model: string }> {
  return embedTexts(deps, inputs);
}
