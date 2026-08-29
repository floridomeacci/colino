let allJobs = [];
let filteredJobs = [];
let currentPage = 1;
const PAGE_SIZE = 100;

// ── CV Match state ──
let cvMatchUrls = new Set();
let cvMatchScores = {};
let pinnedIds = new Set();

// ── Likes / Dislikes ──
let likedUrls = new Set();
let dislikedUrls = new Set();
function loadVotes() {
  try {
    const l = localStorage.getItem('colino_likes');
    if (l) likedUrls = new Set(JSON.parse(l));
    const d = localStorage.getItem('colino_dislikes');
    if (d) dislikedUrls = new Set(JSON.parse(d));
  } catch (e) {}
}
function saveVotes() {
  try {
    localStorage.setItem('colino_likes', JSON.stringify([...likedUrls]));
    localStorage.setItem('colino_dislikes', JSON.stringify([...dislikedUrls]));
  } catch (e) {}
}
function vote(url, kind) {
  if (kind === 'like') {
    dislikedUrls.delete(url);
    if (likedUrls.has(url)) likedUrls.delete(url);
    else likedUrls.add(url);
  } else {
    likedUrls.delete(url);
    if (dislikedUrls.has(url)) dislikedUrls.delete(url);
    else dislikedUrls.add(url);
    // Disagreeing with a suggestion removes it from the pinned top.
    pinnedIds.delete(jobId(url));
  }
  saveVotes();
}

// Auto-upvote roles the AI suggests, so semantic search keeps leaning the right way.
function autoLike(urls) {
  let changed = false;
  for (const url of urls) {
    dislikedUrls.delete(url);
    if (!likedUrls.has(url)) { likedUrls.add(url); changed = true; }
  }
  if (changed) saveVotes();
}

// Instantly re-rank using the current semantic scores + local vote nudge.
function applyLocalVoteNudge() {
  if (activeTags.length && semanticScores) {
    applyFilters();
    updateStats();
  }
  runSemanticSearch();
}

// ── Search tags ──
let activeTags = [];
let semanticScores = null;
const tagRow = document.getElementById('tagRow');

function loadTags() {
  try {
    const v = localStorage.getItem('colino_tags');
    if (v) activeTags = JSON.parse(v) || [];
  } catch (e) {}
}
function saveTags() {
  try { localStorage.setItem('colino_tags', JSON.stringify(activeTags)); } catch (e) {}
}

function splitQueryToTags(text) {
  return String(text)
    .split(/[,;]/)
    .map(s => s.trim())
    .filter(s => s.length > 1)
    .map(s => s.replace(/\s+/g, ' ').trim());
}

function addTags(list) {
  for (const t of list) {
    const key = t.toLowerCase();
    if (!activeTags.some(x => x.toLowerCase() === key)) activeTags.push(t);
  }
  renderTags();
  saveTags();
  runSemanticSearch();
}

function removeTag(text) {
  activeTags = activeTags.filter(t => t.toLowerCase() !== text.toLowerCase());
  renderTags();
  saveTags();
  if (!activeTags.length) semanticScores = null;
  runSemanticSearch();
}

function clearTags() {
  activeTags = [];
  semanticScores = null;
  renderTags();
  saveTags();
  applyFilters();
  updateStats();
}

let semanticTimer = null;
function runSemanticSearch() {
  // Re-render immediately with whatever ordering we already have.
  applyFilters();
  updateStats();
  if (!activeTags.length) {
    semanticScores = null;
    return;
  }
  clearTimeout(semanticTimer);
  semanticTimer = setTimeout(async () => {
    try {
      const res = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags: activeTags, likes: [...likedUrls], dislikes: [...dislikedUrls] }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      if (Array.isArray(data.jobs)) {
        semanticScores = {};
        for (const j of data.jobs) semanticScores[j.url] = j.score;
        applyFilters();
        updateStats();
      }
    } catch (e) {
      semanticScores = null;
    }
  }, 0);
}

function renderTags() {
  if (!tagRow) return;
  tagRow.innerHTML = activeTags.map(t =>
    `<span class="tag-chip">${esc(t)}<button class="tag-chip-x" data-tag="${esc(t)}" aria-label="Remove">×</button></span>`
  ).join('');
  tagRow.querySelectorAll('.tag-chip-x').forEach(btn => {
    btn.addEventListener('click', () => removeTag(btn.dataset.tag));
  });
}

function clearTags() {
  activeTags = [];
  renderTags();
}

function jobId(url) {
  let h = 5381;
  const s = String(url || "");
  for (let i = 0; i < s.length; i++) h = ((h * 33) + s.charCodeAt(i)) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  const chars = "0123456789abcdefghijklmnopqrstuvwxyz";
  let out = "";
  let n = h;
  for (let i = 0; i < 5; i++) { out = chars[n % 36] + out; n = Math.floor(n / 36); }
  return out.toUpperCase();
}

// Recency with a slight nudge for liked jobs (treated as ~7 days newer).
function favRecency(job) {
  const d = new Date(job.job_posted_date || 0).getTime();
  return likedUrls.has(job.url) ? d + (7 * 86400000) : d;
}

// ── Industry grouping ──
const INDUSTRY_GROUPS = {
  'IT & Software': ['software', 'it services', 'it system', 'computer', 'information technology', 'saas', 'cloud'],
  'Technology & Internet': ['technology, information and internet', 'internet', 'tech', 'semiconductor', 'embedded', 'blockchain', 'quantum'],
  'AI & Data': ['artificial intelligence', 'machine learning', 'data', 'analytics', 'business intelligence'],
  'Financial Services': ['financial', 'banking', 'insurance', 'capital markets', 'investment', 'venture capital', 'fintech', 'accounting', 'pension'],
  'Consulting & Services': ['consulting', 'professional services', 'staffing', 'human resources', 'outsourcing', 'management consulting'],
  'Media & Advertising': ['advertising', 'marketing', 'media', 'design', 'creative', 'animation', 'graphic', 'digital media', 'public relations', 'branding', 'content'],
  'Manufacturing': ['manufacturing', 'industrial', 'machinery', 'automotive', 'chemical', 'plastics', 'metals', 'paper', 'packaging', 'appliances'],
  'Healthcare': ['health', 'medical', 'pharma', 'biotech', 'hospital', 'wellness', 'life science', 'genomic'],
  'Engineering': ['engineering', 'construction', 'architecture', 'civil engineering', 'mechanical', 'structural'],
  'Energy': ['energy', 'oil', 'gas', 'renewable', 'solar', 'utilities', 'nuclear', 'sustainability', 'climate', 'environmental'],
  'Retail & Consumer': ['retail', 'e-commerce', 'consumer', 'fashion', 'luxury', 'apparel', 'food', 'beverage', 'cosmetic', 'sporting goods', 'wholesale'],
  'Education': ['education', 'higher education', 'research', 'e-learning', 'training', 'academic', 'university'],
  'Government': ['government', 'non-profit', 'civic', 'public policy', 'international affairs', 'ngo', 'think tank'],
  'Telecom': ['telecommunications', 'telecom', 'wireless', 'networking'],
  'Transport & Logistics': ['transportation', 'logistics', 'shipping', 'freight', 'aviation', 'airlines', 'maritime', 'railroad', 'trucking', 'warehousing'],
  'Entertainment': ['entertainment', 'gaming', 'game', 'music', 'film', 'video', 'broadcast', 'performing arts', 'spectator sport'],
  'Real Estate': ['real estate', 'property'],
  'Legal': ['legal', 'law practice', 'law enforcement'],
  'Travel & Hospitality': ['travel', 'hospitality', 'hotel', 'restaurant', 'leisure', 'tourism'],
};

function getIndustryGroup(raw) {
  if (!raw) return null;
  const lower = raw.toLowerCase();
  for (const [group, keywords] of Object.entries(INDUSTRY_GROUPS)) {
    if (keywords.some(kw => lower.includes(kw))) return group;
  }
  return 'Other';
}

// DOM
const feed = document.getElementById('jobFeed');
const loader = document.getElementById('loader');
const searchInput = document.getElementById('searchInput');
const seniorityFilter = document.getElementById('seniorityFilter');
const employmentFilter = document.getElementById('employmentFilter');
const easyApplyFilter = document.getElementById('easyApplyFilter');
const newFilter = document.getElementById('newFilter');
const salaryFilter = document.getElementById('salaryFilter');
const sortBy = document.getElementById('sortBy');
const feedFooter = document.getElementById('feedFooter');

document.addEventListener('DOMContentLoaded', () => {
  loadJobs();
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const val = searchInput.value.trim();
      if (val) {
        addTags(splitQueryToTags(val));
        searchInput.value = '';
      }
    }
  });
  [seniorityFilter, employmentFilter, easyApplyFilter, newFilter, salaryFilter, sortBy]
    .forEach(el => el.addEventListener('change', () => { syncSelectState(el); applyFilters(); }));
});

function syncSelectState(el) {
  el.classList.toggle('set', el.value !== '');
}

async function loadJobs() {
  try {
    const res = await fetch('/api/jobs');
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error('Bad response');
    allJobs = data;
    populateFilters();
    applyFilters();
    updateStats();
  } catch (err) {
    feed.innerHTML = `<p class="loader" style="color:var(--negative)">Failed to load: ${esc(err.message)}</p>`;
  }
}

function updateStats() {
  const src = filteredJobs.length || activeTags.length ? filteredJobs : allJobs;
  document.getElementById('statTotal').textContent = src.length.toLocaleString();
  document.getElementById('statCompanies').textContent =
    new Set(src.map(j => j.company_name).filter(Boolean)).size.toLocaleString();
}

function populateFilters() {
  fillSelect(seniorityFilter, 'Seniority',
    [...new Set(allJobs.map(j => j.job_seniority_level).filter(Boolean))].sort());
  fillSelect(employmentFilter, 'Type',
    [...new Set(allJobs.map(j => j.job_employment_type).filter(Boolean))].sort());
}

function fillSelect(el, label, items) {
  const current = el.value;
  el.innerHTML = `<option value="">${label}</option>` +
    items.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
  if (current) el.value = current;
}

function applyFilters() {
  currentPage = 1;
  const seniority = seniorityFilter.value;
  const employment = employmentFilter.value;
  const easy = easyApplyFilter.value;
  const isNew = newFilter.value;
  const salary = salaryFilter.value;
  const sort = sortBy.value;

  filteredJobs = allJobs.filter(job => {
    if (seniority && job.job_seniority_level !== seniority) return false;
    if (employment && job.job_employment_type !== employment) return false;
    if (easy === 'yes' && !job.is_easy_apply) return false;
    if (easy === 'no' && job.is_easy_apply) return false;
    if (salary === 'with' && !job.base_salary) return false;
    if (salary === 'without' && job.base_salary) return false;
    if (isNew === 'new' && !isJobNew(job)) return false;
    if (isNew === 'old' && isJobNew(job)) return false;
    return true;
  });

  // Semantic ordering: when tags are present, rank by relevance (not hard-filter).
  if (activeTags.length && semanticScores) {
    filteredJobs.sort((a, b) => (semanticScores[b.url] || 0) - (semanticScores[a.url] || 0));
  } else {
    filteredJobs.sort((a, b) => {
      switch (sort) {
        case 'cv-match': return (cvMatchScores[b.url] || 0) - (cvMatchScores[a.url] || 0);
        case 'favorites': return (likedUrls.has(b.url) ? 1 : 0) - (likedUrls.has(a.url) ? 1 : 0);
        case 'applicants-asc': return (a.job_num_applicants || 0) - (b.job_num_applicants || 0);
        case 'applicants-desc': return (b.job_num_applicants || 0) - (a.job_num_applicants || 0);
        case 'salary-desc': return getSalaryValue(b) - getSalaryValue(a);
        case 'salary-asc': return getSalaryValue(a) - getSalaryValue(b);
        case 'title-asc': return (a.job_title || '').localeCompare(b.job_title || '');
        default: return favRecency(b) - favRecency(a);
      }
    });
  }

  if (pinnedIds.size) {
    const pinned = filteredJobs.filter(j => pinnedIds.has(jobId(j.url)));
    const rest = filteredJobs.filter(j => !pinnedIds.has(jobId(j.url)));
    filteredJobs = [...pinned, ...rest];
  }

  renderJobs();
  updatePagination();
  updateStats();
  feedFooter.textContent = `Showing ${filteredJobs.length} of ${allJobs.length} positions`;
  renderLeadCta();
}

function renderJobs() {
  if (!filteredJobs.length) {
    feed.innerHTML = '';
    return;
  }

  const start = (currentPage - 1) * PAGE_SIZE;
  const pageJobs = filteredJobs.slice(start, start + PAGE_SIZE);

  feed.innerHTML = pageJobs.map((job, i) => {
    const initial = (job.company_name || '?')[0].toUpperCase();
    const avatarHtml = job.company_logo
      ? `<img class="job-logo" src="${esc(job.company_logo)}" alt="" loading="lazy" onerror="this.outerHTML='<span class=\\'job-initial\\'>${esc(initial)}</span>'">`
      : `<span class="job-initial">${esc(initial)}</span>`;

    const tags = [];
    if (cvMatchUrls.has(job.url)) tags.push(`<span class="tag tag-match">★ Match ${cvMatchScores[job.url]}</span>`);
    if (job.base_salary) tags.push(`<span class="tag tag-salary">${formatSalary(job.base_salary)}</span>`);
    if (job.is_easy_apply) tags.push('<span class="tag tag-easy">Easy Apply</span>');
    if (job.workplace_type) tags.push(`<span class="tag tag-workplace">${esc(job.workplace_type)}</span>`);
    if (job.job_seniority_level && job.job_seniority_level !== 'Not Applicable')
      tags.push(`<span class="tag tag-seniority">${esc(job.job_seniority_level)}</span>`);

    const desc = job.description ? `\n          <p class="job-desc">${esc(truncate(job.description, 320))}</p>` : '';

    const id = jobId(job.url);
    const liked = likedUrls.has(job.url);
    const disliked = dislikedUrls.has(job.url);

    // Stagger only first 30 items
    const stagger = i < 30 ? `style="--i:${i}"` : 'style="--i:0"';

    return `
      <a href="${esc(job.url || '#')}" target="_blank" rel="noopener noreferrer" class="job ${pinnedIds.has(id) ? 'job-pinned' : ''} ${disliked ? 'job-disliked' : ''}" ${stagger}>
        ${avatarHtml}
        <div class="job-body">
          <div class="job-title">${esc(job.job_title || 'Untitled')}${isJobNew(job) ? ' <span class="tag tag-new">New</span>' : ''}</div>
          <div class="job-company">${esc(job.company_name || 'Unknown')}</div>
          <div class="job-meta">
            <span>${esc(job.job_location || '—')}</span>
            <span>${esc(job.job_employment_type || '—')}</span>
            ${job.job_posted_time ? `<span>${esc(job.job_posted_time)}</span>` : ''}
          </div>${desc}
        </div>
        <div class="job-aside">
          <div class="vote-row">
            <button class="vote-btn vote-like ${liked ? 'active' : ''}" data-url="${esc(job.url)}" aria-label="Like" title="Like">▲</button>
            <button class="vote-btn vote-dislike ${disliked ? 'active' : ''}" data-url="${esc(job.url)}" aria-label="Dislike" title="Dislike">▼</button>
          </div>
          ${tags.join('')}
          ${job.job_num_applicants != null ? `<span class="job-applicants">${job.job_num_applicants} applicants</span>` : ''}
        </div>
      </a>`;
  }).join('');

  // Vote toggling (delegated, stops link navigation)
  feed.querySelectorAll('.vote-like').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      vote(btn.dataset.url, 'like');
      applyLocalVoteNudge();
      renderJobs();
    });
  });
  feed.querySelectorAll('.vote-dislike').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      vote(btn.dataset.url, 'dislike');
      applyLocalVoteNudge();
      renderJobs();
    });
  });

  // Scroll-triggered reveals via IntersectionObserver
  observeJobs();
}

function renderLeadCta() {
  const existing = document.getElementById('leadCta');
  if (existing) existing.remove();
  const q = activeTags.join(' ');
  if (!q) return;

  const cta = document.createElement('div');
  cta.id = 'leadCta';
  cta.className = 'lead-cta';
  cta.innerHTML = `
    <div class="lead-cta-inner">
      <div class="lead-cta-copy">
        <strong>Want more?</strong>
        <span>I can search more companies for this query.</span>
      </div>
      <button id="leadBtn" class="lead-btn">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 21l-4.35-4.35"/><circle cx="11" cy="11" r="7"/><path d="M11 7v4l2.5 1.5"/></svg>
        <span>Find more</span>
      </button>
    </div>`;
  feed.appendChild(cta);
  document.getElementById('leadBtn').addEventListener('click', () => fetchLeads(q));
}

async function fetchLeads(query) {
  const btn = document.getElementById('leadBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="lead-spinner"></span> Searching companies…';
  try {
    const res = await fetch('/api/leads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    if (Array.isArray(data.jobs) && data.jobs.length) {
      const existingUrls = new Set(allJobs.map(j => j.url));
      const fresh = data.jobs.filter(j => !existingUrls.has(j.url));
      const freshCompanies = new Set(fresh.map(j => j.company_name).filter(Boolean)).size;
      if (fresh.length) {
        allJobs = [...fresh, ...allJobs];
        // Clear tags so the new jobs are visible even if they don't match the query.
        clearTags();
        populateFilters();
        applyFilters();
        updateStats();
      }
      const note = document.createElement('p');
      note.className = 'lead-note';
      note.textContent = fresh.length
        ? `Added ${fresh.length} new jobs from ${freshCompanies} compan${freshCompanies === 1 ? 'y' : 'ies'}.`
        : `No new jobs found for “${query}”. Try a different search.`;
      const cta = document.getElementById('leadCta');
      if (cta) { cta.innerHTML = ''; cta.appendChild(note); }
      return;
    }
    const note = document.createElement('p');
    note.className = 'lead-note';
    note.textContent = `No new jobs found for “${query}”. Try a different search.`;
    const cta = document.getElementById('leadCta');
    if (cta) { cta.innerHTML = ''; cta.appendChild(note); }
  } catch (err) {
    btn.disabled = false;
    btn.innerHTML = `Something went wrong: ${esc(err.message)}`;
  }
}

function observeJobs() {
  const jobs = feed.querySelectorAll('.job');
  if (!('IntersectionObserver' in window)) {
    jobs.forEach(j => j.classList.add('visible'));
    return;
  }
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.05, rootMargin: '0px 0px 60px 0px' });
  jobs.forEach(j => observer.observe(j));
}

function isJobNew(job) {
  if (!job.job_posted_date) return false;
  return job.job_posted_date > '2026-03-19';
}

function getSalaryValue(job) {
  if (!job.base_salary) return 0;
  const s = job.base_salary;
  const mid = ((s.min_amount || 0) + (s.max_amount || 0)) / (s.min_amount && s.max_amount ? 2 : 1);
  const multiplier = { yr: 1, mo: 12, hr: 2080 }[s.payment_period] || 1;
  return mid * multiplier;
}

function updatePagination() {
  const totalPages = Math.ceil(filteredJobs.length / PAGE_SIZE);
  const pag = document.getElementById('pagination');
  if (totalPages <= 1) { pag.innerHTML = ''; return; }

  const start = (currentPage - 1) * PAGE_SIZE + 1;
  const end = Math.min(currentPage * PAGE_SIZE, filteredJobs.length);
  let html = `<span class="pag-info">${start}–${end} of ${filteredJobs.length}</span>`;
  html += `<button class="pag-btn" ${currentPage <= 1 ? 'disabled' : ''} data-page="${currentPage - 1}">← Prev</button>`;

  const maxVisible = 5;
  let lo = Math.max(1, currentPage - Math.floor(maxVisible / 2));
  let hi = Math.min(totalPages, lo + maxVisible - 1);
  lo = Math.max(1, hi - maxVisible + 1);

  if (lo > 1) html += `<button class="pag-btn" data-page="1">1</button><span class="pag-dots">…</span>`;
  for (let p = lo; p <= hi; p++) {
    html += `<button class="pag-btn ${p === currentPage ? 'pag-active' : ''}" data-page="${p}">${p}</button>`;
  }
  if (hi < totalPages) html += `<span class="pag-dots">…</span><button class="pag-btn" data-page="${totalPages}">${totalPages}</button>`;

  html += `<button class="pag-btn" ${currentPage >= totalPages ? 'disabled' : ''} data-page="${currentPage + 1}">Next →</button>`;
  pag.innerHTML = html;

  pag.querySelectorAll('.pag-btn:not([disabled])').forEach(btn => {
    btn.addEventListener('click', () => {
      currentPage = parseInt(btn.dataset.page);
      renderJobs();
      updatePagination();
      feedFooter.textContent = `Showing ${filteredJobs.length} of ${allJobs.length} positions`;
      feed.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
}

function formatSalary(s) {
  if (!s) return '';
  const cur = s.currency || '€';
  const period = { yr: '/yr', mo: '/mo', hr: '/hr' }[s.payment_period] || '';
  const fmt = n => n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);
  if (s.min_amount && s.max_amount) return `${cur}${fmt(s.min_amount)}–${fmt(s.max_amount)}${period}`;
  if (s.min_amount) return `${cur}${fmt(s.min_amount)}+${period}`;
  if (s.max_amount) return `up to ${cur}${fmt(s.max_amount)}${period}`;
  return '';
}

function esc(str) {
  if (!str) return '';
  const d = document.createElement('div');
  d.textContent = String(str);
  return d.innerHTML;
}

function truncate(str, n) {
  if (!str) return '';
  return str.length > n ? str.slice(0, n).trimEnd() + '…' : str;
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// ── Chat + Notes ──
const chatMessages = document.getElementById('chatMessages');
const chatForm = document.getElementById('chatForm');
const chatInput = document.getElementById('chatInput');
const chatSend = document.getElementById('chatSend');
const chatAttach = document.getElementById('chatAttach');
const chatFileInput = document.getElementById('chatFileInput');
const clearChatBtn = document.getElementById('clearChat');
const sidebarToggle = document.getElementById('sidebarToggle');
const app = document.querySelector('.app');
const chatWelcome = document.getElementById('chatWelcome');
const welcomeUpload = document.getElementById('welcomeUpload');

let cvTextCache = '';
let profileCache = null;
let selectedRole = '';
let notesText = '';
let chatHistory = [];
let chatBusy = false;

function hideWelcome() {
  if (chatWelcome) chatWelcome.remove();
}

function applySearch(query) {
  addTags(splitQueryToTags(query));
  applyFilters();
  updateStats();
}

function deriveSearchQuery(text) {
  let q = text.trim();
  q = q.replace(/[?!.]+$/, '');
  q = q.replace(/^(what are|what is|what's|whats|show me|find me|find|search for|search|looking for|look for|i want|i need|browse|give me|get me)\s+/i, '');
  q = q.replace(/\b(roles?|jobs?|positions?|companies|work|gigs?|openings?)\s+/gi, '');
  q = q.replace(/\b(at|for|in|on)\s+/gi, '');
  q = q.replace(/\b(right now|currently|available|hiring|open)\b/gi, '');
  q = q.replace(/\s{2,}/g, ' ').trim();
  return q || text.trim();
}

function looksLikeSearch(text) {
  const t = text.toLowerCase();
  return /(find|show|search|looking for|roles?|jobs?|browse|hiring|amsterdam|senior|junior|remote|design|engineer|developer|manager|companies)/.test(t);
}

function loadChatState() {
  try {
    const notes = localStorage.getItem('fitlist_notes');
    if (notes != null) notesText = notes;
    const hist = localStorage.getItem('fitlist_chat');
    if (hist) chatHistory = JSON.parse(hist) || [];
  } catch (e) {}
}
function saveNotes() {
  try { localStorage.setItem('fitlist_notes', notesText); } catch (e) {}
}
function saveChat() {
  try { localStorage.setItem('fitlist_chat', JSON.stringify(chatHistory.slice(-60))); } catch (e) {}
}

function renderMd(text) {
  const escText = esc(text);
  return escText
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
}

function addMessage(role, content) {
  chatHistory.push({ role, content });
  const el = document.createElement('div');
  el.className = `chat-msg ${role}`;
  if (role === 'assistant') el.innerHTML = renderMd(content);
  else el.textContent = content;
  chatMessages.appendChild(el);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  saveChat();
}

function addThinking() {
  const el = document.createElement('div');
  el.className = 'chat-msg assistant thinking';
  el.textContent = 'Thinking…';
  chatMessages.appendChild(el);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return el;
}

function appendNotes(section) {
  const cur = notesText.trim();
  notesText = cur ? cur + '\n\n' + section : section;
  saveNotes();
}

async function sendChat(text) {
  if (chatBusy || !text.trim()) return;
  chatBusy = true;
  chatSend.disabled = true;
  hideWelcome();
  const msg = text.trim();
  addMessage('user', msg);
  const ok = await performChatRequest(msg, false);
  if (!ok) {
    addMessage('assistant', 'That got interrupted on my end. Let me try again…');
    await new Promise(r => setTimeout(r, 1500));
    const ok2 = await performChatRequest(msg, true);
    if (!ok2) {
      addMessage('assistant', 'Still interrupted. Please try again in a moment.');
    }
  }
  chatBusy = false;
  chatSend.disabled = false;
}

async function performChatRequest(msg, isRetry) {
  const isSearch = looksLikeSearch(msg) || !!profileCache;
  const thinking = addThinking();
  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: chatHistory,
        notes: notesText,
        profile: profileCache,
        mode: isSearch ? 'search' : 'chat',
        favorites: [...likedUrls],
        dislikes: [...dislikedUrls]
      }),
    });
    const data = await res.json();
    thinking.remove();
    if (data.error) throw new Error(data.error);

    if (isSearch && Array.isArray(data.ids)) {
      pinnedIds = new Set(data.ids);
      // Auto-upvote the AI's suggested matches.
      const idUrls = data.ids.map(id => allJobs.find(j => jobId(j.url) === id)).filter(Boolean).map(j => j.url);
      autoLike(idUrls);
      // Merge any fresh company-fetched jobs into the feed.
      if (Array.isArray(data.freshJobs) && data.freshJobs.length) {
        const existing = new Set(allJobs.map(j => j.url));
        const added = data.freshJobs.filter(j => !existing.has(j.url));
        if (added.length) allJobs = [...added, ...allJobs];
      }
      // Turn the search message into tags, then show pinned matches on top.
      addTags(splitQueryToTags(msg));
      populateFilters();
      applyFilters();
      updateStats();
      if (data.message) addMessage('assistant', data.message);
      const titles = (data.titles || []).filter(Boolean);
      if (data.ids.length) {
        const matchLine = titles.length
          ? `I found ${data.ids.length} strong match${data.ids.length > 1 ? 'es' : ''}: ${titles.join(', ')}.`
          : `I found ${data.ids.length} strong match${data.ids.length > 1 ? 'es' : ''}.`;
        addMessage('assistant', matchLine);
      }
    } else {
      let reply = data.reply || '';
      const searchMatch = reply.match(/SEARCH:\s*(.+)/i);
      if (searchMatch) {
        reply = reply.replace(/SEARCH:\s*.+/i, '').trim();
        applySearch(searchMatch[1].trim());
      }
      addMessage('assistant', reply || 'Done.');
    }
    return true;
  } catch (err) {
    thinking.remove();
    const msg = String(err && err.message ? err.message : err);
    if (/interrupted|retry|code: pa|code: pb|timed out|timeout|overloaded|capacity/i.test(msg)) {
      return false;
    }
    addMessage('assistant', 'Something went wrong: ' + err.message);
    return true;
  }
}

chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const val = chatInput.value;
  chatInput.value = '';
  chatInput.style.height = 'auto';
  sendChat(val);
});

chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    chatForm.requestSubmit();
  }
});
chatInput.addEventListener('input', () => {
  chatInput.style.height = 'auto';
  chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + 'px';
});

clearChatBtn.addEventListener('click', () => {
  try {
    localStorage.removeItem('fitlist_chat');
    localStorage.removeItem('fitlist_notes');
    localStorage.removeItem('colino_likes');
    localStorage.removeItem('colino_dislikes');
    localStorage.removeItem('colino_tags');
    localStorage.removeItem('colino_favs');
  } catch (e) {}
  location.reload();
});

sidebarToggle.addEventListener('click', () => {
  app.classList.toggle('sidebar-collapsed');
  try { localStorage.setItem('fitlist_sidebar', app.classList.contains('sidebar-collapsed') ? '1' : '0'); } catch (e) {}
});

// ── Resume upload (via chat attach) ──
chatAttach.addEventListener('click', () => chatFileInput.click());
chatFileInput.addEventListener('change', () => {
  if (chatFileInput.files[0]) processCV(chatFileInput.files[0]);
});

async function processCV(file) {
  if (typeof pdfjsLib === 'undefined') {
    addMessage('assistant', 'The PDF reader could not load. Your network may be blocking a CDN resource.');
    return;
  }
    hideWelcome();
    const thinking = addThinking();
    try {
      const text = await extractPDFText(file);
      if (text.trim().length < 50) throw new Error('Could not extract enough text from PDF');
      cvTextCache = text;

      const res = await fetch('/api/analyze-cv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cvText: text }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      profileCache = data.profile;
      window.__colinoProfile = data.profile;

      // Build notes from the profile
      const p = data.profile || {};
      const lines = [];
      if (p.roles && p.roles.length) lines.push('Current roles: ' + p.roles.slice(0, 6).join(', '));
      if (p.future_roles && p.future_roles.length) lines.push('Future roles: ' + p.future_roles.slice(0, 8).join(', '));
      if (p.skills && p.skills.length) lines.push('Skills: ' + p.skills.slice(0, 12).join(', '));
      if (p.domains && p.domains.length) lines.push('Domains: ' + p.domains.slice(0, 8).join(', '));
      if (p.industries && p.industries.length) lines.push('Industries: ' + p.industries.slice(0, 8).join(', '));
      if (p.locations && p.locations.length) lines.push('Locations: ' + p.locations.slice(0, 5).join(', '));
      if (p.seniority) lines.push('Seniority: ' + p.seniority);
      appendNotes(`## ${file.name}\n${lines.join('\n')}`);

      thinking.remove();
      const summary = buildProfileSummary(p);
      addMessage('assistant', summary);

      // Turn the profile into search tags so results narrow immediately.
      const profileTags = [];
      if (p.roles && p.roles[0]) profileTags.push(p.roles[0]);
      if (p.seniority) profileTags.push(p.seniority);
      if (p.locations && p.locations.length) profileTags.push(...p.locations.slice(0, 2));
      if (p.industries && p.industries.length) profileTags.push(...p.industries.slice(0, 2));
      if (p.skills && p.skills.length) profileTags.push(...p.skills.slice(0, 5));
      clearTags();
      addTags(profileTags);

      const missing = (p.missing || []).filter(Boolean);
      if (missing.length) {
        askProfileFollowUps(missing, data.suggestions || []);
      } else {
        showRoleSuggestions(data.suggestions || []);
      }
    } catch (err) {
      thinking.remove();
      addMessage('assistant', 'Something went wrong: ' + err.message);
    }
  }

function buildProfileSummary(p) {
  const parts = [];
  if (p.roles && p.roles.length) parts.push(`role: ${p.roles[0]}`);
  if (p.seniority) parts.push(`seniority: ${p.seniority}`);
  if (p.locations && p.locations.length) parts.push(`location: ${p.locations.slice(0, 2).join(', ')}`);
  if (p.industries && p.industries.length) parts.push(`industry: ${p.industries.slice(0, 2).join(', ')}`);
  if (p.skills && p.skills.length) parts.push(`skills: ${p.skills.slice(0, 5).join(', ')}`);
  if (p.future_roles && p.future_roles.length) parts.push(`could grow into: ${p.future_roles.slice(0, 3).join(', ')}`);
  if (!parts.length) return 'I read your resume.';
  return `I read your resume. Here's what I picked up:\n${parts.map(s => `- ${s}`).join('\n')}`;
}

const FOLLOWUP_QUESTIONS = {
  skills: 'Which tools or skills should I prioritize?',
  roles: 'What roles are you currently targeting?',
  future_roles: 'What would you like to grow into next?',
  industries: 'Which industries are you interested in?',
  locations: 'Where are you based, or willing to work?',
  seniority: 'What seniority level are you at?'
};

function askProfileFollowUps(missing, suggestions) {
  const qs = missing.map(f => FOLLOWUP_QUESTIONS[f]).filter(Boolean);
  if (!qs.length) { showRoleSuggestions(suggestions); return; }
  addMessage('assistant', "A few gaps I'd like to confirm:\n" + qs.map(q => `- ${q}`).join('\n'));
  chatInput.focus();
  setTimeout(() => showRoleSuggestions(suggestions), 400);
}

function showRoleSuggestions(suggestions) {
  addMessage('assistant', 'Which role fits you best?');

  if (suggestions.length) {
    const row = document.createElement('div');
    row.className = 'chat-role-row';
    suggestions.slice(0, 5).forEach(role => {
      const chip = document.createElement('button');
      chip.className = 'chat-role-chip';
      chip.textContent = role;
      chip.addEventListener('click', () => {
        selectedRole = role;
        clearRoleOptions(row, custom);
        addMessage('user', `Role: ${role}`);
        const companies = (profileCache && profileCache.companies) || [];
        runMatch(role, companies);
      });
      row.appendChild(chip);
    });
    chatMessages.appendChild(row);
  }

  const custom = document.createElement('input');
  custom.className = 'chat-role-custom';
  custom.placeholder = 'Or type a custom role…';
  custom.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && custom.value.trim()) {
      const role = custom.value.trim();
      selectedRole = role;
      clearRoleOptions(row, custom);
      addMessage('user', `Role: ${role}`);
      const companies = (profileCache && profileCache.companies) || [];
      runMatch(role, companies);
    }
  });
  chatMessages.appendChild(custom);

  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function clearRoleOptions(...nodes) {
  nodes.forEach(n => { if (n && n.parentNode) n.remove(); });
}

async function runMatch(role, companies = []) {
  const thinking = addThinking();
  try {
    const res = await fetch('/api/match-cv', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cvText: cvTextCache, role, profile: profileCache, companies }),
    });
    const data = await res.json();
    thinking.remove();
    if (data.error) throw new Error(data.error);

    allJobs = data.matches;
    cvMatchUrls = new Set(data.matches.map(m => m.url));
    data.matches.forEach(m => { cvMatchScores[m.url] = m.score; });

    // Handpick the top matches (by score) to pin on top.
    const top = [...data.matches].sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 5);
    pinnedIds = new Set(top.map(m => jobId(m.url)));
    const topTitles = top.map(m => m.job_title).filter(Boolean);

    // Auto-upvote the AI's suggested roles so the semantic search keeps leaning correctly.
    autoLike(top.map(m => m.url));

    populateFilters();
    applyFilters();
    updateStats();

    if (!sortBy.querySelector('option[value="cv-match"]')) {
      const opt = document.createElement('option');
      opt.value = 'cv-match';
      opt.textContent = '★ Best match';
      sortBy.insertBefore(opt, sortBy.firstChild);
    }
    sortBy.value = 'cv-match';
    applyFilters();

    const picks = topTitles.length ? ` My top picks: ${topTitles.join('; ')}.` : '';
    addMessage('assistant', `Matched you against ${data.matches.length} roles.${picks}`);
  } catch (err) {
    thinking.remove();
    addMessage('assistant', 'Something went wrong: ' + err.message);
  }
}

async function extractPDFText(file) {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  let text = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map(item => item.str).join(' ') + '\n';
  }
  return text;
}

// Init chat + notes on load
(function initChat() {
  if (typeof pdfjsLib !== 'undefined') {
    try { pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'; } catch (e) {}
  }
  try {
    const saved = localStorage.getItem('fitlist_sidebar');
    const isMobile = window.matchMedia('(max-width: 720px)').matches;
    // On mobile, default to collapsed (slide-over hidden) unless user explicitly opened it.
    if (saved !== null) {
      if (saved === '1') app.classList.add('sidebar-collapsed');
    } else if (isMobile) {
      app.classList.add('sidebar-collapsed');
    }
  } catch (e) {}
  loadChatState();
  loadVotes();
  loadTags();
  renderTags();
  if (activeTags.length) runSemanticSearch();

  // Wire welcome quick actions
  if (welcomeUpload) {
    welcomeUpload.addEventListener('click', () => chatFileInput.click());
  }
  document.querySelectorAll('.welcome-hint[data-prompt]').forEach(hint => {
    hint.addEventListener('click', () => sendChat(hint.dataset.prompt));
  });

  if (chatHistory.length) hideWelcome();
  chatHistory.forEach(m => {
    const el = document.createElement('div');
    el.className = `chat-msg ${m.role}`;
    if (m.role === 'assistant') el.innerHTML = renderMd(m.content);
    else el.textContent = m.content;
    chatMessages.appendChild(el);
  });
  chatMessages.scrollTop = chatMessages.scrollHeight;
})();
