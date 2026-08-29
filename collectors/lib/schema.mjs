// Shared normalizers mapping ATS fields -> the unified schema used by all_jobs.json.

export function toISO(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

export function mapEmploymentType(raw) {
  if (!raw) return null;
  const s = String(raw).toLowerCase().trim();
  if (s.includes("intern")) return "Internship";
  if (s.includes("contract") || s.includes("temp")) return "Contract";
  if (s.includes("part")) return "Part-time";
  if (s.includes("full")) return "Full-time";
  if (s.includes("volunteer")) return "Volunteer";
  if (s.includes("other")) return "Other";
  return null;
}

// Normalize to a single location string.
export function normalizeLocation(...parts) {
  const seen = new Set();
  const out = [];
  for (const p of parts) {
    if (!p) continue;
    const s = String(p).trim();
    if (!s) continue;
    const key = s.toLowerCase();
    // Avoid a redundant bare "Remote" when an earlier part already signals remote.
    if (key === "remote" && seen.has("remote")) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out.join(", ") || null;
}

export function relativeTime(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days < 0) return "just now";
  if (days === 0) return "today";
  if (days === 1) return "1 day ago";
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)} week${Math.floor(days / 7) === 1 ? "" : "s"} ago`;
  return `${Math.floor(days / 30)} month${Math.floor(days / 30) === 1 ? "" : "s"} ago`;
}

export function makeJob(fields) {
  return {
    job_posting_id: fields.job_posting_id,
    url: fields.url,
    job_title: fields.job_title,
    company_name: fields.company_name,
    company_logo: fields.company_logo || null,
    job_location: fields.job_location || null,
    job_posted_date: fields.job_posted_date || null,
    job_posted_time: fields.job_posted_time || null,
    job_seniority_level: fields.job_seniority_level || null,
    job_employment_type: fields.job_employment_type || null,
    job_industries: fields.job_industries || null,
    job_function: fields.job_function || null,
    job_num_applicants: null,
    is_easy_apply: false,
    _query_label: fields._query_label || null,
  };
}
