# Colino

> Strain out the noise. Find the jobs that fit.

Colino is a job search that filters live openings down to the roles that match your CV. Upload a resume, or just describe what you want, and an AI agent reads your skills, roles, seniority, location, and industry. It ranks the jobs that fit, suggests companies to look at next, and learns from every like and dislike you give it.

Built for the [WebMCP Challenge](https://devpost.com), a web app where people and their agents work together.

![Colino](./public/og-image.png)

---

## What it does

Drop a PDF resume and the agent extracts skills, current roles, growth roles, seniority, industry, and location, then ranks the live feed by fit.

A chat panel on the left lets you refine in plain language, like "senior design roles in the Netherlands", while results update on the right.

Search terms become removable tags. Ranking puts role identity first: a job must belong to the requested role family before location or any other preference can lift it, so "creative technologist" surfaces related roles without letting nearby marketing jobs leapfrog them. A second-stage cross-encoder reads each job against your intent and returns per-job fit scores plus plain-language reasons and gaps.

Vote jobs up or down and the ranking learns. Liked jobs and their companies float up, disliked ones sink, and AI-suggested matches are auto-liked so the search keeps leaning the right way.

When results are thin, the agent proposes around 20 real companies for your query and fetches their live postings from Greenhouse, Lever, Ashby, Workable, and Recruitee, then streams progress back to you.

The platform is exposed to browser agents through WebMCP via `document.modelContext.registerTool(...)`, with 13 tools: `search-jobs`, `get-job`, `get-jobs`, `get-companies`, `get-stats`, `get-active-profile-summary`, `match-jobs-to-profile`, `explain-job-match`, `start-company-discovery`, `get-company-discovery-status`, `save-job`, `unsave-job`, and `list-saved-jobs`.

## Try it live

<https://colino.work>

Test it in ChatGPT's in-app browser, or in Google Chrome with `chrome://flags/#enable-webmcp-testing` enabled.

## How it works

```
┌─────────────┐     ┌──────────────────────────────┐     ┌──────────────────┐
│  Frontend   │────▶│  Cloudflare Worker (single)  │────▶│  KV (job store)  │
│  static SPA │     │  • AI chat + matching        │     │  • cached jobs   │
│  + WebMCP   │◀────│  • ATS collectors            │     │  • embeddings    │
└─────────────┘     │  • hybrid ranking            │     └──────────────────┘
                    └──────────────────────────────┘
```

Matching runs in stages. A query is parsed into structured intent (target and related roles, skills, seniority, locations) by the LLM. Jobs are then enriched (remote regions, canonical country, active status) and deduplicated by company and normalized title. Hybrid retrieval scores each job with separate title and description embeddings plus lexical role fit, weighted across role, skills, responsibilities, seniority, industry, and freshness.

A deterministic role gate then decides eligibility: jobs below the role threshold are dropped, weak role matches get a muted location preference, and only solid role matches receive full location weighting. The top candidates pass through a cross-encoder reranker that returns role, skills, seniority, and location fit plus reasons and gaps. Location stays a preference, never a filter.

The chat agent gets a full platform overview, including top companies, titles, locations, and seniority, so it understands the catalogue.

For company discovery, the agent names employers for a query and scrapes their live ATS boards. Results are cached in KV with 30-day retention.

No secrets reach the client or agents. Stateful endpoints are rate limited, and input validation, prompt-injection guards, and security headers are applied throughout.

## Relevance evaluation

An assertion-based eval set lives in `data/eval.json` and is run by `collectors/eval.mjs`. Each query asserts role relevance, seniority compatibility, location compatibility, deduplication, enrichment fields, and (in full mode) reranker fields.

```bash
npm run eval:fast   # retrieval only, skips the cross-encoder
npm run eval:full   # end-to-end, includes the cross-encoder
```

Results are cached by query so full runs only re-hit the LLM when inputs change.

## Tech stack

| Layer | Tech |
|---|---|
| Runtime | Cloudflare Workers |
| Storage | Cloudflare KV |
| Embeddings | Cloudflare Workers AI (`bge-small-en-v1.5`) |
| LLM | DeepSeek (`deepseek-chat`), Replicate (`deepseek-v3`) fallback |
| Frontend | Vanilla JS + CSS (no framework) |
| PDF | pdf.js |
| Agents | WebMCP (W3C spec) |

## Getting started

### Prerequisites

- Node.js 18+
- A Cloudflare account with `wrangler` (`npm i -g wrangler`)
- A [DeepSeek](https://platform.deepseek.com) API key for CV analysis and chat (a [Replicate](https://replicate.com) key works as a fallback)

### Install and run locally

```bash
npm install
cp .env.example .env   # add your DEEPSEEK_API_KEY (and REPLICATE_API_KEY)
npm run dev            # http://localhost:8787
```

### Deploy

```bash
npx wrangler login
npx wrangler kv namespace create JOBS_KV   # update the id in wrangler.toml
npx wrangler secret put DEEPSEEK_API_KEY
npx wrangler secret put REPLICATE_API_KEY
npx wrangler deploy
```

### Env vars

| Var | Where | Purpose |
|---|---|---|
| `DEEPSEEK_API_KEY` | `.env` (local) / `wrangler secret` (prod) | Primary LLM for analysis, chat, and reranking |
| `REPLICATE_API_KEY` | `.env` (local) / `wrangler secret` (prod) | Fallback LLM |

Never commit credentials. `.env` and `.dev.vars` are gitignored.

## Project structure

```
src/worker.js        # single Worker: API routes, AI matching, hybrid ranking, ATS collectors
public/              # static SPA (index.html, app.js, style.css, webmcp.js)
collectors/          # offline ATS collector scripts + the eval runner (eval.mjs)
data/                # seed job data + eval assertions (eval.json)
wrangler.toml        # Worker + KV + AI binding config
```

## License

[MIT](./LICENSE) © 2026 Florido Meacci
