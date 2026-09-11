// embeddings.generate — chunk document pages / source text / report
// narrative (~3200 chars, 200 overlap), embed through the OpenAI-compatible
// provider and store via semantic_chunks_replace (shared jobCore logic).
import { embeddingsGenerate, type KindHandler } from '../jobCore.ts';

export const kind = 'embeddings.generate';
export const queue = 'embeddings';
export const handler: KindHandler = embeddingsGenerate;
