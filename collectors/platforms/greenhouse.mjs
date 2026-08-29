// Greenhouse — https://developers.greenhouse.io/job-board.html
// GET https://boards-api.greenhouse.io/v1/boards/{company}/jobs
import { fetchJson } from "../lib/http.mjs";
import { toISO, mapEmploymentType, normalizeLocation, relativeTime, makeJob } from "../lib/schema.mjs";

export async function collectGreenhouse(company) {
  const data = await fetchJson(`https://boards-api.greenhouse.io/v1/boards/${company}/jobs`);
  const jobs = Array.isArray(data) ? data : (data.jobs || []);
  return jobs.map((j) => {
    const employment = (j.metadata || []).find((m) => /employment/i.test(m.name || ""));
    const seniority = (j.metadata || []).find((m) => /level|seniority/i.test(m.name || ""));
    return makeJob({
      job_posting_id: `gh_${j.id}`,
      url: j.absolute_url,
      job_title: j.title,
      company_name: j.company_name || company,
      company_logo: null,
      job_location: normalizeLocation(j.location && j.location.name, j.office_name),
      job_posted_date: toISO(j.first_published || j.updated_at),
      job_posted_time: relativeTime(j.first_published || j.updated_at),
      job_seniority_level: seniority ? seniority.value : null,
      job_employment_type: employment ? mapEmploymentType(employment.value) : null,
      job_industries: (j.departments || []).map((d) => d.name).join(", ") || null,
      job_function: null,
      _query_label: "Greenhouse",
    });
  });
}
