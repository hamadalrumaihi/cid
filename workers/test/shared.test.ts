import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isBlockedAddress, urlStaticCheck } from '../src/urlPolicy.ts';
import { extractHtml } from '../src/htmlText.ts';
import { chunkText } from '../src/chunk.ts';
import { canonicalJson } from '../src/manifest.ts';
import { meiliDocId, mediaIndexable } from '../src/jobCore.ts';

const root = resolve(__dirname, '..', '..');
const SHARED = ['urlPolicy', 'htmlText', 'manifest', 'chunk', 'packetPdf', 'jobCore'];

describe('shared modules stay byte-identical with the edge runner', () => {
  for (const name of SHARED) {
    it(name, () => {
      const a = readFileSync(resolve(root, 'supabase/functions/_shared', `${name}.ts`));
      const b = readFileSync(resolve(root, 'workers/src', `${name}.ts`));
      expect(Buffer.compare(a, b)).toBe(0);
    });
  }
  it('urlPolicy also matches src/lib/urlPolicy.ts', () => {
    const a = readFileSync(resolve(root, 'supabase/functions/_shared/urlPolicy.ts'));
    const c = readFileSync(resolve(root, 'src/lib/urlPolicy.ts'));
    expect(Buffer.compare(a, c)).toBe(0);
  });
});

describe('isBlockedAddress', () => {
  it.each(['127.0.0.1', '10.0.0.1', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '100.100.100.200', '0.0.0.0', '::1', '::', 'fc00::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:10.0.0.1', '64:ff9b::a00:1', '2002:7f00:1::', 'not-an-ip'])('blocks %s', (ip) => {
    expect(isBlockedAddress(ip)).toBe(true);
  });
  it.each(['8.8.8.8', '1.1.1.1', '172.32.0.1', '100.128.0.1', '2606:4700::1111', '::ffff:8.8.8.8'])('allows %s', (ip) => {
    expect(isBlockedAddress(ip)).toBe(false);
  });
});

describe('urlStaticCheck', () => {
  it('refuses schemes, userinfo, local hosts and IP literals', () => {
    expect(urlStaticCheck('ftp://example.com/', null).code).toBe('scheme');
    expect(urlStaticCheck('javascript:alert(1)', null).code).toBe('scheme');
    expect(urlStaticCheck('http://u:p@example.com/', null).code).toBe('userinfo');
    expect(urlStaticCheck('http://localhost/', null).code).toBe('host_blocked');
    expect(urlStaticCheck('http://box.local/', null).code).toBe('host_blocked');
    expect(urlStaticCheck('http://metadata.google.internal/', null).code).toBe('host_blocked');
    expect(urlStaticCheck('http://127.0.0.1/', null).code).toBe('ip_blocked');
    expect(urlStaticCheck('http://0x7f.1/', null).code).toBe('ip_blocked');
    expect(urlStaticCheck('http://[::1]/', null).code).toBe('ip_blocked');
    expect(urlStaticCheck('http://' + 'a'.repeat(2100) + '.com/', null).code).toBe('too_long');
  });
  it('applies block and allow lists and canonicalises', () => {
    expect(urlStaticCheck('https://sub.evil.com/x', { block_domains: ['evil.com'] }).code).toBe('domain_blocked');
    expect(urlStaticCheck('https://ok.example/x', { allow_domains: ['gov.example'] }).code).toBe('domain_not_allowed');
    const r = urlStaticCheck('HTTPS://Example.COM:443/a?b=1#frag', { allow_domains: ['example.com'] });
    expect(r.ok).toBe(true);
    expect(r.canonical).toBe('https://example.com/a?b=1');
  });
});

describe('extractHtml', () => {
  it('drops scripts/nav, keeps text, builds markdown', () => {
    const ex = extractHtml('<html><head><title>T &amp; U</title><meta name="author" content="A"></head><body><nav>skip</nav><script>x()</script><h1>H</h1><p>Body <a href="https://x.y/z">link</a></p><ul><li>a</li></ul></body></html>');
    expect(ex.title).toBe('T & U');
    expect(ex.author).toBe('A');
    expect(ex.text).not.toContain('skip');
    expect(ex.text).not.toContain('x()');
    expect(ex.markdown).toContain('# H');
    expect(ex.markdown).toContain('[link](https://x.y/z)');
    expect(ex.markdown).toContain('- a');
  });
});

describe('chunkText / canonicalJson / index helpers', () => {
  it('chunks with overlap', () => {
    const chunks = chunkText('word '.repeat(2000));
    expect(chunks.length).toBeGreaterThan(2);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(3200);
  });
  it('canonical json sorts keys', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{\n  "a": {\n    "c": 3,\n    "d": 2\n  },\n  "b": 1\n}\n');
  });
  it('meili ids contain only allowed characters', () => {
    expect(meiliDocId('document_page', '3f2b1c9e-0000-4000-8000-000000000000', 3)).toMatch(/^[A-Za-z0-9_-]+$/);
  });
  it('mediaIndexable excludes restricted and SIU cases', () => {
    expect(mediaIndexable({ restricted: true }, null)).toBe(false);
    expect(mediaIndexable({ restricted: false, case_id: 'c' }, { siu_classification: 'sib' })).toBe(false);
    expect(mediaIndexable({ restricted: false, case_id: 'c' }, { siu_classification: null })).toBe(true);
    expect(mediaIndexable({ restricted: false, person_id: 'p', case_id: 'c' }, null)).toBe(false);
  });
});
