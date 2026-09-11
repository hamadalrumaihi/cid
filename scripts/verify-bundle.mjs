#!/usr/bin/env node
// verify-bundle — offline Evidence Seal verifier.
//
//   node scripts/verify-bundle.mjs <dir-or-zip>
//
// Reads manifest.json + manifest.sha256 from an unzipped bundle directory (or
// from a .zip, extracted to a temp dir with the system `unzip` when it is
// available — no npm dependency is needed at the repo root), hashes every
// listed file with SHA-256 and prints one line per file:
//   VERIFIED / MODIFIED FILE / MISSING FILE / UNEXPECTED FILE / HASH MISMATCH
// plus a final status. Exit code 0 only when everything is VERIFIED.
//
// "MODIFIED FILE" = size differs from the manifest; "HASH MISMATCH" = same
// size, different content; "UNEXPECTED FILE" = present on disk but absent
// from the manifest (manifest.json / manifest.sha256 themselves are exempt).
// The manifest's own hash (manifest.sha256) is checked first: a bundle whose
// manifest was edited fails before any file is inspected.
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const arg = process.argv[2];
if (!arg) {
  console.error('usage: node scripts/verify-bundle.mjs <dir-or-zip>');
  process.exit(2);
}

async function sha256(file) {
  const h = createHash('sha256');
  h.update(await fs.readFile(file));
  return h.digest('hex');
}

async function walk(dir, base = dir, out = []) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(p, base, out);
    else out.push(path.relative(base, p).split(path.sep).join('/'));
  }
  return out;
}

async function prepare(input) {
  const stat = await fs.stat(input);
  if (stat.isDirectory()) return { dir: input, cleanup: null };
  if (!/\.zip$/i.test(input)) throw new Error('input must be a directory or a .zip file');
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cid-bundle-'));
  const unzip = spawnSync('unzip', ['-o', '-q', input, '-d', tmp], { stdio: 'inherit' });
  if (unzip.error || unzip.status !== 0) {
    await fs.rm(tmp, { recursive: true, force: true });
    throw new Error('could not extract the zip: install `unzip` or extract it manually and pass the directory');
  }
  return { dir: tmp, cleanup: () => fs.rm(tmp, { recursive: true, force: true }) };
}

function statusLine(status, file, extra = '') {
  console.log(`${status.padEnd(16)} ${file}${extra ? '  ' + extra : ''}`);
}

async function main() {
  const { dir, cleanup } = await prepare(path.resolve(arg));
  let ok = true;
  try {
    const manifestPath = path.join(dir, 'manifest.json');
    const shaPath = path.join(dir, 'manifest.sha256');
    let manifestBytes;
    try {
      manifestBytes = await fs.readFile(manifestPath);
    } catch {
      statusLine('MISSING FILE', 'manifest.json');
      console.log('\nSTATUS: FAILED (no manifest)');
      process.exit(1);
    }
    const actualManifestSha = createHash('sha256').update(manifestBytes).digest('hex');
    let expectedManifestSha = null;
    try {
      expectedManifestSha = (await fs.readFile(shaPath, 'utf8')).trim().split(/\s+/)[0].toLowerCase();
    } catch {
      statusLine('MISSING FILE', 'manifest.sha256');
      ok = false;
    }
    if (expectedManifestSha) {
      if (expectedManifestSha === actualManifestSha) statusLine('VERIFIED', 'manifest.json', `sha256 ${actualManifestSha.slice(0, 16)}…`);
      else {
        statusLine('HASH MISMATCH', 'manifest.json', 'manifest.sha256 does not match manifest.json');
        ok = false;
      }
    }
    let manifest;
    try {
      manifest = JSON.parse(manifestBytes.toString('utf8'));
    } catch {
      console.log('\nSTATUS: FAILED (manifest.json is not valid JSON)');
      process.exit(1);
    }
    const files = Array.isArray(manifest.files) ? manifest.files : [];
    const listed = new Set();
    for (const f of files) {
      const rel = String(f.path ?? '');
      listed.add(rel);
      const abs = path.join(dir, ...rel.split('/'));
      let st;
      try {
        st = await fs.stat(abs);
      } catch {
        statusLine('MISSING FILE', rel);
        ok = false;
        continue;
      }
      if (typeof f.size === 'number' && st.size !== f.size) {
        statusLine('MODIFIED FILE', rel, `size ${st.size} != ${f.size}`);
        ok = false;
        continue;
      }
      const actual = await sha256(abs);
      const expected = String(f.sha256 ?? '').toLowerCase();
      if (actual === expected) statusLine('VERIFIED', rel);
      else {
        statusLine('HASH MISMATCH', rel);
        ok = false;
      }
    }
    for (const rel of await walk(dir)) {
      if (rel === 'manifest.json' || rel === 'manifest.sha256') continue;
      if (!listed.has(rel)) {
        statusLine('UNEXPECTED FILE', rel);
        ok = false;
      }
    }
    console.log('');
    console.log(`bundle ${manifest.bundle_id ?? '?'} (${manifest.kind ?? '?'}) case ${manifest.case_number ?? manifest.case_id ?? '?'} generated ${manifest.generated_at ?? '?'}`);
    console.log(`files listed: ${files.length}`);
    console.log(`STATUS: ${ok ? 'VERIFIED' : 'FAILED'}`);
  } finally {
    if (cleanup) await cleanup();
  }
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(String(e?.message ?? e));
  process.exit(2);
});
