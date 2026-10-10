// Where things are, for every test: the repo, its fixtures, a scratch folder for screenshots and browser
// profiles, the site under test and the Chrome to drive.
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';

/** The repo root, with forward slashes. */
export const ROOT = fileURLToPath(new URL('../../', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '');
/** The repo root as a file URL ending in "/", for importing the app's modules: `${ROOT_URL}services/x.ts`. */
export const ROOT_URL = pathToFileURL(`${ROOT}/`).href;
export const FIXTURES = `${ROOT}/tests/fixtures`;
/**
 * Screenshots, logs, browser profiles and other output, outside the repo (TEST_OUT overrides): the dev
 * server watches the repo and reloads the page under test whenever a file in it changes.
 */
export const OUT = (process.env.TEST_OUT ?? `${tmpdir()}/argus-tests`).replace(/\\/g, '/');
mkdirSync(`${OUT}/shots`, { recursive: true });

/** The app under test: `npm run dev` serves it on port 3000; BASE points the browser tests elsewhere. */
export const BASE = (process.env.BASE ?? 'http://localhost:3000').replace(/\/$/, '');

const CHROME_DEFAULT = {
  win32: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  darwin: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
}[process.platform] ?? 'google-chrome';
/** The Chrome the browser tests drive (CHROME_PATH overrides). */
export const CHROME = process.env.CHROME_PATH ?? CHROME_DEFAULT;

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
