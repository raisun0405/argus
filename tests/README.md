# Tests

Plain Node scripts, no test framework: each file prints `PASS …` / `FAIL …` lines and exits non-zero when
anything failed. They need Node 22.18 or newer (it runs the app's TypeScript directly) and, for the browser
tests, Google Chrome.

| Command | What it runs | Needs |
|---|---|---|
| `npm test` | `unit/`: the app's logic with every outside service mocked or read from `fixtures/` | nothing else; seconds |
| `npm run test:data` | `data/`: the same logic on live public data (RCSB, PDBe, UniProt, AlphaFold DB, PrankWeb, STRING, wwPDB), checked against independent values; no AI calls | the network; a few minutes |
| `npm run test:browser` | `browser/`: the app in a headless Chrome, used the way a visitor would; the AI's answers are scripted, so no AI calls | `npm run dev` running in another terminal |
| `npm run test:site -- <url>` | `site/`: a deployed site: security headers, the origin check, the error-report endpoint, the bot check | the deployed address |

The browser tests open `http://localhost:3000` (what `npm run dev` serves); set `BASE` for another address,
e.g. `BASE=http://127.0.0.1:3100 npm run test:browser`. `CHROME_PATH` points them at another Chrome.
To run some files only, add words from their names: `npm run test:browser -- cofold quiz`.

Files run one at a time: two browser tests side by side would drive each other's pages. Each prints its
own results; the full output of a run, screenshots and browser profiles go to `argus-tests` in the
system's temp folder (`TEST_OUT` to choose another), never into the repo, whose files the dev server
watches.

The data tests depend on public services, which are sometimes slow or down; a failure there is worth one
rerun before it is believed. The site tests send only requests the server refuses before doing any work:
none of them calls the AI or sends an alert email.
