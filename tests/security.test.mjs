// Security regression tests for Reloadly Pulse. Zero dependencies: `npm test`.
// These guard the hardening done on feature/security-hardening-csp-xss.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const lines = html.split('\n');

test('every inline <script> parses (catches broken edits)', () => {
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
  let m, n = 0;
  while ((m = re.exec(html))) { new vm.Script(m[1], { filename: `inline-script-${++n}` }); }
  assert.ok(n > 0);
});

test('every external <script src> has Subresource Integrity', () => {
  const tags = [...html.matchAll(/<script[^>]*\bsrc="(https?:[^"]+)"[^>]*>/g)];
  // Cloudflare Turnstile must load from Cloudflare unpinned; everything else is pinned.
  for (const [tag, src] of tags) {
    if (src.startsWith('https://challenges.cloudflare.com/')) continue;
    assert.match(tag, /integrity="sha384-/, `missing integrity: ${src}`);
    assert.match(tag, /crossorigin="anonymous"/, `missing crossorigin: ${src}`);
  }
});

test('dynamically loaded libraries have an SRI hash registered', () => {
  const sri = html.match(/window\._PULSE_SRI=(\{[^;]+\});/);
  assert.ok(sri, '_PULSE_SRI map missing');
  const urls = new Set([...html.matchAll(/loadLib\('(https:[^']+)'/g)].map(m => m[1]));
  for (const u of urls) assert.ok(sri[1].includes(u), `no SRI hash for dynamic script ${u}`);
});

test('no new unescaped free-text interpolation into HTML (ratchet)', () => {
  // Free text (names, titles, comments, feedback) must go through esc() before
  // being concatenated into an HTML string. Static labels are allow-listed.
  const F = '(?:name|title|text|notes?|comment|desc|description|body|message|label|summary|role|assignee|owner|reason|highlight|headline|content|feedback|subject|question|answer|detail)';
  const pat = new RegExp(`\\+\\s*([A-Za-z_$][\\w$]*(?:\\.[\\w$]+|\\[[^\\]]{1,30}\\])*\\.${F})\\s*(?=\\+|\\))`, 'g');
  const allow = new Set(['m.label', 's.title']); // static strings, reviewed
  const bad = [];
  lines.forEach((l, i) => {
    if (!/innerHTML|html\+=|h\+=|insertAdjacentHTML/.test(l)) return;
    for (const m of l.matchAll(pat)) {
      if (l.slice(Math.max(0, m.index - 14), m.index).includes('esc(')) continue;
      if (allow.has(m[1])) continue;
      bad.push(`line ${i + 1}: ${m[1]}`);
    }
  });
  assert.deepEqual(bad, [], 'wrap these in esc(): \n' + bad.join('\n'));
});

test('no secrets or tokens committed in index.html', () => {
  assert.doesNotMatch(html, /xox[bp]-[0-9A-Za-z-]{10,}/, 'Slack token');
  assert.doesNotMatch(html, /hooks\.slack\.com\/services\//, 'Slack webhook');
  assert.doesNotMatch(html, /AKIA[0-9A-Z]{16}/, 'AWS key');
  assert.doesNotMatch(html, /sk-[A-Za-z0-9]{32,}/, 'API key');
  assert.doesNotMatch(html, /-----BEGIN [A-Z ]*PRIVATE KEY-----/);
});

test('sensitive people data files are not tracked', async () => {
  const { execSync } = await import('node:child_process');
  const files = execSync('git ls-files', { cwd: new URL('..', import.meta.url) }).toString();
  assert.doesNotMatch(files, /_import\.json|funding-proxy\/|\.bak/);
});
