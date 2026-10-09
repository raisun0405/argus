import path from 'path';
import { defineConfig, loadEnv, type Plugin, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import { buildThemeCss } from './themes';

// Inlines the colour-theme CSS variables (themes.ts) into the app's page (app.html), so the
// saved theme is correct from the very first paint in dev and production. The landing page
// (index.html) has colours of its own.
function themeCss(): Plugin {
  return {
    name: 'argus-theme-css',
    transformIndexHtml(html) {
      if (!html.includes('id="root"')) return html;
      return html.replace('</head>', `<style id="argus-theme-vars">${buildThemeCss()}</style>\n</head>`);
    },
  };
}

// Two pages: the landing page (index.html) at /, and the app (app.html) at /app. This sends /app and
// /app/ (with any query) to app.html in the dev and preview servers, ahead of Vite's own handling,
// which would take an extension-less /app for a module (on Windows, App.tsx). vercel.json does the
// same in production.
function appPath(): Plugin {
  const toApp = (req: { url?: string }, _res: unknown, next: () => void) => {
    const match = req.url?.match(/^\/app\/?(\?.*)?$/);
    if (match) req.url = `/app.html${match[1] ?? ''}`;
    next();
  };
  return {
    name: 'argus-app-path',
    configureServer(server) { server.middlewares.use(toApp); },
    configurePreviewServer(server) { server.middlewares.use(toApp); },
  };
}

// The landing's WebGL (landing/visuals.js, with three.js) is imported on demand, so the page works
// without waiting for it; this has the browser start fetching it with the page all the same, rather
// than once the page's own script has run.
function preloadVisuals(): Plugin {
  return {
    name: 'argus-preload-visuals',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        // Only the landing page: the app's (app.html) is the one with a React root
        if (!ctx.bundle || html.includes('id="root"')) return;
        const visuals = Object.values(ctx.bundle).find(c => c.type === 'chunk' && c.facadeModuleId?.replace(/\\/g, '/').endsWith('/landing/visuals.js'));
        if (!visuals) return;
        return [{ tag: 'link', attrs: { rel: 'modulepreload', crossorigin: true, href: `/${visuals.fileName}` }, injectTo: 'head' }];
      },
    },
  };
}

// Dev-only bridge for the Vercel Edge functions.
//
// Vite serves the SPA but has no idea about `api/*.ts` — those files are
// executed by Vercel's runtime in production. Under plain `npm run dev`, a
// POST to /api/analyze therefore 404s and the UI reports a failed analysis.
// This plugin runs the handlers in-process so local dev matches production,
// streamed responses included (/api/cofold streams while Boltz-2 runs).
//
// `apply: 'serve'` keeps it out of `vite build`; Vercel is unaffected.
const API_ROUTES = ['analyze', 'cofold', 'investigate'];
const SERVER_KEYS = ['NEBIUS_API_KEY', 'NEMOTRON_MODEL', 'NVIDIA_NIM_KEY', 'COFOLD_DAILY_LIMIT', 'TAVILY_API_KEY'];

function vercelApiDev(env: Record<string, string>): Plugin {
  return {
    name: 'argus-api-dev',
    apply: 'serve',
    configureServer(server: ViteDevServer) {
      for (const route of API_ROUTES) {
        server.middlewares.use(`/api/${route}`, async (req, res) => {
          try {
            // The handlers read their keys from process.env at runtime (as on
            // Vercel). Vite only exposes VITE_-prefixed vars to the client,
            // so these stay server-side and never enter the browser bundle.
            for (const key of SERVER_KEYS) if (env[key]) process.env[key] = env[key];

            const chunks: Buffer[] = [];
            for await (const chunk of req) chunks.push(chunk as Buffer);

            const headers = new Headers();
            for (const [key, value] of Object.entries(req.headers)) {
              if (typeof value === 'string') headers.set(key, value);
              else if (Array.isArray(value)) headers.set(key, value.join(', '));
            }

            const method = req.method ?? 'GET';
            // Use the address the browser actually used, so the handler's same-origin check
            // also passes on 127.0.0.1, a LAN IP or another port
            const request = new Request(
              `http://${req.headers.host ?? 'localhost:3000'}${req.originalUrl ?? `/api/${route}`}`,
              {
                method,
                headers,
                body:
                  method === 'GET' || method === 'HEAD' || chunks.length === 0
                    ? undefined
                    : Buffer.concat(chunks),
              }
            );

            // ssrLoadModule compiles the TS on the fly and picks up edits.
            const mod = await server.ssrLoadModule(`/api/${route}.ts`);
            const response: Response = await mod.default(request);

            res.statusCode = response.status;
            response.headers.forEach((value, key) => res.setHeader(key, value));
            if (!response.body) {
              res.end();
              return;
            }
            for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) res.write(chunk);
            res.end();
          } catch (e) {
            const detail = e instanceof Error ? e.message : String(e);
            server.config.logger.error(`[argus-api-dev] ${detail}`);
            if (res.headersSent) {
              res.end();
              return;
            }
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Dev API middleware failed', detail }));
          }
        });
      }
    },
  };
}

// Note: NEBIUS_API_KEY and NVIDIA_NIM_KEY are intentionally NOT injected into the
// client bundle. They are read at runtime by the Vercel Edge functions in `api/`
// (where they stay server-side and never reach the browser).
export default defineConfig(({ mode }) => {
  // '' prefix loads unprefixed vars too, so the keys in .env.local are
  // available to the dev middleware above.
  const env = loadEnv(mode, process.cwd(), '');

  return {
    server: {
      port: 3000,
      host: '0.0.0.0',
    },
    plugins: [react(), themeCss(), appPath(), preloadVisuals(), vercelApiDev(env)],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      rollupOptions: {
        input: {
          main: path.resolve(__dirname, 'index.html'),
          app: path.resolve(__dirname, 'app.html'),
        },
      },
    },
  };
});
