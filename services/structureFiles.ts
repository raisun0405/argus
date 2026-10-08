import { memoize } from './http';

// One download per PDB entry, shared by the viewer and by services that read atoms
// (the Partners interface finder), so opening a complex doesn't fetch its file twice.

const MAX_FILES = 12; // Recent entries kept in memory; switching back to one is instant
const files = new Map<string, Promise<string>>();

/** The entry's PDB-format file from RCSB. Rejects when the entry doesn't exist or has no PDB-format file. */
export const fetchPdbFile = (pdbId: string): Promise<string> => {
  const id = pdbId.trim().toUpperCase();
  const pending = memoize(files, id, async () => {
    const response = await fetch(`https://files.rcsb.org/download/${id}.pdb`);
    if (!response.ok) throw new Error(`Structure ${id} not found`);
    const data = await response.text();
    if (data.includes('<!DOCTYPE') || data.includes('<html')) throw new Error('Invalid PDB data.');
    return data;
  });
  // Most recently used last; drop the oldest beyond the cap
  files.delete(id);
  files.set(id, pending);
  while (files.size > MAX_FILES) files.delete(files.keys().next().value as string);
  return pending;
};
