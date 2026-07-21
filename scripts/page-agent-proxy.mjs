#!/usr/bin/env node
/**
 * Local proxy for the owner-only Portal Assistant (page-agent) → Anthropic.
 *
 * Why this exists:
 *  • page-agent runs in the BROWSER. Anthropic's API refuses direct browser
 *    calls (no CORS headers) and any NEXT_PUBLIC key would be exposed to every
 *    page viewer. This proxy solves both: it holds the real key server-side and
 *    adds the CORS headers the browser needs.
 *  • Anthropic ships an OpenAI-compatible endpoint (/v1/chat/completions), and
 *    page-agent speaks OpenAI — so this proxy is a thin pass-through: inject the
 *    Authorization header, add CORS, forward the (possibly streaming) response.
 *
 * Usage:
 *    ANTHROPIC_API_KEY=sk-ant-... node scripts/page-agent-proxy.mjs
 *    # optional: PORT=8787  UPSTREAM=https://api.anthropic.com
 *
 * Then in .env.local (already set up for you):
 *    NEXT_PUBLIC_PAGE_AGENT_BASE_URL=http://localhost:8787/v1
 *    NEXT_PUBLIC_PAGE_AGENT_API_KEY=proxy   # dummy — real key lives here, not the client
 *
 * The real key NEVER reaches the browser. Keep this terminal running while you
 * use the assistant; Ctrl-C to stop.
 */
import { createServer } from 'node:http'
import { Readable } from 'node:stream'

const PORT = Number(process.env.PORT || 8787)
const UPSTREAM = (process.env.UPSTREAM || 'https://api.anthropic.com').replace(/\/$/, '')
const KEY = process.env.ANTHROPIC_API_KEY || ''

if (!KEY) {
  console.error('✗ ANTHROPIC_API_KEY is not set. Start with:\n' +
    '    ANTHROPIC_API_KEY=sk-ant-... node scripts/page-agent-proxy.mjs')
  process.exit(1)
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'authorization,content-type,x-api-key,anthropic-version',
  'access-control-max-age': '86400',
}

const server = createServer(async (req, res) => {
  // Preflight — answer immediately with the CORS allowances.
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); res.end(); return }

  // Read the incoming body (OpenAI-shaped chat request from page-agent).
  const chunks = []
  for await (const c of req) chunks.push(c)
  const body = Buffer.concat(chunks)

  const url = UPSTREAM + req.url // e.g. /v1/chat/completions
  try {
    const upstream = await fetch(url, {
      method: req.method,
      headers: {
        // Anthropic's OpenAI-compat layer accepts the bearer key here. The
        // browser only ever sent us a dummy "proxy" token — we replace it.
        authorization: `Bearer ${KEY}`,
        'content-type': req.headers['content-type'] || 'application/json',
      },
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body,
    })

    // Mirror status + upstream content-type, then layer CORS on top.
    const headers = { ...CORS }
    const ct = upstream.headers.get('content-type')
    if (ct) headers['content-type'] = ct
    res.writeHead(upstream.status, headers)

    if (upstream.body) Readable.fromWeb(upstream.body).pipe(res)
    else res.end()
  } catch (e) {
    res.writeHead(502, { ...CORS, 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: { message: `proxy → upstream failed: ${e?.message || e}` } }))
  }
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`✦ page-agent proxy → ${UPSTREAM}`)
  console.log(`  listening on http://localhost:${PORT}  (point NEXT_PUBLIC_PAGE_AGENT_BASE_URL at http://localhost:${PORT}/v1)`)
  console.log('  key is held here, server-side — it is never sent to the browser. Ctrl-C to stop.')
})
