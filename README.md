# Prospecting Engine

Internal AI-assisted prospecting tool: find prospects, research their public websites, score them against a product's ideal customer profile, and track the pipeline. See [docs/PLAN.md](docs/PLAN.md) for the architecture and phases.

**Status:** Phase 0 + Phase 1 (database, CSV import, discovery, research, qualification, dashboard). Nothing in this app sends email yet.

## How it works

1. **Find prospects** (`/discover`): you pick a market and business types. Claude searches the web for businesses' own websites (portals and social sites are excluded), skips domains you already have, and creates prospects.
2. **Research** (background job): the app reads a few public pages of each prospect's site (respecting robots.txt). Claude extracts facts, each with a verbatim quote. A fact is marked *verified* only if that quote is actually on the cited page. Emails count only if they appear on the site.
3. **Qualify** (background job): Claude scores each rubric criterion (0–1) with a basis (verified / inferred / unknown) and evidence. The weighted score is computed in code. Score ≥ 60 → *qualified*. Suspected pain points are stored separately as unverified hypotheses.
4. **Import** (`/import`): CSV with column mapping, dedup by domain/email, merge-without-overwrite.

Background jobs run every 5 minutes via Vercel Cron, or immediately with **Run now** in the header.

## Setup

1. **Supabase**: create a project. In the SQL editor, run `supabase/migrations/20261017000000_initial_schema.sql` (or `npx supabase link` + `npx supabase db push`). Under Authentication → URL Configuration, add `https://<your-app>/auth/callback` (and `http://localhost:3000/auth/callback`) to the redirect URLs.
2. **Environment**: copy `.env.example` to `.env.local` and fill it in. `ALLOWED_EMAILS` is the list of people who can sign in.
3. **Run locally**: `npm install && npm run dev`, open http://localhost:3000, sign in with an allowed email. The first sign-in creates the workspace and the real-estate product config.
4. **Deploy**: import the repo into Vercel, set the same environment variables (plus `CRON_SECRET`), and set `NEXT_PUBLIC_SITE_URL` to the production URL. `vercel.json` schedules the job runner.

## Configuration

- Product, ideal customer profile, and scoring rubric: `src/lib/products/real-estate.ts` (copied into the database on first sign-in).
- Models: every step defaults to `claude-opus-5-5`. Override per step with `MODEL_DISCOVERY`, `MODEL_RESEARCH`, `MODEL_QUALIFY` (e.g. `claude-haiku-5-5` for research, `claude-sonnet-5-5` for scoring).

## Development

```
npm run typecheck
npm run lint
npm test
```
