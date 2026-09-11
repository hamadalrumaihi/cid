// packetPdf — case packet renderer on pdf-lib (contract §3 packet.render).
// Pure TypeScript, import-free: the pdf-lib module is passed in by the caller
// (`npm:pdf-lib` in the edge runner, `pdf-lib` in the worker) so this file is
// byte-identical in supabase/functions/_shared/packetPdf.ts and
// workers/src/packetPdf.ts.
//
// Output: cover page (case number, title, packet type, classification band,
// generated at/by), one section per key in the snapshot's `sections` order
// (generic typesetting of strings / lists / tables / objects), an evidence
// index table, embedded evidence images (jpg/png), "Page n of N" footers, a
// diagonal watermark on every page and producer/creator "CID Portal" only.
// Text is limited to WinAnsi (pdf-lib standard fonts); other glyphs become '?'.

/* eslint-disable @typescript-eslint/no-explicit-any */
// deno-lint-ignore-file no-explicit-any

export interface PacketImage {
  label: string;
  bytes: Uint8Array;
  mime: string;
}

export interface PacketRenderInput {
  pdfLib: any;
  snapshot: Record<string, unknown>;
  caseNumber: string;
  caseTitle: string;
  packetType: string;
  classification: string;
  generatedAt: string;
  generatedBy: string;
  watermark: string;
  images: PacketImage[];
}

export interface PacketRenderOutput {
  bytes: Uint8Array;
  pageCount: number;
}

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 54;
const BODY = 10;
const LINE = 14;
const MAX_TABLE_COLS = 6;
const META_KEYS = new Set(['case', 'packet', 'sections', 'excluded', 'meta', 'classification', 'generated_at', 'generated_by', 'watermark', 'cover']);

export const SECTION_LABELS: Record<string, string> = {
  overview: 'Case Overview',
  summary: 'Summary',
  investigators: 'Investigators',
  persons: 'Persons',
  vehicles: 'Vehicles',
  gangs: 'Gangs / Groups',
  places: 'Places',
  narcotics: 'Narcotics',
  reports: 'Reports',
  evidence_index: 'Evidence Index',
  evidence_images: 'Evidence Images',
  charges: 'Charges',
  warrants: 'Warrants',
  subpoenas: 'Subpoenas',
  legal_decisions: 'Legal Decisions',
  timeline: 'Timeline',
  signatures: 'Signatures',
};

export function sanitizePdfText(s: unknown): string {
  const t = s == null ? '' : String(s);
  return t
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, '  ')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/•/g, '-')
    .replace(/[^\x20-\x7e\xa0-\xff\n]/g, '?');
}

function labelFor(key: string): string {
  return SECTION_LABELS[key] ?? key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function cell(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return v.map(cell).filter(Boolean).join(', ');
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    for (const k of ['label', 'name', 'title', 'number', 'display_name', 'evidence_number', 'case_number']) {
      if (typeof o[k] === 'string' && o[k]) return o[k] as string;
    }
    return JSON.stringify(o).slice(0, 120);
  }
  return String(v);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

class Writer {
  doc: any;
  font: any;
  bold: any;
  rgb: (r: number, g: number, b: number) => any;
  page: any = null;
  y = 0;
  constructor(doc: any, font: any, bold: any, rgb: (r: number, g: number, b: number) => any) {
    this.doc = doc;
    this.font = font;
    this.bold = bold;
    this.rgb = rgb;
  }
  newPage() {
    this.page = this.doc.addPage([PAGE_W, PAGE_H]);
    this.y = PAGE_H - MARGIN;
    return this.page;
  }
  ensure(height: number) {
    if (!this.page || this.y - height < MARGIN + 24) this.newPage();
  }
  width(text: string, size: number, bold = false): number {
    return (bold ? this.bold : this.font).widthOfTextAtSize(text, size);
  }
  wrap(text: string, size: number, maxWidth: number, bold = false): string[] {
    const lines: string[] = [];
    for (const para of sanitizePdfText(text).split('\n')) {
      const words = para.split(/\s+/).filter(Boolean);
      if (!words.length) {
        lines.push('');
        continue;
      }
      let cur = '';
      for (const w of words) {
        let word = w;
        // Hard-break words wider than the column.
        while (this.width(word, size, bold) > maxWidth) {
          let k = word.length - 1;
          while (k > 1 && this.width(word.slice(0, k), size, bold) > maxWidth) k--;
          if (cur) lines.push(cur);
          cur = '';
          lines.push(word.slice(0, k));
          word = word.slice(k);
        }
        const next = cur ? cur + ' ' + word : word;
        if (this.width(next, size, bold) <= maxWidth) cur = next;
        else {
          if (cur) lines.push(cur);
          cur = word;
        }
      }
      lines.push(cur);
    }
    return lines;
  }
  text(text: string, opts: { size?: number; bold?: boolean; indent?: number; color?: any; gap?: number } = {}) {
    const size = opts.size ?? BODY;
    const indent = opts.indent ?? 0;
    const lh = Math.max(LINE, size * 1.35);
    const lines = this.wrap(text, size, PAGE_W - 2 * MARGIN - indent, opts.bold);
    for (const line of lines) {
      this.ensure(lh);
      this.page.drawText(line, {
        x: MARGIN + indent,
        y: this.y - size,
        size,
        font: opts.bold ? this.bold : this.font,
        color: opts.color ?? this.rgb(0.1, 0.1, 0.12),
      });
      this.y -= lh;
    }
    this.y -= opts.gap ?? 0;
  }
  heading(text: string, level = 1) {
    const size = level === 1 ? 15 : level === 2 ? 12 : 10.5;
    this.ensure(size * 2.4);
    this.y -= level === 1 ? 6 : 2;
    this.text(text, { size, bold: true, gap: level === 1 ? 4 : 2 });
    if (level === 1) {
      this.page.drawLine({
        start: { x: MARGIN, y: this.y + 2 },
        end: { x: PAGE_W - MARGIN, y: this.y + 2 },
        thickness: 0.8,
        color: this.rgb(0.3, 0.3, 0.35),
      });
      this.y -= 8;
    }
  }
  bullets(items: unknown[], indent = 0) {
    for (const it of items) {
      const lines = this.wrap(cell(it), BODY, PAGE_W - 2 * MARGIN - indent - 12);
      this.ensure(LINE);
      this.page.drawText('-', { x: MARGIN + indent, y: this.y - BODY, size: BODY, font: this.font });
      for (const [i, line] of lines.entries()) {
        if (i > 0) this.ensure(LINE);
        this.page.drawText(line, { x: MARGIN + indent + 12, y: this.y - BODY, size: BODY, font: this.font });
        this.y -= LINE;
      }
    }
    this.y -= 4;
  }
  table(rows: Record<string, unknown>[], columns?: string[]) {
    if (!rows.length) {
      this.text('None.', { color: this.rgb(0.4, 0.4, 0.45), gap: 4 });
      return;
    }
    const cols =
      columns ??
      Array.from(rows.reduce((acc, r) => {
        for (const k of Object.keys(r)) if (!/^(id|.*_id|storage_path|sha256|mime)$/i.test(k) || k === 'sha256') acc.add(k);
        return acc;
      }, new Set<string>())).slice(0, MAX_TABLE_COLS);
    if (!cols.length) {
      this.text('None.', { gap: 4 });
      return;
    }
    const totalW = PAGE_W - 2 * MARGIN;
    const colW = cols.map(() => totalW / cols.length);
    const size = 8.5;
    const lh = 11;
    const pad = 3;
    const drawRow = (values: string[], bold: boolean) => {
      const wrapped = values.map((v, i) => this.wrap(v, size, colW[i] - 2 * pad, bold));
      const h = Math.max(1, ...wrapped.map((w) => w.length)) * lh + 2 * pad;
      this.ensure(h);
      let x = MARGIN;
      for (const [i, lines] of wrapped.entries()) {
        for (const [j, line] of lines.entries()) {
          this.page.drawText(line, { x: x + pad, y: this.y - pad - size - j * lh + 2, size, font: bold ? this.bold : this.font });
        }
        x += colW[i];
      }
      this.y -= h;
      this.page.drawLine({
        start: { x: MARGIN, y: this.y },
        end: { x: PAGE_W - MARGIN, y: this.y },
        thickness: bold ? 0.8 : 0.3,
        color: this.rgb(0.6, 0.6, 0.65),
      });
    };
    drawRow(cols.map(labelFor), true);
    for (const r of rows) drawRow(cols.map((c) => cell(r[c]).slice(0, 400)), false);
    this.y -= 8;
  }
  value(v: unknown, depth = 0) {
    if (v == null || v === '') {
      this.text('None.', { color: this.rgb(0.4, 0.4, 0.45), gap: 4, indent: depth * 12 });
      return;
    }
    if (typeof v === 'string') {
      for (const para of v.split(/\n{2,}/)) this.text(para.replace(/^#+\s*/gm, ''), { gap: 6, indent: depth * 12 });
      return;
    }
    if (typeof v === 'number' || typeof v === 'boolean') {
      this.text(String(v), { gap: 4, indent: depth * 12 });
      return;
    }
    if (Array.isArray(v)) {
      if (!v.length) {
        this.text('None.', { color: this.rgb(0.4, 0.4, 0.45), gap: 4, indent: depth * 12 });
        return;
      }
      if (v.every(isPlainObject)) {
        const objs = v as Record<string, unknown>[];
        // Rows carrying long narrative text render as stacked records rather than a table.
        const longText = objs.some((o) => Object.values(o).some((x) => typeof x === 'string' && x.length > 160));
        if (longText || depth > 0) {
          for (const o of objs) {
            const title = cell(o);
            this.text(title, { bold: true, indent: depth * 12, gap: 2 });
            this.value(o, depth + 1);
          }
        } else this.table(objs);
        return;
      }
      this.bullets(v, depth * 12);
      return;
    }
    if (isPlainObject(v)) {
      const o = v as Record<string, unknown>;
      if (Array.isArray(o.rows) || Array.isArray(o.items)) {
        if (typeof o.title === 'string') this.heading(o.title, 2);
        if (typeof o.text === 'string') this.value(o.text, depth);
        this.value((o.rows ?? o.items) as unknown[], depth);
        return;
      }
      for (const [k, val] of Object.entries(o)) {
        if (/^(id|.*_id|storage_path)$/i.test(k) && depth > 0) continue;
        if (val == null || val === '') continue;
        if (typeof val === 'object') {
          this.text(labelFor(k), { bold: true, indent: depth * 12, gap: 2 });
          this.value(val, depth + 1);
        } else {
          const label = labelFor(k) + ': ';
          this.text(label + cell(val), { indent: depth * 12, gap: 1 });
        }
      }
      this.y -= 4;
      return;
    }
    this.text(String(v), { gap: 4 });
  }
}

export async function renderPacketPdf(input: PacketRenderInput): Promise<PacketRenderOutput> {
  const { PDFDocument, StandardFonts, rgb, degrees } = input.pdfLib;
  const doc = await PDFDocument.create();
  doc.setProducer('CID Portal');
  doc.setCreator('CID Portal');
  doc.setTitle(sanitizePdfText(`Case Packet ${input.caseNumber}`));
  doc.setAuthor('');
  doc.setSubject('');
  doc.setKeywords([]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const w = new Writer(doc, font, bold, rgb);
  const snap = input.snapshot ?? {};

  // ---- Cover ----
  const cover = w.newPage();
  const band = sanitizePdfText(input.classification || 'UNCLASSIFIED').toUpperCase();
  const bandColor = /RESTRICTED|SECRET|SENSITIVE/.test(band) ? rgb(0.55, 0.1, 0.1) : rgb(0.2, 0.25, 0.35);
  cover.drawRectangle({ x: 0, y: PAGE_H - 40, width: PAGE_W, height: 40, color: bandColor });
  cover.drawText(band, { x: (PAGE_W - w.width(band, 14, true)) / 2, y: PAGE_H - 27, size: 14, font: bold, color: rgb(1, 1, 1) });
  cover.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: 40, color: bandColor });
  cover.drawText(band, { x: (PAGE_W - w.width(band, 14, true)) / 2, y: 13, size: 14, font: bold, color: rgb(1, 1, 1) });
  w.y = PAGE_H - 200;
  w.text('CASE PACKET', { size: 28, bold: true, gap: 10 });
  w.text(`Case ${input.caseNumber}`, { size: 18, bold: true, gap: 4 });
  w.text(input.caseTitle || '', { size: 13, gap: 24 });
  const type = String(input.packetType || 'custom');
  w.text(`Packet type: ${type.charAt(0).toUpperCase()}${type.slice(1)}`, { size: 11, gap: 2 });
  w.text(`Classification: ${band}`, { size: 11, gap: 2 });
  w.text(`Generated at: ${input.generatedAt}`, { size: 11, gap: 2 });
  w.text(`Generated by: ${input.generatedBy || 'CID Portal'}`, { size: 11, gap: 16 });
  const excluded = isPlainObject(snap.excluded) ? (snap.excluded as Record<string, unknown>) : null;
  if (excluded) {
    const parts: string[] = [];
    for (const [k, v] of Object.entries(excluded)) if (typeof v === 'number' && v > 0) parts.push(`${v} ${labelFor(k).toLowerCase()}`);
    if (parts.length) w.text(`Excluded from this packet (access rules applied at generation): ${parts.join(', ')}.`, { size: 9, color: rgb(0.4, 0.4, 0.45), gap: 8 });
  }
  w.text('This document was generated by the CID Portal from the case record as of the generation time above. Original evidence is immutable; integrity hashes are listed in the evidence index and in the accompanying manifest.json.', { size: 9, color: rgb(0.4, 0.4, 0.45) });

  // ---- Sections ----
  const order: string[] = Array.isArray(snap.sections)
    ? (snap.sections as unknown[]).map(String)
    : Object.keys(snap).filter((k) => !META_KEYS.has(k));
  // The snapshot stores the evidence list under `evidence` (case_packet_snapshot).
  const evidenceIndex = Array.isArray(snap.evidence) ? (snap.evidence as Record<string, unknown>[]) : Array.isArray(snap.evidence_index) ? (snap.evidence_index as Record<string, unknown>[]) : [];
  for (const key of order) {
    if (key === 'cover') continue;
    if (key === 'evidence_images') continue; // rendered after the text sections
    w.newPage();
    w.heading(labelFor(key), 1);
    if (key === 'evidence_index') {
      const rows = evidenceIndex.map((r) => ({
        evidence_number: r.evidence_number ?? '',
        title: r.title ?? r.original_filename ?? '',
        type: r.mime ?? r.type ?? '',
        size: typeof r.byte_size === 'number' ? `${Math.round((r.byte_size as number) / 1024)} KB` : '',
        sha256: typeof r.sha256 === 'string' ? (r.sha256 as string).slice(0, 16) + '…' : '',
        integrity: r.integrity_status ?? '',
      }));
      w.table(rows, ['evidence_number', 'title', 'type', 'size', 'sha256', 'integrity']);
      continue;
    }
    if (key === 'signatures') {
      const sigs = Array.isArray(snap.signatures) ? (snap.signatures as unknown[]) : [];
      if (!sigs.length) w.text('No signatures recorded.', { gap: 6 });
      for (const s of sigs) {
        const o = isPlainObject(s) ? s : { name: cell(s) };
        w.ensure(60);
        w.text(cell(o.name ?? o.label ?? o), { bold: true, gap: 2 });
        if (o.role) w.text(String(o.role), { gap: 2 });
        w.page.drawLine({ start: { x: MARGIN, y: w.y - 24 }, end: { x: MARGIN + 240, y: w.y - 24 }, thickness: 0.6 });
        w.y -= 30;
        w.text(`Signed: ${o.signed_at ? cell(o.signed_at) : '__________________'}`, { size: 9, gap: 14 });
      }
      continue;
    }
    w.value(snap[key]);
  }

  // ---- Evidence images ----
  if (order.includes('evidence_images')) {
    for (const img of input.images) {
      let embedded: any = null;
      try {
        if (/png/i.test(img.mime)) embedded = await doc.embedPng(img.bytes);
        else if (/jpe?g/i.test(img.mime)) embedded = await doc.embedJpg(img.bytes);
      } catch {
        embedded = null;
      }
      w.newPage();
      w.heading(labelFor('evidence_images'), 1);
      w.text(img.label, { bold: true, gap: 8 });
      if (!embedded) {
        w.text('Image could not be embedded (unsupported encoding).', { color: rgb(0.5, 0.2, 0.2) });
        continue;
      }
      const maxW = PAGE_W - 2 * MARGIN;
      const maxH = w.y - MARGIN - 30;
      const scale = Math.min(maxW / embedded.width, maxH / embedded.height, 1);
      const dw = embedded.width * scale;
      const dh = embedded.height * scale;
      w.page.drawImage(embedded, { x: MARGIN + (maxW - dw) / 2, y: w.y - dh, width: dw, height: dh });
      w.y -= dh + 8;
    }
    if (!input.images.length) {
      w.newPage();
      w.heading(labelFor('evidence_images'), 1);
      w.text('No embeddable images (jpg/png up to 8 MB) were included.', { gap: 6 });
    }
  }

  // ---- Page numbers + watermark ----
  const pages = doc.getPages();
  const total = pages.length;
  const mark = sanitizePdfText(input.watermark || 'LAW ENFORCEMENT SENSITIVE');
  for (const [i, p] of pages.entries()) {
    const label = `Page ${i + 1} of ${total}`;
    p.drawText(label, { x: PAGE_W - MARGIN - w.width(label, 8), y: i === 0 ? 46 : 28, size: 8, font, color: rgb(0.35, 0.35, 0.4) });
    const footer = sanitizePdfText(`Case ${input.caseNumber} - ${band}`);
    p.drawText(footer, { x: MARGIN, y: i === 0 ? 46 : 28, size: 8, font, color: rgb(0.35, 0.35, 0.4) });
    const size = Math.min(48, Math.max(20, 900 / Math.max(mark.length, 1)));
    const tw = w.width(mark, size, true);
    p.drawText(mark, {
      x: PAGE_W / 2 - (tw / 2) * Math.cos(Math.PI / 4) + 40,
      y: PAGE_H / 2 - (tw / 2) * Math.sin(Math.PI / 4),
      size,
      font: bold,
      color: rgb(0.7, 0.1, 0.1),
      opacity: 0.13,
      rotate: degrees(45),
    });
  }
  const bytes = await doc.save();
  return { bytes, pageCount: total };
}
