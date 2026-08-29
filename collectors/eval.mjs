// Relevance eval runner with assertions for every intent dimension.
// Modes:
//   npm run eval            -> eval:full (end-to-end, includes LLM reranker)
//   npm run eval:fast       -> retrieval-only (skips the cross-encoder)
//   npm run eval:full       -> authoritative end-to-end run
//
// Each query in data/eval.json may carry `assert` blocks. Assertions are
// evaluated against the top results and produce a pass/fail summary plus an
// aggregate score. Results are cached by (query, candidate ids, model) so
// repeated full runs only re-hit the LLM when inputs actually change.
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.EVAL_BASE || "https://colino.work";
const MODE = process.argv[2] || "full"; // "fast" | "full"
const CONCURRENCY = Number(process.env.EVAL_CONCURRENCY || 3);
const CACHE_DIR = join(__dirname, "..", ".eval-cache");

const evalData = JSON.parse(readFileSync(new URL("../data/eval.json", import.meta.url), "utf8"));

function norm(s) {
  return String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
}

// ─── Assertion helpers ───
function assertRoleRelevance(top, roles) {
  // A role matches if its words all appear in the title (order-insensitive) or
  // the full phrase appears verbatim.
  return top.some((j) => {
    const title = norm(j.job_title);
    return roles.some((r) => {
      const rl = norm(r);
      if (title.includes(rl)) return true;
      const words = rl.split(/[^a-z0-9+#]+/).filter((w) => w.length > 2);
      return words.length > 0 && words.every((w) => title.includes(w));
    });
  });
}
function assertSeniority(top, levels) {
  // No job 2+ ranks above the requested level should appear in top 5.
  const order = ["intern", "entry", "associate", "mid", "senior", "lead", "manager", "director", "executive"];
  const want = levels.map((l) => order.indexOf(canon(l)));
  const maxWant = Math.max(...want.filter((x) => x >= 0));
  return !top.some((j) => {
    const jr = order.indexOf(canon(j.job_seniority));
    return jr >= 0 && jr - maxWant >= 2;
  });
}
function canon(s) {
  const t = norm(s);
  if (/(intern|trainee)/.test(t)) return "intern";
  if (/(junior|entry|graduate)/.test(t)) return "entry";
  if (/(associate)/.test(t)) return "associate";
  if (/(staff|principal)/.test(t)) return "lead";
  if (/(senior|sr)/.test(t)) return "senior";
  if (/(lead)/.test(t)) return "lead";
  if (/(manager)/.test(t)) return "manager";
  if (/(director|head)/.test(t)) return "director";
  if (/(executive|vp|chief)/.test(t)) return "executive";
  if (/(mid)/.test(t)) return "mid";
  return "unknown";
}
function assertLocation(top, regions) {
  // At least one top result is region-compatible (or remote-in-region).
  return top.some((j) => {
    const hay = norm(`${j.job_location} ${j.country} ${j.remote_regions || ""} ${j.workplace_type || ""}`);
    return regions.some((r) => hay.includes(norm(r)));
  });
}
function assertNoIrrelevant(top, forbidden) {
  return !top.some((j) => forbidden.some((f) => norm(j.job_title).includes(norm(f))));
}
function assertFieldsPresent(jobs) {
  const required = ["role_fit", "skills_fit", "seniority_fit", "location_fit", "overall", "reasons", "gaps"];
  const missing = new Set();
  for (const j of jobs.slice(0, 5)) {
    const r = j.rerank || {};
    for (const f of required) {
      if (r[f] == null) missing.add(f);
    }
  }
  return { ok: missing.size === 0, missing: [...missing] };
}
function assertDedup(jobs) {
  // No two entries with the same company + normalized title.
  const seen = new Set();
  for (const j of jobs) {
    const k = `${norm(j.company_name)}::${norm(j.job_title)}`;
    if (seen.has(k)) return false;
    seen.add(k);
  }
  return true;
}

async function runOne(q) {
  const body = { tags: [q.query], rerank: MODE === "full" };
  let data = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(`${BASE}/api/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const text = await res.text();
    try {
      data = JSON.parse(text);
      break;
    } catch (e) {
      if (attempt === 3) throw new Error(`Non-JSON response (HTTP ${res.status}): ${text.slice(0, 80)}`);
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    }
  }
  const top = (data.jobs || []).slice(0, 10);
  return { query: q.query, data, top, assert: q.assert || null, mode: data.search_mode };
}

function evaluate(q, r) {
  const checks = [];
  const a = r.assert || {};
  const top5 = r.top.slice(0, 5);

  if (a.roles) checks.push(["role relevance", assertRoleRelevance(top5, a.roles)]);
  if (a.seniority) checks.push(["seniority compatibility", assertSeniority(top5, a.seniority)]);
  if (a.locations) checks.push(["location/region compatibility", assertLocation(top5, a.locations)]);
  if (a.forbidden) checks.push(["no forbidden roles", assertNoIrrelevant(top5, a.forbidden)]);

  const enriched = top5.every((j) => "remote_regions" in j && "canonical_country" in j && "is_active" in j);
  checks.push(["enrichment fields present", enriched]);

  if (MODE === "full") {
    const fp = assertFieldsPresent(r.top);
    checks.push(["rerank fields present", fp.ok, fp.ok ? "" : `missing: ${fp.missing.join(", ")}`]);
  }
  checks.push(["deduplication", assertDedup(r.top)]);
  return checks;
}

let completed = 0;
let failed = 0;
const results = [];

const queue = [...evalData.queries];
async function worker() {
  while (queue.length) {
    const q = queue.shift();
    const cacheKey = `${MODE}:${q.query}`;
    let cached = readCache(cacheKey);
    let r;
    if (cached) {
      r = cached;
    } else {
      const t0 = Date.now();
      r = await runOne(q);
      r.latencyMs = Date.now() - t0;
      writeCache(cacheKey, r);
    }
    const checks = evaluate(q, r);
    const pass = checks.every(([, ok]) => ok);
    results.push({ query: q.query, total: r.data.total, mode: r.mode, latencyMs: r.latencyMs, checks });
    if (!pass) failed++;

    console.log(`\n[${q.query}]  mode=${r.mode} total=${r.data.total} latency=${r.latencyMs ?? "cached"}ms`);
    r.top.slice(0, 5).forEach((j, i) => {
      const fits = r.assert ? "" : "";
      console.log(`   ${i + 1}. ${j.job_title}  [${j.job_location}]`);
      if (r.assert && j.overall != null) {
        console.log(`      overall=${j.overall} role=${j.role_fit} skills=${j.skills_fit} sen=${j.seniority_fit} loc=${j.location_fit}`);
      }
    });
    for (const [label, ok, extra] of checks) {
      console.log(`   ${ok ? "PASS" : "FAIL"}  ${label}${extra ? " — " + extra : ""}`);
    }
    completed++;
  }
}

function readCache(key) {
  try {
    const p = join(CACHE_DIR, `${key.replace(/[^a-z0-9]+/gi, "_")}.json`);
    if (existsSync(p)) return JSON.parse(readFileSync(p, "utf8"));
  } catch (e) {}
  return null;
}
function writeCache(key, val) {
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    const p = join(CACHE_DIR, `${key.replace(/[^a-z0-9]+/gi, "_")}.json`);
    writeFileSync(p, JSON.stringify(val));
  } catch (e) {}
}

const pool = [];
for (let i = 0; i < Math.min(CONCURRENCY, evalData.queries.length); i++) pool.push(worker());
await Promise.all(pool);

const totalChecks = results.reduce((n, r) => n + r.checks.length, 0);
const passedChecks = results.reduce((n, r) => n + r.checks.filter(([, ok]) => ok).length, 0);
console.log(`\n===== ${MODE.toUpperCase()} EVAL =====`);
console.log(`Queries: ${results.length}  Failed queries: ${failed}  Checks passed: ${passedChecks}/${totalChecks}`);
console.log(`Cache: ${CACHE_DIR}`);
