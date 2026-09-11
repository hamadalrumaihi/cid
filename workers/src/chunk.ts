// chunk — text windowing for embeddings (~800 tokens ≈ 3200 chars, 200 overlap).
// Pure TypeScript, import-free. Byte-identical copies:
//   supabase/functions/_shared/chunk.ts  and  workers/src/chunk.ts

export const CHUNK_CHARS = 3200;
export const CHUNK_OVERLAP = 200;

/** Split text into overlapping windows, preferring to cut at paragraph / sentence / word boundaries. */
export function chunkText(text: string, size = CHUNK_CHARS, overlap = CHUNK_OVERLAP): string[] {
  const t = (text ?? '').replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').trim();
  if (!t) return [];
  if (t.length <= size) return [t];
  const out: string[] = [];
  let start = 0;
  while (start < t.length) {
    let end = Math.min(t.length, start + size);
    if (end < t.length) {
      const window = t.slice(start, end);
      const cut = Math.max(window.lastIndexOf('\n\n'), window.lastIndexOf('. '), window.lastIndexOf('\n'), window.lastIndexOf(' '));
      if (cut > size * 0.5) end = start + cut + 1;
    }
    const piece = t.slice(start, end).trim();
    if (piece) out.push(piece);
    if (end >= t.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return out;
}
