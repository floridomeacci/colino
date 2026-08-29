// WebMCP tool registration for Colino.
// Exposes the job platform's capabilities to browser/agent clients via
// document.modelContext.registerTool(), per the W3C WebMCP spec.
// Safety: all tools are read-only queries against our existing JSON API.
// No API keys, secrets, or user tokens are ever exposed to the agent.
// All destructive or privileged actions remain behind the human UI.

(function registerColinoTools() {
  if (!document.modelContext || typeof document.modelContext.registerTool !== "function") {
    // WebMCP not available (older browser / flag disabled). Silently skip.
    return;
  }

  const API = (path, opts) =>
    fetch(path, opts).then((r) => r.json());

  function text(content) {
    return { content: [{ type: "text", text: typeof content === "string" ? content : JSON.stringify(content, null, 2) }] };
  }

  const MAX_RESULTS = 50;
  const MAX_QUERY = 200;

  function clean(str, max) {
    return String(str || "").slice(0, max).trim();
  }

  async function safe(fn) {
    try {
      return await fn();
    } catch (err) {
      return text({ error: String(err && err.message ? err.message : err) });
    }
  }

  const register = (name, description, inputSchema, execute) => {
    try {
      document.modelContext.registerTool({ name, description, inputSchema, execute });
    } catch (err) {
      console.warn(`[webmcp] failed to register "${name}"`, err);
    }
  };

  register(
    "search_jobs",
    "Search the Colino job database by a natural-language query and return matching job listings (title, company, location, seniority, URL).",
    {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query, e.g. 'senior product designer'." },
        limit: { type: "number", description: `Maximum results to return (default 10, max ${MAX_RESULTS}).` }
      },
      required: ["query"]
    },
    async ({ query, limit }) =>
      safe(async () => {
        const q = clean(query, MAX_QUERY);
        if (!q) return text({ error: "query is required" });
        const n = Math.min(Math.max(Number(limit) || 10, 1), MAX_RESULTS);
        const jobs = await API("/api/jobs");
        const tokens = q.toLowerCase().split(/[^a-z0-9+#]+/).filter((t) => t.length > 1);
        const scored = jobs.map((j) => {
          const title = (j.job_title || "").toLowerCase();
          const hay = [j.job_title, j.company_name, j.job_location, j.job_function, j.job_industries, j.description].join(" ").toLowerCase();
          let s = 0;
          for (const t of tokens) { if (hay.includes(t)) s++; if (title.includes(t)) s += 2; }
          return { j, s };
        }).sort((a, b) => b.s - a.s).filter((x) => x.s > 0);
        const out = scored.slice(0, n).map((x) => ({
          title: x.j.job_title,
          company: x.j.company_name,
          location: x.j.job_location,
          seniority: x.j.job_seniority_level,
          url: x.j.url,
          posted: x.j.job_posted_time || x.j.job_posted_date
        }));
        return text({ total: jobs.length, results: out });
      })
  );

  register(
    "get_job_details",
    "Get full details for a specific job listing, including its description, given its URL.",
    {
      type: "object",
      properties: {
        url: { type: "string", description: "The full URL of the job listing." }
      },
      required: ["url"]
    },
    async ({ url }) =>
      safe(async () => {
        const u = clean(url, 500);
        if (!u) return text({ error: "url is required" });
        const jobs = await API("/api/jobs");
        const job = jobs.find((j) => j.url === u);
        if (!job) return text({ error: "Job not found" });
        const { description, ...rest } = job;
        return text({ ...rest, description: description ? description.slice(0, 3000) : null });
      })
  );

  register(
    "get_companies",
    "List the companies currently represented in the Colino database, with job counts.",
    {
      type: "object",
      properties: {
        query: { type: "string", description: "Optional substring to filter company names." },
        limit: { type: "number", description: "Maximum companies to return (default 20)." }
      }
    },
    async ({ query, limit }) =>
      safe(async () => {
        const jobs = await API("/api/jobs");
        const counts = new Map();
        for (const j of jobs) {
          const c = j.company_name || "Unknown";
          counts.set(c, (counts.get(c) || 0) + 1);
        }
        let entries = [...counts.entries()].sort((a, b) => b[1] - a[1]);
        const q = clean(query, 100).toLowerCase();
        if (q) entries = entries.filter(([name]) => name.toLowerCase().includes(q));
        const n = Math.min(Math.max(Number(limit) || 20, 1), MAX_RESULTS);
        return text(entries.slice(0, n).map(([name, count]) => ({ company: name, jobs: count })));
      })
  );

  register(
    "get_stats",
    "Return aggregate platform statistics: total jobs, number of companies, and seniority distribution.",
    {
      type: "object",
      properties: {}
    },
    async () =>
      safe(async () => {
        const jobs = await API("/api/jobs");
        const companies = new Set(jobs.map((j) => j.company_name).filter(Boolean));
        const seniority = {};
        for (const j of jobs) {
          const s = j.job_seniority_level || "Unknown";
          seniority[s] = (seniority[s] || 0) + 1;
        }
        return text({ total_jobs: jobs.length, companies: companies.size, seniority });
      })
  );

  register(
    "propose_companies",
    "Given a role or domain, generate a list of companies that hire for it, then fetch their live job postings. Returns the suggested companies and the jobs discovered.",
    {
      type: "object",
      properties: {
        role: { type: "string", description: "A role, domain, or search phrase, e.g. 'interior design netherlands' or 'senior product designer'." }
      },
      required: ["role"]
    },
    async ({ role }) =>
      safe(async () => {
        const q = clean(role, MAX_QUERY);
        if (!q) return text({ error: "role is required" });
        const data = await API("/api/leads", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: q })
        });
        if (data.error) return text({ error: data.error });
        const jobs = (data.jobs || []).map((j) => ({
          title: j.job_title,
          company: j.company_name,
          location: j.job_location,
          seniority: j.job_seniority_level,
          url: j.url
        }));
        return text({ companies: data.companies || [], companies_count: (data.companies || []).length, jobs_count: jobs.length, jobs: jobs.slice(0, MAX_RESULTS) });
      })
  );
})();
