// crawl4ai — Crawl4AI docker API provider (CRAWL4AI_URL, optional
// CRAWL4AI_API_TOKEN → `Authorization: Bearer`).
//
// POST {CRAWL4AI_URL}/crawl  { urls:[url], browser_config:{...}, crawler_config:{...} }
//   → { success, results:[{ url, status_code, html, cleaned_html, markdown: string | {raw_markdown, fit_markdown}, metadata:{title, author, description, ...}, response_headers }] }
//
// SSRF posture is identical to the basic provider: urlStaticCheck + DNS
// (dns.promises.lookup all:true) BEFORE the URL is handed to Crawl4AI, and
// the final URL Crawl4AI reports is re-validated after the crawl. Crawl4AI
// itself must run on the compose-internal network with no route to the
// metadata endpoint (see docker-compose.yml). crawler_policy governs
// timeout, byte cap and domain lists.
import { urlStaticCheck } from '../urlPolicy.ts';
import type { CoreDeps } from '../jobCore.ts';
import { FetchRefused, assertHostResolvesPublic } from './basicFetch.ts';
import { extractHtml } from '../htmlText.ts';
import { env } from '../deps.ts';

export interface CrawlResult {
  final_url: string;
  http_status: number;
  html: string;
  cleaned_html: string | null;
  markdown: string;
  text: string;
  title: string | null;
  author: string | null;
  published_at: string | null;
  byte_size: number;
}

export function crawl4aiConfigured(): boolean {
  return !!env('CRAWL4AI_URL');
}

interface RawResult {
  url?: string;
  status_code?: number;
  html?: string;
  cleaned_html?: string;
  markdown?: string | { raw_markdown?: string; fit_markdown?: string; markdown_with_citations?: string };
  metadata?: Record<string, unknown>;
  success?: boolean;
  error_message?: string;
}

function pickMarkdown(m: RawResult['markdown']): string {
  if (!m) return '';
  if (typeof m === 'string') return m;
  return m.fit_markdown || m.raw_markdown || m.markdown_with_citations || '';
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

export async function crawl(deps: CoreDeps, url: string, policy: Record<string, unknown>): Promise<CrawlResult> {
  const base = (env('CRAWL4AI_URL') ?? '').replace(/\/$/, '');
  if (!base) throw new FetchRefused('crawl4ai_unconfigured', 'transient');
  const check = urlStaticCheck(url, policy as { allow_domains?: string[]; block_domains?: string[] });
  if (!check.ok || !check.canonical || !check.host) throw new FetchRefused(`policy:${check.code}`);
  await assertHostResolvesPublic(deps, check.host);
  const timeoutMs = Math.min(120_000, Math.max(5_000, Number(policy.timeout_ms) || 20_000));
  const maxBytes = Math.max(64 * 1024, Number(policy.max_bytes) || 5 * 1024 * 1024);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs + 15_000);
  let body: { success?: boolean; results?: RawResult[]; error?: string };
  try {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    const token = env('CRAWL4AI_API_TOKEN');
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await fetch(`${base}/crawl`, {
      method: 'POST',
      headers,
      signal: ctrl.signal,
      body: JSON.stringify({
        urls: [check.canonical],
        browser_config: { type: 'BrowserConfig', params: { headless: true, ignore_https_errors: false, java_script_enabled: true } },
        crawler_config: {
          type: 'CrawlerRunConfig',
          params: {
            page_timeout: timeoutMs,
            word_count_threshold: 5,
            remove_overlay_elements: true,
            excluded_tags: ['script', 'style', 'nav', 'noscript', 'footer', 'header', 'aside'],
            exclude_external_images: true,
            cache_mode: 'bypass',
            stream: false,
          },
        },
      }),
    });
    if (!res.ok) throw new FetchRefused(`crawl4ai_http_${res.status}`, res.status >= 500 ? 'transient' : 'permanent');
    body = (await res.json()) as typeof body;
  } catch (e) {
    if (e instanceof FetchRefused) throw e;
    throw new FetchRefused(ctrl.signal.aborted ? 'timeout' : 'crawl4ai_unreachable', 'transient');
  } finally {
    clearTimeout(t);
  }
  const r = body.results?.[0];
  if (!r || body.success === false || r.success === false) throw new FetchRefused(`crawl_failed:${(r?.error_message ?? body.error ?? 'unknown').slice(0, 60)}`);
  const status = Number(r.status_code ?? 200);
  if (status >= 400) throw new FetchRefused(`http_${status}`, status >= 500 ? 'transient' : 'permanent');
  const finalUrl = str(r.url) ?? check.canonical;
  const final = urlStaticCheck(finalUrl, policy as { allow_domains?: string[]; block_domains?: string[] });
  if (!final.ok || !final.host) throw new FetchRefused(`policy:${final.code}`);
  if (final.host !== check.host) await assertHostResolvesPublic(deps, final.host);
  const html = typeof r.html === 'string' ? r.html : '';
  const htmlBytes = Buffer.byteLength(html, 'utf8');
  if (htmlBytes > maxBytes) throw new FetchRefused('too_large');
  const ex = extractHtml(html);
  const meta = r.metadata ?? {};
  const markdown = pickMarkdown(r.markdown) || ex.markdown;
  return {
    final_url: final.canonical ?? finalUrl,
    http_status: status,
    html,
    cleaned_html: typeof r.cleaned_html === 'string' ? r.cleaned_html : null,
    markdown,
    text: ex.text || markdown.replace(/[#*_>`|-]+/g, ' ').replace(/\s+/g, ' ').trim(),
    title: str(meta.title) ?? ex.title,
    author: str(meta.author) ?? ex.author,
    published_at: ex.published_at ?? (str(meta.published_time) ? new Date(String(meta.published_time)).toISOString() : null),
    byte_size: htmlBytes,
  };
}

export async function health(): Promise<{ ok: boolean; latency_ms: number }> {
  const t = Date.now();
  try {
    const res = await fetch((env('CRAWL4AI_URL') ?? '').replace(/\/$/, '') + '/health', { signal: AbortSignal.timeout(5000) });
    return { ok: res.ok, latency_ms: Date.now() - t };
  } catch {
    return { ok: false, latency_ms: Date.now() - t };
  }
}
