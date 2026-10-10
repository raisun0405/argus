// Tests for services/commands.ts: fuzzy search ranking, residue queries, shortcut matching.
import '../lib/ts-hooks.mjs';
import { ROOT_URL } from '../lib/env.mjs';
const c = await import(`${ROOT_URL}services/commands.ts`);

let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== '' ? ' — ' + detail : ''}`); if (!ok) failures++; };

const cmd = (id, title, group = 'Tools', extra = {}) => ({ id, title, group, run() {}, ...extra });
const list = [
  cmd('pockets', 'Pockets'), cmd('interactions', 'Interactions'), cmd('cofold', 'Co-fold a molecule'),
  cmd('partners', 'Partners'), cmd('similar', 'Find similar structures'), cmd('share', 'Copy share link', 'Workspace'),
  cmd('cartoon', 'Cartoon', 'View'), cmd('surface', 'Surface', 'View'), cmd('reset', 'Reset view', 'View'),
  cmd('variant', 'Variant Lens', 'Tools', { keywords: 'pathogenicity alphamissense mutation' }),
  cmd('off', 'Disabled thing', 'View', { disabled: true }),
];
const top = (q, n = 3) => c.searchCommands(list, q).slice(0, n).map(s => s.command.id);

check('exact word ranks first', top('pockets')[0] === 'pockets', JSON.stringify(top('pockets')));
check('prefix beats mid-word', top('pok')[0] === 'pockets', JSON.stringify(top('pok')));
check('initials find multi-word commands', top('cofold')[0] === 'cofold', JSON.stringify(top('cofold')));
check('keywords find a command by what it does', top('pathogenic')[0] === 'variant', JSON.stringify(top('pathogenic')));
check('word-start beats later letters', top('surf')[0] === 'surface', JSON.stringify(top('surf')));
check('no match returns nothing', c.searchCommands(list, 'zzzqq').length === 0);
check('disabled commands never appear', !c.searchCommands(list, 'disabled').some(s => s.command.id === 'off') && !c.searchCommands(list, '').some(s => s.command.id === 'off'));
check('empty query keeps the given order', c.searchCommands(list, '').map(s => s.command.id)[0] === 'pockets');
check('fuzzyScore rejects out-of-order letters', c.fuzzyScore('Pockets', 'skp') === null);
check('fuzzyScore prefers shorter titles on a tie', c.fuzzyScore('Cartoon', 'cart') > c.fuzzyScore('Cartoon representation preset', 'cart'));

// --- Residue queries ---
const rq = (s) => JSON.stringify(c.parseResidueQuery(s));
check('"A:25"', rq('A:25') === '{"chain":"A","from":25,"to":25}', rq('A:25'));
check('"25"', rq('25') === '{"from":25,"to":25}', rq('25'));
check('"Asp25" keeps the name', rq('Asp25') === '{"from":25,"to":25,"name":"ASP"}', rq('Asp25'));
check('"A:Asp25"', rq('A:Asp25') === '{"chain":"A","from":25,"to":25,"name":"ASP"}', rq('A:Asp25'));
check('"25-40" is a range', rq('25-40') === '{"from":25,"to":40}', rq('25-40'));
check('"B 40-25" sorts the range', rq('B 40-25') === '{"chain":"B","from":25,"to":40}', rq('B 40-25'));
check('a word is not a residue query', c.parseResidueQuery('pockets') === null && c.parseResidueQuery('') === null && c.parseResidueQuery('hiv protease') === null);
check('a non-residue three-letter word is not one', c.parseResidueQuery('cat25') === null, rq('cat25'));

// --- Shortcuts ---
const ev = (key, mods = {}) => ({ key, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...mods });
check('mod+k matches ctrl and meta', c.matchesChord(ev('k', { ctrlKey: true }), 'mod+k') && c.matchesChord(ev('k', { metaKey: true }), 'mod+k'));
check('mod+k does not match plain k', !c.matchesChord(ev('k'), 'mod+k'));
check('plain key does not match with a modifier', !c.matchesChord(ev('s', { ctrlKey: true }), 's'));
check('shift+? matches', c.matchesChord(ev('?', { shiftKey: true }), 'shift+?'));
check('escape matches', c.matchesChord(ev('Escape'), 'escape'));
check('case-insensitive', c.matchesChord(ev('K', { ctrlKey: true }), 'mod+k'));
check('shortcutLabel reads naturally', /^(⌘|Ctrl\+?)K$/.test(c.shortcutLabel('mod+k')), c.shortcutLabel('mod+k'));
check('two-step shortcut label', c.shortcutLabel('g r') === 'G then R', c.shortcutLabel('g r'));
check('isTyping detects fields', c.isTyping({ tagName: 'INPUT' }) && c.isTyping({ tagName: 'TEXTAREA' }) && c.isTyping({ tagName: 'DIV', isContentEditable: true }) && !c.isTyping({ tagName: 'BUTTON' }) && !c.isTyping(null));

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures ? 1 : 0);
