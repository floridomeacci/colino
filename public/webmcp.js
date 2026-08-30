// WebMCP tool registration for Colino.
// Exposes the job platform's capabilities to browser/agent clients via
// document.modelContext.registerTool(), per the W3C WebMCP spec.
// Safety: all tools are read-only queries against our existing JSON API.
// No API keys, secrets, or user tokens are ever exposed to the agent.
// All destructive or privileged actions remain behind the human UI.

(function registerColinoTools() {
  if (!document.modelContext || typeof document.modelContext.registerTool !== "function") {
    return;
  }

  const API = (path, opts) =>
    fetch(path, opts).then((r) => r.json());

  function ok(data, meta = {}) {
    return { ok: true, data, meta: { generated_at: new Date().toISOString(), ...meta } };
  }

  function fail(code, message, retryable = false) {
    return { ok: false, error: { code, message, retryable } };
  }

  async function safe(fn) {
    try {
      return await fn();
    } catch (err) {
      const msg = String(err && err.message ? err.message : err);
      if (/interrupted|retry|timed out|timeout|overloaded|capacity|429/i.test(msg)) {
        return fail("UPSTREAM_TIMEOUT", msg, true);
      }
      return fail("UPSTREAM_ERROR", msg, false);
    }
  }

  const MAX_RESULTS = 50;
  const MAX_QUERY = 200;

  function clean(str, max) {
    return String(str || "").slice(0, max).trim();
  }

  // Executor-level validation: WebMCP does not guarantee runtime schema enforcement.
  function checkRange(input, key, min, max) {
    if (input[key] == null) return null;
    const n = Number(input[key]);
    if (!Number.isFinite(n) || n < min || n > max) {
      return `'${key}' must be between ${min} and ${max}`;
    }
    return null;
  }

  function jobId(j) {
    return j.job_posting_id || null;
  }

  function stripHtml(s) {
    if (!s) return "";
    return String(s)
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&#39;|&apos;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/\s+/g, " ")
      .trim();
  }

  function summary(j) {
    const r = j.rerank || null;
    return {
      job_id: jobId(j),
      job_title: j.job_title,
      company_name: j.company_name,
      job_location: j.job_location,
      country: j.country,
      seniority: j.job_seniority || "unknown",
      seniority_raw: j.seniority_raw || null,
      job_employment_type: j.job_employment_type,
      workplace_type: j.workplace_type,
      source_url: j.url,
      posted_at: j.job_posted_date || null,
      is_active: j.is_active !== false,
      last_verified_at: j.last_verified_at || null,
      remote_regions: j.remote_regions || null,
      canonical_country: j.canonical_country || null,
      _dup_count: j._dup_count || null,
      rerank_status: j.rerank_status || null,
      role_fit: r ? r.role_fit : null,
      skills_fit: r ? r.skills_fit : null,
      seniority_fit: r ? r.seniority_fit : null,
      location_fit: r ? r.location_fit : null,
      overall: r ? r.overall : null,
      reasons: r ? (r.reasons || []) : null,
      gaps: r ? (r.gaps || []) : null
    };
  }

  const register = async (name, title, description, inputSchema, execute) => {
    try {
      await document.modelContext.registerTool({ name, title, description, inputSchema, execute });
    } catch (err) {
      console.warn(`[webmcp] failed to register "${name}"`, err);
    }
  };

  // ── search-jobs: natural language + structured filters ──
  register(
    "search-jobs",
    "Search jobs",
    "Search the Colino job database by a natural-language query, with optional structured filters (location, seniority, employment type, remote, salary, sorting). Returns ranked matches with a stable job_id.",
    {
      type: "object",
      properties: {
        query: { type: "string", minLength: 1, maxLength: 200, description: "Natural-language query, e.g. 'senior product designer'." },
        preferred_locations: { type: "array", items: { type: "string" }, description: "Locations to prefer when ranking, e.g. ['Amsterdam', 'Remote EU']. Jobs elsewhere are not removed, just ranked lower." },
        location_mode: { type: "string", enum: ["prefer", "strict"], default: "prefer", description: "'prefer' (default) boosts matching locations; 'strict' keeps only jobs matching preferred_locations." },
        seniority: { type: "array", items: { type: "string", enum: ["intern", "entry", "associate", "mid", "senior", "lead", "manager", "director", "executive"] }, description: "Seniority levels to include." },
        employment_types: { type: "array", items: { type: "string", enum: ["full_time", "part_time", "contract", "internship"] }, description: "Employment types to include." },
        remote: { type: "boolean", description: "True for remote-only, false for on-site only. Omit for either." },
        posted_within_days: { type: "integer", minimum: 1, maximum: 365, description: "Only jobs posted within this many days." },
        companies: { type: "array", items: { type: "string" }, description: "Company names to include." },
        exclude_companies: { type: "array", items: { type: "string" }, description: "Company names to exclude." },
        sort: { type: "string", enum: ["relevance", "recent", "salary_desc", "salary_asc"], default: "relevance", description: "Sort order." },
        limit: { type: "integer", minimum: 1, maximum: 50, default: 10, description: "Number of results to return." },
        cursor: { type: "integer", minimum: 0, default: 0, description: "Pagination offset." }
      },
      required: ["query"]
    },
    async (input) =>
      safe(async () => {
        const q = clean(input.query, MAX_QUERY);
        if (!q) return fail("INVALID_INPUT", "query is required");
        if (q.length > MAX_QUERY) return fail("INVALID_INPUT", `query must be at most ${MAX_QUERY} characters`);
        const limitErr = checkRange(input, "limit", 1, MAX_RESULTS);
        if (limitErr) return fail("INVALID_INPUT", limitErr);
        const cursorErr = checkRange(input, "cursor", 0, 100000);
        if (cursorErr) return fail("INVALID_INPUT", cursorErr);
        const daysErr = input.posted_within_days != null ? checkRange(input, "posted_within_days", 1, 365) : null;
        if (daysErr) return fail("INVALID_INPUT", daysErr);
        const limit = Number(input.limit) || 10;
        const offset = Number(input.cursor) || 0;
        const tags = [q];
        const locs = (Array.isArray(input.preferred_locations) ? input.preferred_locations : (Array.isArray(input.locations) ? input.locations : []));
        locs.forEach((s) => { const c = clean(s, 100); if (c) tags.push(c); });
        const res = await API("/api/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tags: tags.slice(0, 20),
            location_mode: input.location_mode === "strict" ? "strict" : "prefer"
          })
        });
        if (res.error) return fail("UPSTREAM_ERROR", res.error);
        let jobs = res.jobs || [];

        // Structured filters (post-filtering since /api/search is semantic).
        // Note: location strictness is enforced server-side before reranking.
        if (Array.isArray(input.seniority) && input.seniority.length) {
          const want = input.seniority.map((s) => String(s).toLowerCase());
          jobs = jobs.filter((j) => want.includes(String(j.job_seniority || "unknown").toLowerCase()));
        }
        if (Array.isArray(input.employment_types) && input.employment_types.length) {
          const want = input.employment_types.map((s) => String(s).toLowerCase());
          jobs = jobs.filter((j) => {
            const et = String(j.job_employment_type || "").toLowerCase();
            return want.some((w) => et.includes(w));
          });
        }
        if (typeof input.remote === "boolean") {
          jobs = jobs.filter((j) => {
            const isRemote = /remote/i.test(`${j.job_location || ""} ${j.workplace_type || ""}`.toLowerCase());
            return isRemote === input.remote;
          });
        }
        if (Number(input.posted_within_days) > 0) {
          const cutoff = Date.now() - Number(input.posted_within_days) * 86400000;
          jobs = jobs.filter((j) => j.job_posted_date && new Date(j.job_posted_date).getTime() >= cutoff);
        }
        if (Array.isArray(input.companies) && input.companies.length) {
          const want = input.companies.map((s) => String(s).toLowerCase());
          jobs = jobs.filter((j) => want.some((w) => String(j.company_name || "").toLowerCase().includes(w)));
        }
        if (Array.isArray(input.exclude_companies) && input.exclude_companies.length) {
          const want = input.exclude_companies.map((s) => String(s).toLowerCase());
          jobs = jobs.filter((j) => !want.some((w) => String(j.company_name || "").toLowerCase().includes(w)));
        }

        const matched = jobs.length;
        if (input.sort === "recent") {
          jobs.sort((a, b) => new Date(b.job_posted_date || 0) - new Date(a.job_posted_date || 0));
        } else if (input.sort === "salary_desc" || input.sort === "salary_asc") {
          const sv = (j) => (j.base_salary && j.base_salary.max_amount) || (j.base_salary && j.base_salary.min_amount) || 0;
          jobs.sort((a, b) => input.sort === "salary_desc" ? sv(b) - sv(a) : sv(a) - sv(b));
        }

        const page = jobs.slice(offset, offset + limit);
        return ok({
          matched_count: matched,
          returned_count: page.length,
          next_cursor: offset + limit < matched ? offset + limit : null,
          database_total: res.total ?? matched,
          search_mode: res.search_mode || null,
          rerank_status: res.rerank_status || null,
          jobs: page.map(summary)
        }, { search_mode: res.search_mode || null, ...(res.meta || {}) });
      })
  );

  // ── get-job: details by job_id ──
  register(
    "get-job",
    "Job details",
    "Get full details for a single job listing by its stable job_id, including the cleaned description.",
    {
      type: "object",
      properties: {
        job_id: { type: "string", minLength: 1, description: "The stable job_id returned by search-jobs." },
        source_url: { type: "string", description: "Fallback: look up by the source URL instead." }
      },
      anyOf: [
        { required: ["job_id"] },
        { required: ["source_url"] }
      ]
    },
    async (input) =>
      safe(async () => {
        const id = clean(input.job_id, 200);
        const url = clean(input.source_url, 500);
        if (!id && !url) return fail("INVALID_INPUT", "job_id or source_url is required");
        const job = await API("/api/job", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(id ? { job_id: id } : { url })
        });
        if (job.error) return fail("JOB_NOT_FOUND", job.error);
        return ok({
          ...summary(job),
          description_text: stripHtml(job.description),
          description_truncated: (job.description || "").length > 3000,
          base_salary: job.base_salary,
          company_logo: job.company_logo,
          is_easy_apply: job.is_easy_apply,
          collected_at: job.collected_at ? new Date(job.collected_at).toISOString() : null
        });
      })
  );

  // ── get-jobs: batch details ──
  register(
    "get-jobs",
    "Multiple job details",
    "Get full details for several jobs at once, given a list of job_id values.",
    {
      type: "object",
      properties: {
        job_ids: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 20, description: "List of job_id values." }
      },
      required: ["job_ids"]
    },
    async (input) =>
      safe(async () => {
        const ids = (input.job_ids || []).map((s) => clean(s, 200)).filter(Boolean);
        if (!ids.length) return fail("INVALID_INPUT", "job_ids is required");
        const jobs = await API("/api/jobs");
        const byId = new Map(jobs.map((j) => [j.job_posting_id, j]));
        const out = [];
        const missing = [];
        for (const id of ids) {
          const j = byId.get(id);
          if (j) out.push({ ...summary(j), description_text: stripHtml(j.description) });
          else missing.push(id);
        }
        return ok({ jobs: out, missing_job_ids: missing });
      })
  );

  // ── get-companies ──
  register(
    "get-companies",
    "Companies",
    "List the companies currently represented in the Colino database, with job counts.",
    {
      type: "object",
      properties: {
        query: { type: "string", maxLength: 100, description: "Optional substring to filter company names." },
        limit: { type: "integer", minimum: 1, maximum: 50, default: 20 }
      }
    },
    async (input) =>
      safe(async () => {
        const limitErr = checkRange(input, "limit", 1, MAX_RESULTS);
        if (limitErr) return fail("INVALID_INPUT", limitErr);
        const jobs = await API("/api/jobs");
        const counts = new Map();
        for (const j of jobs) {
          const c = j.company_name || "Unknown";
          counts.set(c, (counts.get(c) || 0) + 1);
        }
        let entries = [...counts.entries()].sort((a, b) => b[1] - a[1]);
        const q = clean(input.query, 100).toLowerCase();
        if (q) entries = entries.filter(([name]) => name.toLowerCase().includes(q));
        const limit = Number(input.limit) || 20;
        return ok({ companies: entries.slice(0, limit).map(([company, jobs]) => ({ company, jobs })) });
      })
  );

  // ── get-stats ──
  register(
    "get-stats",
    "Platform stats",
    "Return aggregate platform statistics: total jobs, number of companies, and seniority distribution.",
    { type: "object", properties: {} },
    async () =>
      safe(async () => {
        const jobs = await API("/api/jobs");
        const companies = new Set(jobs.map((j) => j.company_name).filter(Boolean));
        const seniority = {};
        for (const j of jobs) {
          const s = j.job_seniority || "unknown";
          seniority[s] = (seniority[s] || 0) + 1;
        }
        const dbUpdated = jobs.length ? new Date(Math.max(...jobs.map((j) => j.collected_at || 0))).toISOString() : null;
        return ok({ total_jobs: jobs.length, companies: companies.size, seniority, database_updated_at: dbUpdated });
      })
  );

  // ── get-active-profile-summary ──
  register(
    "get-active-profile-summary",
    "Active profile",
    "Return the current session's CV profile (target roles, seniority, skills, preferred locations). This is a session-scoped summary and never includes contact details.",
    { type: "object", properties: {} },
    async () => {
      const profile = window.__colinoProfile;
      if (!profile) return fail("NO_PROFILE", "No resume has been uploaded in this session yet.");
      return ok({
        profile_id: "session",
        target_roles: profile.roles || [],
        future_roles: profile.future_roles || [],
        seniority: profile.seniority || null,
        skills: profile.skills || [],
        industries: profile.industries || [],
        preferred_locations: profile.locations || []
      });
    }
  );

  // ── match-jobs-to-profile ──
  register(
    "match-jobs-to-profile",
    "Match to profile",
    "Rank the job database against the active CV profile and return the best matches with a score and reasons.",
    {
      type: "object",
      properties: {
        limit: { type: "integer", minimum: 1, maximum: 50, default: 10 }
      }
    },
    async (input) =>
      safe(async () => {
        const limitErr = checkRange(input, "limit", 1, MAX_RESULTS);
        if (limitErr) return fail("INVALID_INPUT", limitErr);
        const profile = window.__colinoProfile;
        if (!profile) return fail("NO_PROFILE", "No resume has been uploaded in this session yet.");
        const limit = Number(input.limit) || 10;
        const res = await API("/api/match-profile", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ profile, limit })
        });
        if (res.error) return fail("UPSTREAM_ERROR", res.error);
        return ok(res);
      })
  );

  // ── explain-job-match ──
  register(
    "explain-job-match",
    "Explain match",
    "Explain why a specific job matches the active profile, listing match reasons and gaps.",
    {
      type: "object",
      properties: {
        job_id: { type: "string", minLength: 1, description: "The job_id to explain." }
      },
      required: ["job_id"]
    },
    async (input) =>
      safe(async () => {
        const profile = window.__colinoProfile;
        if (!profile) return fail("NO_PROFILE", "No resume has been uploaded in this session yet.");
        const jobs = await API("/api/jobs");
        const id = clean(input.job_id, 200);
        const job = jobs.find((j) => j.job_posting_id === id);
        if (!job) return fail("JOB_NOT_FOUND", "No job matched that job_id.");
        const res = await API("/api/match-profile", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ profile, limit: 100 })
        });
        const match = (res.jobs || []).find((m) => m.job_id === id);
        return ok({
          job_id: id,
          job_title: job.job_title,
          match_score: match ? match.match_score : null,
          match_reasons: match ? match.match_reasons : [],
          gaps: match ? match.gaps : []
        });
      })
  );

  // ── start-company-discovery ──
  register(
    "start-company-discovery",
    "Start company discovery",
    "Propose a list of companies that hire for a role or domain. Returns immediately with the suggested companies and an operation_id for polling.",
    {
      type: "object",
      properties: {
        role: { type: "string", minLength: 1, maxLength: 200, description: "A role, domain, or search phrase, e.g. 'product designer'." }
      },
      required: ["role"]
    },
    async (input) =>
      safe(async () => {
        const q = clean(input.role, MAX_QUERY);
        if (!q) return fail("INVALID_INPUT", "role is required");
        const res = await API("/api/discovery/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: q })
        });
        if (res.error) return fail("UPSTREAM_ERROR", res.error);
        return ok(res);
      })
  );

  // ── get-company-discovery-status ──
  register(
    "get-company-discovery-status",
    "Company discovery status",
    "Poll the progress of a company discovery operation and retrieve fetched jobs as they complete. Call repeatedly until status is 'complete'.",
    {
      type: "object",
      properties: {
        operation_id: { type: "string", minLength: 1, description: "The operation_id from start-company-discovery." }
      },
      required: ["operation_id"]
    },
    async (input) =>
      safe(async () => {
        const id = clean(input.operation_id, 100);
        if (!id) return fail("INVALID_INPUT", "operation_id is required");
        const res = await API("/api/discovery/status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ operation_id: id })
        });
        if (res.error) return fail("UPSTREAM_ERROR", res.error);
        const jobs = (res.jobs || []).map(summary);
        return ok({
          operation_id: id,
          status: res.status,
          companies_completed: res.companies_completed,
          companies_total: res.companies_total,
          companies_failed: res.companies_failed ?? 0,
          failed: res.failed || [],
          last_progress_at: res.last_progress_at,
          last_error: res.last_error,
          jobs
        });
      })
  );
  // ── Saved jobs (session-scoped, localStorage) ──
  function savedIds() {
    try { return new Set(JSON.parse(localStorage.getItem("colino_saved") || "[]")); } catch (e) { return new Set(); }
  }
  function saveIds(set) {
    try { localStorage.setItem("colino_saved", JSON.stringify([...set])); } catch (e) {}
  }

  register(
    "save-job",
    "Save job",
    "Save a job to the current session's shortlist by its job_id.",
    {
      type: "object",
      properties: {
        job_id: { type: "string", minLength: 1, description: "The job_id to save." }
      },
      required: ["job_id"]
    },
    async (input) =>
      safe(async () => {
        const id = clean(input.job_id, 200);
        if (!id) return fail("INVALID_INPUT", "job_id is required");
        const jobs = await API("/api/jobs");
        if (!jobs.some((j) => j.job_posting_id === id)) return fail("JOB_NOT_FOUND", "No job matched that job_id.");
        const s = savedIds();
        s.add(id);
        saveIds(s);
        return ok({ job_id: id, saved: true, saved_count: s.size });
      })
  );

  register(
    "unsave-job",
    "Unsave job",
    "Remove a job from the current session's shortlist by its job_id.",
    {
      type: "object",
      properties: {
        job_id: { type: "string", minLength: 1, description: "The job_id to remove." }
      },
      required: ["job_id"]
    },
    async (input) =>
      safe(async () => {
        const id = clean(input.job_id, 200);
        if (!id) return fail("INVALID_INPUT", "job_id is required");
        const s = savedIds();
        s.delete(id);
        saveIds(s);
        return ok({ job_id: id, saved: false, saved_count: s.size });
      })
  );

  register(
    "list-saved-jobs",
    "Saved jobs",
    "List the jobs saved in the current session, in the order they were saved.",
    { type: "object", properties: {} },
    async () =>
      safe(async () => {
        const ids = [...savedIds()];
        if (!ids.length) return ok({ jobs: [], saved_count: 0 });
        const jobs = await API("/api/jobs");
        const byId = new Map(jobs.map((j) => [j.job_posting_id, j]));
        const out = ids.map((id) => byId.get(id)).filter(Boolean).map(summary);
        return ok({ jobs: out, saved_count: out.length });
      })
  );
})();
