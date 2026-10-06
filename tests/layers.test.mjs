// AC-7: domain and application never import adapters or ui; domain imports only domain.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('../src/', import.meta.url).pathname;
const importsOf = (dir) => readdirSync(join(root, dir)).filter((f) => f.endsWith('.js')).flatMap((f) => {
  const src = readFileSync(join(root, dir, f), 'utf8');
  return [...src.matchAll(/(?:import|export)[^'"]*from\s*['"]([^'"]+)['"]/g)].map((m) => ({ file: `${dir}/${f}`, spec: m[1] }));
});

test('domain imports nothing outside domain, and no I/O globals', () => {
  for (const { file, spec } of importsOf('domain')) assert.ok(spec.startsWith('./'), `${file} imports ${spec}`);
  for (const f of readdirSync(join(root, 'domain'))) {
    const src = readFileSync(join(root, 'domain', f), 'utf8');
    assert.ok(!/\bfetch\(|localStorage|document\.|window\./.test(src), `${f} touches I/O`);
  }
});

test('application imports only domain or itself', () => {
  for (const { file, spec } of importsOf('application')) {
    assert.ok(spec.startsWith('./') || spec.startsWith('../domain/'), `${file} imports ${spec}`);
  }
});
