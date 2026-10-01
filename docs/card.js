/* ═══════════════════════════════════════════════════════════
   GitHub Insights — Full Stats Card Generator
   Uses the public GitHub REST, Search & Contributors APIs
   (no sign-in needed) for lifetime stats.
   Events API used for activity-pattern visualizations.
   ═══════════════════════════════════════════════════════════ */

const API = "https://api.github.com";

const LANG_COLORS = {
  JavaScript: "#f1e05a", TypeScript: "#3178c6", Python: "#3572A5",
  Java: "#b07219", "C++": "#f34b7d", C: "#555555",
  "C#": "#178600", Go: "#00ADD8", Rust: "#dea584",
  Ruby: "#701516", PHP: "#4F5D95", Swift: "#ffac45",
  Kotlin: "#A97BFF", HTML: "#e34c26", CSS: "#563d7c",
  Shell: "#89e051", Vue: "#41b883", Dart: "#00B4AB",
  Lua: "#000080", Scala: "#c22d40", R: "#198CE7",
  Perl: "#0298c3", Haskell: "#5e5086", Elixir: "#6e4a7e",
  Clojure: "#db5855", "Objective-C": "#438eff", SCSS: "#c6538c",
  "Jupyter Notebook": "#DA5B0B",
};

const $ = (s) => document.querySelector(s);

const form        = $("#username-form");
const input       = $("#username-input");
const genBtn      = $("#generate-btn");
const btnText     = $(".btn-text");
const btnLoader   = $(".btn-loader");
const errorMsg    = $("#error-msg");
const downloadBtn = $("#download-btn");
const cardActions = $("#card-actions");
const placeholder = $("#card-placeholder");
const cardWrapper = $("#card-wrapper");

/* ── Requests ──────────────────────────────────────────── */

// Every call is unauthenticated: this page never asks for a GitHub token.
function getHeaders() {
  return { Accept: "application/vnd.github.v3+json" };
}

// Forget any token an earlier version of this page saved in the browser
localStorage.removeItem("gh_token");

/* ── Caching (localStorage, 1-hour TTL) ────────────────── */

const CACHE_TTL = 60 * 60 * 1000; // 1 hour

function getCached(username) {
  try {
    const raw = localStorage.getItem(`ghi_cache_${username.toLowerCase()}`);
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw);
    if (Date.now() - ts > CACHE_TTL) {
      localStorage.removeItem(`ghi_cache_${username.toLowerCase()}`);
      return null;
    }
    return data;
  } catch { return null; }
}

function setCache(username, data) {
  try {
    // Convert Sets to arrays for JSON serialization
    const serializable = {
      user: data.user,
      repos: data.repos,
      stats: {
        ...data.stats,
        activeDates: [...(data.stats.activeDates || [])],
        reposContributed: [...(data.stats.reposContributed || [])],
      },
    };
    localStorage.setItem(`ghi_cache_${username.toLowerCase()}`, JSON.stringify({ ts: Date.now(), data: serializable }));
  } catch { /* storage full, ignore */ }
}

/* ── Helpers ───────────────────────────────────────────── */

function fmt(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "k";
  return String(n);
}

function showError(msg) { errorMsg.textContent = msg; errorMsg.hidden = false; }

function showToast(msg) {
  let toast = $("#toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "toast";
    toast.className = "toast";
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 4000);
}

function setLoading(on) {
  btnText.hidden = on;
  btnLoader.hidden = !on;
  input.disabled = on;
  genBtn.disabled = on;
}

/* ── API ───────────────────────────────────────────────── */

/** Graceful fetch — returns null on rate-limit / error (non-critical endpoints) */
async function fetchJSON(url) {
  const res = await fetch(url, { headers: getHeaders() });
  if (!res.ok) {
    if (res.status === 404) return null;
    if (res.status === 403 || res.status === 429) return null; // rate limited — degrade gracefully
    return null;
  }
  return res.json();
}

/** Strict fetch — throws on error (used only for the user profile endpoint) */
async function fetchJSONStrict(url) {
  const res = await fetch(url, { headers: getHeaders() });
  if (!res.ok) {
    if (res.status === 404) throw new Error("User not found");
    if (res.status === 403 || res.status === 429) {
      throw new Error("GitHub's hourly limit for this page has been reached. Try again in an hour.");
    }
    throw new Error(`GitHub API error (${res.status})`);
  }
  return res.json();
}

/** Check remaining rate limit (this endpoint is free and doesn't count) */
async function checkRateLimit() {
  try {
    const res = await fetch(`${API}/rate_limit`, { headers: getHeaders() });
    if (!res.ok) return null;
    const data = await res.json();
    return data.rate; // { limit, remaining, reset }
  } catch { return null; }
}

/** Fetch with retry — handles 202 "computing" from stats endpoints */
async function fetchWithRetry(url, retries = 5) {
  for (let i = 0; i <= retries; i++) {
    const res = await fetch(url, { headers: getHeaders() });
    if (res.status === 200) return res.json();
    if (res.status === 202 && i < retries) {
      await new Promise(r => setTimeout(r, 2000));
      continue;
    }
    if (res.status === 204 || res.status === 403 || res.status === 404) return [];
    return [];
  }
  return [];
}

async function fetchAllRepos(username) {
  let repos = [], page = 1, firstPage = true;
  while (true) {
    const batch = await fetchJSON(
      `${API}/users/${username}/repos?per_page=100&page=${page}&type=owner&sort=updated`
    );
    if (!batch || !Array.isArray(batch)) {
      return firstPage ? null : repos; // null = total failure; partial = return what we got
    }
    firstPage = false;
    repos = repos.concat(batch);
    if (batch.length < 100) break;
    page++;
  }
  return repos;
}

async function fetchEvents(username) {
  let events = [], firstPage = true;
  const maxPages = 1;
  for (let page = 1; page <= maxPages; page++) {
    try {
      const batch = await fetchJSON(
        `${API}/users/${username}/events/public?per_page=100&page=${page}`
      );
      if (!batch || !Array.isArray(batch)) {
        return firstPage ? null : events; // null = total failure
      }
      firstPage = false;
      if (!batch.length) break;
      events = events.concat(batch);
      if (batch.length < 100) break;
    } catch {
      return firstPage ? null : events;
    }
  }
  return events;
}

/** Fetch daily contribution calendar (same data as GitHub profile graph) */
async function fetchDailyContributions(username) {
  try {
    const res = await fetch(
      `https://github-contributions-api.jogruber.de/v4/${username}?y=all`
    );
    if (!res.ok) return null;
    const data = await res.json();
    // data.contributions is an array of { date, count, level }
    return data.contributions || null;
  } catch {
    return null;
  }
}

/* ── Lifetime data (Search API + Contributors API) ────── */

async function fetchLifetimeData(username, repos) {
  // null = "we don't know" (API failed or skipped); 0 = "genuinely zero"
  const lifetime = {
    totalPRs: null,
    totalPRsMerged: null,
    totalIssues: null,
    totalIssuesClosed: null,
    totalCommits: null,
    repoCommits: {},
  };

  // Search API — lifetime PR & Issue counts
  // The Search API has its own rate limit (10 req/min unauthenticated)
  // separate from the core REST API, so this is safe unauthenticated
  try {
    const [prRes, prMergedRes, issueRes, issueClosedRes] = await Promise.all([
      fetchJSON(`${API}/search/issues?q=author:${username}+type:pr+is:public&per_page=1`).catch(() => null),
      fetchJSON(`${API}/search/issues?q=author:${username}+type:pr+is:merged+is:public&per_page=1`).catch(() => null),
      fetchJSON(`${API}/search/issues?q=author:${username}+type:issue+is:public&per_page=1`).catch(() => null),
      fetchJSON(`${API}/search/issues?q=author:${username}+type:issue+is:closed+is:public&per_page=1`).catch(() => null),
    ]);
    if (prRes) lifetime.totalPRs = prRes.total_count || 0;
    if (prMergedRes) lifetime.totalPRsMerged = prMergedRes.total_count || 0;
    if (issueRes) lifetime.totalIssues = issueRes.total_count || 0;
    if (issueClosedRes) lifetime.totalIssuesClosed = issueClosedRes.total_count || 0;
  } catch { /* keep nulls on failure */ }

  // Stats/Contributors API — lifetime commit totals + weekly history
  // This endpoint returns weekly commit data spanning each repo's full lifetime
  const allOwned = repos.filter(r => !r.fork);
  const repoLimit = 5;
  const owned = allOwned
    .sort((a, b) => new Date(b.pushed_at || 0) - new Date(a.pushed_at || 0))
    .slice(0, repoLimit);

  if (owned.length > 0) {
    lifetime.totalCommits = 0; // We're going to try — start at 0, not null
  }
  let reposWithData = 0;
  for (let i = 0; i < owned.length; i += 5) {
    const batch = owned.slice(i, i + 5);
    const results = await Promise.all(
      batch.map(r =>
        fetchWithRetry(`${API}/repos/${username}/${r.name}/stats/contributors`)
      )
    );
    for (let j = 0; j < batch.length; j++) {
      const contributors = Array.isArray(results[j]) ? results[j] : [];
      if (contributors.length > 0) reposWithData++;
      const me = contributors.find(c => c.author?.login?.toLowerCase() === username.toLowerCase());
      if (me) {
        lifetime.repoCommits[batch[j].name] = me.total || 0;
        lifetime.totalCommits += me.total || 0;
      }
    }
  }

  // If we had repos but NONE returned contributor data, the API
  // was probably still computing (202s). Treat as unavailable, not 0.
  if (owned.length > 0 && reposWithData === 0) {
    lifetime.totalCommits = null;
  }

  return lifetime;
}

/* ── Compute stats ─────────────────────────────────────── */

function computeStats(events, repos, user, lifetime, dailyContribs) {
  // null means "data unavailable" — distinguishes from a genuine 0
  const reposFailed = repos === null;
  const eventsFailed = events === null;
  const safeRepos = repos || [];
  const safeEvents = events || [];

  const stats = {
    // Lifetime totals (from Search + Contributors APIs) — null = unavailable
    totalCommits: lifetime.totalCommits,
    totalPRs: lifetime.totalPRs,
    totalPRsMerged: lifetime.totalPRsMerged,
    totalIssues: lifetime.totalIssues,
    totalIssuesClosed: lifetime.totalIssuesClosed,
    repoCommits: { ...lifetime.repoCommits },
    // Time-series from events (for chart visualizations)
    monthlyContributions: {},
    dailyContributions: {},
    hourlyContributions: {},
    activeDates: new Set(),
    reposContributed: new Set(),
    longestStreak: 0,
    currentStreak: 0,
    // From repos API (lifetime) — null if repos API failed
    starsReceived: reposFailed ? null : 0,
    forksReceived: reposFailed ? null : 0,
    // From user API (lifetime)
    publicRepos: user.public_repos || 0,
    followers: user.followers || 0,
    following: user.following || 0,
    // Track what data is incomplete
    _reposFailed: reposFailed,
    _eventsFailed: eventsFailed,
    _partial: reposFailed || eventsFailed,
  };

  // ── Stars & forks from owned repos ──
  for (const r of safeRepos) {
    if (!r.fork) {
      stats.starsReceived += r.stargazers_count || 0;
      stats.forksReceived += r.forks_count || 0;
    }
  }

  // ── Events → time-series patterns (monthly, daily, hourly, streaks) ──
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

  for (const ev of safeEvents) {
    const d = new Date(ev.created_at);
    const dateKey = d.toISOString().slice(0, 10);
    const dayName = dayNames[d.getUTCDay()];
    const monthName = monthNames[d.getUTCMonth()];
    const hour = d.getUTCHours();

    if (ev.type === "PushEvent") {
      const c = (ev.payload && ev.payload.commits) ? ev.payload.commits.length : 0;
      stats.activeDates.add(dateKey);
      stats.monthlyContributions[monthName] = (stats.monthlyContributions[monthName] || 0) + c;
      stats.dailyContributions[dayName] = (stats.dailyContributions[dayName] || 0) + c;
      stats.hourlyContributions[hour] = (stats.hourlyContributions[hour] || 0) + c;

      const repo = (ev.repo && ev.repo.name) ? ev.repo.name.split("/").pop() : "";
      if (repo) stats.reposContributed.add(repo);
    }
    if (ev.type === "PullRequestEvent") {
      stats.activeDates.add(dateKey);
      stats.monthlyContributions[monthName] = (stats.monthlyContributions[monthName] || 0) + 1;
      stats.dailyContributions[dayName] = (stats.dailyContributions[dayName] || 0) + 1;
      stats.hourlyContributions[hour] = (stats.hourlyContributions[hour] || 0) + 1;
      const repo = (ev.repo && ev.repo.name) ? ev.repo.name.split("/").pop() : "";
      if (repo) stats.reposContributed.add(repo);
    }
    if (ev.type === "IssuesEvent") {
      stats.activeDates.add(dateKey);
      stats.monthlyContributions[monthName] = (stats.monthlyContributions[monthName] || 0) + 1;
      stats.dailyContributions[dayName] = (stats.dailyContributions[dayName] || 0) + 1;
      stats.hourlyContributions[hour] = (stats.hourlyContributions[hour] || 0) + 1;
      const repo = (ev.repo && ev.repo.name) ? ev.repo.name.split("/").pop() : "";
      if (repo) stats.reposContributed.add(repo);
    }
    if (ev.type === "CreateEvent" || ev.type === "DeleteEvent" ||
        ev.type === "WatchEvent" || ev.type === "ForkEvent" ||
        ev.type === "IssueCommentEvent" || ev.type === "PullRequestReviewEvent" ||
        ev.type === "PullRequestReviewCommentEvent") {
      stats.activeDates.add(dateKey);
      stats.hourlyContributions[hour] = (stats.hourlyContributions[hour] || 0) + 1;
    }
  }

  // ── Streaks + lifetime total (from daily contribution calendar) ──
  if (dailyContribs && dailyContribs.length) {
    // Sort by date ascending
    const sorted = dailyContribs
      .slice()
      .sort((a, b) => (a.date > b.date ? 1 : -1));

    // Sum all daily contributions for a reliable lifetime total
    stats.lifetimeContributions = sorted.reduce((s, d) => s + (d.count || 0), 0);

    // Longest streak
    let tempStreak = 0, longest = 0;
    for (const day of sorted) {
      if (day.count > 0) {
        tempStreak++;
        longest = Math.max(longest, tempStreak);
      } else {
        tempStreak = 0;
      }
    }
    stats.longestStreak = longest;

    // Current streak — walk backwards from today
    const todayStr = new Date().toISOString().slice(0, 10);
    let curStreak = 0;
    const upToToday = sorted.filter(d => d.date <= todayStr);
    for (let i = upToToday.length - 1; i >= 0; i--) {
      if (upToToday[i].count > 0) curStreak++;
      else break;
    }
    stats.currentStreak = curStreak;
  }

  // Total contributions: use calendar total (most reliable), fall back to summing API values
  if (stats.lifetimeContributions) {
    stats.totalContributions = stats.lifetimeContributions;
  } else {
    // Only sum values we actually have (not null)
    const c = stats.totalCommits, p = stats.totalPRs, i = stats.totalIssues;
    if (c !== null || p !== null || i !== null) {
      stats.totalContributions = (c || 0) + (p || 0) + (i || 0);
    } else {
      stats.totalContributions = null; // all unknown
    }
  }

  return stats;
}

/* ── Developer personality (same thresholds as original) ─ */

function getPersonality(stats, langCount) {
  // Use || 0 so null doesn't pass > comparisons (null > 500 is false anyway in JS,
  // but be explicit for clarity)
  const commits = stats.totalCommits || 0;
  const prs = stats.totalPRs || 0;
  const issues = stats.totalIssues || 0;
  const stars = stats.starsReceived || 0;
  const contribs = stats.totalContributions || 0;

  if (commits > 500)
    return { emoji: "🚀", title: "CODE MACHINE", sub: "Ships code like there's no tomorrow" };
  if (prs > 50)
    return { emoji: "🤝", title: "COLLABORATION KING", sub: "All about teamwork and code reviews" };
  if (issues > 30)
    return { emoji: "🐛", title: "BUG HUNTER", sub: "No bug is safe when you're around" };
  if (stats.longestStreak > 30)
    return { emoji: "🔥", title: "STREAK MASTER", sub: "Consistency is your middle name" };
  if (langCount > 5)
    return { emoji: "🎨", title: "POLYGLOT DEV", sub: "Speaks many programming languages" };
  if (stars > 100)
    return { emoji: "⭐", title: "STAR COLLECTOR", sub: "Your repos shine bright like diamonds" };
  if (contribs > 200)
    return { emoji: "💪", title: "DEDICATED DEV", sub: "Puts in the work, day after day" };
  return { emoji: "🌱", title: "GROWING DEV", sub: "Every commit is a step forward" };
}

/* ── Peak coding time (same buckets as original) ──────── */

function getPeakTime(hourly) {
  const buckets = { Night: 0, Morning: 0, Afternoon: 0, Evening: 0 };
  for (const [h, c] of Object.entries(hourly)) {
    const hr = Number(h);
    if (hr < 6)        buckets.Night += c;
    else if (hr < 12)  buckets.Morning += c;
    else if (hr < 18)  buckets.Afternoon += c;
    else               buckets.Evening += c;
  }
  const peak = Object.entries(buckets).sort((a, b) => b[1] - a[1])[0][0];
  const map = {
    Night:     { emoji: "🦉", title: "NIGHT OWL",         sub: "The moon is your coding companion" },
    Morning:   { emoji: "🌅", title: "EARLY BIRD",        sub: "First commits before first coffee" },
    Afternoon: { emoji: "☀️",  title: "AFTERNOON WARRIOR", sub: "Peak productivity hours" },
    Evening:   { emoji: "🌆", title: "EVENING CODER",     sub: "Golden hour, golden commits" },
  };
  return map[peak] || map.Night;
}

/* ── Language computation ──────────────────────────────── */

function computeLanguages(repos) {
  const map = {};
  for (const r of repos) {
    if (!r.language || r.fork) continue;
    map[r.language] = (map[r.language] || 0) + (r.size || 1);
  }
  const total = Object.values(map).reduce((a, b) => a + b, 0) || 1;
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name, val]) => ({
      name,
      pct: ((val / total) * 100).toFixed(1),
      color: LANG_COLORS[name] || "#8b949e",
    }));
}

/* ── Render the full card ──────────────────────────────── */

/** Format a number, or return '—' if data is unavailable (null) */
function fmtSafe(v) {
  return v === null || v === undefined ? "—" : fmt(v);
}

function renderCard(user, repos, stats) {
  const safeRepos = repos || [];

  // ── Card ──
  // Header
  $("#card-avatar").src = user.avatar_url;
  $("#card-name").textContent = user.name || user.login;
  $("#card-username").textContent = `@${user.login}`;
  $("#card-bio").textContent = user.bio || "";
  $("#card-bio").style.display = user.bio ? "" : "none";

  // Primary stats row: Repos, Stars, Followers, Forks
  $("#card-repos").textContent = fmtSafe(stats.publicRepos);
  $("#card-stars").textContent = fmtSafe(stats.starsReceived);
  $("#card-followers").textContent = fmtSafe(stats.followers);
  $("#card-forks").textContent = fmtSafe(stats.forksReceived);

  // Streaks (lifetime, daily granularity)
  $("#card-longest-streak").textContent = stats.longestStreak + (stats.longestStreak === 1 ? " day" : " days");
  $("#card-current-streak").textContent = stats.currentStreak + (stats.currentStreak === 1 ? " day" : " days");

  // Activity stats row: Contributions, Commits, PRs, Issues + secondary
  // Hide any stat that is 0 or unavailable
  const setActivity = (sel, val) => {
    const el = $(sel);
    el.textContent = fmtSafe(val);
    el.closest(".activity-stat").style.display = (val === null || val === undefined || val === 0) ? "none" : "";
  };
  setActivity("#card-total-contributions", stats.totalContributions);
  setActivity("#card-prs", stats.totalPRs);
  setActivity("#card-issues", stats.totalIssues);
  setActivity("#card-prs-merged", stats.totalPRsMerged);
  setActivity("#card-issues-closed", stats.totalIssuesClosed);

  // Personality
  const langs = computeLanguages(safeRepos);
  const personality = getPersonality(stats, langs.length);
  $("#personality-emoji").textContent = personality.emoji;
  $("#personality-title").textContent = personality.title;
  $("#personality-sub").textContent = personality.sub;

  // Peak coding time
  const peak = getPeakTime(stats.hourlyContributions);
  $("#peak-emoji").textContent = peak.emoji;
  $("#peak-title").textContent = peak.title;
  $("#peak-sub").textContent = peak.sub;

  // ── Most active repo ──
  const topRepos = Object.entries(stats.repoCommits).sort((a, b) => b[1] - a[1]);
  const topRepoEl = $("#card-top-repo");
  if (topRepos.length) {
    topRepoEl.style.display = "";
    $("#top-repo-name").textContent = topRepos[0][0];
    $("#top-repo-commits").textContent = `${topRepos[0][1]} commits`;
  } else {
    topRepoEl.style.display = "none";
  }

  // ── Top 5 repos bar chart ──
  const repoBarSection = $("#card-top-repos-section");
  const repoBarsEl = $("#card-repo-bars");
  repoBarsEl.innerHTML = "";
  const top5 = topRepos.slice(0, 5);
  if (top5.length > 1) {
    repoBarSection.style.display = "";
    const maxC = top5[0][1] || 1;
    const rankColors = ["#ffd700", "#c0c0c0", "#cd7f32", "var(--gh-green)", "var(--gh-blue)"];
    top5.forEach(([name, commits], i) => {
      const pct = Math.max((commits / maxC) * 100, 8);
      const color = rankColors[i] || "var(--gh-text-muted)";
      repoBarsEl.innerHTML += `
        <div class="repo-bar-row">
          <span class="repo-bar-rank" style="background:${color};color:${i < 3 ? '#000' : '#fff'}">${i + 1}</span>
          <div class="repo-bar-info">
            <span class="repo-bar-name">${name}</span>
            <div class="repo-bar-track">
              <div class="repo-bar-fill" style="width:${pct}%;background:${color};">${commits}</div>
            </div>
          </div>
        </div>`;
    });
  } else {
    repoBarSection.style.display = "none";
  }

  // ── Monthly contributions chart ──
  const monthlySection = $("#card-monthly-section");
  const monthlyChart = $("#card-monthly-chart");
  const monthsOrder = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const monthlyData = monthsOrder.map(m => stats.monthlyContributions[m] || 0);
  const maxMonthly = Math.max(...monthlyData, 1);
  const peakMonthIdx = monthlyData.indexOf(Math.max(...monthlyData));
  monthlyChart.innerHTML = "";

  if (monthlyData.some(v => v > 0)) {
    monthlySection.style.display = "";
    monthsOrder.forEach((m, i) => {
      const val = monthlyData[i];
      const h = Math.max((val / maxMonthly) * 100, 3);
      const isPeak = (i === peakMonthIdx && val > 0) ? " peak" : "";
      monthlyChart.innerHTML += `
        <div class="month-col">
          <span class="month-val">${val}</span>
          <div class="month-bar${isPeak}" style="height:${h}%"></div>
          <span class="month-lbl">${m}</span>
        </div>`;
    });
    const peakM = monthsOrder[peakMonthIdx];
    $("#card-peak-month").textContent = monthlyData[peakMonthIdx] > 0
      ? `Peak month: ${peakM} with ${monthlyData[peakMonthIdx]} contributions`
      : "";
  } else {
    monthlySection.style.display = "none";
  }

  // ── Day-of-week heatmap ──
  const dailySection = $("#card-daily-section");
  const dayHeatmap = $("#card-day-heatmap");
  const daysOrder = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const dailyData = daysOrder.map(d => stats.dailyContributions[d] || 0);
  const maxDaily = Math.max(...dailyData, 1);
  dayHeatmap.innerHTML = "";

  if (dailyData.some(v => v > 0)) {
    dailySection.style.display = "";
    const peakDayIdx = dailyData.indexOf(Math.max(...dailyData));
    daysOrder.forEach((d, i) => {
      const val = dailyData[i];
      const ratio = maxDaily ? val / maxDaily : 0;
      let heat = 0;
      if (ratio > 0.8) heat = 5;
      else if (ratio > 0.6) heat = 4;
      else if (ratio > 0.4) heat = 3;
      else if (ratio > 0.2) heat = 2;
      else if (val > 0) heat = 1;
      const isPeak = (i === peakDayIdx && val > 0) ? " peak-cell" : "";
      dayHeatmap.innerHTML += `
        <div class="day-row">
          <span class="day-label">${d}</span>
          <span class="day-cell heat-${heat}${isPeak}">${val.toLocaleString()}</span>
        </div>`;
    });
    const peakD = daysOrder[dailyData.indexOf(Math.max(...dailyData))];
    $("#card-peak-day").textContent = `You code most on ${peakD}s`;
  } else {
    dailySection.style.display = "none";
  }

  // ── Hourly activity heatmap ──
  const hourlySection = $("#card-hourly-section");
  const hourlyHeatmap = $("#card-hourly-heatmap");
  hourlyHeatmap.innerHTML = "";

  const timeLabels = [
    { label: "Night",     emoji: "🦉", hours: [0,1,2,3,4,5] },
    { label: "Morning",   emoji: "🌅", hours: [6,7,8,9,10,11] },
    { label: "Afternoon", emoji: "☀️",  hours: [12,13,14,15,16,17] },
    { label: "Evening",   emoji: "🌆", hours: [18,19,20,21,22,23] },
  ];
  const hourlyVals = timeLabels.map(t => t.hours.reduce((s, h) => s + (stats.hourlyContributions[h] || 0), 0));
  const maxHourly = Math.max(...hourlyVals, 1);

  if (hourlyVals.some(v => v > 0)) {
    hourlySection.style.display = "";
    const peakIdx = hourlyVals.indexOf(Math.max(...hourlyVals));
    timeLabels.forEach((t, i) => {
      const val = hourlyVals[i];
      const ratio = maxHourly ? val / maxHourly : 0;
      let heat = 0;
      if (ratio > 0.8) heat = 5;
      else if (ratio > 0.6) heat = 4;
      else if (ratio > 0.4) heat = 3;
      else if (ratio > 0.2) heat = 2;
      else if (val > 0) heat = 1;
      const isPeak = (i === peakIdx && val > 0) ? " peak-cell" : "";
      hourlyHeatmap.innerHTML += `
        <div class="hourly-row">
          <span class="hourly-emoji">${t.emoji}</span>
          <span class="hourly-label">${t.label}</span>
          <span class="hourly-cell heat-${heat}${isPeak}">${val.toLocaleString()}</span>
        </div>`;
    });
    $("#card-peak-hour").textContent = `You code most during the ${timeLabels[peakIdx].label.toLowerCase()}`;
  } else {
    hourlySection.style.display = "none";
  }

  // ── Languages ──
  const barEl = $("#card-lang-bar");
  const legendEl = $("#card-lang-legend");
  barEl.innerHTML = "";
  legendEl.innerHTML = "";
  if (!langs.length) {
    barEl.style.display = "none";
    legendEl.innerHTML = '<span class="lang-legend-item" style="color:var(--gh-text-muted)">No language data</span>';
  } else {
    barEl.style.display = "";
    for (const l of langs) {
      const seg = document.createElement("div");
      seg.className = "lang-bar-segment";
      seg.style.width = l.pct + "%";
      seg.style.background = l.color;
      barEl.appendChild(seg);
      const item = document.createElement("span");
      item.className = "lang-legend-item";
      item.innerHTML = `<span class="lang-dot" style="background:${l.color}"></span>${l.name} ${l.pct}%`;
      legendEl.appendChild(item);
    }
  }

  // ── Fun facts (real data only — no made-up multipliers) ──
  const funEl = $("#card-fun-facts");
  const facts = [];

  // Account age
  if (user.created_at) {
    const years = ((Date.now() - new Date(user.created_at)) / (365.25 * 24 * 60 * 60 * 1000));
    if (years >= 1) facts.push(`📅 <b>${Math.floor(years)}</b> year${Math.floor(years) !== 1 ? 's' : ''} on GitHub`);
    else facts.push(`📅 Joined GitHub <b>${Math.ceil(years * 12)}</b> month${Math.ceil(years * 12) !== 1 ? 's' : ''} ago`);
  }

  // Contributions total
  const contribTotal = stats.lifetimeContributions || stats.totalContributions;
  if (contribTotal && contribTotal > 0) {
    facts.push(`📊 <b>${contribTotal.toLocaleString()}</b> lifetime contributions`);
  }

  // Stars
  if (stats.starsReceived !== null && stats.starsReceived > 0) {
    facts.push(`⭐ Collected <b>${stats.starsReceived.toLocaleString()}</b> star${stats.starsReceived !== 1 ? 's' : ''}`);
  }

  // Forks
  if (stats.forksReceived !== null && stats.forksReceived > 0) {
    facts.push(`🍴 Repos forked <b>${stats.forksReceived.toLocaleString()}</b> time${stats.forksReceived !== 1 ? 's' : ''}`);
  }

  // Longest streak
  if (stats.longestStreak > 0) {
    facts.push(`🔥 Longest streak: <b>${stats.longestStreak}</b> day${stats.longestStreak !== 1 ? 's' : ''}`);
  }

  // Languages count
  if (langs.length > 0) {
    facts.push(`🗂️ Codes in <b>${langs.length}</b> language${langs.length !== 1 ? 's' : ''}`);
  }

  if (facts.length) {
    funEl.innerHTML = facts.map(f => `<div class="ff-row">${f}</div>`).join('');
  } else {
    funEl.innerHTML = '<div class="ff-row" style="color:var(--gh-text-muted)">Not enough data for fun facts</div>';
  }

  // ── Details ──
  const setDetail = (id, text) => {
    const el = $(`#${id}`);
    if (text) { el.style.display = ""; $(`#${id}-text`).textContent = text; }
    else el.style.display = "none";
  };
  setDetail("detail-company", user.company);
  setDetail("detail-location", user.location);
  setDetail("detail-joined", user.created_at
    ? `Joined ${new Date(user.created_at).toLocaleDateString("en-US", { month: "short", year: "numeric" })}`
    : null);
}

/* ── Download PNG ──────────────────────────────────────── */

async function downloadCard(username) {
  const card = $("#stats-card");
  const canvas = await html2canvas(card, {
    backgroundColor: "#0d1117",
    scale: 2,
    useCORS: true,
    logging: false,
  });
  const link = document.createElement("a");
  link.download = `${username}-github-card.png`;
  link.href = canvas.toDataURL("image/png");
  link.click();
}

/* ── Events ────────────────────────────────────────────── */

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const username = input.value.trim().replace(/^@/, "");
  if (!username) return;
  errorMsg.hidden = true;
  setLoading(true);
  try {
    // 1. Check cache first
    const cached = getCached(username);
    if (cached) {
      renderCard(cached.user, cached.repos, cached.stats);
      placeholder.hidden = true;
      cardWrapper.hidden = false;
      cardActions.hidden = false;
      showToast("⚡ Loaded from cache (refreshes every hour)");
      return;
    }

    // 2. Pre-check rate limit (free call)
    const rateLimit = await checkRateLimit();
    if (rateLimit && rateLimit.remaining < 3) {
      // Not enough calls left — fetch only the free contribution calendar
      const dailyContribs = await fetchDailyContributions(username);
      if (!dailyContribs) {
        showError("GitHub's hourly limit for this page has been reached. Try again in an hour.");
        return;
      }
      // Build a minimal card from the contribution calendar only
      const userRes = await fetch(`${API}/users/${username}`, { headers: getHeaders() });
      if (!userRes.ok) {
        showError("GitHub's hourly limit for this page has been reached. Try again in an hour.");
        return;
      }
      const user = await userRes.json();
      // null = unavailable (not fake zeros)
      const emptyLifetime = { totalPRs: null, totalPRsMerged: null, totalIssues: null, totalIssuesClosed: null, totalCommits: null, repoCommits: {} };
      const stats = computeStats(null, null, user, emptyLifetime, dailyContribs);
      renderCard(user, null, stats);
      placeholder.hidden = true;
      cardWrapper.hidden = false;
      cardActions.hidden = false;
      showToast("⚠️ Rate limited — showing partial data. Try again in an hour for full stats.");
      return;
    }

    // 3. Full fetch (user endpoint uses strict version — must succeed)
    const user = await fetchJSONStrict(`${API}/users/${username}`);

    // Other endpoints degrade gracefully (return null on failure)
    const [repos, events, dailyContribs] = await Promise.all([
      fetchAllRepos(username),
      fetchEvents(username),
      fetchDailyContributions(username),
    ]);
    const lifetime = await fetchLifetimeData(username, repos || []);
    const stats = computeStats(events, repos, user, lifetime, dailyContribs);
    renderCard(user, repos, stats);

    // Only cache complete results — never cache partial/degraded data
    if (!stats._partial) {
      setCache(username, { user, repos, stats });
    }

    placeholder.hidden = true;
    cardWrapper.hidden = false;
    cardActions.hidden = false;

    if (stats._partial) {
      showToast("⚠️ Some data unavailable due to rate limits. Try again in an hour for full stats.");
    }
  } catch (err) {
    showError(err.message || "Something went wrong. Please try again.");
  } finally {
    setLoading(false);
  }
});

/** Generate card as a PNG blob */
async function getCardBlob() {
  const card = $("#stats-card");
  const canvas = await html2canvas(card, {
    backgroundColor: "#0d1117",
    scale: 2,
    useCORS: true,
    logging: false,
  });
  return new Promise(resolve => canvas.toBlob(resolve, "image/png"));
}

downloadBtn.addEventListener("click", () => {
  const username = $("#card-username").textContent.replace("@", "");
  downloadCard(username);
});

$("#linkedin-btn").addEventListener("click", async () => {
  const username = $("#card-username").textContent.replace("@", "");
  const blob = await getCardBlob();
  const file = new File([blob], `${username}-github-card.png`, { type: "image/png" });

  const postText = `Check out my GitHub stats card! 🚀\n\nGenerated with GitHub Insights — see your lifetime commits, streaks, top languages & more at a glance.\n\n🔗 https://github.com/${username}\n\n#GitHub #Developer #OpenSource #GitHubInsights`;

  // Try the Web Share API (supports file attachments on mobile & some desktop)
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ text: postText, files: [file] });
      return;
    } catch (err) {
      if (err.name === "AbortError") return; // user cancelled
    }
  }

  // Fallback: copy image to clipboard, then open LinkedIn post composer
  try {
    await navigator.clipboard.write([
      new ClipboardItem({ "image/png": blob })
    ]);
    // Open LinkedIn's post creation page
    window.open(
      "https://www.linkedin.com/feed/?shareActive=true",
      "_blank",
      "noopener,noreferrer,width=700,height=700"
    );
    // Show a brief toast telling user to paste
    showToast("📋 Card copied to clipboard — paste it into your LinkedIn post!");
  } catch {
    // Last resort: just download + open LinkedIn
    await downloadCard(username);
    window.open(
      "https://www.linkedin.com/feed/?shareActive=true",
      "_blank",
      "noopener,noreferrer,width=700,height=700"
    );
    showToast("Card downloaded — attach it to your LinkedIn post!");
  }
});

input.addEventListener("keydown", (e) => {
  if (e.key === "Enter") form.requestSubmit();
});
