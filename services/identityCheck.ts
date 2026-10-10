// --- IDENTITY CHECK ---
// Whether the protein an answer names is the one in the entry it picked. The answer's title is matched
// against the entry's own records: its title, the names of its molecules, and its proteins' UniProt
// names, short names and genes. Only a clear mismatch counts: not one word of the answer's title that
// names something (not "structure", "human", "hexamer"...) appears in any of those records, allowing
// for spelling (haemoglobin, hemoglobin), Greek letters, compound words (hemoglobin inside
// deoxyhemoglobin) and acronyms (GFP for green fluorescent protein). A title that names nothing ("An
// interesting protein") isn't judged.

const GREEK: Record<string, string> = { α: 'alpha', β: 'beta', γ: 'gamma', δ: 'delta', ε: 'epsilon', κ: 'kappa', λ: 'lambda', μ: 'mu', σ: 'sigma', ω: 'omega' };

// Words that name no particular protein: what a structure is, how it was solved, where it is from,
// how it is assembled, and filler
const GENERIC = new Set(`
structure structures structural crystal crystallographic crystallized cryo em cryoem xray ray nmr solution model models
predicted prediction alphafold af complex complexes complexed bound binding bind binds with without and or of the an in on at from by
for to into its their this that these those form forms state states conformation conformations apo holo native wild type wildtype
mutant mutants mutated mutation variant variants domain domains fragment fragments region regions subunit subunits chain chains
protein proteins molecule molecules enzyme enzymes human humans homo sapiens mouse murine rat bovine porcine chicken yeast bacterial
viral recombinant full length core catalytic active site sites inhibitor inhibitors inhibited ligand ligands substrate substrates
analog analogue dimer dimeric trimer trimeric tetramer tetrameric pentamer hexamer hexameric octamer oligomer oligomeric monomer
monomeric assembly unit units resolution angstrom angstroms high low new novel first view image interesting random example showing
shown show reveals revealed insight insights basis mechanism family member related like any some typical classic famous well known
ii iii iv vi using method methods collected small free alternative major minor synthetic analogues analogs chimera chimeric
containing unknown uncharacterized putative probable hypothetical nascent fold folded folding apparently one two three four single
double multiple system systems pressure temperature dynamic dynamics intact broad potent activity template design designed
engineered deposition group transitions ultrafast cryocooling
coli escherichia aureus staphylococcus streptococcus pyogenes pneumoniae bacillus subtilis mycobacterium tuberculosis salmonella
typhimurium pseudomonas aeruginosa thermus thermophilus aquaticus vibrio cholerae saccharomyces cerevisiae schizosaccharomyces pombe
arabidopsis thaliana drosophila melanogaster caenorhabditis elegans zebrafish danio rerio xenopus laevis plasmodium falciparum
sars cov coronavirus virus viruses bacteria bacterium archaea archaeal thermophilic mesophilic hyperthermophilic mammalian plant
plants insect fungal fungus
`.trim().split(/\s+/));

/** An answer's first sentence (decimals like "1.8 Å" don't end it), where it says what it shows. */
export const firstSentence = (text: string) => (text.split(/(?<=[.!?])\s+/)[0] ?? '').slice(0, 300);

/** Lower case, Greek letters spelled out, British spellings American, hyphens in names closed up, punctuation gone. */
export function normalize(text: string): string {
  return text
    .replace(/[αβγδεκλμσω]/g, c => ` ${GREEK[c]} `)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/([a-z])-(\d)/g, '$1$2') // HIV-1, PD-1
    .replace(/(\d)-([a-z])/g, '$1$2')
    .replace(/aem/g, 'em') // haemoglobin, leukaemia
    .replace(/oe(?=[a-z])/g, 'e') // oestrogen, foetal
    .replace(/sulph/g, 'sulf')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const singular = (t: string) => (t.length > 4 && t.endsWith('s') && !t.endsWith('ss') ? t.slice(0, -1) : t);

/** The words of a title that could name a protein. */
export function namingWords(title: string): string[] {
  return [...new Set(normalize(title).split(' ').filter(t => t && !GENERIC.has(t) && !/^\d+$/.test(t) && (t.length >= 3 || (/\d/.test(t) && /[a-z]/.test(t)))))];
}

/**
 * The records' naming words (generic ones like "form" or "structure" can't vouch for a match, not even
 * inside a longer word: "forming"), plus each multi-word name's acronym (green fluorescent protein: gfp).
 */
function vocabulary(names: string[]) {
  const words = new Set<string>();
  const phrases: string[] = [];
  for (const name of names) {
    const n = normalize(name);
    if (!n) continue;
    phrases.push(n);
    const parts = n.split(' ');
    parts.filter(p => !GENERIC.has(p) && !GENERIC.has(singular(p))).forEach(p => { words.add(p); words.add(singular(p)); });
    if (parts.length >= 2 && parts.length <= 6) {
      words.add(parts.map(p => (/^\d+$/.test(p) ? p : p[0])).join(''));
      words.add(parts.filter(p => !/^\d+$/.test(p)).map(p => p[0]).join(''));
    }
  }
  return { words, joined: ` ${phrases.join(' | ')} ` };
}

export interface IdentityVerdict {
  judged: boolean; // The title names something to check
  match: boolean;
  words: string[]; // The title's naming words
  matched: string[]; // ...those found in the records
}

export function identityVerdict(title: string, names: string[]): IdentityVerdict {
  const words = namingWords(title);
  if (words.length === 0) return { judged: false, match: true, words, matched: [] };
  const vocab = vocabulary(names);
  const found = (w: string) =>
    vocab.words.has(w) || vocab.words.has(singular(w))
    || (w.length >= 4 && vocab.joined.includes(w))
    || (w.length >= 5 && [...vocab.words].some(v => v.length >= 4 && w.includes(v)));
  const matched = words.filter(found);
  return { judged: true, match: matched.length > 0, words, matched };
}
