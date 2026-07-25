// @ts-check
import { defineConfig } from 'astro/config';
import { loadEnv } from 'vite';

// The Convex CLI owns CONVEX_URL in .env.local and rewrites it whenever the
// deployment changes. We deliberately do NOT keep a second PUBLIC_CONVEX_URL
// copy — two variables both matching "CONVEX_URL" is what stops the CLI from
// updating that file automatically.
//
// Astro only auto-exposes PUBLIC_-prefixed vars, and `process.env` is populated
// during `astro build` but NOT during `astro dev`. So read the file here (in
// Node, before either starts) and set it ourselves — that makes the value
// resolve identically in dev, build and CI. A real process.env wins, so hosting
// providers can inject the production URL at build time.
const fileEnv = loadEnv('development', process.cwd(), '');
process.env.CONVEX_URL = process.env.CONVEX_URL ?? fileEnv.CONVEX_URL ?? '';

// Fully static output — the whole site builds to plain HTML/CSS/JS and can be
// dropped on Cloudflare Pages / Netlify for free. Convex is reached from the
// browser at runtime, so no SSR and no server are required.
// GitHub Pages serves a project repo under /<repo>/, so every URL needs that
// prefix. Both are overridable, so moving to a custom domain later is just
// SITE_URL=https://example.com BASE_PATH=/ npm run build — no code changes.
const SITE = process.env.SITE_URL ?? 'https://mauribuffa.github.io';
const BASE = process.env.BASE_PATH ?? '/a-new-ascension';

export default defineConfig({
  output: 'static',
  site: SITE,
  base: BASE,
  build: { inlineStylesheets: 'auto' },
});
