// The app's identity check end to end (groundingService.checkIdentity: live records + the rule + the
// two signals) on fixed cases and on real AI answers collected from the app (JSONL files).
//   node tf-identity-real.mjs <project root> [answers.jsonl ...]
import '../lib/ts-hooks.mjs';
import { ROOT_URL } from '../lib/env.mjs';
import { readFileSync, existsSync } from 'node:fs';
const [ROOT, ...files] = process.argv.slice(2);
const { checkIdentity, loadIdentity } = await import(`${ROOT_URL}services/groundingService.ts`);
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== '' ? ' — ' + detail : ''}`); if (!ok) failures++; };

console.log('[fixed cases]');
const wrong = [
  ['2JDF', 'Human Insulin Hexamer', 'This X-ray structure (1.8 Å) shows human insulin assembled as a hexamer with coordinated zinc ions, providing insight into its storage form.'],
  ['AF-P04637-F1', 'Human insulin', 'The AlphaFold model of human insulin, the hormone that lowers blood sugar.'],
  ['4HHB', 'HIV-1 protease bound to indinavir', 'HIV-1 protease is the enzyme that cuts the viral polyprotein; here it holds the drug indinavir.'],
];
const right = [
  ['2JDF', 'Human gamma-B crystallin', 'A lens protein that keeps the eye lens transparent.'],
  ['4HHB', 'Human deoxyhemoglobin', 'Haemoglobin carries oxygen in red blood cells.'],
  ['4HHB', 'Human Deoxyhaemoglobin (T state)', ''],
  ['1TRZ', 'Human insulin hexamer', 'Insulin stored as a zinc-bound hexamer.'],
  ['1HSG', 'HIV-1 protease with indinavir', ''],
  ['AF-P04637-F1', 'Cellular tumor antigen p53', ''],
  ['AF-P04637-F1', 'p53 tumour suppressor (AlphaFold model)', ''],
  ['6VXX', 'SARS-CoV-2 spike glycoprotein, closed state', ''],
  ['3PTB', 'Trypsin with benzamidine', ''],
  ['1EMA', 'Green fluorescent protein (GFP)', ''],
  ['1EMA', 'GFP', ''],
  ['1M17', 'EGFR kinase domain with erlotinib', ''],
  ['5F9R', 'SpCas9-sgRNA-DNA Complex', ''],
  ['1D3Z', 'Ubiquitin', ''],
  ['2OCJ', 'p53 core domain', ''],
];
for (const [pdbId, title, summary] of wrong) {
  const p = await checkIdentity({ pdbId, title, summary, highlights: [], measurements: [] });
  check(`flagged: ${pdbId} called "${title}"`, !!p, p ?? 'not flagged');
}
for (const [pdbId, title, summary] of right) {
  const p = await checkIdentity({ pdbId, title, summary, highlights: [], measurements: [] });
  check(`left alone: ${pdbId} "${title}"`, !p, p ?? '');
}

for (const file of files.filter(f => existsSync(f))) {
  const rows = readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(r => r.status === 200 && r.pdbId && r.title);
  console.log(`\n[real answers: ${file.split(/[\\/]/).pop()}, ${rows.length}]`);
  let flagged = 0;
  for (const r of rows) {
    const p = await checkIdentity({ pdbId: r.pdbId, title: r.title, summary: r.summary ?? '', highlights: [], measurements: [] });
    const id = await loadIdentity(r.pdbId).catch(() => null);
    if (p) flagged++;
    console.log(`  ${p ? 'FLAG' : 'ok  '} ${r.pdbId} "${r.title}"  [entry: ${(id?.title ?? '?').slice(0, 90)}]`);
  }
  console.log(`  ${flagged} of ${rows.length} flagged`);
}

console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
process.exit(failures ? 1 : 0);
