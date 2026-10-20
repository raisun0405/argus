// --- CUTTING TEXT TO A LENGTH ---
// The facts and hints sent with a question are capped, and the prompt tells the model to copy residue
// numbers exactly: a cut in the middle of "Lys745" would hand it "Lys74". So text is cut between
// words, never inside one. Pure TypeScript: the browser and the server functions both use it.

/**
 * `text` in at most `max` characters, never cutting a word or a number: at the last line break when
 * one comes late enough (whole lines, as nothing after it was cut short), otherwise at the last space,
 * comma or semicolon, ending in "…".
 */
export const cutText = (text: string, max: number): string => {
  if (text.length <= max) return text;
  const head = text.slice(0, max + 1); // A break right at the limit still counts
  const line = head.lastIndexOf('\n');
  if (line >= max / 2) return head.slice(0, line).trimEnd();
  const room = text.slice(0, max); // The ellipsis takes the last place
  const at = Math.max(room.lastIndexOf(' '), room.lastIndexOf(','), room.lastIndexOf(';'));
  const cut = at > 0 ? room.slice(0, at) : room.slice(0, max - 1);
  return `${cut.replace(/[\s,;:(–-]+$/, '')}…`;
};
