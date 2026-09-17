/** The proxy is the server-side enforcement of the portal mode: it must hold
 *  for every route, not only the ones the client knows about, and it must
 *  say the mode and nothing more. */
import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it } from 'vitest'
import { config, proxy } from './proxy'

const saved = process.env.PORTAL_MODE
afterEach(() => {
  if (saved === undefined) delete process.env.PORTAL_MODE
  else process.env.PORTAL_MODE = saved
})

const req = (path: string, init?: { method?: string; headers?: Record<string, string> }) =>
  new NextRequest(new URL(path, 'https://cid.example.test'), init)

const PROTECTED = ['/', '/inbox', '/cases', '/owner', '/guides', '/guides/cid-standard-operating-procedure', '/m/cases/abc', '/workspace', '/no-such-route']

describe.each(['retired', 'maintenance'] as const)('PORTAL_MODE=%s', (mode) => {
  it('rewrites every page route to /unavailable with a 503 — there is no direct route past it', () => {
    process.env.PORTAL_MODE = mode
    for (const path of PROTECTED) {
      const res = proxy(req(path))
      expect(res.status, path).toBe(503)
      expect(res.headers.get('x-middleware-rewrite'), path).toBe('https://cid.example.test/unavailable')
      expect(res.headers.get('x-portal-mode'), path).toBe(mode)
      expect(res.headers.get('cache-control'), path).toBe('no-store')
      expect(res.headers.get('retry-after'), path).toBe('3600')
      expect(res.cookies.get('cid-portal-mode')?.value, path).toBe(mode)
    }
  })

  it('serves /unavailable itself as a 503, not a redirect loop', () => {
    process.env.PORTAL_MODE = mode
    const res = proxy(req('/unavailable'))
    expect(res.status).toBe(503)
    expect(res.headers.get('x-middleware-rewrite')).toBeNull()
    expect(res.headers.get('x-middleware-next')).toBe('1')
  })

  it('answers API paths and server actions with a JSON refusal that names the mode only', async () => {
    process.env.PORTAL_MODE = mode
    for (const r of [
      req('/api/anything', { method: 'POST' }),
      req('/api/health'),
      req('/inbox', { method: 'POST', headers: { 'next-action': 'abc123' } }),
      req('/cases', { headers: { accept: 'application/json' } }),
    ]) {
      const res = proxy(r)
      expect(res.status).toBe(503)
      expect(res.headers.get('content-type')).toContain('application/json')
      const body = await res.json()
      expect(body).toEqual({ ok: false, code: `portal_${mode}`, message: expect.any(String) })
      expect(JSON.stringify(body)).not.toMatch(/PORTAL_MODE|env|supabase|stack/i)
    }
  })

  it('does not treat a browser navigation as JSON (browsers accept html first)', () => {
    process.env.PORTAL_MODE = mode
    const res = proxy(req('/inbox', { headers: { accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' } }))
    expect(res.headers.get('x-middleware-rewrite')).toBe('https://cid.example.test/unavailable')
  })
})

describe.each(['normal', 'readonly'] as const)('PORTAL_MODE=%s', (mode) => {
  it('lets every route through and tells the browser the mode', () => {
    process.env.PORTAL_MODE = mode
    for (const path of [...PROTECTED, '/api/anything']) {
      const res = proxy(req(path))
      expect(res.status, path).toBe(200)
      expect(res.headers.get('x-middleware-next'), path).toBe('1')
      expect(res.headers.get('x-middleware-rewrite'), path).toBeNull()
      expect(res.headers.get('x-portal-mode'), path).toBe(mode)
      expect(res.cookies.get('cid-portal-mode')?.value, path).toBe(mode)
    }
  })
})

it('an unset or misspelt PORTAL_MODE is normal', () => {
  delete process.env.PORTAL_MODE
  expect(proxy(req('/inbox')).headers.get('x-portal-mode')).toBe('normal')
  process.env.PORTAL_MODE = 'retire'
  expect(proxy(req('/inbox')).status).toBe(200)
})

it('the matcher spares only the build output and the files the notice needs', () => {
  const [pattern] = config.matcher
  const re = new RegExp(`^${pattern}$`)
  for (const p of ['/', '/inbox', '/api/x', '/guides/x', '/unavailable', '/m/cases/1']) expect(re.test(p), p).toBe(true)
  for (const p of ['/_next/static/chunks/main.js', '/_next/image?url=x', '/icon.svg', '/favicon.ico', '/manifest.webmanifest', '/map/tiles/1.png']) {
    expect(re.test(p), p).toBe(false)
  }
})
