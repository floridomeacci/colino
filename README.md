# Colino

> Strain out the noise. Find the jobs that fit.

Colino is a job search that filters live openings down to the roles that match your CV. Upload a resume, or just describe what you want, and an AI agent reads your skills, roles, seniority, location, and industry. It ranks the jobs that fit, suggests companies to look at next, and learns from every like and dislike you give it.

Built for the [WebMCP Challenge](https://devpost.com), a web app where people and their agents work together.

![Colino](./public/og-image.png)

---

## What it does

Drop a PDF resume and the agent extracts skills, current roles, growth roles, seniority, industry, and location, then ranks the live feed by fit.

A chat panel on the left lets you refine in plain language, like "senior design roles in the Netherlands", while results update on the right.

Search terms become removable tags. The feed re-ranks by semantic relevance instead of hard-filtering, so "creative technologist" surfaces related roles, not just exact title matches.

Vote jobs up or down and the ranking learns. Liked jobs and their companies float up, disliked ones sink, and AI-suggested matches are auto-liked so the search keeps leaning the right way.

When results are thin, the agent proposes around 100 real companies for your query and fetches their live postings from Greenhouse, Lever, Ashby, Workable, and Recruitee.

The platform is exposed to browser agents through WebMCP via `document.modelContext.registerTool(...)`, with tools for `search_jobs`, `get_job_details`, `get_companies`, `get_stats`, and `propose_companies`.

## Try it live

<https://colino.work>

Test it in ChatGPT's in-app browser, or in Google Chrome with `chrome://flags/#enable-webmcp-testing` enabled.

## How it works

```
┌─────────────┐     ┌──────────────────────────────┐     ┌──────────────────┐
│  Frontend   │────▶│  Cloudflare Worker (single)  │────▶│  KV (job store)  │
│  static SPA │     │  • AI chat + matching        │     │  • cached jobs   │
│  + WebMCP   │◀────│  • ATS collectors            │     │  • embeddings    │
└─────────────┘     │  • semantic ranking          │     └──────────────────┘
                    └──────────────────────────────┘
```

CV and profile text is embedded with `bge-small-en-v1.5` (Cloudflare Workers AI) and ranked against job embeddings using cosine similarity, keyword overlap, seniority, and recency.

The chat agent gets a full platform overview, including top companies, titles, locations, and seniority, so it understands the catalogue.

For company discovery, the agent names employers for a query and scrapes their live ATS boards. Results are cached in KV with 30-day retention.

No secrets reach the client or agents. Stateful endpoints are rate limited, and input validation, prompt-injection guards, and security headers are applied throughout.

## Tech stack

| Layer | Tech |
|---|---|
| Runtime | Cloudflare Workers |
| Storage | Cloudflare KV |
| Embeddings | Cloudflare Workers AI (`bge-small-en-v1.5`) |
| LLM | Replicate (`deepseek-v3`) |
| Frontend | Vanilla JS + CSS (no framework) |
| PDF | pdf.js |
| Agents | WebMCP (W3C spec) |

## Getting started

### Prerequisites

- Node.js 18+
- A Cloudflare account with `wrangler` (`npm i -g wrangler`)
- A [Replicate](https://replicate.com) API key for CV analysis and chat

### Install and run locally

```bash
npm install
cp .env.example .env   # add your REPLICATE_API_KEY
npm run dev            # http://localhost:8787
```

### Deploy

```bash
npx wrangler login
npx wrangler kv namespace create JOBS_KV   # update the id in wrangler.toml
npx wrangler secret put REPLICATE_API_KEY
npx wrangler deploy
```

### Env vars

| Var | Where | Purpose |
|---|---|---|
| `REPLICATE_API_KEY` | `.env` (local) / `wrangler secret` (prod) | CV analysis and chat LLM |

Never commit credentials. `.env` and `.dev.vars` are gitignored.

## Project structure

```
src/worker.js        # single Worker: API routes, AI matching, ATS collectors
public/              # static SPA (index.html, app.js, style.css, webmcp.js)
collectors/          # offline ATS collector scripts (Greenhouse, Lever, Ashby, and more)
data/                # seed job data
wrangler.toml        # Worker + KV + AI binding config
```

## License

[MIT](./LICENSE) © 2026 Florido Meacci
