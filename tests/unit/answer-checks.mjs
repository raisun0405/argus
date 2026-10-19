// The line under an answer (services/answerChecks.ts buildChecks): every state, worded from the
// checks' results. No network.
//   node tf-checks-unit.mjs <project root>
import '../lib/ts-hooks.mjs';
import { ROOT_URL } from '../lib/env.mjs';
const { buildChecks, retryOutcome } = await import(`${ROOT_URL}services/answerChecks.ts`);

let failures = 0;
const check = (name, ok, detail = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail !== '' ? ' — ' + detail : ''}`); if (!ok) failures++; };
const marks = (over = {}) => ({ problems: [], exists: true, residues: 0, ligands: 0, missing: 0, wrong: 0, unchecked: 0, named: 0, misnamed: 0, ...over });
const named = (name, status = 'match') => ({ status, problem: null, name, proteins: [] });
const unknown = { status: 'unavailable', problem: null, name: '', proteins: [] };
const show = c => JSON.stringify({ status: c.status, summary: c.summary, rows: c.rows.map(r => `${r.state}: ${r.text}`) }, null, 1);

{
  const c = buildChecks('4HHB', marks({ residues: 12, ligands: 4 }), named('The crystal structure of human deoxyhaemoglobin at 1.74 angstroms resolution'), {});
  check('passed: summary lists what was checked', c.status === 'passed' && c.summary === 'Checked against 4HHB: protein name, 12 residues, 4 ligands', show(c));
  check('...rows: protein, residues, ligands, all ticked', c.rows.length === 3 && c.rows.every(r => r.state === 'ok') && c.rows[1].text === '12 marked residues are in 4HHB' && c.rows[2].text === '4 marked ligands are in 4HHB', show(c));
  check('...sources named', c.source === 'Sources: RCSB, PDBe and UniProt');
}
{
  const c = buildChecks('2JDF', marks({ residues: 3 }), named('Human gamma-B crystallin'), { retry: { entry: '2JDF', title: 'Human Insulin Hexamer', missing: false, holds: 'Human gamma-B crystallin', problems: 0, outcome: 'kept' } });
  check('wrong protein fixed on the retry: "Fixed, then checked"', c.status === 'fixed' && c.summary === 'Fixed, then checked against 2JDF: protein name, 3 residues', show(c));
  check('...the fix says what the first answer got wrong', c.rows.some(r => r.state === 'fixed' && r.text === 'The first answer called 2JDF "Human Insulin Hexamer", but 2JDF is Human gamma-B crystallin, so it went back to the AI once with 2JDF\'s records'), show(c));
}
{
  const c = buildChecks('2JDF', marks({ residues: 3 }), named('Human gamma-B crystallin'), { retry: { entry: '2JDF', title: 'Human Insulin Hexamer', missing: false, holds: 'Human gamma-B crystallin', problems: 0, outcome: 'first' }, corrected: true });
  check('AI repeats the mistake: issues, "the answer describes another protein"', c.status === 'issues' && c.summary === 'Checked against 2JDF: the answer describes another protein', show(c));
  check('...rows: the heading was replaced, the retry was no better', c.rows[0].state === 'issue' && c.rows[0].text.includes('so its heading is now 2JDF\'s own title') && c.rows.some(r => r.state === 'skipped' && r.text.includes('the second answer was no better')), show(c));
}
{
  const c = buildChecks('1M17', marks({ residues: 5 }), named('Epidermal growth factor receptor tyrosine kinase domain with 4-anilinoquinazoline inhibitor erlotinib'), { local: { renumbered: 1, moved: 0, examples: ['UniProt Met793 = A:Met769'] } });
  check('UniProt numbering fixed in place', c.status === 'fixed' && c.summary === 'Fixed, then checked against 1M17: protein name, 5 residues' && c.rows.some(r => r.state === 'fixed' && r.text === '1 residue number in UniProt numbering changed to 1M17\'s own (UniProt Met793 = A:Met769)'), show(c));
}
{
  const c = buildChecks('1M17', marks({ residues: 5 }), named('EGFR'), { local: { renumbered: 2, moved: 1, examples: [] }, retry: { entry: '1M17', title: 'EGFR', missing: false, holds: '', problems: 2, outcome: 'kept' } });
  check('a kept retry replaces the first answer, so its in-place fixes are not claimed', !c.rows.some(r => /UniProt numbering|ligand mark/.test(r.text)) && c.rows.some(r => r.text === 'The first answer didn\'t match 1M17 in 2 places, so it went back to the AI once with 1M17\'s records'), show(c));
}
{
  const c = buildChecks('4HHB', marks({ residues: 11, missing: 1, problems: ['A:300 ("Asp300") is not in this file (chain A has residues 1-141)'] }), named('Hemoglobin'), {});
  check('a mark not in the file: issues, counted in the summary', c.status === 'issues' && c.summary === 'Checked against 4HHB: 1 of 12 marked parts doesn\'t match the entry', show(c));
  check('...and listed in the details', c.rows.some(r => r.state === 'issue' && r.text.startsWith('A:300 ("Asp300") is not in this file')), show(c));
}
{
  const problems = Array.from({ length: 8 }, (_, i) => `A:${500 + i} is not in this file (chain A has residues 1-141)`);
  const c = buildChecks('4HHB', marks({ residues: 2, missing: 10, problems }), named('Hemoglobin'), {});
  check('more problems than listed: "...and 2 more like these"', c.rows.at(-1).text === '...and 2 more like these' && c.summary === 'Checked against 4HHB: 10 of 12 marked parts don\'t match the entry', show(c));
}
{
  const c = buildChecks('9ZZZ', marks({ exists: false, problems: ['9ZZZ is not an existing PDB entry'] }), unknown, {});
  check('an entry that doesn\'t exist', c.status === 'issues' && c.summary === 'Checked against 9ZZZ: it isn\'t an existing PDB entry' && c.rows.length === 1 && c.rows[0].text === '9ZZZ is not an existing PDB entry', show(c));
}
{
  const c = buildChecks('ESM-3f2a91', null, unknown, {});
  check('a prediction made here: not checked, no details', c.status === 'unchecked' && c.summary === 'Not checked: predictions made here have no records to check against' && c.rows.length === 0, show(c));
}
{
  const c = buildChecks('4HHB', null, unknown, {});
  check('records didn\'t load: not checked', c.status === 'unchecked' && c.summary === 'Not checked: 4HHB\'s records didn\'t load in time' && c.rows.length === 0, show(c));
}
{
  const c = buildChecks('4HHB', null, named('Hemoglobin'), {});
  check('identity judged, residue list missing: says which part wasn\'t checked', c.status === 'passed' && c.summary === 'Checked against 4HHB: protein name' && c.rows.some(r => r.state === 'skipped' && r.text.startsWith('Marked parts not checked')), show(c));
}
{
  const c = buildChecks('AF-P69905-F1', marks({ residues: 2 }), named('Hemoglobin subunit alpha'), {});
  check('AlphaFold model: "in the model", source UniProt', c.summary === 'Checked against AF-P69905-F1: protein name, 2 residues' && c.rows[1].text === '2 marked residues are in the model' && c.source === 'Source: UniProt', show(c));
}
{
  const c = buildChecks('4HHB', marks(), named('Hemoglobin', 'unjudged'), {});
  check('nothing named, nothing marked: "the entry exists"', c.status === 'passed' && c.summary === 'Checked against 4HHB: the entry exists' && c.rows[0].state === 'skipped', show(c));
}
{
  const long = 'Crystal structure of a very long named complex '.repeat(6).trim();
  const c = buildChecks('1ABC', marks({ residues: 1 }), named(long), {});
  check('a long entry title is cut at a word', c.rows[0].text.endsWith('…') && c.rows[0].text.length < 120 && c.summary === 'Checked against 1ABC: protein name, 1 residue', show(c));
}
{
  const c = buildChecks('4HHB', marks({ residues: 3, wrong: 1, problems: ['A:87 is His in this file, not Asp as labelled ("Asp87")'] }), named('Hemoglobin'), { retry: { entry: '4HHB', title: 'Hemoglobin', missing: false, holds: '', problems: 1, outcome: 'failed' } });
  check('retry request failed: said so, issue stays', c.status === 'issues' && c.rows.some(r => r.state === 'skipped' && r.text === 'The first answer didn\'t match 4HHB in 1 place. It went back to the AI once, but that request failed, so this is the first answer'), show(c));
}
{
  const c = buildChecks('4INS', marks({ residues: 4 }), named('The structure of 2Zn pig insulin crystals at 1.5 A resolution'), { retry: { entry: '2JDF', title: 'Human Insulin Hexamer', missing: false, holds: 'Human gamma-B crystallin', problems: 0, outcome: 'kept' } });
  check('the AI chose another entry on the retry', c.status === 'fixed' && c.rows.some(r => r.text.endsWith(', so it went back to the AI once, which chose 4INS instead')), show(c));
}
{
  const c = buildChecks('XYZ12', marks({ exists: false, problems: ['"XYZ12" is not a valid PDB ID (PDB IDs are 4 characters, e.g. a digit and three letters or digits)'] }), unknown, {});
  check('an invalid ID', c.summary === 'Checked against XYZ12: it isn\'t a valid PDB ID', show(c));
}
{
  const c = buildChecks('4HHB', marks({ residues: 4, named: 4 }), named('Hemoglobin'), {});
  check('amino acids named in the text, all right: counted in the line', c.status === 'passed' && c.summary === 'Checked against 4HHB: protein name, 4 residues, 4 amino acids' && c.rows.some(r => r.text === '4 amino acids named in the answer are that amino acid in 4HHB'), show(c));
}
{
  const problems = ['the answer\'s text says Ile124, but residue 124 is His in this file', 'the answer\'s text says Lys135, but residue 135 is Val in this file', 'the answer\'s text says Lys141, but residue 141 is Gly in this file'];
  const c = buildChecks('4LDB', marks({ residues: 5, named: 2, misnamed: 3, problems }), named('An entry title'), {});
  check('3 of 5 named wrong: counted in the line, marked parts not blamed', c.status === 'issues' && c.summary === 'Checked against 4LDB: 3 of 5 amino acids it names don\'t match the entry', show(c));
  check('...each one listed, and the 5 marked places still shown as present', c.rows.filter(r => r.state === 'issue').length === 3 && c.rows.some(r => r.text === '5 marked residues are in 4LDB'), show(c));
}
{
  const c = buildChecks('4HHB', marks({ residues: 1, missing: 1, named: 0, misnamed: 1, problems: ['A:300 is not in this file (chain A has residues 1-141)', 'the answer\'s text says Asp58, but residue 58 is His in this file'] }), named('Hemoglobin'), {});
  check('both kinds wrong: both counted', c.summary === 'Checked against 4HHB: 1 of 2 marked parts and 1 of 1 amino acid it names don\'t match the entry', show(c));
}
{
  const c = buildChecks('4HHB', marks({ residues: 1, named: 1, misnamed: 1, problems: ['the answer\'s text says Asp58, but residue 58 is His in this file'] }), named('Hemoglobin'), {});
  check('one named wrong: singular verb', c.summary === 'Checked against 4HHB: 1 of 2 amino acids it names doesn\'t match the entry', show(c));
}
{
  // The second answer replaced a wrong-protein first one, but its parts couldn't be checked: no "Fixed"
  const c = buildChecks('2ITY', null, named('An entry title'), { retry: { entry: '1M17', title: 'Insulin', missing: false, holds: 'EGFR kinase', problems: 0, outcome: 'kept' } });
  check('kept but unchecked: no "Fixed, then checked", only what was checked', c.status === 'passed' && c.summary === 'Checked against 2ITY: protein name', show(c));
  check('...the retry row is not a fix, and the parts say they weren\'t checked', c.rows.some(r => r.state === 'skipped' && r.text.startsWith('The first answer called 1M17') && r.text.endsWith('which chose 2ITY instead')) && c.rows.some(r => r.state === 'skipped' && r.text.startsWith('Marked parts not checked')) && !c.rows.some(r => r.state === 'fixed'), show(c));
}
{
  const c = buildChecks('4HHB', marks({ residues: 1, missing: 1, problems: ['A:300 is not in this file (chain A has residues 1-141)'] }), named('Hemoglobin'), { retry: { entry: '4HHB', title: 'Hemoglobin', missing: false, holds: '', problems: 1, outcome: 'unverified' } });
  check('second answer couldn\'t be checked: the first stands, and the row says why', c.status === 'issues' && c.rows.some(r => r.state === 'skipped' && r.text === "The first answer didn't match 4HHB in 1 place. It went back to the AI once, but the second answer couldn't be checked, so this is the first answer"), show(c));
}

console.log('== The first answer or its retry (retryOutcome)');
{
  const right = (faults) => ({ wrongEntry: false, faults });
  const wrong = (faults) => ({ wrongEntry: true, faults });
  const cases = [
    // A retry about another protein never beats one about the right protein (P15: 3 + wrong protein beat 5)
    ['right protein, 5 faults vs another protein, 3 faults', right(5), wrong(3), 'first'],
    ['another protein, 0 faults vs the right protein, 9 faults', wrong(0), right(9), 'kept'],
    ['both right: fewer faults wins', right(5), right(3), 'kept'],
    // All the faults count, not the eight the model is shown (P14: 20 fixed to 10 looked like 8 vs 8)
    ['both right: 20 faults vs 10', right(20), right(10), 'kept'],
    ['a tie keeps the first', right(4), right(4), 'first'],
    ['both about another protein: fewer faults wins', wrong(6), wrong(2), 'kept'],
    ['retry unchecked, first about another protein: the retry', wrong(0), { wrongEntry: false, faults: null }, 'kept'],
    ['retry unchecked, first right: the first, its faults shown', right(3), { wrongEntry: false, faults: null }, 'unverified'],
    ['retry unchecked and about another protein: the first', wrong(0), { wrongEntry: true, faults: null }, 'first'],
  ];
  for (const [name, first, retry, want] of cases) check(`${name} -> ${want}`, retryOutcome(first, retry) === want, retryOutcome(first, retry));
}
console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
process.exit(failures ? 1 : 0);
