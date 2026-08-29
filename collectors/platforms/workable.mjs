// Workable — public job board (markdown interface)
// GET https://apply.workable.com/{company}/jobs.md  (markdown table)
import { toISO, mapEmploymentType, relativeTime, makeJob } from "../lib/schema.mjs";

export async function collectWorkable(company) {
  const res = await fetch(`https://apply.workable.com/${company}/jobs.md`, {
    headers: { "User-Agent": "jobs-dashboard-collector/1.0", Accept: "text/markdown" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${company}`);
  const md = await res.text();
  return parseJobsMd(md, company);
}

function parseJobsMd(md, company) {
  const jobs = [];
  for (const line of md.split("\n")) {
    if (!line.startsWith("|")) continue;
    const cells = line.split("|").map((c) => c.trim()).filter((c, i, a) => i > 0 && i < a.length - 1);
    if (cells.length < 6) continue;
    if (/^[-: ]+$/.test(cells[0])) continue; // separator row
    if (cells[0].toLowerCase() === "title") continue; // header row
    const [title, department, location, type, salary, posted, details] = cells;
    const urlMatch = details && details.match(/\(([^)]+)\)/);
    const viewId = urlMatch ? urlMatch[1].match(/view\/([^/.]+)/)?.[1] : null;
    jobs.push(
      makeJob({
        job_posting_id: viewId ? `workable_${viewId}` : `workable_${title}_${posted}`,
        url: urlMatch ? urlMatch[1].replace(/\.md$/, "") : null,
        job_title: title,
        company_name: company,
        company_logo: null,
        job_location: location || null,
        job_posted_date: toISO(posted),
        job_posted_time: relativeTime(posted),
        job_seniority_level: null,
        job_employment_type: mapEmploymentType(type),
        job_industries: null,
        job_function: department || null,
        _query_label: "Workable",
      })
    );
  }
  return jobs;
}
