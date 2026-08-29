// Ashby — https://developers.ashbyhq.com/reference/postjobboard
// GET https://api.ashbyhq.com/posting-api/job-board/{company}
import { fetchJson } from "../lib/http.mjs";
import { toISO, mapEmploymentType, normalizeLocation, relativeTime, makeJob } from "../lib/schema.mjs";

export async function collectAshby(company) {
  const data = await fetchJson(`https://api.ashbyhq.com/posting-api/job-board/${company}`);
  const jobs = Array.isArray(data) ? data : (data.jobs || []);
  return jobs.map((j) => {
    return makeJob({
      job_posting_id: `ashby_${j.id}`,
      url: j.jobUrl || j.applyUrl,
      job_title: j.title,
      company_name: j.company || company,
      company_logo: null,
      job_location: normalizeLocation(j.location, j.isRemote ? "Remote" : null),
      job_posted_date: toISO(j.publishedAt || j.createdAt),
      job_posted_time: relativeTime(j.publishedAt || j.createdAt),
      job_seniority_level: null,
      job_employment_type: mapEmploymentType(j.employmentType),
      job_industries: j.team || null,
      job_function: j.department || null,
      _query_label: "Ashby",
    });
  });
}
