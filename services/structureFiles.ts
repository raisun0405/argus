import { memoize } from './http';

// One download per PDB entry, shared by the viewer and by services that read atoms
// (the Partners interface finder), so opening a complex doesn't fetch its file twice.

const MAX_FILES = 12; // Recent entries kept in memory; switching back to one is instant
// A stalled connection fails instead of leaving "loading" on screen for good (and, since the download
// is shared, every later look at the entry waiting on it): RCSB has this long to start answering...
const ANSWER_MS = 20_000;
// ...and this long to finish sending, generous for large files on slow connections
const DOWNLOAD_MS = 120_000;
const files = new Map<string, Promise<string>>();

/** The entry's PDB-format file from RCSB. Rejects when the entry doesn't exist, has no PDB-format file, or doesn't arrive in time. */
export const fetchPdbFile = (pdbId: string): Promise<string> => {
  const id = pdbId.trim().toUpperCase();
  const pending = memoize(files, id, async () => {
    const controller = new AbortController();
    let timer = setTimeout(() => controller.abort(), ANSWER_MS);
    try {
      const response = await fetch(`https://files.rcsb.org/download/${id}.pdb`, { signal: controller.signal });
      if (!response.ok) throw new Error(`Structure ${id} not found`);
      clearTimeout(timer);
      timer = setTimeout(() => controller.abort(), DOWNLOAD_MS);
      const data = await response.text();
      if (data.includes('<!DOCTYPE') || data.includes('<html')) throw new Error('Invalid PDB data.');
      return data;
    } catch (error) {
      if (controller.signal.aborted) throw new Error(`RCSB didn't send ${id} in time. Try again.`);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  });
  // Most recently used last; drop the oldest beyond the cap
  files.delete(id);
  files.set(id, pending);
  while (files.size > MAX_FILES) files.delete(files.keys().next().value as string);
  return pending;
};
