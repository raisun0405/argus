// Runs a group of tests, one file at a time (browser tests must never run side by side: their browsers
// would collide), and prints one line per file. Full output: <temp folder>/argus-tests/logs/<group>/.
//
//   node tests/run.mjs unit             no network, no browser: seconds
//   node tests/run.mjs data             live public data (RCSB, PDBe, UniProt, ...), no AI calls
//   node tests/run.mjs browser          headless Chrome against the dev server (`npm run dev` first;
//                                       BASE=http://127.0.0.1:3100 for another address); AI answers scripted
//   node tests/run.mjs site <url>       a deployed site: headers, origins, the report endpoint, the bot check
//   node tests/run.mjs <group> <words>  only the files whose names contain one of the words
//
// A test file prints "PASS name" / "FAIL name" lines and exits non-zero when anything failed.
import { spawn } from 'node:child_process';
import { readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { ROOT, OUT, BASE } from './lib/env.mjs';

const GROUPS = ['unit', 'data', 'browser', 'site'];
const [group, ...rest] = process.argv.slice(2);
if (!GROUPS.includes(group)) {
  console.log(`Usage: node tests/run.mjs ${GROUPS.join('|')} [site url] [name words]`);
  process.exit(2);
}
const site = group === 'site' ? (rest[0]?.startsWith('http') ? rest.shift() : process.env.SITE) : null;
if (group === 'site' && !site) {
  console.log('The site tests need the deployed address: node tests/run.mjs site https://example.com');
  process.exit(2);
}
const words = rest;
if (group === 'browser') {
  const up = await fetch(`${BASE}/app`, { signal: AbortSignal.timeout(5000) }).then(r => r.ok, () => false);
  if (!up) {
    console.log(`The browser tests need the app running at ${BASE} (npm run dev, or set BASE).`);
    process.exit(2);
  }
}

const dir = `${ROOT}/tests/${group}`;
const files = readdirSync(dir).filter(f => f.endsWith('.mjs') && (!words.length || words.some(w => f.includes(w)))).sort();
mkdirSync(`${OUT}/logs/${group}`, { recursive: true });
let failed = 0;
const started = Date.now();
for (const file of files) {
  const t0 = Date.now();
  const output = await new Promise((resolve) => {
    let text = '';
    const child = spawn(process.execPath, [`${dir}/${file}`, ...(site ? [site] : [])], { cwd: ROOT, env: process.env });
    child.stdout.on('data', d => { text += d; });
    child.stderr.on('data', d => { text += d; });
    child.on('close', code => resolve({ text, code }));
  });
  writeFileSync(`${OUT}/logs/${group}/${file.replace(/\.mjs$/, '')}.txt`, output.text);
  const pass = (output.text.match(/^\s*PASS\b/gm) ?? []).length;
  const fail = (output.text.match(/^\s*FAIL\b/gm) ?? []).length;
  const ok = output.code === 0 && fail === 0;
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${file.padEnd(28)} ${String(pass).padStart(3)} passed${fail ? `, ${fail} failed` : ''}${output.code !== 0 && !fail ? ` (exit ${output.code})` : ''}  ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}
console.log(`\n${files.length - failed} of ${files.length} files passed (${((Date.now() - started) / 1000).toFixed(0)} s)${failed ? `; see ${OUT}/logs/${group}/` : ''}`);
process.exit(failed ? 1 : 0);
