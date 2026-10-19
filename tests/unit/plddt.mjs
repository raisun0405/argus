// services/alphafoldService.ts: a predicted model's confidence (pLDDT) is read on the file's own scale,
// 0-1 (ESMFold) or 0-100 (AlphaFold), decided once for the file. No network.
import '../lib/ts-hooks.mjs';
import { ROOT_URL } from '../lib/env.mjs';
const af = await import(`${ROOT_URL}services/alphafoldService.ts`);

let failures = 0;
const check = (name, ok, detail = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail !== '' ? ' — ' + detail : ''}`); if (!ok) failures++; };

// PDB atom lines with the score in columns 61-66, as AlphaFold and ESMFold write them
const atom = (n, resi, b) => `ATOM  ${String(n).padStart(5)}  CA  ALA A${String(resi).padStart(4)}    ${'1.000'.padStart(8)}${'2.000'.padStart(8)}${'3.000'.padStart(8)}  1.00${b.toFixed(2).padStart(6)}           C`;
const file = (scores) => scores.map((b, i) => atom(i + 1, i + 1, b)).join('\n');

const alphafold = file([92.5, 88.1, 0.8, 45.0, 71.3]); // One residue scored below 1 out of 100
const esmfold = file([0.93, 0.71, 0.42, 1.0]);

check('an AlphaFold file is out of 100, even with one score below 1', af.plddtIsFraction(alphafold) === false);
check('an ESMFold file is a fraction', af.plddtIsFraction(esmfold) === true);
check('a file with no atoms is not a fraction', af.plddtIsFraction('HEADER    EMPTY') === false);

const fraction = af.plddtIsFraction(alphafold);
check('the least certain AlphaFold residue (0.8) is "Very low", not "Very high"', af.plddtBand(0.8, fraction).label === 'Very low', af.plddtBand(0.8, fraction).label);
check('...judged on its own, as before, it read as 80, "Confident" (and 0.95 as "Very high")', af.plddtBand(0.8).label === 'Confident' && af.plddtBand(0.95).label === 'Very high');
check('...and its value stays 0.8, not 80', af.plddtValue(0.8, fraction) === 0.8);
check('ESMFold 0.93 reads as 93, "Very high"', af.plddtValue(0.93, true) === 93 && af.plddtBand(0.93, true).label === 'Very high');
check('ESMFold 0.42 reads as 42, "Very low"', Math.round(af.plddtValue(0.42, true)) === 42 && af.plddtBand(0.42, true).label === 'Very low');
check('AlphaFold 71.3 is "Confident"', af.plddtBand(71.3, false).label === 'Confident');

console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
process.exit(failures ? 1 : 0);
