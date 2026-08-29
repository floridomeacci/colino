// Lever — https://hire.lever.co/postings-api
// GET https://api.lever.co/v0/postings/{company}?mode=json
import { fetchJson } from "../lib/http.mjs";
import { toISO, mapEmploymentType, normalizeLocation, relativeTime, makeJob } from "../lib/schema.mjs";

export async function collectLever(company) {
  const jobs = await fetchJson(`https://api.lever.co/v0/postings/${company}?mode=json`);
  if (!Array.isArray(jobs)) return [];
  return jobs.map((j) => {
    const cats = j.categories || {};
    return makeJob({
      job_posting_id: `lever_${j.id}`,
      url: j.hostedUrl || j.applyUrl,
      job_title: j.text,
      company_name: company,
      company_logo: null,
      job_location: normalizeLocation(cats.location, j.country),
      job_posted_date: toISO(j.createdAt),
      job_posted_time: relativeTime(j.createdAt),
      job_seniority_level: null,
      job_employment_type: mapEmploymentType(cats.commitment),
      job_industries: cats.team || null,
      job_function: cats.department || null,
      _query_label: "Lever",
    });
  });
}
