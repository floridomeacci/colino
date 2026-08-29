// Recruitee — public offers API
// GET https://{company}.recruitee.com/api/offers
import { fetchJson } from "../lib/http.mjs";
import { toISO, mapEmploymentType, normalizeLocation, relativeTime, makeJob } from "../lib/schema.mjs";

export async function collectRecruitee(company) {
  const data = await fetchJson(`https://${company}.recruitee.com/api/offers`);
  const offers = data.offers || [];
  return offers.map((o) => {
    return makeJob({
      job_posting_id: `recruitee_${o.id}`,
      url: o.careers_url || o.careers_apply_url,
      job_title: o.title,
      company_name: o.company_name || company,
      company_logo: null,
      job_location: normalizeLocation(o.city, o.country, o.remote ? "Remote" : null, o.location),
      job_posted_date: toISO(o.published_at || o.created_at),
      job_posted_time: relativeTime(o.published_at || o.created_at),
      job_seniority_level: o.experience_level || null,
      job_employment_type: mapEmploymentType(o.employment_type),
      job_industries: null,
      job_function: o.department || null,
      _query_label: "Recruitee",
    });
  });
}
