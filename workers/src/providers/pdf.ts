// pdf — pdf-lib / unpdf fallbacks (identical behaviour to the edge runner):
// per-page text extraction and the document tools the worker can do without
// Stirling: merge, extract_pages/split, rearrange, rotate, page_numbers,
// watermark, metadata_remove. Everything else needs Stirling.
import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';
import { renderPacketPdf, sanitizePdfText } from '../packetPdf.ts';

export { renderPacketPdf };

export async function pdfPages(bytes: Uint8Array): Promise<string[]> {
  const unpdf = await import('unpdf');
  const doc = await unpdf.getDocumentProxy(bytes);
  const { text } = await unpdf.extractText(doc, { mergePages: false });
  return Array.isArray(text) ? text : [String(text ?? '')];
}

/** "1,3-5,8" → zero-based page indexes within [0, count). */
export function parsePageSpec(spec: string | number[] | undefined, count: number): number[] {
  if (Array.isArray(spec)) return spec.map((n) => Number(n) - 1).filter((i) => Number.isInteger(i) && i >= 0 && i < count);
  if (!spec) return Array.from({ length: count }, (_, i) => i);
  const out: number[] = [];
  for (const part of String(spec).split(',')) {
    const m = /^\s*(\d+)\s*(?:-\s*(\d+))?\s*$/.exec(part);
    if (!m) continue;
    const a = Number(m[1]) - 1;
    const b = m[2] ? Number(m[2]) - 1 : a;
    for (let i = Math.min(a, b); i <= Math.max(a, b); i++) if (i >= 0 && i < count) out.push(i);
  }
  return out;
}

async function load(bytes: Uint8Array): Promise<PDFDocument> {
  return PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
}

function stamp(doc: PDFDocument): void {
  doc.setProducer('CID Portal');
  doc.setCreator('CID Portal');
}

export async function merge(inputs: Uint8Array[]): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  for (const bytes of inputs) {
    const src = await load(bytes);
    const pages = await out.copyPages(src, src.getPageIndices());
    for (const p of pages) out.addPage(p);
  }
  stamp(out);
  return out.save();
}

export async function extractPages(bytes: Uint8Array, spec: string | number[] | undefined): Promise<Uint8Array> {
  const src = await load(bytes);
  const idx = parsePageSpec(spec, src.getPageCount());
  if (!idx.length) throw new Error('no_pages_selected');
  const out = await PDFDocument.create();
  const pages = await out.copyPages(src, idx);
  for (const p of pages) out.addPage(p);
  stamp(out);
  return out.save();
}

/** Split into one PDF per page (or per range when ranges are given). */
export async function split(bytes: Uint8Array, ranges?: string[]): Promise<Uint8Array[]> {
  const src = await load(bytes);
  const specs = ranges?.length ? ranges : Array.from({ length: src.getPageCount() }, (_, i) => String(i + 1));
  const out: Uint8Array[] = [];
  for (const s of specs) out.push(await extractPages(bytes, s));
  return out;
}

export async function rearrange(bytes: Uint8Array, order: number[]): Promise<Uint8Array> {
  return extractPages(bytes, order);
}

export async function rotate(bytes: Uint8Array, angle: number, spec?: string | number[]): Promise<Uint8Array> {
  const doc = await load(bytes);
  const idx = new Set(parsePageSpec(spec, doc.getPageCount()));
  const a = ((Math.round(angle / 90) * 90) % 360 + 360) % 360;
  doc.getPages().forEach((p, i) => {
    if (idx.has(i)) p.setRotation(degrees((p.getRotation().angle + a) % 360));
  });
  stamp(doc);
  return doc.save();
}

export async function pageNumbers(bytes: Uint8Array, opts: { start?: number; position?: 'bottom-right' | 'bottom-center' | 'bottom-left'; format?: string } = {}): Promise<Uint8Array> {
  const doc = await load(bytes);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();
  const start = opts.start ?? 1;
  pages.forEach((p, i) => {
    const label = sanitizePdfText((opts.format ?? 'Page {n} of {total}').replace('{n}', String(i + start)).replace('{total}', String(pages.length + start - 1)));
    const { width } = p.getSize();
    const w = font.widthOfTextAtSize(label, 9);
    const x = opts.position === 'bottom-left' ? 40 : opts.position === 'bottom-center' ? (width - w) / 2 : width - 40 - w;
    p.drawText(label, { x, y: 24, size: 9, font, color: rgb(0.3, 0.3, 0.35) });
  });
  stamp(doc);
  return doc.save();
}

export async function watermark(bytes: Uint8Array, text: string, opts: { opacity?: number; color?: [number, number, number] } = {}): Promise<Uint8Array> {
  const doc = await load(bytes);
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const mark = sanitizePdfText(text || 'LAW ENFORCEMENT SENSITIVE');
  const [r, g, b] = opts.color ?? [0.7, 0.1, 0.1];
  for (const p of doc.getPages()) {
    const { width, height } = p.getSize();
    const size = Math.min(48, Math.max(18, (width * 1.4) / Math.max(mark.length, 1)));
    const tw = font.widthOfTextAtSize(mark, size);
    p.drawText(mark, {
      x: width / 2 - (tw / 2) * Math.cos(Math.PI / 4) + 30,
      y: height / 2 - (tw / 2) * Math.sin(Math.PI / 4),
      size,
      font,
      color: rgb(r, g, b),
      opacity: opts.opacity ?? 0.13,
      rotate: degrees(45),
    });
  }
  stamp(doc);
  return doc.save();
}

/** Copy pages into a fresh document so the Info dictionary and XMP metadata are gone. */
export async function metadataRemove(bytes: Uint8Array): Promise<Uint8Array> {
  const src = await load(bytes);
  const out = await PDFDocument.create();
  const pages = await out.copyPages(src, src.getPageIndices());
  for (const p of pages) out.addPage(p);
  out.setTitle('');
  out.setAuthor('');
  out.setSubject('');
  out.setKeywords([]);
  stamp(out);
  return out.save();
}

export async function info(bytes: Uint8Array): Promise<Record<string, unknown>> {
  const doc = await load(bytes);
  const pages = doc.getPages().map((p) => {
    const { width, height } = p.getSize();
    return { width, height, rotation: p.getRotation().angle };
  });
  return {
    page_count: doc.getPageCount(),
    title: doc.getTitle() ?? null,
    author: doc.getAuthor() ?? null,
    subject: doc.getSubject() ?? null,
    creator: doc.getCreator() ?? null,
    producer: doc.getProducer() ?? null,
    creation_date: doc.getCreationDate()?.toISOString() ?? null,
    modification_date: doc.getModificationDate()?.toISOString() ?? null,
    pages,
  };
}
