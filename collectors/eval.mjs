// Relevance eval runner: sends each eval query to /api/search and reports
// result counts + top-5 titles so relevance can be judged by a human.
import { readFileSync } from "node:fs";

const BASE = process.env.EVAL_BASE || "https://colino.work";
const evalData = JSON.parse(readFileSync(new URL("../data/eval.json", import.meta.url), "utf8"));

async function runOne(q) {
  const res = await fetch(`${BASE}/api/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tags: [q.query] })
  });
  const data = await res.json();
  const top = (data.jobs || []).slice(0, 5).map((j) => j.job_title);
  return {
    query: q.query,
    mode: data.search_mode,
    total: data.total,
    top
  };
}

let noResult = 0;
for (const q of evalData.queries) {
  const r = await runOne(q);
  if (r.total === 0) noResult++;
  console.log(`\n[${r.query}]  mode=${r.mode} total=${r.total}`);
  r.top.forEach((t, i) => console.log(`   ${i + 1}. ${t}`));
}
console.log(`\nNo-result rate: ${noResult}/${evalData.queries.length}`);
