// services/quiz.ts + the quiz part of services/normalizeAnalysis.ts: shuffled order, several right answers, marking.
import '../lib/ts-hooks.mjs';
import { ROOT_URL } from '../lib/env.mjs';
const Q = await import(`${ROOT_URL}services/quiz.ts`);
const N = await import(`${ROOT_URL}services/normalizeAnalysis.ts`);

let failures = 0;
const check = (name, ok, detail = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== '' ? ' — ' + detail : ''}`); if (!ok) failures++; };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const answer = (quiz) => N.normalizeAnalysis({ pdbId: '1TRZ', title: 'Insulin', summary: 's', highlights: [], quiz });
const quizOf = (quiz) => answer(quiz)?.quiz ?? null;
const base = { question: 'Which residue is catalytic?', options: ['Asp25', 'Ile50', 'Gly27', 'Lys45'], explanation: 'Because.' };

console.log('\n[1] normalizeAnalysis: one right answer');
let q = quizOf({ ...base, correctAnswerIndex: 2 });
check('kept with its index', q?.correctAnswerIndex === 2, JSON.stringify(q));
check('no correctAnswerIndices for a single answer', q && !('correctAnswerIndices' in q));
q = quizOf({ ...base, correctAnswerIndex: '3' });
check('"3" read as 3', q?.correctAnswerIndex === 3);
check('out-of-range index -> no quiz', quizOf({ ...base, correctAnswerIndex: 4 }) === null);
check('missing index -> no quiz', quizOf({ ...base }) === null);
check('one option -> no quiz', quizOf({ ...base, options: ['Asp25'], correctAnswerIndex: 0 }) === null);

console.log('\n[2] normalizeAnalysis: several right answers');
q = quizOf({ ...base, question: 'Which residues are in the dimer interface?', correctAnswerIndex: 1, correctAnswerIndices: [3, 1] });
check('indices sorted, first one is correctAnswerIndex', same(q?.correctAnswerIndices, [1, 3]) && q?.correctAnswerIndex === 1, JSON.stringify(q));
q = quizOf({ ...base, correctAnswerIndex: 0, correctAnswerIndices: ['2', 2, 0, 1.5, 'x', null] });
check('strings read, duplicates and junk dropped', same(q?.correctAnswerIndices, [0, 2]));
q = quizOf({ ...base, correctAnswerIndex: 0, correctAnswerIndices: [2] });
check('a single index in the list -> one right answer', q?.correctAnswerIndex === 2 && !('correctAnswerIndices' in q));
q = quizOf({ ...base, correctAnswerIndex: 1, correctAnswerIndices: [] });
check('empty list -> falls back to correctAnswerIndex', q?.correctAnswerIndex === 1 && !('correctAnswerIndices' in q));
check('every option right -> no quiz', quizOf({ ...base, correctAnswerIndex: 0, correctAnswerIndices: [0, 1, 2, 3] }) === null);
check('only out-of-range indices -> no quiz', quizOf({ ...base, correctAnswerIndex: 0, correctAnswerIndices: [5, 9] }) === null);
q = quizOf({ ...base, correctAnswerIndex: 0, correctAnswerIndices: [0, 7] });
check('one in range of two -> one right answer', q?.correctAnswerIndex === 0 && !('correctAnswerIndices' in q));

console.log('\n[3] normalizeAnalysis: empty options are dropped and the right answers follow them');
q = quizOf({ ...base, options: ['Asp25', '', 'Gly27', 'Lys45'], correctAnswerIndex: 2 });
check('index 2 -> 1 after an empty option is dropped', same(q?.options, ['Asp25', 'Gly27', 'Lys45']) && q?.correctAnswerIndex === 1, JSON.stringify(q));
check('right answer was the empty option -> no quiz', quizOf({ ...base, options: ['Asp25', '  ', 'Gly27'], correctAnswerIndex: 1 }) === null);
q = quizOf({ ...base, options: ['', 'Ile50', 'Gly27', '', 'Lys45'], correctAnswerIndex: 1, correctAnswerIndices: [1, 3, 4] });
check('several: an empty right option is dropped, the rest follow', same(q?.options, ['Ile50', 'Gly27', 'Lys45']) && same(q?.correctAnswerIndices, [0, 2]), JSON.stringify(q));
q = quizOf({ ...base, options: [42, 'Ile50', 'Gly27'], correctAnswerIndex: 2 });
check('non-text options are dropped too', same(q?.options, ['Ile50', 'Gly27']) && q?.correctAnswerIndex === 1);

console.log('\n[3b] normalizeAnalysis: "A) ", "B) "... labels are dropped, since the card shuffles the options');
const labelled = (options) => quizOf({ ...base, options, correctAnswerIndex: 1 })?.options;
check('A) B) C) D)', same(labelled(['A) Cys A6–Cys A11', 'B) Cys A7–Cys B7', 'C) Cys A20–Cys B19', 'D) Cys B7–Cys B19']), ['Cys A6–Cys A11', 'Cys A7–Cys B7', 'Cys A20–Cys B19', 'Cys B7–Cys B19']));
check('a. b. c. d.', same(labelled(['a. Asp25', 'b. Ile50', 'c. Gly27', 'd. Lys45']), ['Asp25', 'Ile50', 'Gly27', 'Lys45']));
check('(A) (B) (C)', same(labelled(['(A) Asp25', '(B) Ile50', '(C) Gly27']), ['Asp25', 'Ile50', 'Gly27']));
check('1. 2. 3. 4.', same(labelled(['1. Asp25', '2) Ile50', '3: Gly27', '4. Lys45']), ['Asp25', 'Ile50', 'Gly27', 'Lys45']));
check('labels follow an empty option that was dropped', same(quizOf({ ...base, options: ['A) Asp25', '', 'C) Gly27', 'D) Lys45'], correctAnswerIndex: 0 })?.options, ['Asp25', 'Gly27', 'Lys45']));
check('out of sequence -> kept', same(labelled(['B) Asp25', 'A) Ile50', 'C) Gly27']), ['B) Asp25', 'A) Ile50', 'C) Gly27']));
check('only some labelled -> kept', same(labelled(['A) Asp25', 'Ile50', 'C) Gly27']), ['A) Asp25', 'Ile50', 'C) Gly27']));
check('no space after the label -> kept', same(labelled(['A)Asp25', 'B)Ile50']), ['A)Asp25', 'B)Ile50']));
check('ordinary options -> kept', same(labelled(['A7–B7', 'A20–B19', 'B7–B19']), ['A7–B7', 'A20–B19', 'B7–B19']));
check('"2.5 Å"-style numbers -> kept', same(labelled(['1.5 Å', '2.5 Å', '3.5 Å']), ['1.5 Å', '2.5 Å', '3.5 Å']));

console.log('\n[4] normalizeAnalysis: a second pass changes nothing (cached answers are normalized again)');
for (const raw of [
  { ...base, options: ['A) Asp25', 'B) Ile50', 'C) Gly27', 'D) Lys45'], correctAnswerIndex: 1 },
  { ...base, correctAnswerIndex: 2 },
  { ...base, correctAnswerIndex: 1, correctAnswerIndices: [3, 1] },
  { ...base, options: ['', 'Ile50', 'Gly27', '', 'Lys45'], correctAnswerIndex: 1, correctAnswerIndices: [1, 3, 4] },
]) {
  const once = answer(raw);
  check(`idempotent: ${JSON.stringify(raw.correctAnswerIndices ?? raw.correctAnswerIndex)}`, same(N.normalizeAnalysis(once), once));
}

console.log('\n[5] rightAnswers / markQuiz');
check('rightAnswers single', same(Q.rightAnswers({ ...base, correctAnswerIndex: 2 }), [2]));
check('rightAnswers several', same(Q.rightAnswers({ ...base, correctAnswerIndex: 1, correctAnswerIndices: [1, 3] }), [1, 3]));
const marks = [
  [[2], [2], 'correct'], [[2], [0], 'wrong'],
  [[1, 3], [1, 3], 'correct'], [[1, 3], [3, 1], 'correct'],
  [[1, 3], [1], 'partly'], [[1, 3], [1, 3, 0], 'partly'], [[1, 3], [1, 0], 'partly'],
  [[1, 3], [0], 'wrong'], [[1, 3], [0, 2], 'wrong'], [[1, 3], [], 'wrong'],
];
for (const [right, picked, want] of marks) check(`markQuiz(${JSON.stringify(right)}, ${JSON.stringify(picked)}) = ${want}`, Q.markQuiz(right, picked) === want, Q.markQuiz(right, picked));

console.log('\n[6] quizOrder');
check('0 options -> []', same(Q.quizOrder('x', 0), []));
check('1 option -> [0]', same(Q.quizOrder('x', 1), [0]));
let perms = true;
for (let n = 2; n <= 6; n++) for (let s = 0; s < 500; s++) {
  const o = Q.quizOrder(`question ${s}`, n);
  if (o.length !== n || !same([...o].sort((a, b) => a - b), Array.from({ length: n }, (_, i) => i))) perms = false;
}
check('always a permutation (2-6 options, 500 seeds each)', perms);
check('same question -> same order', same(Q.quizOrder('Which residue is catalytic?', 4), Q.quizOrder('Which residue is catalytic?', 4)));
const orders = new Set(Array.from({ length: 200 }, (_, s) => Q.quizOrder(`q${s}`, 4).join('')));
check('different questions -> varied orders', orders.size >= 20, `${orders.size} distinct of 24`);
// Where an answer the AI put first ends up: each of the 4 spots about a quarter of the time
const spots = [0, 0, 0, 0];
const T = 8000;
for (let s = 0; s < T; s++) spots[Q.quizOrder(`Which part binds the drug in structure ${s}?`, 4).indexOf(0)]++;
const shares = spots.map(c => c / T);
check('the first option lands in each spot ~25%', shares.every(p => Math.abs(p - 0.25) < 0.025), shares.map(p => `${(p * 100).toFixed(1)}%`).join(' '));
// Real-looking questions from the audit: spread of the AI's first answer
const audit = ['Which residue forms the disulfide bond?', 'Which residue coordinates the heme iron?', 'Which residues form the catalytic dyad of HIV-1 protease?',
  'Which residue is the nucleophile in lysozyme?', 'Which residue anchors the S1 pocket of trypsin?', 'Which residues form the GFP chromophore?',
  'Which residue is the proximal histidine in myoglobin?', 'Which residue is part of the catalytic triad of acetylcholinesterase?'];
console.log(`  (audit questions: the AI's first option shows at ${audit.map(t => Q.quizOrder(t, 4).indexOf(0) + 1).join(', ')})`);

console.log('\n[7] quizQuestion strips a "select all that apply" of its own');
const strips = [
  ['Which residues form the disulfides? (Select all that apply)', 'Which residues form the disulfides?'],
  ['Which residues form the disulfides? (select all that apply.)', 'Which residues form the disulfides?'],
  ['Which residues form the disulfides? Select all that apply.', 'Which residues form the disulfides?'],
  ['Which residues form the disulfides? — Choose all that apply', 'Which residues form the disulfides?'],
  ['Which residues form the disulfides? [Select all that apply]', 'Which residues form the disulfides?'],
  ['(Select all that apply) Which residues form the disulfides?', 'Which residues form the disulfides?'],
  ['Select all that apply: Which residues form the disulfides?', 'Which residues form the disulfides?'],
  ['Which residue is catalytic?', 'Which residue is catalytic?'],
  ['Which of these rules apply?', 'Which of these rules apply?'],
  ['Select all that apply', 'Select all that apply'],
];
for (const [input, want] of strips) check(JSON.stringify(input), Q.quizQuestion(input) === want, JSON.stringify(Q.quizQuestion(input)));

console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILED`}`);
process.exit(failures ? 1 : 0);
