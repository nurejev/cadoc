// ======================================================================
// App wiring. One main screen with three views: Cards (default) · List · Matrix.
// ======================================================================
(() => {
  const $ = (id) => document.getElementById(id);
  let policies = [];          // view models
  let tenantName = "";
  let tenantDomain = "";
  // Baseline tenants deploy the persona policies Off first; there the Gap and
  // MS Learn checks review only the persona baseline policies (always Off),
  // and skip non-persona policies.
  const BASELINE_TENANTS = ["cloudfellows.dev"];
  function isBaselineTenant() {
    const n = (tenantName || "").toLowerCase(), d = (tenantDomain || "").toLowerCase();
    return BASELINE_TENANTS.some(t => d === t || d.endsWith("." + t) || n.includes(t.split(".")[0]));
  }
  const isPersonaBaseline = (vm) => Render.caGroup(vm.name).num != null; // has a CAxxx number → persona
  function checkScope(includeDisabledChecked) {
    if (isBaselineTenant()) {
      const inScope = policies.filter(isPersonaBaseline);
      return { raws: inScope.map(p => p.raw), includeDisabled: true, baseline: true, skipped: policies.length - inScope.length };
    }
    return { raws: policies.map(p => p.raw), includeDisabled: !!includeDisabledChecked, baseline: false, skipped: 0 };
  }
  function scopeNote(scope, nOff) {
    return scope.baseline
      ? `— baseline tenant: reviewing ${scope.raws.length} persona baseline polic${scope.raws.length === 1 ? "y" : "ies"} (Off), ${scope.skipped} non-persona skipped`
      : nOff ? `(${nOff} Off in tenant)` : "(none Off)";
  }
  let tenantLogo = null;      // tenant branding logo (data URL) for neutral exports
  let selected = new Set();
  let collapsedGroups = new Set();  // collapsed persona sections in cards view
  let stateFilter = "all", query = "", viewMode = "cards", fmt = "png";
  let currentExport = [];
  let isDemo = false;
  let anReport = null, anFilter = "all", anQuery = "";   // impact analysis state
  let anPols = [], anMaps = [], anTab = "users", anPage = 0;
  let anGroups = [], anGroupSel = "";   // persona/scope group filter
  let anType = "";                       // post-run user-type filter: "" | member | guest
  let toolMode = "document";             // action of the lemon toolbar button: document | backup
  const AN_PAGE_SIZE = 50;

  // ---------- helpers ----------
  // ---------- screens + browser history ----------
  // This is a single page, so without history entries the Back button leaves
  // the site entirely — and after an MSAL popup sign-in the previous entry may
  // be the login redirect, which is why it felt like being "thrown out".
  // Each tool screen pushes a state; Back walks those before it ever leaves.
  const HISTORY_SCREENS = new Set(["screen-home", "screen-list", "screen-baseline",
    "screen-cagroups", "screen-mslearn", "screen-gapcheck", "screen-exclusions", "screen-validator", "screen-whatif",
    "screen-locations", "screen-audit", "screen-changelog", "screen-help"]);
  let navSuppress = false;   // true while we are reacting to popstate

  function show(id) {
    document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
    $(id).classList.add("active");
    window.scrollTo(0, 0);
    if (navSuppress || !HISTORY_SCREENS.has(id)) return;
    // Replace rather than push when the screen has not changed, so clicking the
    // same tool twice does not need two Backs to leave it.
    if (history.state && history.state.screen === id) return;
    history.pushState({ screen: id }, "", location.pathname + location.search);
  }

  window.addEventListener("popstate", (e) => {
    // A modal or full-screen panel is the thing Back should close first —
    // that is what the same gesture does in every other app.
    const open = [...document.querySelectorAll(".modal-bg.open")];
    const fs = Fs.isOpen();
    if (open.length || fs) {
      open.forEach(m => m.classList.remove("open"));
      if (fs) Fs.close();
      history.pushState(history.state || { screen: "screen-home" }, "", location.pathname + location.search);
      return;
    }
    const target = (e.state && e.state.screen) || (policies.length ? "screen-home" : null);
    if (!target) return;                       // not signed in — let the browser go back
    navSuppress = true;
    try { show(target); } finally { navSuppress = false; }
  });
  const esc = (s) => String(s).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  // ---------- build stamp ----------
  // Shown before sign-in so a stale deploy (or a cached tab) is obvious.
  (function showBuild() {
    if (typeof APP_BUILD === "undefined") return;
    const stamp = $("buildStamp"), foot = $("buildStampFoot");
    if (stamp) stamp.textContent = `${APP_BUILD.label} · ${APP_BUILD.date}`;
    if (foot) {
      // the build number is the natural way in to "what changed"
      foot.textContent = APP_BUILD.label;
      foot.style.cursor = "pointer";
      foot.title = "See what's new";
      foot.addEventListener("click", () => { if (policies.length) openChangelog(); });
    }
    // per-tool version in the corner of each tile
    if (typeof TOOL_VERSIONS !== "undefined") {
      for (const [id, t] of Object.entries(TOOL_VERSIONS)) {
        const tile = $(id);
        if (!tile || tile.querySelector(".tool-ver")) continue;
        const tag = document.createElement("span");
        tag.className = "tool-ver";
        tag.textContent = `v${t.v}`;
        tag.title = t.note ? `${t.note}\n\nApp build ${APP_BUILD.label}` : `App build ${APP_BUILD.label}`;
        tile.appendChild(tag);
      }
    }
    // handy when someone reports a bug from a version you cannot see
    console.info(`ENCA ${APP_BUILD.full}`);
  })();

  // ---------- theme: Auto (device) → Light → Dark ----------
  // Auto leaves data-theme off so the CSS prefers-color-scheme block decides;
  // the logo swaps to the dark-background variant through a CSS content: rule.
  const THEMES = [
    { id: "auto", ico: "🌗", label: "Auto (follows your device)" },
    { id: "light", ico: "☀️", label: "Light" },
    { id: "dark", ico: "🌙", label: "Dark" },
  ];
  function applyTheme(id) {
    const t = THEMES.find((x) => x.id === id) || THEMES[0];
    if (t.id === "auto") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", t.id);
    const btn = $("themeBtn");
    if (btn) {
      btn.querySelector(".tico").textContent = t.ico;
      btn.title = `Theme: ${t.label} — click to change`;
    }
    try { localStorage.setItem("enca-theme", t.id); } catch { /* private mode */ }
    return t.id;
  }
  let theme = (() => { try { return localStorage.getItem("enca-theme") || "auto"; } catch { return "auto"; } })();
  applyTheme(theme);
  $("themeBtn").addEventListener("click", () => {
    const i = THEMES.findIndex((x) => x.id === theme);
    theme = applyTheme(THEMES[(i + 1) % THEMES.length].id);
    toast(`Theme: <span>${THEMES.find((x) => x.id === theme).label}</span>`);
  });

  function toast(msg) {
    const t = $("toast"); t.innerHTML = msg; t.classList.add("show");
    clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("show"), 3200);
  }
  // Download a text blob as "<base>-<tenant>-<yyyy-mm-dd-hhmmss>.<ext>".
  function downloadText(base, ext, mime, text) {
    const d = new Date(), pad = (n) => String(n).padStart(2, "0");
    const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
    a.download = `${base}-${(tenantName || "tenant").replace(/[^\w-]+/g, "-")}-${stamp}.${ext}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
  // ---------- consent, up front ----------
  // A write run may need scopes the session has not consented yet. Asking for
  // them mid-run means the popup is raised several awaits after the click, and
  // Edge/Safari have already withdrawn the gesture by then — the window is
  // blocked and the run dies half-way. So every write handler calls this FIRST,
  // while the click is still fresh; after this returns true, the rest of the
  // run is pure Graph calls with a token already in hand.
  let pendingScopes = null;
  function preConsent(scopes) {
    if (isDemo || Graph.hasScopes(scopes)) return Promise.resolve(true);
    return Graph.ensureScopes(scopes).then(() => true).catch((e) => {
      if (Graph.isPopupBlocked(e)) { askPopup(scopes, e); return false; }
      if (/user_cancelled|cancell?ed/i.test(e.errorCode || e.message || "")) {
        toast("Permission request <span>cancelled</span> — nothing was changed");
        return false;
      }
      toast(`Could not get permission: <span>${esc(e.message || e)}</span>`);
      return false;
    });
  }
  function askPopup(scopes, err) {
    pendingScopes = scopes;
    $("popupWhy").textContent = `Needed: ${scopes.join(", ")}.`;
    console.warn("Popup blocked:", err);
    $("popupModal").classList.add("open");
  }
  $("popupCancel").addEventListener("click", () => { pendingScopes = null; $("popupModal").classList.remove("open"); });
  $("popupGo").addEventListener("click", async () => {
    if (!pendingScopes) return;
    const btn = $("popupGo"); btn.disabled = true;
    try {
      await Graph.ensureScopes(pendingScopes);
      $("popupModal").classList.remove("open");
      toast("Permissions <span>granted</span> — run the action again");
    } catch (e) {
      toast(Graph.isPopupBlocked(e)
        ? "Still blocked — allow popups for this site in the address bar"
        : `Failed: <span>${esc(e.message || e)}</span>`);
    } finally { btn.disabled = false; }
  });

  // ---------- Markdown report viewer ----------
  // A deliberately small renderer for the subset the reports actually emit:
  // headings, tables, lists, bold, inline code, rules. Everything is escaped
  // first and inline markup applied to the escaped text, so a policy name
  // containing "<" can never become markup.
  function mdToHtml(md) {
    const inline = (s) => esc(s)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
      .replace(/(^|[\s(])_([^_]+)_(?=[\s.,)]|$)/g, "$1<i>$2</i>")
      .replace(/❌/g, '<span class="md-bad">❌</span>')
      .replace(/✅|✓/g, (m) => `<span class="md-ok">${m}</span>`);
    const lines = String(md || "").split("\n");
    const out = [];
    let list = null, table = null;
    const closeList = () => { if (list) { out.push("</ul>"); list = null; } };
    const closeTable = () => { if (table) { out.push("</tbody></table>"); table = null; } };
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i];
      const row = /^\s*\|(.+)\|\s*$/.exec(ln);
      if (row) {
        const cells = row[1].split("|").map((c) => c.trim());
        // the |---|---| separator only tells us the header ended
        if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue;
        if (!table) { out.push(`<table><thead><tr>${cells.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>`); table = true; continue; }
        out.push(`<tr>${cells.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`);
        continue;
      }
      closeTable();
      const h = /^(#{1,4})\s+(.*)$/.exec(ln);
      if (h) { closeList(); out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); continue; }
      if (/^\s*(-{3,}|\*{3,})\s*$/.test(ln)) { closeList(); out.push("<hr>"); continue; }
      const li = /^\s*[-*]\s+(.*)$/.exec(ln);
      if (li) { if (!list) { out.push("<ul>"); list = true; } out.push(`<li>${inline(li[1])}</li>`); continue; }
      closeList();
      if (ln.trim()) out.push(`<p>${inline(ln)}</p>`);
    }
    closeList(); closeTable();
    return out.join("\n");
  }

  // Show a report on screen AND keep it downloadable. `base`/`ext` feed
  // downloadText, so the file name matches what the tool would have written.
  let rptCurrent = null;
  function showReport(title, base, md, ext) {
    rptCurrent = { base, md, ext: ext || "md" };
    $("rptTitle").textContent = title;
    $("rptBody").innerHTML = mdToHtml(md);
    $("rptBody").scrollTop = 0;
    $("reportModal").classList.add("open");
  }
  $("rptClose").addEventListener("click", () => $("reportModal").classList.remove("open"));

  // ---------- What's new / changelog ----------
  // The overlay appears once per release: we remember the build the person
  // acknowledged and show everything newer than that. Anyone arriving for the
  // first time just gets the newest release, not the whole history.
  const CL_KEY = "enca-seen-build";
  const clSeen = () => { try { return +localStorage.getItem(CL_KEY) || 0; } catch { return 0; } };
  const clMarkSeen = () => { try { localStorage.setItem(CL_KEY, String(CHANGELOG_LATEST)); } catch { /* private mode */ } };
  const CL_KIND = { new: "New", improved: "Improved", fixed: "Fixed" };

  function clEntries(rel) {
    const order = { new: 0, improved: 1, fixed: 2 };
    return rel.items.slice().sort((a, b) => order[a.kind] - order[b.kind])
      .map((i) => `<li class="cl-i">
        <span class="cl-k ${i.kind}">${CL_KIND[i.kind]}</span>
        <span><b>${esc(i.tool)}</b> — ${esc(i.text)}</span></li>`).join("");
  }
  function clRelease(rel) {
    return `<div class="cl-rel">
      <div class="cl-h"><b>${esc(rel.title)}</b>
        <span class="mini muted">build ${rel.build} · ${esc(rel.date)}</span></div>
      <ul class="cl-list">${clEntries(rel)}</ul>
    </div>`;
  }
  function openChangelog() {
    crumb("📋 What's new");
    show("screen-changelog");
    $("clBody").innerHTML = (typeof CHANGELOG !== "undefined" ? CHANGELOG : []).map(clRelease).join("")
      || '<p class="mini">No changelog entries yet.</p>';
    clMarkSeen();
  }
  $("toolChangelog").addEventListener("click", openChangelog);

  // Called once the tenant has loaded, so it never covers the sign-in screen.
  function maybeShowWhatsNew() {
    if (typeof CHANGELOG === "undefined" || !CHANGELOG.length) return;
    const seen = clSeen();
    if (seen >= CHANGELOG_LATEST) return;
    // First visit (no key — which is also everyone's state right after the move
    // to enca.limon-it.nl, since localStorage is per-origin): show only the
    // newest release, not the entire history.
    const fresh = seen ? CHANGELOG.filter((r) => r.build > seen) : [];
    const rels = fresh.length ? fresh : [CHANGELOG[0]];
    const n = rels.reduce((s, r) => s + r.items.length, 0);
    $("newSub").innerHTML = seen
      ? `${n} change${n === 1 ? "" : "s"} since you were last here (build ${seen} → ${CHANGELOG_LATEST}).`
      : `Here's what the toolset can do as of build ${CHANGELOG_LATEST}.`;
    $("newBody").innerHTML = rels.map(clRelease).join("");
    $("newModal").classList.add("open");
  }
  function closeWhatsNew() { clMarkSeen(); $("newModal").classList.remove("open"); }
  $("newClose").addEventListener("click", closeWhatsNew);
  $("newModal").addEventListener("click", (e) => { if (e.target.id === "newModal") closeWhatsNew(); });
  $("newFull").addEventListener("click", () => { closeWhatsNew(); openChangelog(); });

  // ---------- Help (a full tool: own screen + tab) ----------
  // Table of contents is built once from the section headings so it can never
  // drift from the sections themselves.
  let helpTocBuilt = false;
  function buildHelpToc() {
    if (helpTocBuilt) return;
    const secs = [...document.querySelectorAll("#screen-help .help-sec > h4")];
    secs.forEach((h, i) => { h.id = h.id || `help-sec-${i}`; });
    $("helpToc").innerHTML = secs.map((h) => `<a href="#${h.id}">${h.textContent.replace(/\s+(BETA|NEW|writes to tenant)\b/gi, "").trim()}</a>`).join("");
    // Scroll-spy: highlight the chip for the section currently in view, and keep
    // that chip scrolled into view within the sticky ToC so it stays reachable.
    const links = new Map([...$("helpToc").querySelectorAll("a")].map((a) => [a.getAttribute("href").slice(1), a]));
    const seen = new Set();
    const spy = new IntersectionObserver((entries) => {
      entries.forEach((e) => e.isIntersecting ? seen.add(e.target.id) : seen.delete(e.target.id));
      const top = secs.find((h) => seen.has(h.id)) || secs[0];
      links.forEach((a) => a.classList.remove("active"));
      const a = top && links.get(top.id);
      if (a) a.classList.add("active");
    }, { rootMargin: "-118px 0px -68% 0px", threshold: 0 });
    secs.forEach((h) => spy.observe(h));
    helpTocBuilt = true;
  }
  function openHelp() {
    buildHelpToc();
    crumb("❓ Help");
    show("screen-help");
  }
  $("toolHelp").addEventListener("click", openHelp);
  // ToC links scroll to the section without leaving a #hash in the address bar
  $("helpToc").addEventListener("click", (e) => {
    const a = e.target.closest("a"); if (!a) return;
    e.preventDefault();
    const t = document.getElementById(a.getAttribute("href").slice(1));
    if (t) t.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  $("rptDownload").addEventListener("click", () => {
    if (rptCurrent) downloadText(rptCurrent.base, rptCurrent.ext, "text/markdown", rptCurrent.md);
  });
  $("rptCopy").addEventListener("click", async () => {
    if (!rptCurrent) return;
    try { await navigator.clipboard.writeText(rptCurrent.md); toast("Markdown <span>copied</span>"); }
    catch { toast("Could not copy — use Download instead"); }
  });

  // Search matches the policy name AND its persona label, so "guest" finds the
  // Guest admins group even though those policies are named "G_Admin", and
  // "service account" finds CA600s named "MSA". Without this, searching by the
  // persona you see on screen silently misses policies named by convention.
  function policyHaystack(p) {
    let label = "";
    try { label = Render.caGroup(p.name).label || ""; } catch { /* unnumbered */ }
    return `${p.name} ${label}`.toLowerCase();
  }
  function visible() {
    return policies.filter(p => (stateFilter === "all" || p.state === stateFilter)
      && (!query || policyHaystack(p).includes(query)));
  }

  // ---------- views ----------
  function refreshViews() {
    const vis = visible();
    $("stateChips").innerHTML = Render.stateChips(policies, stateFilter);
    $("cardsView").innerHTML = Render.groupedCards(vis, selected, collapsedGroups)
      || '<p class="mini" style="padding:20px">No policies match the current filter.</p>';
    document.querySelector("#ptable tbody").innerHTML = Render.listRows(policies, selected, stateFilter, query, collapsedGroups);
    $("mtable").innerHTML = Render.matrix(vis.length ? vis : policies);
    // group checkboxes: indeterminate when only part of the group is selected
    document.querySelectorAll("[data-gsel]").forEach(cb => {
      const ids = groupIds(cb.dataset.gsel);
      const n = ids.filter(id => selected.has(id)).length;
      cb.indeterminate = n > 0 && n < ids.length;
    });
    setView(viewMode);
    updateSelbar();
    syncCollapseAllBtn();
    syncHkBtn();
  }
  function groupIds(key) {
    return visible().filter(p => String(Render.caGroup(p.name).key) === String(key)).map(p => p.id);
  }
  function toggleGroupSel(key, on) {
    groupIds(key).forEach(id => on ? selected.add(id) : selected.delete(id));
    refreshViews();
  }
  function setView(v) {
    viewMode = v;
    $("cardsView").style.display = v === "cards" ? "grid" : "none";
    $("listView").style.display = v === "list" ? "block" : "none";
    $("matrixView").style.display = v === "matrix" ? "block" : "none";
    $("analyzeView").style.display = v === "analyze" ? "block" : "none";
    $("plFull").style.display = v === "matrix" ? "" : "none";
    // show a hint when the matrix is wider than the screen (horizontal scroll needed)
    if (v === "matrix") {
      (window.requestAnimationFrame || setTimeout)(() => {
        const mv = $("matrixView");
        $("matrixHint").style.display = mv.scrollWidth > mv.clientWidth + 4 ? "block" : "none";
      });
    } else { $("matrixHint").style.display = "none"; }
    syncCollapseAllBtn();
    ["viewCards", "viewList", "viewMatrix"].forEach(id => $(id).classList.remove("active"));
    if (v !== "analyze") $(v === "cards" ? "viewCards" : v === "list" ? "viewList" : "viewMatrix").classList.add("active");
    // Only one action can be the current one: entering the analyze view takes
    // the highlight off whichever tool mode brought you here.
    $("selActAnalyze").classList.toggle("on", v === "analyze");
    if (v === "analyze") SEL_ACTIONS.forEach(([id]) => $(id).classList.remove("on"));
    // Gap analyse lives inside this screen but has its own toolbar and its own
    // subject (users, not policies) — the policy search, state chips, select-all
    // and the sticky green action bar don't apply and would sit over its output.
    const isAn = v === "analyze";
    const pSearch = document.querySelector("#screen-list .toolbar .search");
    if (pSearch) pSearch.style.display = isAn ? "none" : "";
    $("stateChips").style.display = isAn ? "none" : "";
    $("selAllWrap").style.display = isAn ? "none" : "";
    updateSelbar();
  }
  // Pin the action bar just below the toolbar. The toolbar wraps to two or
  // three rows depending on width and which controls are showing, so a fixed
  // offset ends up overlapping it — measure instead.
  function syncSelbarTop() {
    const tb = document.querySelector("#screen-list .toolbar");
    if (!tb) return;
    const h = Math.round(tb.getBoundingClientRect().height);
    document.documentElement.style.setProperty("--selbar-top", (106 + h) + "px");
  }
  window.addEventListener("resize", syncSelbarTop);

  function updateSelbar() {
    const n = selected.size;
    (window.requestAnimationFrame || setTimeout)(syncSelbarTop);
    // The bar is the screen's action row, so it stays up as long as there are
    // policies to act on — an empty selection means "all visible", not "nothing".
    $("selbar").classList.toggle("visible", policies.length > 0 && viewMode !== "analyze");
    // "Select all" reflects the visible (filtered) set: checked when all of it
    // is selected, indeterminate while only part of it is.
    const vis = visible(), picked = vis.filter(p => selected.has(p.id)).length;
    const all = $("selAllTop"), listAll = $("selAll");
    [all, listAll].forEach(cb => {
      if (!cb) return;
      cb.checked = vis.length > 0 && picked === vis.length;
      cb.indeterminate = picked > 0 && picked < vis.length;
      cb.disabled = vis.length === 0;
    });
    $("selAllLabel").textContent = picked && picked === vis.length
      ? `All ${vis.length} selected`
      : picked ? `Select all (${picked}/${vis.length})` : `Select all (${vis.length})`;
    $("refreshBtn").disabled = policies.length === 0;

    // Writing to the tenant always needs an explicit selection — "everything
    // visible" is far too blunt a default for changing groups or policy state.
    // Assign groups stays available with an empty selection: its first step can
    // scope to the whole tenant, which is the point of a blanket exclusion.
    $("selActAssign").disabled = policies.length === 0;
    $("selActState").disabled = n === 0;
    $("selActDelete").disabled = n === 0;
    $("selLead").innerHTML = n
      ? `<b id="selCount">${n}</b> ${n === 1 ? "policy" : "policies"} selected`
      : `<b id="selCount">${vis.length}</b> ${vis.length === 1 ? "policy" : "policies"} in view`;
    $("selHint").textContent = !n
      ? "Nothing selected — Documentation, Backup and Gap analyse use everything in view"
      : n === 1
        ? "One policy exports as PNG, multiple as a combined PDF"
        : "Multiple selected — will export as a combined PDF";
  }
  // #10: warn when directory lookups partially failed and raw GUIDs remain
  function warnUnresolved() {
    const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    let n = 0;
    for (const p of policies) {
      [...p.users.inc, ...p.users.exc, ...p.apps.inc, ...p.apps.exc, ...p.net.inc, ...p.net.exc, ...p.grant.controls]
        .forEach(v => { if (guid.test(String(v))) n++; });
    }
    if (n) setTimeout(() => toast(`⚠ ${n} object name(s) could not be resolved — exports will show raw IDs for these`), 3500);
  }

  function showDetail(id) {
    const p = policies.find(x => x.id === id); if (!p) return;
    // The what-if flow is opt-in (a button under the card) so the detail stays
    // compact until you actually want to trace what the policy does.
    $("detailBody").innerHTML = Render.card(p, tenantName)
      + `<div class="pcard-actions">
           <button class="btn" data-wf="${p.id}">⑃ What-if flow</button>
           <span class="pa-sep"></span>
           <button class="btn" data-pact="document">📄 Documentation</button>
           <button class="btn" data-pact="backup">🗄 Backup</button>
           <button class="btn" data-pact="assign">👥 Assign groups</button>
           <button class="btn" data-pact="state">🎚 Policy state</button>
         </div>
         <div class="wf-panel" id="wfPanel" style="display:none"></div>`;
    detailPolicyId = p.id;
    $("detailModal").classList.add("open");
  }
  let detailPolicyId = null;

  // Persona apply flow — a popout of what CA does to a sign-in for this persona,
  // including the Global policies that apply to everyone.
  function openPersonaFlow(key) {
    const label = (Render.caGroup(`CA${String(key).padStart(3, "0")}`).label || "").replace(/\s*\(.*\)$/, "") || "this persona";
    $("flowTitle").textContent = `⑃ Apply flow — ${label}`;
    $("flowBody").innerHTML = WhatIf.personaFlow(key, policies, label);
    $("flowModal").classList.add("open");
  }
  $("flowClose").addEventListener("click", () => $("flowModal").classList.remove("open"));
  $("flowBody").addEventListener("click", (e) => {
    const pl = e.target.closest(".pol-link");
    if (pl) { $("flowModal").classList.remove("open"); openPolicyByName(pl.dataset.pol); }
  });

  // reveal / hide the per-policy flow on demand
  $("detailBody").addEventListener("click", (e) => {
    const b = e.target.closest("[data-wf]");
    if (b) {
      const panel = $("wfPanel"); const p = policies.find(x => x.id === b.dataset.wf); if (!p || !panel) return;
      if (panel.style.display === "none") { panel.innerHTML = WhatIf.policyFlow(p); panel.style.display = "block"; b.textContent = "⑃ Hide what-if flow"; }
      else { panel.style.display = "none"; b.textContent = "⑃ What-if flow"; }
      return;
    }
    // Per-policy action: act on just this policy. Set the selection to it, close
    // the detail, and run the same tool the selection bar would.
    const act = e.target.closest("[data-pact]");
    if (act && detailPolicyId) {
      const mode = act.dataset.pact;
      selected = new Set([detailPolicyId]);
      refreshViews();
      $("detailModal").classList.remove("open");
      setToolMode(mode);
      runToolMode(mode);
    }
  });

  // ---------- export ----------
  function openExport() {
    currentExport = selected.size ? [...selected] : visible().map(p => p.id);
    if (!currentExport.length) return;
    fmt = currentExport.length > 1 ? "docx" : "png";
    syncFmt();
    $("expDesc").textContent = selected.size
      ? (currentExport.length > 1
        ? `${currentExport.length} policies selected — recommended export is a Word document (one card per page).`
        : "1 policy selected — recommended export is a PNG image.")
      : `No selection — exporting all ${currentExport.length} policies in the current view.`;
    $("exportModal").classList.add("open");
  }
  function syncFmt() {
    ["Png", "Pdf", "Docx", "Zip", "Md", "Json"].forEach(f => $("expOpt" + f).classList.toggle("sel", fmt === f.toLowerCase()));
    $("expMatrixWrap").style.display = fmt === "pdf" ? "flex" : "none"; // appendix only applies to PDF
  }
  async function doExport() {
    $("exportModal").classList.remove("open");
    // export in persona order (CA number ranges): Global, Admins, Internals, …
    const ps = exportOrder(currentExport.map(id => policies.find(p => p.id === id)));
    try {
      if (fmt === "png") {
        for (const p of ps) {
          toast(`Exporting <span>${p.seq}.png</span>…`);
          await Exporter.policyPng(p, tenantName, tenantLogo);
        }
        toast("PNG export <span>done</span>");
      } else if (fmt === "docx") {
        await Exporter.policiesDocx(ps, tenantName, tenantLogo, (m) => toast(m));
        toast("Word export <span>done</span> — images can be copied straight into other documents");
      } else if (fmt === "zip") {
        await Exporter.policiesZip(ps, tenantName, tenantLogo, (m) => toast(m));
        toast("PNG bundle <span>done</span>");
      } else if (fmt === "md") {
        await Exporter.policiesMd(ps, tenantName);
        toast("Markdown export <span>done</span>");
      } else if (fmt === "json") {
        await Exporter.policiesJson(ps, tenantName);
        toast("JSON backup <span>done</span>");
      } else {
        await Exporter.policiesPdf(ps, tenantName, $("expMatrix").checked, (m) => toast(m), tenantLogo);
        toast("PDF export <span>done</span>");
      }
    } catch (e) {
      console.error("Export failed:", e);
      toast(`Export failed: <span>${esc(e.message || e)}</span>`);
    }
  }

  // ---------- data loading ----------
  async function loadFromGraph(isRefresh) {
    show("screen-loading");
    let phase = "loading the Conditional Access policies from your tenant";
    try {
      const { policies: raw, org, logo, resolve, account } = await Graph.loadTenant((m) => $("loadStatus").textContent = m);
      phase = "processing the policies";
      tenantName = org?.displayName || account?.tenantId || "";
      tenantDomain = (account?.username || "").split("@")[1] || "";
      tenantLogo = logo || null;
      isDemo = false; anReport = null;
      $("anResults").style.display = "none"; $("anStatus").textContent = "";
      raw.sort((a, b) => (a.displayName || "").localeCompare(b.displayName || ""));
      policies = raw.map((r, i) => buildViewModel(r, resolve, i));
      $("tenantName").textContent = tenantName;
      $("tenantUser").textContent = account?.username || "";
      $("avatar").textContent = (account?.name || account?.username || "?").split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase();
      $("tenantBox").style.display = "flex";
    $("homeBtn").style.display = "inline-flex";
      selected = new Set();
      refreshViews();
      renderPermissions();
      show(isRefresh ? "screen-list" : "screen-home");
      toast(isRefresh
        ? `Refreshed from Entra — <span>${policies.length}</span> Conditional Access policies`
        : `Signed in to <span>${esc(tenantName)}</span> — ${policies.length} Conditional Access policies loaded`);
      warnUnresolved();
      if (!isRefresh) maybeShowWhatsNew();   // after sign-in, never over the login screen
    } catch (e) {
      console.error("Failed while " + phase + ":", e); // full details for diagnostics
      alert(`Something went wrong while ${phase}.\n\nError: ${e.message || e}\n\n` +
        (phase.startsWith("loading")
          ? "If this mentions 401/403: admin consent for this app may not be granted in your tenant yet."
          : "This looks like an app bug — please report the error text above."));
      show("screen-login");
    }
  }

  function loadDemo() {
    tenantName = DEMO_DATA.tenantName;
    tenantLogo = null;
    isDemo = true; anReport = null;
    $("anResults").style.display = "none"; $("anStatus").textContent = "";
    const resolve = (id, map) => (map && map[id]) || DEMO_DATA.names[id] || id;
    policies = DEMO_DATA.policies.map((r, i) => buildViewModel(r, resolve, i));
    $("tenantName").textContent = tenantName;
    $("tenantUser").textContent = "demo@contoso.onmicrosoft.com";
    $("avatar").textContent = "DM";
    $("tenantBox").style.display = "flex";
    $("homeBtn").style.display = "inline-flex";
    refreshViews();
    renderPermissions();
    show("screen-home");
    toast(`Demo mode — <span>${policies.length}</span> sample policies loaded`);
    maybeShowWhatsNew();
  }

  // ---------- permissions overview (home) ----------
  const SCOPE_INFO = [
    { scope: "Policy.Read.All", use: "Read CA policies, named locations, auth strengths & contexts", tools: "all tools", onDemand: false },
    { scope: "Directory.Read.All", use: "Resolve users/groups/roles/apps to names; expand memberships", tools: "all tools", onDemand: false },
    { scope: "AuditLog.Read.All", use: "Read the directory audit log for Conditional Access changes", tools: "Change audit", onDemand: true },
    { scope: "Agreement.Read.All", use: "Read terms-of-use agreements", tools: "Backup", onDemand: true },
    { scope: "Policy.ReadWrite.ConditionalAccess", use: "Update policy group assignments / state, create policies, manage named locations", tools: "CA groups (assign), Set Policy state, Import, Named locations, MS Learn apply", onDemand: true },
    { scope: "Application.Read.All", use: "Required by Graph to create policies with app conditions", tools: "Import", onDemand: true },
    { scope: "Application.ReadWrite.All", use: "Create service principals for Microsoft apps a policy must reference", tools: "MS Learn apply", onDemand: true },
    { scope: "Policy.ReadWrite.AuthenticationMethod", use: "Create authentication strengths", tools: "Import", onDemand: true },
    { scope: "Group.ReadWrite.All", use: "Create missing persona groups", tools: "CA groups (create)", onDemand: true },
    { scope: "RoleManagement.ReadWrite.Directory", use: "Create groups as role-assignable", tools: "CA groups (create)", onDemand: true },
  ];
  async function renderPermissions() {
    const el = $("permOverview");
    const granted = isDemo ? ["Policy.Read.All", "Directory.Read.All"] : await Graph.grantedScopes();
    const missing = SCOPE_INFO.map(s => s.scope).filter(s => !granted.includes(s));
    el.innerHTML = `<h3 style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">🔑 Permissions in this session
        <button class="btn" id="permRefresh" style="font-size:12px;padding:5px 12px">⟳ Refresh</button>
        ${missing.length && !isDemo ? `<button class="btn primary" id="permConsent" style="font-size:12px;padding:5px 12px">🔓 Request consent for ${missing.length} missing permission(s)</button>` : ""}</h3>
      <p class="mini" style="margin-bottom:10px">Granted scopes come from your current sign-in${isDemo ? " (demo — simulated)" : ""}. On-demand scopes are only requested when the matching tool is used — refresh after consenting to see them turn green.</p>
      <table class="plist" style="font-size:13px">
        <thead><tr><th>Permission</th><th>Used for</th><th>Tools</th><th>Status</th></tr></thead>
        <tbody>${SCOPE_INFO.map(s => {
          const has = granted.includes(s.scope);
          return `<tr><td><code>${s.scope}</code></td><td class="mini">${s.use}</td><td class="mini">${s.tools}</td>
            <td>${has ? '<span class="tag grant">granted</span>' : s.onDemand ? '<span class="tag">on demand</span>' : '<span class="tag block">missing</span>'}</td></tr>`;
        }).join("")}</tbody>
      </table>`;
    el.style.display = "block";
  }
  $("permOverview").addEventListener("click", async (e) => {
    if (e.target.id === "permRefresh") { renderPermissions(); toast("Permission status <span>refreshed</span>"); return; }
    if (e.target.id === "permConsent") {
      e.target.disabled = true;
      try {
        const all = [...new Set([...AUTH_CONFIG.scopes, ...SCOPE_INFO.map(s => s.scope)])];
        const granted = await Graph.requestConsent(all);
        toast(`Consent updated — <span>${granted.length}</span> scopes in session`);
      } catch (err) {
        if (err.errorCode !== "user_cancelled") { console.error(err); toast(`Consent failed: <span>${esc(err.errorMessage || err.message || err)}</span>`); }
      } finally { renderPermissions(); }
    }
  });

  // ---------- tools home ----------
  function exportOrder(ps) {
    return [...ps].sort((a, b) => {
      const ga = Render.caGroup(a.name), gb = Render.caGroup(b.name);
      return ga.key - gb.key || (ga.num ?? 1e9) - (gb.num ?? 1e9) || a.name.localeCompare(b.name);
    });
  }
  // selection-bar action buttons ↔ tool mode
  const SEL_ACTIONS = [
    ["selActDoc", "document"], ["selActBackup", "backup"],
    ["selActAssign", "assign"], ["selActState", "state"],
  ];
  // Highlights the selection-bar action matching the tool you entered from, so
  // the screen still says which tool you are in now that the toolbar button
  // (which used to carry that label) is gone.
  function setToolMode(mode) {
    toolMode = mode;
    SEL_ACTIONS.forEach(([id, m]) => { const b = $(id); if (b) b.classList.toggle("on", m === mode); });
  }
  function runBackup() {
    const ps = exportOrder((selected.size ? [...selected] : visible().map(p => p.id)).map(id => policies.find(p => p.id === id)));
    if (!ps.length) { toast("Nothing to back up"); return; }
    bkPolicies = ps;
    const dep = backupDependencyIds(ps);
    const nDeps = Object.values(dep).reduce((s, a) => s + a.length, 0);
    $("bkDesc").textContent = `${ps.length} ${ps.length === 1 ? "policy" : "policies"} — referencing ${nDeps} dependencies `
      + `(${dep.groups.length} groups, ${dep.authStrengths.length} auth strengths, ${dep.namedLocations.length} named locations, ${dep.authContexts.length} auth contexts, ${dep.termsOfUse.length} terms of use).`;
    $("backupModal").classList.add("open");
  }
  let bkPolicies = [];
  function backupGroupIds(ps) {
    const ids = new Set();
    ps.forEach(p => {
      const u = p.raw.conditions?.users || {};
      [...(u.includeGroups || []), ...(u.excludeGroups || [])].forEach(id => ids.add(id));
    });
    return [...ids];
  }
  // All dependency ids referenced by the selected policies, per category.
  function backupDependencyIds(ps) {
    const d = { groups: new Set(), authStrengths: new Set(), namedLocations: new Set(), authContexts: new Set(), termsOfUse: new Set() };
    ps.forEach(p => {
      const c = p.raw.conditions || {}, g = p.raw.grantControls || {};
      backupGroupIds([p]).forEach(id => d.groups.add(id));
      if (g.authenticationStrength?.id) d.authStrengths.add(g.authenticationStrength.id);
      [...(c.locations?.includeLocations || []), ...(c.locations?.excludeLocations || [])]
        .filter(id => id !== "All" && id !== "AllTrusted").forEach(id => d.namedLocations.add(id));
      (c.applications?.includeAuthenticationContextClassReferences || []).forEach(id => d.authContexts.add(id));
      (g.termsOfUse || []).forEach(id => d.termsOfUse.add(id));
    });
    return Object.fromEntries(Object.entries(d).map(([k, v]) => [k, [...v]]));
  }
  const DEP_ENDPOINTS = {
    groups: (id) => `/groups/${id}`,
    authStrengths: (id) => `/policies/authenticationStrengthPolicies/${id}`,
    namedLocations: (id) => `/identity/conditionalAccess/namedLocations/${id}`,
    authContexts: (id) => `/identity/conditionalAccess/authenticationContextClassReferences/${id}`,
    termsOfUse: (id) => `/identityGovernance/termsOfUse/agreements/${id}?$expand=files`, // files carry the actual PDF (fileData.data)
  };
  // terms-of-use agreements need Agreement.Read.All — requested on demand
  const DEP_SCOPES = { termsOfUse: [...AUTH_CONFIG.scopes, "Agreement.Read.All"] };
  $("bkCancel").addEventListener("click", () => $("backupModal").classList.remove("open"));
  $("bkGo").addEventListener("click", async () => {
    $("backupModal").classList.remove("open");
    const ps = bkPolicies;
    const wantGroups = $("bkGroups").checked;
    if (!$("bkPolicies").checked && !wantGroups) { toast("Nothing selected to back up"); return; }
    try {
      const deps = { groups: [], authStrengths: [], namedLocations: [], authContexts: [], termsOfUse: [] };
      if (wantGroups) {
        const ids = backupDependencyIds(ps);
        const total = Object.values(ids).reduce((s, a) => s + a.length, 0);
        let n = 0; const skipped = [];
        for (const [cat, list] of Object.entries(ids)) {
          for (const id of list) {
            toast(`Fetching dependency ${++n}/${total}…`);
            try {
              deps[cat].push(isDemo
                ? { id, displayName: DEMO_DATA.names[id] || id, demo: true }
                : await Graph.gget(DEP_ENDPOINTS[cat](id), DEP_SCOPES[cat]));
            } catch (e) {
              console.warn(`Dependency fetch failed (skipped): ${cat}/${id}`, e.message);
              skipped.push(`${cat}: ${id}`);
            }
          }
        }
        if (skipped.length) toast(`⚠ <span>${skipped.length}</span> dependencies could not be fetched and were skipped — see browser console`);
      }
      const psOut = $("bkPolicies").checked ? ps : [];
      toast("Building JSON backup…");
      const nDeps = Object.values(deps).reduce((s, a) => s + a.length, 0);
      await Exporter.policiesJson(psOut, tenantName, {
        ...deps,
        tenantId: Graph.account?.tenantId || "",
      });
      toast(`JSON backup <span>downloaded</span> — ${psOut.length} policies${nDeps ? `, ${nDeps} dependencies` : ""}`);
    } catch (e) { console.error(e); toast(`Backup failed: <span>${esc(e.message || e)}</span>`); }
  });
  // ---------- tool tab bar ----------
  // The tools, in home-grid order. Each carries the exact crumb string its tile
  // handler sets, so the active tab can be matched from crumb() regardless of
  // whether the tool was opened from the grid or a tab.
  const TOOL_TABS = [
    ["toolPolicies", "🗂 List Policies"],
    ["toolDocument", "📄 Create documentation"],
    ["toolAnalyze", "🔍 Gap analyse"],
    ["toolGapCheck", "🛡 Best-practice & bypass checks"],
    ["toolValidator", "⚡ CA validator"],
    ["toolWhatIf", "🧪 What-If"],
    ["toolAudit", "🕓 Change audit"],
    ["toolExclusions", "🚪 Exclusion analyzer"],
    ["toolBaseline", "🧬 Baseline Policies"],
    ["toolBaselineJoey", "🧩 Baseline (Joey Verlinden)"],
    ["toolMsLearn", "📘 MS Learn checks"],
    ["toolJson", "🗄 Backup (JSON)"],
    ["toolCaGroups", "👥 Conditional Access groups"],
    ["toolLocations", "🌐 Named locations"],
    ["toolState", "🎚 Set Policy state"],
    ["toolImport", "📥 Import"],
  ];
  // Help is a tool too, but always sits last (after the + in the tab bar).
  TOOL_TABS.push(["toolChangelog", "📋 What's new"]);
  TOOL_TABS.push(["toolHelp", "❓ Help"]);
  // Browser-style tabs: a tab exists only for a tool you have opened. Home shows
  // no tabs; opening a tool (from the grid or the + menu) adds one; the + opens
  // another. openTabs is the ordered set of open tool ids.
  let openTabs = [], activeTab = null;
  const labelFor = (id) => (TOOL_TABS.find((x) => x[0] === id) || [, id])[1];
  const idForCrumb = (name) => (TOOL_TABS.find((x) => x[1] === name) || [])[0] || null;

  function renderTabs() {
    const home = `<button class="toolnav-btn home ${activeTab ? "" : "active"}" data-navhome title="All tools" aria-label="All tools">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M3 10.6 12 3.2l9 7.4"/><path d="M5.2 9.4V20.4h13.6V9.4"/><path d="M9.6 20.4v-6.2h4.8v6.2"/>
      </svg></button>`;
    const tabs = openTabs.map((id) =>
      `<span class="toolnav-tab ${id === activeTab ? "active" : ""}">
        <button class="toolnav-btn" data-nav="${id}">${esc(labelFor(id))}</button>
        <button class="toolnav-x" data-close="${id}" title="Close tab">×</button>
      </span>`).join("");
    const add = `<button class="toolnav-btn add" data-navadd title="Open a tool in a new tab">＋</button>`;
    const help = `<button class="toolnav-btn help" data-navhelp title="How each tool works">❓ Help</button>`;
    // "close all" appears only when there's more than one tab to close at once
    const closeAll = openTabs.length > 1 ? `<button class="toolnav-btn closeall" data-navcloseall title="Close all tabs">✕ all</button>` : "";
    // Centred inner strip aligned to the card width; tabs grow out from the
    // middle to left and right as more open ("opening a curtain").
    $("toolNav").innerHTML = `<div class="toolnav-inner">${home}${tabs}${add}${closeAll}${help}</div>`;
    // the bar only appears once a tool is open (empty at the tools home)
    $("toolNav").style.display = openTabs.length ? "block" : "none";
  }
  function buildToolNav() { openTabs = []; activeTab = null; renderTabs(); }

  function closeTab(id) {
    const i = openTabs.indexOf(id);
    if (i < 0) return;
    openTabs.splice(i, 1);
    if (activeTab === id) {
      const next = openTabs[i] || openTabs[i - 1] || null;   // neighbour, else last
      if (next) { $(next).click(); }                          // switch to it
      else { crumb(""); show("screen-home"); }
    } else { renderTabs(); }
  }

  // The + menu: pick any tool to open in a new tab.
  function openAddMenu(anchor) {
    closeAddMenu();
    const menu = document.createElement("div");
    menu.className = "toolnav-menu"; menu.id = "toolAddMenu";
    menu.innerHTML = TOOL_TABS.map(([id, label]) =>
      `<button data-nav="${id}" class="${openTabs.includes(id) ? "open" : ""}">${esc(label)}${openTabs.includes(id) ? " <span class='mini'>· open</span>" : ""}</button>`).join("");
    document.body.appendChild(menu);
    const r = anchor.getBoundingClientRect();
    menu.style.top = `${r.bottom + 4}px`;
    menu.style.left = `${Math.min(r.left, window.innerWidth - 280)}px`;
    menu.addEventListener("click", (e) => {
      const b = e.target.closest("[data-nav]"); if (!b) return;
      closeAddMenu(); $(b.dataset.nav).click();
    });
    setTimeout(() => document.addEventListener("click", closeAddMenu, { once: true }), 0);
  }
  function closeAddMenu() { const m = $("toolAddMenu"); if (m) m.remove(); }

  $("toolNav").addEventListener("click", (e) => {
    if (e.target.closest("[data-navhelp]")) { openHelp(); return; }
    if (e.target.closest("[data-navcloseall]")) { openTabs = []; activeTab = null; renderTabs(); crumb(""); show("screen-home"); return; }
    if (e.target.closest("[data-navhome]")) { crumb(""); show("screen-home"); return; }
    if (e.target.closest("[data-navadd]")) { openAddMenu(e.target.closest("[data-navadd]")); return; }
    const x = e.target.closest("[data-close]"); if (x) { e.stopPropagation(); closeTab(x.dataset.close); return; }
    const b = e.target.closest("[data-nav]");
    if (b) $(b.dataset.nav).click();   // reuse the tile's own handler (crumb, screen, setup)
  });

  // Header breadcrumb + tab state: crumb(name) is called by every tool on entry,
  // so it both labels the header chip and registers/activates the tab.
  function crumb(name) {
    const id = name ? idForCrumb(name) : null;
    if (id) { if (!openTabs.includes(id)) openTabs.push(id); activeTab = id; }
    else { activeTab = null; }
    renderTabs();
  }
  $("homeBtn").addEventListener("click", () => { crumb(""); show("screen-home"); });
  // logo returns to the tools overview when signed in (does nothing on login)
  $("logoHome").addEventListener("click", () => { if (policies.length) { crumb(""); show("screen-home"); } });
  $("toolPolicies").addEventListener("click", () => { crumb("🗂 List Policies"); setToolMode("document"); setView("cards"); show("screen-list"); });
  // Document tool: opens the policy overview first — select policies (or none
  // for all), then click "Create documentation" in the toolbar to choose the format.
  $("toolDocument").addEventListener("click", () => {
    crumb("📄 Create documentation"); setToolMode("document"); setView("cards"); show("screen-list");
    toast("Documentation mode — select policies (or none for all), then click <span>Create documentation</span>");
  });
  $("toolAnalyze").addEventListener("click", () => { crumb("🔍 Gap analyse"); setToolMode("document"); setView("analyze"); show("screen-list"); });
  $("toolMsLearn").addEventListener("click", () => { crumb("📘 MS Learn checks"); openMsLearn(); });
  $("toolGapCheck").addEventListener("click", () => { crumb("🛡 Best-practice & bypass checks"); openGapCheck(); });
  $("toolExclusions").addEventListener("click", () => { crumb("🚪 Exclusion analyzer"); openExclusions(); });
  $("toolValidator").addEventListener("click", () => { openValidator(); });   // openValidator sets its own crumb
  $("toolBaseline").addEventListener("click", () => { crumb("🧬 Baseline Policies"); openBaseline("limonit"); });
  $("toolBaselineJoey").addEventListener("click", () => { crumb("🧩 Baseline (Joey Verlinden)"); openBaseline("joey"); });
  // Backup tool: opens the policy overview in backup mode — select policies
  // (or leave unselected for all), then click "Backup (JSON)" in the toolbar.
  $("toolJson").addEventListener("click", () => {
    crumb("🗄 Backup (JSON)"); setToolMode("backup"); setView("cards"); show("screen-list");
    toast("Backup mode — select policies (or none for all), then click <span>Backup (JSON)</span>");
  });
  // Set-state tool (BETA): select policies, choose On / Report-only / Off, apply.
  $("toolState").addEventListener("click", () => {
    crumb("🎚 Set Policy state"); setToolMode("state"); setView("cards"); show("screen-list");
    toast("Set-state mode — select policies, then click <span>Set Policy state</span>");
  });
  function openStateModal() {
    if (!selected.size) { toast("Select at least one policy first"); return; }
    const ps = exportOrder([...selected].map(id => policies.find(p => p.id === id)));
    $("stDesc").textContent = `${ps.length} ${ps.length === 1 ? "policy" : "policies"} selected — choose the new state. This WRITES to your tenant.${isDemo ? " (demo — simulated)" : ""}`;
    $("stList").innerHTML = `<ul class="plist2" style="border:1px solid var(--border);border-radius:8px">` +
      ps.map(p => `<li>${Render.stateChip(p.state)} ${esc(p.name)}</li>`).join("") + "</ul>";
    document.querySelectorAll('[name="stState"]').forEach(r => r.checked = false);
    $("stateModal").classList.add("open");
  }
  $("stCancel").addEventListener("click", () => $("stateModal").classList.remove("open"));
  $("stGo").addEventListener("click", async () => {
    const sel = document.querySelector('[name="stState"]:checked');
    if (!sel) { toast("Choose the new state first"); return; }
    const state = sel.value;
    if (!await preConsent([...AUTH_CONFIG.scopes, "Policy.ReadWrite.ConditionalAccess"])) return;
    const ps = exportOrder([...selected].map(id => policies.find(p => p.id === id)));
    $("stGo").disabled = true;
    try {
      const results = [];
      for (let i = 0; i < ps.length; i++) {
        toast(`Updating ${i + 1}/${ps.length}…`);
        try {
          if (!isDemo) await Graph.gpatch(`/identity/conditionalAccess/policies/${ps[i].id}`, { state });
          results.push({ name: ps[i].name, ok: true });
        } catch (e) { console.error(e); results.push({ name: ps[i].name, ok: false }); }
      }
      $("stateModal").classList.remove("open");
      const failed = results.filter(r => !r.ok).length;
      toast(failed ? `State change done with <span>${failed} failure(s)</span> — see console`
        : `State of <span>${results.length}</span> policies set${isDemo ? " (simulated)" : ""}`);
      if (!isDemo && results.some(r => r.ok)) await loadFromGraph(true);
    } finally { $("stGo").disabled = false; }
  });

  // ---------- delete policies ----------
  // Entra has no recycle bin for Conditional Access, so a delete is final. The
  // guards are deliberately heavier than for any other action here: the raw
  // JSON is offered as a download first (that backup IS the only undo), the
  // word DELETE must be typed, and enforced policies need a second tick because
  // removing one silently drops a control that is live right now.
  function delSelection() {
    return exportOrder([...selected].map(id => policies.find(p => p.id === id))).filter(Boolean);
  }
  function openDeleteModal() {
    if (!selected.size) { toast("Select at least one policy first"); return; }
    const ps = delSelection();
    const live = ps.filter(p => p.state === "enabled");
    $("delDesc").textContent = `${ps.length} ${ps.length === 1 ? "policy" : "policies"} selected `
      + `in ${tenantName || "this tenant"}.${isDemo ? " (demo — simulated, nothing is really deleted)" : ""}`;
    $("delOnWarn").style.display = live.length ? "block" : "none";
    $("delOnWarn").innerHTML = live.length
      ? `<label class="chk" style="margin:6px 0"><input type="checkbox" id="delAckOn"> `
        + `I understand <b>${live.length}</b> of these ${live.length === 1 ? "is" : "are"} currently <span class="state on">On</span> `
        + `— deleting ${live.length === 1 ? "it" : "them"} removes enforcement immediately</label>`
      : "";
    $("delList").innerHTML = `<ul class="plist2" style="border:1px solid var(--border);border-radius:8px">`
      + ps.map(p => `<li>${Render.stateChip(p.state)} ${esc(p.name)}</li>`).join("") + "</ul>";
    $("delConfirm").value = "";
    $("delBackup").checked = true;
    syncDelGo();
    $("delModal").classList.add("open");
  }
  // The Delete button only wakes up once every guard is satisfied.
  function syncDelGo() {
    const ack = $("delAckOn");
    $("delGo").disabled = $("delConfirm").value.trim().toUpperCase() !== "DELETE" || (ack ? !ack.checked : false);
  }
  $("delConfirm").addEventListener("input", syncDelGo);
  $("delOnWarn").addEventListener("change", syncDelGo);
  $("delCancel").addEventListener("click", () => $("delModal").classList.remove("open"));

  $("delGo").addEventListener("click", async () => {
    const ps = delSelection();
    if (!ps.length) { $("delModal").classList.remove("open"); return; }
    if (!await preConsent([...AUTH_CONFIG.scopes, "Policy.ReadWrite.ConditionalAccess"])) return;
    // Backup first — if this throws we stop, because the download is the only
    // thing standing between a mistaken click and an unrecoverable policy.
    if ($("delBackup").checked) {
      try {
        downloadText("CA-Deleted-Policies", "json", "application/json",
          JSON.stringify({ tenant: tenantName, exported: new Date().toISOString(), policies: ps.map(p => p.raw) }, null, 2));
      } catch (e) {
        console.error(e);
        toast("Backup download <span>failed</span> — nothing was deleted");
        return;
      }
    }
    $("delGo").disabled = true;
    try {
      const results = [];
      for (let i = 0; i < ps.length; i++) {
        toast(`Deleting ${i + 1}/${ps.length}…`);
        try {
          if (!isDemo) await Graph.gdelete(`/identity/conditionalAccess/policies/${ps[i].id}`, [...AUTH_CONFIG.scopes, ...ML_WRITE]);
          results.push({ name: ps[i].name, ok: true });
        } catch (e) { console.error(e); results.push({ name: ps[i].name, ok: false, err: e.message }); }
      }
      $("delModal").classList.remove("open");
      const failed = results.filter(r => !r.ok);
      toast(failed.length
        ? `Deleted <span>${results.length - failed.length}</span>, <span>${failed.length} failed</span> — see console`
        : `<span>${results.length}</span> ${results.length === 1 ? "policy" : "policies"} deleted${isDemo ? " (simulated)" : ""}`);
      selected.clear();
      if (!isDemo && results.some(r => r.ok)) await loadFromGraph(true); else refreshViews();
    } finally { $("delGo").disabled = false; }
  });

  // ---------- housekeeping: delete superseded (Off) policy versions ----------
  // "Match & replace" deliberately leaves the old version behind, switched Off,
  // as the rollback. Nothing ever cleans those up, so a tenant that has been
  // through a few baseline upgrades accumulates dead policies. This lists them
  // with what replaced them and hands the chosen ones to the normal delete flow,
  // guards and JSON backup included.
  function hkFind() { return Importer.supersededOff(policies); }
  function syncHkBtn() {
    const n = hkFind().length;
    const b = $("hkBtn"); if (!b) return;
    b.style.display = (n && viewMode !== "analyze") ? "" : "none";
    b.textContent = `🧹 Housekeeping (${n})`;
    b.title = `${n} old policy version${n === 1 ? "" : "s"} left switched Off by a match & replace import — review and clean up`;
  }
  function openHousekeeping() {
    const rows = hkFind();
    $("hkDesc").textContent = `${rows.length} superseded ${rows.length === 1 ? "policy" : "policies"} in ${tenantName || "this tenant"}.`;
    $("hkList").innerHTML = `<ul class="plist2" style="border:1px solid var(--border);border-radius:8px">`
      + rows.map((r, i) => `<li><label class="chk" style="margin:0">
          <input type="checkbox" data-hk="${i}" checked>
          ${Render.stateChip(r.policy.state)} ${esc(r.policy.name)}
          <span class="mini">superseded by <b>${esc(r.newer.name)}</b> ${Render.stateChip(r.newer.state)}</span>
        </label></li>`).join("") + "</ul>";
    syncHkGo();
    $("hkModal").classList.add("open");
  }
  function syncHkGo() {
    const n = document.querySelectorAll("[data-hk]:checked").length;
    $("hkGo").disabled = n === 0;
    $("hkGo").textContent = n ? `Review & delete ${n}` : "Review & delete";
  }
  $("hkBtn").addEventListener("click", openHousekeeping);
  $("hkCancel").addEventListener("click", () => $("hkModal").classList.remove("open"));
  $("hkList").addEventListener("change", (e) => { if (e.target.matches("[data-hk]")) syncHkGo(); });
  $("hkGo").addEventListener("click", () => {
    const rows = hkFind();
    const ids = [...document.querySelectorAll("[data-hk]:checked")].map(cb => rows[+cb.dataset.hk]?.policy.id).filter(Boolean);
    if (!ids.length) return;
    $("hkModal").classList.remove("open");
    // Hand over to the delete flow — typed DELETE, backup download, the lot.
    selected = new Set(ids);
    refreshViews();
    openDeleteModal();
  });

  // ---------- import tool (BETA) ----------
  let imBundle = null, imPlan = null, imFileName = "", imMode = "deploy";
  // Workload ID licence state for this tenant: { known, licensed, sku }. Read
  // once per file load — a workload-identity policy cannot be created without it.
  let imLic = { known: false, licensed: false, sku: null };
  const imWidBlocked = (p) => p.wid && imLic.known && !imLic.licensed;
  $("toolImport").addEventListener("click", () => {
    crumb("📥 Import");
    imBundle = null; imPlan = null; imMode = "deploy"; imLic = { known: false, licensed: false, sku: null };
    $("imBody").innerHTML = ""; $("imGo").style.display = "none"; $("imPick").style.display = "flex";
    $("imDesc").textContent = "Select an ENCA backup zip, or pick the extracted backup folder — both use the same structure.";
    $("importModal").classList.add("open");
  });
  // Import is a modal over the current screen — drop the crumb when it closes.
  $("imCancel").addEventListener("click", () => { $("importModal").classList.remove("open"); crumb(""); });
  // Label a plan item's persona for the filter — an E-Admins policy is imported
  // as-is (no persona group), so it gets its own bucket.
  const IM_PERSONA_LABEL = {
    global: "🌐 Global", admins: "🛡 Admins", internals: "👤 Internals", externals: "🤝 Externals",
    guestusers: "👥 Guest users", g_admins: "🔑 Guest admins", serviceaccounts: "⚙ Service accounts",
    devops: "🧰 DevOps", factoryworkers: "🏭 Factory workers",
  };
  const imPersonaKey = (p) => p.asIs ? "eadmins" : (p.persona || "other");
  const imPersonaLabel = (k) => k === "eadmins" ? "🚨 E-Admins" : (IM_PERSONA_LABEL[k] || "Other");

  async function imLoaded(bundle, fileName) {
    imBundle = bundle; imFileName = fileName;
    // pass the tenant's raw policies (not just names) so "match & replace" can
    // read the current assignment and id of a policy it supersedes
    imPlan = Importer.plan(bundle, policies.map(p => p.raw));
    const dep = ["groups", "namedLocations", "authStrengths", "authContexts", "termsOfUse"].map(k => `${bundle[k].length} ${k}`).join(", ");
    $("imDesc").textContent = `${fileName}: ${bundle.policies.length} policies, dependencies: ${dep}.`;
    // Only worth a Graph call when the file actually contains one.
    imLic = imPlan.some(p => p.wid)
      ? (isDemo ? { known: true, licensed: false, sku: null } : await Importer.workloadIdLicence())
      : { known: false, licensed: false, sku: null };
    imRenderList();
    $("imPick").style.display = "none";
  }

  // Rebuilds the plan list — called on load and whenever the assignment mode
  // toggles, since the per-row hint depends on the mode.
  function imRenderList() {
    const importable = imPlan.filter(p => !p.exists && !imWidBlocked(p));
    const nUpg = imPlan.filter(p => p.upgrade).length;
    const replace = imMode === "replace";
    const nWid = imPlan.filter(p => p.wid && !p.exists).length;

    // Persona filter: how many importable policies each persona has, so you can
    // bring in just one persona's set from a whole-tenant backup.
    const counts = new Map();
    importable.forEach(p => { const k = imPersonaKey(p); counts.set(k, (counts.get(k) || 0) + 1); });
    const order = ["global", "admins", "internals", "externals", "guestusers", "g_admins", "serviceaccounts", "devops", "factoryworkers", "eadmins", "other"];
    const chips = [...counts.keys()].sort((a, b) => order.indexOf(a) - order.indexOf(b))
      .map(k => `<button class="btn sm persona-chip" data-im-persona="${esc(k)}">${esc(imPersonaLabel(k))} (${counts.get(k)})</button>`).join("");

    const rowHint = (p) => {
      if (p.exists) return esc(p.reason);
      if (imWidBlocked(p)) return `<span style="color:var(--off)">workload identity — this tenant has no Microsoft Entra Workload ID licence, so Graph will not create it</span>`;
      if (p.upgrade) return replace
        ? `♻️ replaces the current v${esc(p.existing.ver)} — assignment + state kept (new exclusions merged), old policy switched Off`
        : `→ ${esc(p.personaGroup || "")} · <span style="color:var(--muted)">current v${esc(p.existing.ver)} stays as-is</span>`;
      if (p.personaGroup) return `→ ${esc(p.personaGroup)}`;
      return esc(p.reason || "");
    };

    $("imBody").innerHTML = `
      <div class="im-mode" role="radiogroup" aria-label="Assignment mode">
        <label class="im-mode-opt${!replace ? " on" : ""}"><input type="radio" name="imMode" value="deploy" ${!replace ? "checked" : ""}>
          <b>🚀 Deployment groups</b><span class="mini">Includes remapped to the deploy persona group (CAD-SEC-U-DG-*) — staged, nothing existing is touched.</span></label>
        <label class="im-mode-opt${replace ? " on" : ""}"><input type="radio" name="imMode" value="replace" ${replace ? "checked" : ""}>
          <b>♻️ Match &amp; replace</b><span class="mini">A policy already in this tenant keeps its current assignment and state (plus any new exclusion groups this version adds); its old version is switched Off.${nUpg ? ` ${nUpg} match${nUpg === 1 ? "es" : "es"} here.` : " No matches in this file."}</span></label>
      </div>
      ${nWid && imLic.known && !imLic.licensed ? `<div class="danger-note" style="margin:10px 0">
        🔒 <b>${nWid} workload-identity ${nWid === 1 ? "policy is" : "policies are"} held back.</b> They target service principals, which needs the separately purchased
        <b>Microsoft Entra Workload ID</b> licence — not included in Entra ID P1/P2 — and this tenant has none, so Graph would reject them with a bare 400.
        Buy or trial the licence, then re-import; nothing else has to be redone.</div>` : ""}
      ${nWid && imLic.known && imLic.licensed ? `<p class="mini" style="margin:8px 0">✅ Workload ID licence found${imLic.sku ? ` (<b>${esc(imLic.sku)}</b>)` : ""} — the ${nWid} workload-identity ${nWid === 1 ? "policy" : "policies"} can be imported.</p>` : ""}
      ${nWid && !imLic.known ? `<p class="mini" style="margin:8px 0">⚠ Could not read the tenant's licences, so the ${nWid} workload-identity ${nWid === 1 ? "policy is" : "policies are"} attempted anyway — a 400 on those means the Workload ID licence is missing.</p>` : ""}
      <p class="mini" style="margin:8px 0">Dependencies are imported first (create-if-missing). Policies always land in state <b>Off</b>, and one with the same CA number + version is skipped.${isDemo ? " <b>Demo — simulated.</b>" : ""}</p>
      <p class="mini" style="margin:6px 0 4px"><b>Import only:</b> pick a persona to select just its policies, or use All / None.</p>
      <div class="persona-row" style="margin-bottom:10px">
        <button class="btn sm" data-im-persona="__all">All (${importable.length})</button>
        <button class="btn sm" data-im-persona="__none">None</button>
        ${chips}
      </div>
      <ul class="plist2" style="border:1px solid var(--border);border-radius:8px">` +
      imPlan.map((p, i) => `<li data-imrow="${i}" data-imkey="${esc(imPersonaKey(p))}"><label class="chk" style="margin:0">
        <input type="checkbox" data-imp="${i}" ${p.exists || imWidBlocked(p) ? "disabled" : "checked"}>
        ${p.exists ? '<span class="tag">skip</span>' : imWidBlocked(p) ? '<span class="tag block" title="Conditional Access for workload identities requires the Microsoft Entra Workload ID licence">🔒 no Workload ID licence</span>' : p.upgrade ? '<span class="tag grant">update</span>' : p.asIs ? '<span class="tag new">as-is</span>' : `<span class="tag grant">import</span>`}
        ${p.needsTou ? '<span class="tag block" title="Grants a Terms of use — create the ToU in the portal first, then re-import; it imports now without that control">📜 needs ToU</span>' : ""}
        ${esc(p.name)}
        <span class="mini">${rowHint(p)}${p.needsTou && !p.exists ? ' · <span style="color:var(--off)">imports without the Terms of use until you create it</span>' : ""}</span>
      </label></li>`).join("") + "</ul>";
    $("imGo").style.display = importable.length ? "inline-flex" : "none";
    updateImGo();
  }

  // Tick exactly the importable policies of one persona (or all / none). An
  // "already exists" row is disabled and never touched.
  function imSelectPersona(key) {
    const single = key !== "__all" && key !== "__none";
    imPlan.forEach((p, i) => {
      const cb = document.querySelector(`[data-imp="${i}"]`);
      if (cb && !cb.disabled) cb.checked = key === "__all" ? true : key === "__none" ? false : imPersonaKey(p) === key;
      // Picking one persona narrows the list to just its policies; All / None
      // show everything again.
      const row = document.querySelector(`[data-imrow="${i}"]`);
      if (row) row.style.display = (!single || imPersonaKey(p) === key) ? "" : "none";
    });
    updateImGo();
  }
  function updateImGo() {
    const n = document.querySelectorAll("[data-imp]:checked").length;
    const btn = $("imGo");
    btn.disabled = n === 0;
    btn.textContent = n ? `Import ${n}` : "Import";
  }
  $("imBody").addEventListener("click", (e) => {
    const chip = e.target.closest("[data-im-persona]");
    if (chip) {
      imSelectPersona(chip.dataset.imPersona);
      // highlight the persona just applied (not All/None)
      document.querySelectorAll("#imBody [data-im-persona]").forEach(b => b.classList.remove("on"));
      if (!chip.dataset.imPersona.startsWith("__")) chip.classList.add("on");
      return;
    }
  });
  $("imBody").addEventListener("change", (e) => {
    if (e.target.matches('input[name="imMode"]')) { imMode = e.target.value; imRenderList(); return; }
    if (e.target.matches("[data-imp]")) updateImGo();
  });
  $("imZip").addEventListener("change", async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { await imLoaded(await Importer.readZip(f), f.name); }
    catch (err) { console.error(err); toast(`Could not read zip: <span>${esc(err.message || err)}</span>`); }
  });
  $("imFolder").addEventListener("change", async (e) => {
    if (!e.target.files.length) return;
    try { await imLoaded(await Importer.readFolder([...e.target.files]), "selected folder"); }
    catch (err) { console.error(err); toast(`Could not read folder: <span>${esc(err.message || err)}</span>`); }
  });
  $("imGo").addEventListener("click", async () => {
    const chosen = [...document.querySelectorAll("[data-imp]:checked")].map(cb => imPlan[+cb.dataset.imp]);
    if (!chosen.length) { toast("Nothing selected to import"); return; }
    // Consent first, while the click is still fresh — an import creates
    // dependencies (groups, locations) as well as policies, so ask for both.
    if (!await preConsent([...AUTH_CONFIG.scopes, "Policy.ReadWrite.ConditionalAccess",
      "Group.ReadWrite.All", "RoleManagement.ReadWrite.Directory"])) return;
    $("imGo").disabled = true;
    try {
      let depLog = { created: [], reused: [], warnings: [] }, maps = { group: {}, loc: {}, strength: {}, ctx: {}, tou: {}, personaGroupIds: {} }, res = { results: [], warnings: [] };
      // Only build the dependencies the CHOSEN policies need — importing one
      // persona should not create every group in a whole-tenant backup.
      const scoped = Importer.scopeBundle(imBundle, chosen.map(p => p.raw));
      // policies that will be replaced in place don't need a deploy group made
      const matchedNames = imMode === "replace" ? chosen.filter(p => p.upgrade).map(p => p.name) : [];
      if (isDemo) {
        chosen.forEach(p => { if (p.personaGroup && !matchedNames.includes(p.name)) maps.personaGroupIds[p.personaGroup] = "g-" + p.personaGroup; });
        res.results = chosen.map(p => {
          const matched = imMode === "replace" && p.upgrade;
          return { name: p.name, ok: true, persona: p.persona, personaGroup: matched ? null : p.personaGroup, matched, disabledOld: matched, oldName: matched ? p.existing?.name : null, state: matched ? (p.existing?.raw?.state || "disabled") : "disabled" };
        });
        depLog.created = scoped.groups.map(g => "Group: " + g.displayName);
      } else {
        const dep = await Importer.ensureDependencies(scoped, (m) => toast(esc(m)), { matchedNames });
        depLog = dep.log; maps = dep.maps;
        res = await Importer.importPolicies(chosen, maps, (m) => toast(esc(m)), { mode: imMode });
      }
      // Change report — shown on screen and downloadable. A failed import is
      // the case you most need to read, so it should not require opening a file.
      const md = Importer.buildReport({ tenantName, fileName: imFileName, depLog, planItems: imPlan, results: res.results, warnings: res.warnings, mode: imMode, licence: imLic });
      const failed = res.results.filter(r => !r.ok).length;
      $("importModal").classList.remove("open");
      showReport("📥 Import report", "CA-Import-Report", md);
      toast(failed ? `Import done with <span>${failed} failure(s)</span>`
        : `Imported <span>${res.results.length}</span> policies (Off)${isDemo ? " (simulated)" : ""}`);
      if (!isDemo && res.results.some(r => r.ok)) await loadFromGraph(true);
    } catch (e) {
      console.error(e); toast(`Import failed: <span>${esc(e.message || e)}</span>`);
    } finally { $("imGo").disabled = false; }
  });

  // ---------- Conditional Access groups ----------
  // One tool for the group side of the baseline: check what exists, create what
  // does not, read who is in them, and assign them to policies. The assign step
  // is the former standalone tool, unchanged — it just lives here now, next to
  // the groups it assigns.
  let cgRes = null, cgTab = "check", cgFilter = "all", cgQuery = "", cgBusy = false, cgStop = false;
  // Default scope: only the groups the tenant's CA policies actually reference.
  // "all" additionally expects every template / baseline group (finds missing).
  let cgScope = "policies";
  const cgMemberSel = new Set();   // group names picked for the member read
  let cgMemberPick = false;        // showing the picker rather than the matrix

  $("toolCaGroups").addEventListener("click", () => { crumb("👥 Conditional Access groups"); openCaGroups(); });

  async function openCaGroups(keepTab) {
    show("screen-cagroups");
    if (!keepTab) { cgTab = "check"; cgFilter = "all"; cgQuery = ""; $("cgSearch").value = ""; }
    if (!cgRes) {
      $("cgHead").innerHTML = '<p class="mini">Scanning groups…</p>';
      $("cgChips").innerHTML = ""; $("cgBody").innerHTML = "";
      try {
        cgRes = isDemo ? demoGroupScan() : await CaGroups.scan(policies, {
          scope: cgScope,
          onStatus: (m) => { const el = $("cgHead").querySelector("p"); if (el) el.textContent = m; },
        });
      } catch (e) {
        console.error(e);
        $("cgHead").innerHTML = `<p class="mini" style="color:var(--off)">Group scan failed: ${esc(e.message || e)}</p>`;
        return;
      }
    }
    renderCaGroups();
  }

  // Demo mode has no directory, so synthesise a scan that still exercises every
  // status — otherwise the demo silently shows an empty tool.
  function demoGroupScan() {
    const names = (typeof GROUP_TEMPLATES !== "undefined" ? GROUP_TEMPLATES : []).slice(0, 24);
    const rows = names.map((t, i) => ({
      name: t.displayName, status: i % 5 === 0 ? "missing" : "present",
      sources: ["template"], template: t, id: i % 5 === 0 ? null : "g-demo-" + i,
      description: t.description || "", roleAssignable: !t.membershipRule,
      dynamic: !!t.membershipRule, membershipRule: t.membershipRule || "",
      refs: { include: [], exclude: [] }, refCount: i % 3,
      members: null, memberTotal: null, memberError: null, drift: null,
    }));
    const counts = rows.reduce((a, r) => { a[r.status] = (a[r.status] || 0) + 1; return a; }, {});
    const expectedTotal = rows.length;
    return { rows, counts, expectedTotal, present: counts.present || 0,
      coverage: Math.round(((counts.present || 0) / expectedTotal) * 100), scanned: new Date() };
  }

  function renderCaGroups() {
    if (!cgRes) return;
    $("cgHead").innerHTML = CaGroups.renderSummary(cgRes, tenantName);
    [...document.querySelectorAll("#cgTabs button")].forEach(b =>
      b.classList.toggle("active", b.dataset.cgtab === cgTab));
    $("cgChips").innerHTML = cgTab === "check" ? CaGroups.chips(cgRes, cgFilter) : "";
    $("cgChips").style.display = cgTab === "check" ? "flex" : "none";
    $("cgFull").style.display = cgTab === "members" ? "inline-flex" : "none";
    $("cgSearch").placeholder = cgTab === "members"
      ? "Search member name or UPN…" : "Search group name or object ID…";
    $("cgSearch").style.display = cgTab === "create" || cgTab === "assign" ? "none" : "";

    if (cgTab === "check") {
      $("cgBody").innerHTML = CaGroups.renderTable(cgRes, cgFilter, cgQuery);
    } else if (cgTab === "create") {
      renderCgCreate();
    } else if (cgTab === "members") {
      renderCgMembers();
    } else {
      renderCgAssign();
    }
  }

  // ---- ② create ----
  // Two ways to create, both here and both separate from Assign: batch-create
  // the missing baseline groups, or hand-build one group with full control over
  // role-assignable and static/dynamic.
  function renderCgCreate() {
    const can = CaGroups.creatable(cgRes);
    const cannot = CaGroups.missingNoTemplate(cgRes);
    const batch = (can.length || cannot.length) ? `<div class="cg-panel">
      <h4>CREATE MISSING BASELINE GROUPS (${can.length})</h4>
      <p class="mini">From the bundled templates. Assigned templates are created <b>role-assignable</b>; templates with a membership rule are created <b>dynamic</b>.
        A group that already exists under the same name is reused, never duplicated.</p>
      <div class="cg-pick">${can.map((r, i) =>
        `<label class="chk" style="margin:5px 0"><input type="checkbox" data-cgcreate="${i}" checked> ${esc(r.name)}
          <span class="mini muted">${r.template.membershipRule ? "dynamic" : "role-assignable"}</span></label>`).join("")
        || '<p class="mini muted">No creatable missing groups.</p>'}</div>
      <div class="cg-progress" id="cgCreateBar" style="display:none"><div style="width:0%"></div></div>
      <div id="cgCreateLog" class="mini" style="margin-top:8px"></div>
      ${can.length ? `<div class="row" style="justify-content:flex-start;margin-top:12px">
        <button class="btn" id="cgCreateNone">Clear all</button>
        <button class="btn" id="cgCreateAll">Select all</button>
        <button class="btn primary" id="cgCreateGo">Create selected${isDemo ? " (simulated)" : ""}</button>
      </div>` : ""}
      ${cannot.length ? `<p class="mini" style="margin-top:14px;color:var(--report)">⚠ ${cannot.length} expected group${cannot.length === 1 ? " has" : "s have"} no template
        (named by a baseline catalog but not in the bundled export). Build ${cannot.length === 1 ? "it" : "them"} by hand below: ${cannot.map(r => `<b>${esc(r.name)}</b>`).join(", ")}.</p>` : ""}
    </div>` : "";

    // The manual builder is always present, even when nothing is missing —
    // it is the general-purpose "make me a CA group" path.
    const manual = `<div class="cg-panel">
      <h4>BUILD A GROUP MANUALLY</h4>
      <label class="mini" for="cgmName" style="display:block;margin-bottom:4px">Display name</label>
      <input id="cgmName" class="txt" placeholder="e.g. CAB-SEC-U-Persona-Contractors" autocomplete="off" style="letter-spacing:normal;font-weight:400">
      <label class="mini" for="cgmDesc" style="display:block;margin:10px 0 4px">Description <span class="muted">(optional)</span></label>
      <input id="cgmDesc" class="txt" placeholder="What this group is for" autocomplete="off" style="letter-spacing:normal;font-weight:400">

      <h5 class="mini" style="margin:16px 0 6px">MEMBERSHIP</h5>
      <label class="chk" style="margin:5px 0"><input type="radio" name="cgmType" value="assigned" checked> <b>Assigned</b> — you add members manually</label>
      <label class="chk" style="margin:5px 0"><input type="radio" name="cgmType" value="dynamic"> <b>Dynamic</b> — members set by a rule</label>
      <div id="cgmRuleWrap" style="display:none;margin-top:8px">
        <label class="mini" for="cgmRule" style="display:block;margin-bottom:4px">Membership rule</label>
        <input id="cgmRule" class="txt" placeholder='(user.department -eq "IT")' autocomplete="off" spellcheck="false" style="letter-spacing:normal;font-weight:400">
        <p class="mini muted" style="margin-top:4px">Entra dynamic-membership syntax. The group is created with the rule processing <b>On</b>.</p>
      </div>

      <h5 class="mini" style="margin:16px 0 6px">ROLE-ASSIGNABLE</h5>
      <label class="chk" id="cgmRoleWrap" style="margin:5px 0"><input type="checkbox" id="cgmRole"> Make this group <b>role-assignable</b> <span class="mini muted">(<code>isAssignableToRole</code> — lets it hold directory roles; immutable after creation)</span></label>
      <p class="mini" id="cgmRoleNote" style="display:none;color:var(--report)">Dynamic groups cannot be role-assignable — Entra forbids the combination, so this is off for a dynamic group.</p>

      <div id="cgmLog" class="mini" style="margin-top:10px"></div>
      <div class="row" style="justify-content:flex-start;margin-top:12px">
        <button class="btn primary" id="cgmCreate">Create group${isDemo ? " (simulated)" : ""}</button>
      </div>
      <p class="mini muted" style="margin-top:10px">Security group, mail-disabled. Requires the Privileged Role Administrator role for role-assignable groups;
        consents <code>Group.ReadWrite.All</code> + <code>RoleManagement.ReadWrite.Directory</code> on demand. An existing group with the same name is reused.</p>
    </div>`;

    $("cgBody").innerHTML = batch + manual;
  }

  $("cgBody").addEventListener("click", async (e) => {
    if (e.target.id === "cgCreateAll" || e.target.id === "cgCreateNone") {
      const on = e.target.id === "cgCreateAll";
      document.querySelectorAll("[data-cgcreate]").forEach(cb => { cb.checked = on; });
      return;
    }
    if (e.target.id === "cgCreateGo") {
      const can = CaGroups.creatable(cgRes);
      const picked = [...document.querySelectorAll("[data-cgcreate]:checked")].map(cb => can[+cb.dataset.cgcreate]).filter(Boolean);
      if (!picked.length) { toast("Nothing selected to create"); return; }
      if (!await preConsent([...AUTH_CONFIG.scopes, "Group.ReadWrite.All", "RoleManagement.ReadWrite.Directory"])) return;
      e.target.disabled = true;
      const bar = $("cgCreateBar"), log = $("cgCreateLog");
      bar.style.display = "block";
      const lines = [];
      let ok = 0, failed = 0;
      for (let i = 0; i < picked.length; i++) {
        const r = picked[i];
        bar.firstElementChild.style.width = `${Math.round(((i + 1) / picked.length) * 100)}%`;
        try {
          const g = isDemo
            ? { id: "g-" + r.name, name: r.name, created: true }
            : await Assign.createGroup(r.template);
          ok++;
          lines.push(`<div>${g.created ? "✓ created" : "• already existed, reused"} <b>${esc(r.name)}</b></div>`);
        } catch (err) {
          failed++;
          lines.push(`<div style="color:var(--off)">✗ <b>${esc(r.name)}</b> — ${esc(err.message || err)}</div>`);
        }
        log.innerHTML = lines.join("");
      }
      e.target.disabled = false;
      toast(failed ? `${ok} created, <span>${failed} failed</span>` : `<span>${ok}</span> group${ok === 1 ? "" : "s"} created${isDemo ? " (simulated)" : ""}`);
      // Re-scan so Check reflects reality rather than what we hoped happened.
      cgRes = null;
      await openCaGroups(true);
      cgTab = "check"; renderCaGroups();
      return;
    }
    if (e.target.id === "cgmCreate") { await cgManualCreate(e.target); return; }
    if (e.target.id === "cgMemberGo") { cgMemberPick = false; startMemberScan(); return; }
    if (e.target.id === "cgMemberStop") { cgStop = true; return; }
    // Scan one group. The full scan is a call per group, so reading a single
    // one you are curious about should not cost the other 130.
    const one = e.target.closest("[data-cgscan]");
    if (one) {
      e.stopPropagation();          // do not also open the row detail
      await scanOneGroup(one.dataset.cgscan, one);
      return;
    }
    // Create one missing group from its template, in place.
    const co = e.target.closest("[data-cgcreateone]");
    if (co) { e.stopPropagation(); await cgCreateOne(co.dataset.cgcreateone, co); return; }
    // Recreate a present-but-not-role-assignable group correctly.
    const rc = e.target.closest("[data-cgrecreate]");
    if (rc) { e.stopPropagation(); openRecreate(rc.dataset.cgrecreate); return; }
    // a row in the check table opens that group's detail
    const row = e.target.closest("[data-cgrow]");
    if (row) showGroupRow(row.dataset.cgrow);
  });

  // Create a single missing baseline group from its template, then re-scan.
  async function cgCreateOne(name, btn) {
    const r = cgRes && cgRes.rows.find((x) => x.name === name && x.status === "missing" && x.template);
    if (!r) return;
    if (!await preConsent([...AUTH_CONFIG.scopes, "Group.ReadWrite.All", "RoleManagement.ReadWrite.Directory"])) return;
    if (btn) { btn.disabled = true; btn.textContent = "…"; }
    try {
      const g = isDemo ? { id: "g-" + name, name, created: true } : await Assign.createGroup(r.template);
      toast(g.created ? `Created <span>${esc(name)}</span>` : `<span>${esc(name)}</span> already existed — reused`);
      cgRes = null; await openCaGroups(true); cgTab = "check"; renderCaGroups();
    } catch (err) { console.error(err); toast(`Create failed: <span>${esc(err.message || err)}</span>`); if (btn) { btn.disabled = false; btn.textContent = "Create"; } }
  }

  // ---- recreate a not-role-assignable group correctly ----
  // isAssignableToRole is immutable, so the group has to be replaced: rename the
  // old one aside, create a new role-assignable group with the original name,
  // then swap every referencing policy from the old group id to the new one.
  let recreateRow = null;
  function openRecreate(name) {
    const r = cgRes && cgRes.rows.find((x) => x.name === name);
    if (!r || !r.id) return;
    recreateRow = r;
    const legacy = `${r.name} (legacy ${new Date().toISOString().slice(0, 10)})`;
    const inc = r.refs.include, exc = r.refs.exclude;
    const md = [];
    md.push(`**${r.name}** is not role-assignable, and \`isAssignableToRole\` cannot be changed on an existing group. This will:`);
    md.push("");
    md.push(`1. Rename the current group to **${legacy}** (kept, not deleted — members and history preserved).`);
    md.push(`2. Create a new **role-assignable** security group named **${r.name}**.`);
    md.push(`3. Move the **${r.refCount}** referencing polic${r.refCount === 1 ? "y" : "ies"} from the old group to the new one:`);
    md.push("");
    if (inc.length) { md.push("_Included in:_"); inc.forEach((p) => md.push(`- ${p.name}`)); md.push(""); }
    if (exc.length) { md.push("_Excluded from:_"); exc.forEach((p) => md.push(`- ${p.name}`)); md.push(""); }
    if (!r.refCount) md.push("_No policy references this group, so only the group is recreated._");
    md.push("");
    md.push(isDemo ? "_Demo mode — simulated, nothing is written._" : "The new group has **no members** — add them (or set a membership rule) afterwards. This **writes to your tenant**.");
    $("recreateBody").innerHTML = mdToHtml(md.join("\n"));
    $("recreateOk").value = ""; $("recreateGo").disabled = true;
    $("recreateModal").classList.add("open");
  }
  $("recreateOk").addEventListener("input", (e) => { $("recreateGo").disabled = e.target.value.trim().toUpperCase() !== "RECREATE"; });
  $("recreateCancel").addEventListener("click", () => $("recreateModal").classList.remove("open"));
  $("recreateGo").addEventListener("click", async () => {
    const r = recreateRow; if (!r) return;
    if (!await preConsent([...AUTH_CONFIG.scopes, "Group.ReadWrite.All", "RoleManagement.ReadWrite.Directory", "Policy.ReadWrite.ConditionalAccess"])) return;
    const btn = $("recreateGo"); btn.disabled = true;
    const legacy = `${r.name} (legacy ${new Date().toISOString().slice(0, 10)})`;
    const log = { renamed: false, newId: null, moved: [], failed: [] };
    try {
      if (isDemo) {
        log.renamed = true; log.newId = "g-new-" + r.name;
        log.moved = [...r.refs.include.map((p) => ({ name: p.name, how: "include" })), ...r.refs.exclude.map((p) => ({ name: p.name, how: "exclude" }))];
      } else {
        toast("Renaming the old group…");
        await Graph.gpatch(`/groups/${r.id}`, { displayName: legacy }, [...AUTH_CONFIG.scopes, "Group.ReadWrite.All"]);
        log.renamed = true;
        toast("Creating the new role-assignable group…");
        const g = await Assign.createGroup({ displayName: r.name, description: r.description, roleAssignable: true });
        log.newId = g.id;
        // swap old id -> new id in every referencing policy
        const refs = [...r.refs.include.map((p) => ({ ...p, how: "include" })), ...r.refs.exclude.map((p) => ({ ...p, how: "exclude" }))];
        for (let i = 0; i < refs.length; i++) {
          const p = refs[i];
          toast(`Moving policy ${i + 1}/${refs.length}…`);
          try {
            const fresh = await Graph.gget(`/identity/conditionalAccess/policies/${p.id}`);
            const u = fresh.conditions?.users || {};
            const key = p.how === "include" ? "includeGroups" : "excludeGroups";
            const list = (u[key] || []).map((x) => (x === r.id ? g.id : x));
            await Graph.gpatch(`/identity/conditionalAccess/policies/${p.id}`, { conditions: { users: { ...u, [key]: [...new Set(list)] } } });
            log.moved.push({ name: p.name, how: p.how });
          } catch (e) { console.error(e); log.failed.push({ name: p.name, error: e.message || String(e) }); }
        }
      }
      $("recreateModal").classList.remove("open");
      // change report
      const md = [];
      md.push(`# Group recreated role-assignable — ${tenantName || "tenant"}`);
      md.push("");
      md.push(`- **Group:** ${r.name}`);
      md.push(`- **Old group renamed to:** ${legacy} (id \`${r.id}\`)`);
      md.push(`- **New role-assignable group id:** \`${log.newId}\``);
      md.push(`- **Policies moved:** ${log.moved.length}${log.failed.length ? ` · **failed:** ${log.failed.length}` : ""}`);
      if (isDemo) md.push(`- _Demo mode — simulated._`);
      md.push("");
      if (log.moved.length) {
        md.push("## Policies moved to the new group");
        md.push("");
        md.push("| Policy | Slot |");
        md.push("|---|---|");
        log.moved.forEach((m) => md.push(`| ${m.name} | ${m.how} |`));
        md.push("");
      }
      if (log.failed.length) {
        md.push("## Failed — move these manually");
        md.push("");
        log.failed.forEach((f) => md.push(`- ❌ **${f.name}** — ${f.error}`));
        md.push("");
      }
      md.push("The old group is renamed, not deleted — copy its members to the new group, then remove the old group when you are satisfied.");
      md.push("");
      md.push("---");
      md.push("Generated by ENCA — Conditional Access groups");
      showReport("↻ Group recreate report", "CA-Group-Recreate", md.join("\n"));
      toast(log.failed.length ? `Recreated with <span>${log.failed.length} failure(s)</span>` : `<span>${r.name}</span> recreated role-assignable`);
      cgRes = null; await openCaGroups(true); cgTab = "check"; renderCaGroups();
    } catch (e) {
      console.error(e); toast(`Recreate failed: <span>${esc(e.message || e)}</span>`);
      btn.disabled = false;
    }
  });

  // Dynamic and role-assignable are mutually exclusive in Entra. Reflect that
  // live: choosing Dynamic reveals the rule box and forces role-assignable off.
  $("cgBody").addEventListener("change", (e) => {
    if (e.target.matches("[data-cgmem]")) {
      const n = e.target.dataset.cgmem;
      if (e.target.checked) cgMemberSel.add(n); else cgMemberSel.delete(n);
      // refresh just the button label, not the whole list (keeps scroll + focus)
      const go = $("cgMemberGo");
      if (go) { const c = cgMemberSel.size; go.disabled = !c; go.textContent = `Read members of ${c} selected group${c === 1 ? "" : "s"}`; }
      return;
    }
    if (e.target.name === "cgmType") {
      const dyn = e.target.value === "dynamic";
      const w = $("cgmRuleWrap"); if (w) w.style.display = dyn ? "block" : "none";
      const role = $("cgmRole"), note = $("cgmRoleNote");
      if (role) { role.disabled = dyn; if (dyn) role.checked = false; }
      if (note) note.style.display = dyn ? "block" : "none";
    }
  });

  async function cgManualCreate(btn) {
    const name = $("cgmName").value.trim();
    if (!name) { toast("Give the group a display name"); $("cgmName").focus(); return; }
    const dynamic = document.querySelector('[name="cgmType"]:checked')?.value === "dynamic";
    const rule = dynamic ? $("cgmRule").value.trim() : "";
    if (dynamic && !rule) { toast("A dynamic group needs a membership rule"); $("cgmRule").focus(); return; }
    const roleAssignable = !dynamic && $("cgmRole").checked;
    if (!await preConsent([...AUTH_CONFIG.scopes, "Group.ReadWrite.All", "RoleManagement.ReadWrite.Directory"])) return;
    btn.disabled = true;
    const log = $("cgmLog");
    try {
      const spec = { displayName: name, description: $("cgmDesc").value.trim(), dynamic, membershipRule: rule, roleAssignable };
      const g = isDemo
        ? { id: "g-" + name, name, created: true, dynamic, roleAssignable }
        : await Assign.createGroup(spec);
      const kind = g.dynamic ? "dynamic" : g.roleAssignable ? "role-assignable" : "assigned";
      log.innerHTML = g.created
        ? `<span style="color:var(--on)">✓ created <b>${esc(g.name)}</b> — ${kind}</span>`
        : `<span style="color:var(--report)">• <b>${esc(g.name)}</b> already existed — reused</span>`;
      toast(g.created ? `<span>${esc(g.name)}</span> created (${kind})${isDemo ? " (simulated)" : ""}` : `<span>${esc(g.name)}</span> already existed — reused`);
      // fold the new group into the scan so Check shows it without a refresh
      cgRes = null;
      await openCaGroups(true);
      cgTab = "create"; renderCaGroups();
    } catch (err) {
      console.error(err);
      if ($("cgmLog")) $("cgmLog").innerHTML = `<span style="color:var(--off)">✗ ${esc(err.message || err)}</span>`;
      toast(`Create failed: <span>${esc(err.message || err)}</span>`);
      btn.disabled = false;
    }
  }

  // ---- ③ members ----
  // The picker: choose which groups to read rather than reading all of them.
  // One Graph call per group, so on a big tenant this is the difference between
  // a handful of calls and a hundred.
  function cgMemberPicker(open) {
    const avail = cgRes.rows.filter((r) => r.id)
      .sort((a, b) => a.name.localeCompare(b.name));
    const q = cgQuery.toLowerCase();
    const shown = q ? avail.filter((r) => r.name.toLowerCase().includes(q)) : avail;
    const sel = [...cgMemberSel].filter((n) => avail.some((r) => r.name === n));
    return `<div class="cg-panel">
      <h4>MEMBER SCAN — PICK THE GROUPS</h4>
      <p class="mini">Reading members costs <b>one Graph call per group</b>, so only the groups you tick are read.
        Membership is read <b>transitively</b>, so a user nested through another group still shows up.
        Groups larger than ${CaGroups.MEMBER_CAP} members are counted in full but listed to the cap.</p>
      <div class="row" style="justify-content:flex-start;margin:10px 0 6px;gap:8px;flex-wrap:wrap">
        <button class="btn sm" data-cgmsel="all">Select all${q ? " shown" : ""} (${shown.length})</button>
        <button class="btn sm" data-cgmsel="none">Clear</button>
        <button class="btn sm" data-cgmsel="unread">Only not-yet-read</button>
        <span class="mini muted">${sel.length} selected${q ? ` · filtered by “${esc(cgQuery)}”` : " · use the search box to narrow the list"}</span>
      </div>
      <div class="cg-picklist">${shown.map((r) => `<label class="chk">
          <input type="checkbox" data-cgmem="${esc(r.name)}" ${cgMemberSel.has(r.name) ? "checked" : ""}>
          <span>${esc(r.name)}</span>
          ${r.members ? `<span class="mini muted">· ${r.memberTotal} member${r.memberTotal === 1 ? "" : "s"} read</span>` : ""}
          ${r.refs && (r.refs.include.length + r.refs.exclude.length) ? `<span class="mini muted">· ${r.refs.include.length + r.refs.exclude.length} policy ref${(r.refs.include.length + r.refs.exclude.length) === 1 ? "" : "s"}</span>` : ""}
        </label>`).join("") || '<p class="mini">No group matches the search.</p>'}</div>
      <div class="row" style="justify-content:flex-start;margin-top:12px">
        <button class="btn primary" id="cgMemberGo" ${sel.length ? "" : "disabled"}>Read members of ${sel.length} selected group${sel.length === 1 ? "" : "s"}</button>
        ${open ? '<button class="btn" data-cgmclose>Back to the matrix</button>' : ""}
      </div>
    </div>`;
  }

  function renderCgMembers() {
    const scanned = cgRes.rows.filter(r => r.members);
    if (cgMemberPick || (!scanned.length && !cgBusy)) {
      $("cgBody").innerHTML = cgMemberPicker(scanned.length > 0);
      return;
    }
    if (cgBusy) {
      $("cgBody").innerHTML = `<div class="cg-panel">
        <h4>READING MEMBERS…</h4>
        <div class="cg-progress"><div id="cgMemBar" style="width:0%"></div></div>
        <p class="mini" id="cgMemStatus">Starting…</p>
        <div class="row" style="justify-content:flex-start;margin-top:12px"><button class="btn" id="cgMemberStop">Stop</button></div>
      </div>`;
      return;
    }
    const m = CaGroups.matrix(cgRes.rows);
    const empties = m.empty.length
      ? `<p class="mini" style="margin:10px 0;color:var(--report)">⚠ ${m.empty.length} group${m.empty.length === 1 ? " is" : "s are"} empty:
         ${m.empty.map(c => `<b>${esc(c.name)}</b>`).join(", ")} — a policy scoped to an empty include group applies to nobody;
         an empty exclude group excludes nobody.</p>` : "";
    const errs = cgRes.rows.filter(r => r.memberError);
    $("cgBody").innerHTML = `<div class="mini" style="margin:10px 0">
        ${m.users.length} distinct member${m.users.length === 1 ? "" : "s"} across ${m.cols.length} group${m.cols.length === 1 ? "" : "s"}.
        <button class="btn sm" data-cgmpick style="margin-left:8px">＋ Read more groups</button>
        <button class="btn sm" id="cgMemberGo" style="margin-left:6px">⟳ Re-read selected</button>
      </div>${empties}
      ${errs.length ? `<p class="mini" style="color:var(--off)">${errs.length} group${errs.length === 1 ? "" : "s"} could not be read: ${errs.map(r => esc(r.name)).join(", ")}</p>` : ""}
      ${CaGroups.renderMatrix(m, cgQuery)}`;
  }

  // One group's members, on demand. Same reader as the bulk scan so a row
  // filled this way is indistinguishable from one filled by "read all" — it
  // counts towards the matrix and the Markdown export straight away.
  async function scanOneGroup(name, btn) {
    const r = cgRes && cgRes.rows.find(x => x.name === name);
    if (!r || !r.id) return;
    const label = btn ? btn.textContent : null;
    if (btn) { btn.disabled = true; btn.textContent = "…"; }
    try {
      if (isDemo) {
        r.memberTotal = 3;
        r.members = [1, 2, 3].map(k => ({ id: `u${k}-${r.id}`, name: `Demo user ${k}`, upn: `demo${k}@contoso.com`, disabled: k === 3 }));
      } else {
        await CaGroups.loadMembers([r], {});
      }
      if (r.memberError) toast(`Could not read <span>${esc(r.name)}</span>: ${esc(r.memberError)}`);
      else toast(`<span>${esc(r.name)}</span> — ${r.memberTotal} member${r.memberTotal === 1 ? "" : "s"}`);
    } catch (e) {
      console.error(e); toast(`Member read failed: <span>${esc(e.message || e)}</span>`);
    } finally {
      if (btn && btn.isConnected) { btn.disabled = false; btn.textContent = label; }
    }
    renderCaGroups();
    if ($("depModal").classList.contains("open")) showGroupRow(name);
  }

  async function startMemberScan() {
    cgBusy = true; cgStop = false; renderCaGroups();
    try {
      // only the groups the user ticked — one Graph call each
      const picked = cgRes.rows.filter(r => r.id && cgMemberSel.has(r.name));
      const targets = picked.length ? picked : cgRes.rows.filter(r => r.id && r.members);
      if (isDemo) {
        targets.forEach((r, i) => {
          r.memberTotal = i % 4; r.members = Array.from({ length: i % 4 }, (_, k) =>
            ({ id: `u${k}-${i}`, name: `Demo user ${k + 1}`, upn: `demo${k + 1}@contoso.com`, disabled: false }));
        });
      } else {
        await CaGroups.loadMembers(targets, {
          shouldStop: () => cgStop,
          onStatus: (msg, i, n) => {
            const s = $("cgMemStatus"), b = $("cgMemBar");
            if (s) s.textContent = msg;
            if (b) b.style.width = `${Math.round((i / n) * 100)}%`;
          },
        });
      }
      if (cgStop) toast("Member scan <span>stopped</span> — showing what was read so far");
    } catch (e) {
      console.error(e); toast(`Member scan failed: <span>${esc(e.message || e)}</span>`);
    } finally {
      cgBusy = false; renderCaGroups();
    }
  }

  // ---- ④ assign ----
  function renderCgAssign() {
    const n = selected.size;
    $("cgBody").innerHTML = `<div class="cg-panel">
      <h4>ASSIGN GROUPS TO POLICIES</h4>
      <p class="mini">Set or add the include/exclude groups of your policies. Scope it to the policies you ticked in
        <b>List Policies</b>, or to every policy in the tenant — the latter is how a break-glass or service-account
        exclusion gets onto everything without missing one. <b>ADD to EXCLUDE</b> is the only additive action; the
        others replace what is there.</p>
      <p class="mini" style="margin-top:8px">${n
        ? `<b>${n}</b> polic${n === 1 ? "y is" : "ies are"} currently selected.`
        : "Nothing is selected right now, so the wizard will open scoped to <b>all policies</b> — you can change that in step 1."}</p>
      <div class="row" style="justify-content:flex-start;margin-top:12px">
        <button class="btn primary" id="cgAssignGo">Open the assign wizard →</button>
        <button class="btn" id="cgAssignPick">Pick policies first</button>
      </div>
    </div>`;
  }
  $("cgBody").addEventListener("click", (e) => {
    // ---- member picker ----
    const bulk = e.target.closest("[data-cgmsel]");
    if (bulk) {
      const avail = cgRes.rows.filter((r) => r.id);
      const q = cgQuery.toLowerCase();
      const shown = q ? avail.filter((r) => r.name.toLowerCase().includes(q)) : avail;
      const mode = bulk.dataset.cgmsel;
      if (mode === "none") cgMemberSel.clear();
      else if (mode === "all") shown.forEach((r) => cgMemberSel.add(r.name));
      else if (mode === "unread") { cgMemberSel.clear(); shown.filter((r) => !r.members).forEach((r) => cgMemberSel.add(r.name)); }
      renderCaGroups(); return;
    }
    if (e.target.closest("[data-cgmpick]")) { cgMemberPick = true; renderCaGroups(); return; }
    if (e.target.closest("[data-cgmclose]")) { cgMemberPick = false; renderCaGroups(); return; }
    if (e.target.id === "cgAssignGo") { openAssign(selected.size ? "selection" : "all"); return; }
    if (e.target.id === "cgAssignPick") {
      setToolMode("assign"); setView("cards"); show("screen-list");
      toast("Tick the policies, then use <span>Assign groups</span> on the selection bar");
    }
  });

  // Detail of one group row — the policies that use it and its members.
  function showGroupRow(name) {
    const r = cgRes.rows.find(x => x.name === name); if (!r) return;
    const list = (arr, how) => arr.length
      ? `<h5 class="mini" style="margin:10px 0 4px">${how} (${arr.length})</h5><ul class="plist2" style="border:1px solid var(--border);border-radius:8px">${arr.map(p => `<li>${esc(p.name)}</li>`).join("")}</ul>` : "";
    $("depTitle").textContent = r.name;
    $("depBody").innerHTML = `
      <p class="mini">${r.id ? `Object ID <code>${esc(r.id)}</code>` : "Not present in this tenant"}
        · ${r.status === "missing" ? "missing" : r.dynamic ? "dynamic" : r.roleAssignable ? "role-assignable" : "assigned"}
        · expected by ${r.sources.join(", ")}</p>
      ${r.description ? `<p class="mini">${esc(r.description)}</p>` : ""}
      ${r.membershipRule ? `<p class="mini">Membership rule: <code>${esc(r.membershipRule)}</code></p>` : ""}
      ${r.drift ? `<p class="mini" style="color:var(--report)">⚠ ${esc(r.drift)}</p>` : ""}
      ${list(r.refs.include, "Included in")}
      ${list(r.refs.exclude, "Excluded from")}
      ${!r.refCount ? '<p class="mini muted" style="margin-top:10px">No policy references this group.</p>' : ""}
      ${r.id && !r.members ? `<div class="row" style="justify-content:flex-start;margin-top:12px">
        <button class="btn" id="cgOneScan" data-cgone="${esc(r.name)}">Read members of this group</button></div>` : ""}
      ${r.memberError ? `<p class="mini" style="color:var(--off)">Member read failed: ${esc(r.memberError)}</p>` : ""}
      ${r.members ? `<h5 class="mini" style="margin:10px 0 4px">Members (${r.memberTotal})</h5>
        <ul class="plist2" style="border:1px solid var(--border);border-radius:8px">${r.members.map(m => `<li>${esc(m.name)} <span class="mini muted">${esc(m.upn || "")}</span>${m.disabled ? ' <span class="tag block">disabled</span>' : ""}</li>`).join("") || '<li class="mini">No members</li>'}</ul>` : ""}`;
    $("depModal").classList.add("open");
  }
  // the same per-group scan, from inside the group's detail overlay
  $("depBody").addEventListener("click", (e) => {
    const b = e.target.closest("[data-cgone]");
    if (b) scanOneGroup(b.dataset.cgone, b);
  });

  // Changing the scope means a different set of groups to look up → re-scan.
  $("cgScope").addEventListener("change", async (e) => {
    cgScope = e.target.value;
    cgRes = null; cgMemberSel.clear(); cgMemberPick = false;
    await openCaGroups(true);
  });
  $("cgTabs").addEventListener("click", (e) => {
    const b = e.target.closest("[data-cgtab]"); if (!b) return;
    cgTab = b.dataset.cgtab; cgQuery = ""; $("cgSearch").value = "";
    renderCaGroups();
  });
  $("cgChips").addEventListener("click", (e) => {
    const b = e.target.closest("[data-cgf]"); if (!b) return;
    cgFilter = b.dataset.cgf; renderCaGroups();
  });
  $("cgSearch").addEventListener("input", (e) => { cgQuery = e.target.value.trim().toLowerCase(); renderCaGroups(); });
  $("cgRefresh").addEventListener("click", async () => {
    const btn = $("cgRefresh");
    btn.disabled = true; btn.textContent = "⟳ Refreshing…";
    try {
      if (isDemo) loadDemo(); else await loadFromGraph(true);
      cgRes = null;
      await openCaGroups(true);
      toast("Groups <span>re-scanned</span>");
    } catch (e) { toast(`Refresh failed: <span>${esc(e.message || e)}</span>`); }
    finally { btn.disabled = false; btn.textContent = "⟳ Refresh"; }
  });
  $("cgMd").addEventListener("click", () => {
    if (!cgRes) return;
    showReport("👥 Conditional Access groups", "CA-Groups",
      CaGroups.toMd(cgRes, tenantName, cgRes.rows.some(r => r.members)));
  });
  $("cgFull").addEventListener("click", () => Fs.open("Members × groups", { body: $("cgBody") }));

  // ---------- assign-groups wizard ----------
  let asStep = 0, asAction = null, asGroups = [], asPolicies = [], asResults = null;
  // "selection" = the policies ticked in the list; "all" = every policy loaded
  // from the tenant. Tenant-wide is what you want for a break-glass or
  // service-account exclusion that must never miss a policy.
  let asScope = "selection", asFound = [], asRun = null;
  const asScopePolicies = () => exportOrder(asScope === "all"
    ? policies.slice()
    : [...selected].map(id => policies.find(p => p.id === id)).filter(Boolean));
  function openAssign(scope) {
    asScope = scope || (selected.size ? "selection" : "all");
    if (!policies.length) { toast("No policies loaded"); return; }
    if (asScope === "all" && !selected.size) toast("Nothing selected — scoped to <span>all policies</span>, change it in step 1");
    asPolicies = asScopePolicies();
    asStep = 0; asAction = null; asGroups = []; asResults = null; asFound = [];
    renderAssign();
    $("assignModal").classList.add("open");
  }
  function assignEsc(s) { return esc(s); }
  async function renderAssign() {
    const b = $("asBody"), next = $("asNext"), back = $("asBack");
    $("asSub").textContent = `${asPolicies.length} ${asPolicies.length === 1 ? "policy" : "policies"}`
      + ` ${asScope === "all" ? "(every policy in this tenant)" : "selected"} · step ${Math.min(asStep + 1, 3)} of 3`;
    back.style.display = asStep > 0 && asStep < 3 ? "inline-flex" : "none";
    next.style.display = "inline-flex";
    if (asStep === 0) {
      next.textContent = "Next";
      const nSel = selected.size, nAll = policies.length;
      b.innerHTML = `<h4 class="mini" style="margin-bottom:8px">APPLY TO</h4>
        <label class="chk" style="margin:6px 0"><input type="radio" name="asScope" value="selection" ${asScope === "selection" ? "checked" : ""} ${nSel ? "" : "disabled"}> Selected policies (${nSel})</label>
        <label class="chk" style="margin:6px 0"><input type="radio" name="asScope" value="all" ${asScope === "all" ? "checked" : ""}> <b>All policies in this tenant (${nAll})</b> <span class="mini muted">— for an exclusion that must cover everything</span></label>
        <h4 class="mini" style="margin:16px 0 8px">ACTION</h4>` + Assign.ACTIONS.map((a, i) =>
        `<label class="chk" style="margin:6px 0"><input type="radio" name="asAct" value="${i}" ${asAction === i ? "checked" : ""}> ${assignEsc(a)}</label>`).join("");
    } else if (asStep === 1) {
      next.textContent = "Next";
      if (!asGroups.length) {
        b.innerHTML = '<p class="mini">Checking which persona groups exist in this tenant…</p>';
        asGroups = (isDemo
          ? Object.keys(DEMO_DATA.scopeGroups || {}).map(n => ({ id: "g-" + n, name: n }))
          : await Assign.resolveGroups((m) => { const el = b.querySelector("p"); if (el) el.textContent = m; })
        ).map(g => ({ ...g, checked: false }));
      }
      const tpls = Assign.templates().filter(t => !asGroups.some(g => g.name === t.displayName));
      // Pick by persona: one click adds that persona's group, creating it from
      // its template first if the tenant does not have it. A persona already in
      // the target list is marked so it is obvious it is covered.
      const personaChips = Assign.personasWithGroup().map(p => {
        const on = asGroups.some(g => g.name === p.group && g.checked);
        return `<button class="btn sm persona-chip ${on ? "on" : ""}" data-asPersona="${esc(p.group)}" title="${esc(p.group)}">${esc(p.label)}${on ? " ✓" : ""}</button>`;
      }).join("");
      b.innerHTML = `<h4 class="mini" style="margin-bottom:8px">BY PERSONA</h4>
        <p class="mini muted" style="margin-bottom:6px">Add the group for a persona — created from its baseline template if it is missing.</p>
        <div class="persona-row">${personaChips}</div>
        <h4 class="mini" style="margin:16px 0 8px">TARGET GROUPS</h4>` +
        (asGroups.map((g, i) => `<label class="chk" style="margin:5px 0"><input type="checkbox" data-asg="${i}" ${g.checked ? "checked" : ""}> ${assignEsc(g.name)}${g.created ? ' <span class="tag grant">created</span>' : ""}</label>`).join("") || '<p class="mini">No predefined persona groups found in this tenant yet — create them from a template below.</p>') +
        `<h4 class="mini" style="margin:16px 0 6px">ANY OTHER GROUP</h4>
        <div style="display:flex;gap:8px">
          <input id="asCustom" class="btn" style="flex:1;cursor:text" placeholder="Search any group by name or paste an object ID…">
          <button class="btn" id="asCustomAdd">Search</button>
        </div>
        <div id="asFound">${asFound.length
          ? asFound.map((g, i) => `<label class="chk" style="margin:5px 0"><input type="checkbox" data-asfound="${i}"> ${assignEsc(g.name)} <span class="mini muted">${assignEsc(g.id)}</span></label>`).join("")
          : ""}</div>
        <h4 class="mini" style="margin:16px 0 6px">CREATE MISSING GROUP (from baseline templates)</h4>
        <div style="display:flex;gap:8px">
          <select id="asTpl" class="btn" style="flex:1;cursor:pointer">${tpls.map((t, i) => `<option value="${i}">${assignEsc(t.displayName)}${t.dynamic ? " (dynamic)" : ""}</option>`).join("")}</select>
          <button class="btn primary" id="asTplCreate" ${tpls.length ? "" : "disabled"}>Create</button>
        </div>
        <div style="display:flex;gap:8px;margin-top:8px">
          <input id="asNewName" class="btn" style="flex:1;cursor:text" placeholder="…or create a custom group by name (e.g. CAD-SEC-U-DG-CUSTOM)">
          <button class="btn primary" id="asNewCreate">Create</button>
        </div>
        <p class="mini" style="margin-top:10px">Groups are created directly via Graph as <b>role-assignable</b> security groups (immutable, set at creation) —
          membership can then only be changed by Privileged Role Administrators or delegated owners. Dynamic templates keep their membership rule instead
          (Graph does not allow role-assignable + dynamic). Creation requires the Privileged Role Administrator role and consents
          <code>Group.ReadWrite.All</code> + <code>RoleManagement.ReadWrite.Directory</code> on demand. Existing groups with the same name are reused, never duplicated.</p>`;
    } else if (asStep === 2) {
      next.textContent = "Review →";
      const gsel = asGroups.filter(g => g.checked);
      const notes = asAction === 2 && asPolicies.some(p => (p.raw.conditions?.users?.includeUsers || []).includes("All"))
        ? '<p class="mini" style="color:var(--report)">⚠ Policies currently targeting "All users" will switch to the selected groups.</p>' : "";
      // Replace (0,1) and All-Users (4) rewrite existing assignment, so tenant-
      // wide they get a typed confirmation. Additive (2,3) and REMOVE (5,6) only
      // touch the named groups, so they are safe to run across everything.
      const rewrites = asAction === 0 || asAction === 1 || asAction === 4;
      const wide = asScope === "all" && rewrites;
      const wideWarn = wide ? `<div class="danger-note"><b>This rewrites the assignment of all ${asPolicies.length} policies.</b>
          "${assignEsc(Assign.ACTIONS[asAction])}" replaces what is there now — it does not merge. Type <b>ALL</b> if that is really what you want.</div>
        <input id="asWideOk" class="txt" placeholder="ALL" autocomplete="off" spellcheck="false" style="margin-bottom:6px">` : "";
      b.innerHTML = `<h4 class="mini">STEP 3 — choose target groups</h4>
        ${wideWarn}
        <p style="margin:8px 0"><b>Action:</b> ${assignEsc(Assign.ACTIONS[asAction])}</p>
        <p style="margin:8px 0"><b>Policies (${asPolicies.length}):</b></p>
        <ul class="plist2" style="border:1px solid var(--border);border-radius:8px;margin-bottom:10px">${asPolicies.map(p => `<li>${assignEsc(p.name)}</li>`).join("")}</ul>
        ${asAction === 4 ? '<p><b>Target:</b> All users (include groups will be cleared)</p>'
          : `<p style="margin:8px 0"><b>Groups (${gsel.length}):</b></p><ul class="plist2" style="border:1px solid var(--border);border-radius:8px">${gsel.map(g => `<li>${assignEsc(g.name)} <span class="mini">${assignEsc(g.id)}</span></li>`).join("")}</ul>`}
        ${notes}`;
    } else {
      // results
      next.textContent = "Close";
      back.style.display = "none";
      const nFail = asResults.filter(r => !r.ok).length;
      const nUp = asResults.filter(r => r.ok && r.changed !== false).length;
      const nSet = asResults.length - nUp - nFail;
      // "unchanged" here means the group was already where you asked it to be —
      // for an add/remove that IS the intended end state, so it reads green
      // ("already set") not neutral. Only a real failure is red.
      b.innerHTML = `<h4 class="mini">RESULT</h4>
        <p class="mini">${nUp} updated · ${nSet} already set · ${nFail} failed</p>
        <div class="row" style="justify-content:flex-start;margin:8px 0 12px">
          <button class="btn" id="asReport">📄 View change report</button>
        </div>
        <ul class="plist2" style="border:1px solid var(--border);border-radius:8px">` +
        asResults.map(r => `<li>${r.ok
          ? (r.changed === false ? '<span class="tag grant">already set</span>' : '<span class="tag grant">updated</span>')
          : '<span class="tag block">failed</span>'} ${assignEsc(r.name)}${r.error ? `<div class="mini">${assignEsc(r.error)}</div>` : ""}</li>`).join("") + "</ul>";
    }
  }
  $("asBody").addEventListener("change", (e) => {
    const sc = e.target.closest('[name="asScope"]');
    if (sc) { asScope = sc.value; asPolicies = asScopePolicies(); renderAssign(); return; }
    const r = e.target.closest('[name="asAct"]'); if (r) { asAction = +r.value; return; }
    const g = e.target.closest("[data-asg]"); if (g) { asGroups[+g.dataset.asg].checked = g.checked; return; }
    // a search hit promotes into the target list, so review shows it like any other
    const f = e.target.closest("[data-asfound]");
    if (f && f.checked) { asAddCreated(asFound[+f.dataset.asfound]); }
  });
  async function asAddCreated(g) {
    if (!asGroups.some(x => x.id === g.id)) asGroups.push({ ...g, checked: true });
    else asGroups.find(x => x.id === g.id).checked = true;
    renderAssign();
  }
  $("asBody").addEventListener("click", async (e) => {
    const pc = e.target.closest("[data-asPersona]");
    if (pc) {
      const name = pc.dataset.asPersona;
      // already in the list? just tick it, no Graph call
      const existing = asGroups.find(g => g.name === name);
      if (existing) { existing.checked = true; renderAssign(); return; }
      pc.disabled = true;
      try {
        // Resolve it; create from template only if it does not exist.
        let g = isDemo ? { id: "g-" + name, name } : await Assign.findGroup(name);
        if (!g) {
          if (!await preConsent([...AUTH_CONFIG.scopes, "Group.ReadWrite.All", "RoleManagement.ReadWrite.Directory"])) { pc.disabled = false; return; }
          g = isDemo ? { id: "g-" + name, name, created: true } : await Assign.createGroup(Assign.templateFor(name));
          toast(g.created ? `Created <span>${esc(name)}</span>` : `<span>${esc(name)}</span> reused`);
        }
        asAddCreated(g);
      } catch (err) { console.error(err); toast(`Persona group failed: <span>${esc(err.message || err)}</span>`); pc.disabled = false; }
      return;
    }
    if (e.target.id === "asCustomAdd") {
      const q = $("asCustom").value.trim(); if (!q) return;
      e.target.disabled = true; e.target.textContent = "Searching…";
      try {
        asFound = isDemo
          ? Object.keys(DEMO_DATA.scopeGroups || {}).filter(n => n.toLowerCase().startsWith(q.toLowerCase())).map(n => ({ id: "g-" + n, name: n }))
          : await Assign.searchGroups(q);
        // already-listed groups would be a confusing duplicate row
        asFound = asFound.filter(g => !asGroups.some(x => x.id === g.id));
        if (!asFound.length) toast("No group matches — check the name, or create one below");
        renderAssign();
        const box = $("asCustom"); if (box) box.value = q;
      } catch (err) { console.error(err); toast(`Search failed: <span>${esc(err.message || err)}</span>`); }
      finally { e.target.disabled = false; e.target.textContent = "Search"; }
      return;
    }
    if (e.target.id === "asTplCreate") {
      const tpls = Assign.templates().filter(t => !asGroups.some(g => g.name === t.displayName));
      const t = tpls[+($("asTpl").value || 0)]; if (!t) return;
      if (!await preConsent([...AUTH_CONFIG.scopes, "Group.ReadWrite.All", "RoleManagement.ReadWrite.Directory"])) return;
      e.target.disabled = true;
      try {
        const g = isDemo
          ? { id: "g-" + t.displayName, name: t.displayName, created: true }
          : await Assign.createGroup(t);
        toast(g.created
          ? `${g.dynamic ? "Dynamic" : "Role-assignable"} group <span>${esc(g.name)}</span> created${isDemo ? " (simulated)" : ""}`
          : `Group <span>${esc(g.name)}</span> already existed — reused`);
        asAddCreated(g);
      } catch (err) { console.error(err); toast(`Create failed: <span>${esc(err.message || err)}</span>`); }
      finally { e.target.disabled = false; }
      return;
    }
    if (e.target.id === "asNewCreate") {
      const name = $("asNewName").value.trim(); if (!name) return;
      if (!await preConsent([...AUTH_CONFIG.scopes, "Group.ReadWrite.All", "RoleManagement.ReadWrite.Directory"])) return;
      e.target.disabled = true;
      try {
        const g = isDemo
          ? { id: "g-" + name, name, created: true }
          : await Assign.createGroup({ displayName: name });
        toast(g.created ? `Role-assignable group <span>${esc(g.name)}</span> created${isDemo ? " (simulated)" : ""}` : `Group <span>${esc(g.name)}</span> already existed — reused`);
        asAddCreated(g);
      } catch (err) { console.error(err); toast(`Create failed: <span>${esc(err.message || err)}</span>`); }
      finally { e.target.disabled = false; }
    }
  });
  $("asCancel").addEventListener("click", () => $("assignModal").classList.remove("open"));
  $("asBack").addEventListener("click", () => { asStep--; renderAssign(); });
  $("asNext").addEventListener("click", async () => {
    if (asStep === 0) {
      if (asAction === null) { toast("Choose an action first"); return; }
      asStep = asAction === 4 ? 2 : 1; // "All Users" needs no group selection
      renderAssign();
    } else if (asStep === 1) {
      if (!asGroups.some(g => g.checked)) { toast("Select at least one group"); return; }
      asStep = 2; renderAssign();
    } else if (asStep === 2) {
      const wideBox = $("asWideOk");
      if (wideBox && wideBox.value.trim().toUpperCase() !== "ALL") {
        toast("Type <span>ALL</span> to confirm a tenant-wide assignment change");
        wideBox.focus(); return;
      }
      if (asAction !== 4 && !asGroups.some(g => g.checked)) { toast("Select at least one group"); return; }
      openAssignConfirm();
    } else {
      $("assignModal").classList.remove("open");
      if (!isDemo && asResults?.some(r => r.ok)) await loadFromGraph(true); // reload changed policies
    }
  });

  // Final plain-language confirm before the write, layered over the wizard.
  const AS_VERB = {
    0: "Replace the include groups of", 1: "Replace the exclude groups of",
    2: "Add to the include groups of", 3: "Add to the exclude groups of",
    4: "Set to All Users (clear include groups)",
    5: "Remove from the include groups of", 6: "Remove from the exclude groups of",
  };
  function openAssignConfirm() {
    const gsel = asGroups.filter(g => g.checked);
    const scope = asScope === "all" ? `all **${asPolicies.length}** policies in this tenant` : `**${asPolicies.length}** selected polic${asPolicies.length === 1 ? "y" : "ies"}`;
    const verb = AS_VERB[asAction] || Assign.ACTIONS[asAction];
    const lines = [];
    lines.push(`**${verb}** ${scope}.`);
    lines.push("");
    if (asAction === 4) {
      lines.push("The include assignment becomes **All users** and any include groups are cleared.");
    } else {
      lines.push(`Group${gsel.length === 1 ? "" : "s"}:`);
      gsel.forEach(g => lines.push(`- ${g.name}`));
    }
    if (Assign.REMOVE_ACTIONS.has(asAction)) {
      lines.push("");
      lines.push("_Policies that do not reference the group are left untouched — only the ones that actually have it are rewritten._");
    }
    lines.push("");
    lines.push(isDemo ? "_Demo mode — this is simulated, nothing is written._" : "This **writes to your tenant**.");
    $("asConfirmBody").innerHTML = mdToHtml(lines.join("\n"));
    $("asConfirm").classList.add("open");
  }
  $("asConfirmBack").addEventListener("click", () => $("asConfirm").classList.remove("open"));
  $("asConfirmGo").addEventListener("click", async () => {
    if (!await preConsent([...AUTH_CONFIG.scopes, "Policy.ReadWrite.ConditionalAccess"])) return;
    const gids = asGroups.filter(g => g.checked).map(g => g.id);
    const btn = $("asConfirmGo"); btn.disabled = true;
    try {
      if (isDemo) {
        asResults = asPolicies.map(p => ({ name: p.name, ok: true, changed: true }));
        toast("Demo — changes <span>simulated</span>");
      } else {
        asResults = await Assign.apply(asPolicies.map(p => p.id), asAction, gids, (m) => toast(m));
      }
      // Snapshot the run so the report reflects exactly what was applied, not
      // whatever the wizard state happens to be when the button is clicked.
      asRun = { action: asAction, scope: asScope, groups: asGroups.filter(g => g.checked).map(g => ({ ...g })), results: asResults, when: new Date() };
      $("asConfirm").classList.remove("open");
      asStep = 3; renderAssign();
      const failed = asResults.filter(r => !r.ok).length;
      const changed = asResults.filter(r => r.ok && r.changed !== false).length;
      toast(failed ? `Done with <span>${failed} failure(s)</span>`
        : `<span>${changed}</span> polic${changed === 1 ? "y" : "ies"} updated${changed < asResults.length ? `, ${asResults.length - changed} already set` : ""}`);
      // A tenant-wide run (the blanket-exclusion case) or any run with failures
      // surfaces its change report automatically — that is exactly when you want
      // a record of what moved and what did not.
      if (asScope === "all" || failed) showReport("👥 Group assignment report", "CA-Assign-Report", assignReportMd(asRun));
    } catch (e) {
      console.error(e); toast(`Assign failed: <span>${esc(e.message || e)}</span>`);
    } finally { btn.disabled = false; }
  });

  // Change report for an assign run — what was applied, which policies changed,
  // which were left alone, and every failure with its Graph error. Same shape
  // as the import and MS Learn reports so a run is auditable the same way.
  function assignReportMd(run) {
    const md = (s) => String(s ?? "").replace(/\|/g, "\\|");
    const r = run.results || [];
    const up = r.filter(x => x.ok && x.changed !== false);
    const unch = r.filter(x => x.ok && x.changed === false);
    const fail = r.filter(x => !x.ok);
    const verb = AS_VERB[run.action] || Assign.ACTIONS[run.action];
    const L = [];
    L.push(`# Conditional Access — group assignment report`);
    L.push("");
    L.push(`- **Tenant:** ${md(tenantName || "tenant")}`);
    L.push(`- **When:** ${run.when.toISOString().slice(0, 16).replace("T", " ")} UTC`);
    L.push(`- **Action:** ${md(verb)}`);
    L.push(`- **Scope:** ${run.scope === "all" ? `all ${r.length} policies in the tenant` : `${r.length} selected`}`);
    if (run.action !== 4) {
      L.push(`- **Group(s):** ${run.groups.map(g => `${md(g.name)}${g.id ? ` (\`${md(g.id)}\`)` : ""}`).join(", ") || "—"}`);
    }
    L.push(`- **Result:** ${up.length} updated · ${unch.length} already set · ${fail.length} failed`);
    if (isDemo) L.push(`- _Demo mode — simulated, nothing was written._`);
    L.push("");
    if (fail.length) {
      L.push("## Failures");
      L.push("");
      fail.forEach(x => L.push(`- ❌ **${md(x.name)}** — ${md(x.error || "unknown error")}`));
      L.push("");
    }
    L.push("## Every policy");
    L.push("");
    L.push("| Result | Policy |");
    L.push("|---|---|");
    for (const x of r) {
      const tag = !x.ok ? "❌ failed" : x.changed === false ? "✅ already set" : "✅ updated";
      L.push(`| ${tag} | ${md(x.name)} |`);
    }
    L.push("");
    L.push("---");
    L.push("Generated by ENCA — Assign groups");
    return L.join("\n");
  }
  $("asBody").addEventListener("click", (e) => {
    if (e.target.id !== "asReport" || !asRun) return;
    showReport("👥 Group assignment report", "CA-Assign-Report", assignReportMd(asRun));
  });

  // ---------- Baseline Policies ----------
  // Pure client-side comparison against the bundled catalog — no Graph calls
  // beyond the policies already loaded, so it is instant and re-runs on filter.
  let blResult = null, blFilter = "all", blQuery = "", blView = "table", blCat = "limonit";
  const blCollapsed = new Set();
  // the Limon-IT R26.6 catalog is large — the table is the readable default;
  // the community catalogs open as cards
  const blDefaultView = (cat) => (cat === "limonit" ? "table" : "cards");
  // keepView: a refresh re-compares in place and must not throw away the filter,
  // search or collapsed sections the person was looking at.
  function openBaseline(catId, keepView) {
    show("screen-baseline");
    if (catId) blCat = catId;
    if (!policies.length) {
      $("blHead").innerHTML = '<p class="mini">No policies loaded.</p>';
      $("blChips").innerHTML = ""; $("blBody").innerHTML = "";
      return;
    }
    blResult = Baseline.compare(policies, blCat);
    if (!keepView) {
      blFilter = "all"; blQuery = ""; blView = blDefaultView(blCat); blCollapsed.clear(); $("blSearch").value = "";
    }
    renderBaseline();
  }
  function renderBaseline() {
    if (!blResult) return;
    $("blHead").innerHTML = Baseline.renderSummary(blResult);
    $("blCatalog").innerHTML = Baseline.catalogs()
      .map((c) => `<button class="${c.id === blCat ? "active" : ""}" data-blcat="${esc(c.id)}">${c.icon || "🧬"} ${esc(c.label)}</button>`).join("");
    $("blChips").innerHTML = Baseline.chips(blResult, blFilter);
    $("blViewCards").classList.toggle("active", blView === "cards");
    $("blViewTable").classList.toggle("active", blView === "table");
    $("blBody").innerHTML = blView === "cards"
      ? Baseline.renderCards(blResult, blFilter, blQuery, blCollapsed)
      : Baseline.renderTable(blResult, blFilter, blQuery, blCollapsed);
    const shown = Baseline.personas(blResult, blFilter, blQuery);
    const allCollapsed = shown.length > 0 && shown.every((g) => blCollapsed.has(g));
    $("blCollapseAll").textContent = allCollapsed ? "⊞ Expand all" : "⊟ Collapse all";
    const n = blResult.toImport.length;
    $("blImport").textContent = n ? `📥 Import baseline (${n}) →` : "📥 Import baseline →";
  }
  $("blCatalog").addEventListener("click", (e) => {
    const b = e.target.closest("[data-blcat]"); if (!b || b.dataset.blcat === blCat) return;
    blCat = b.dataset.blcat;
    blResult = Baseline.compare(policies, blCat);
    blFilter = "all"; blView = blDefaultView(blCat); blCollapsed.clear(); renderBaseline();
  });
  $("blChips").addEventListener("click", (e) => {
    const b = e.target.closest("[data-blf]"); if (!b) return;
    blFilter = b.dataset.blf; renderBaseline();
  });
  $("blSearch").addEventListener("input", (e) => { blQuery = e.target.value; renderBaseline(); });
  // click a persona header to fold that section away
  $("blBody").addEventListener("click", (e) => {
    const h = e.target.closest("[data-blgroup]"); if (!h) return;
    const g = h.dataset.blgroup;
    if (blCollapsed.has(g)) blCollapsed.delete(g); else blCollapsed.add(g);
    renderBaseline();
  });
  $("blCollapseAll").addEventListener("click", () => {
    const shown = Baseline.personas(blResult, blFilter, blQuery);
    const allCollapsed = shown.length > 0 && shown.every((g) => blCollapsed.has(g));
    if (allCollapsed) blCollapsed.clear(); else shown.forEach((g) => blCollapsed.add(g));
    renderBaseline();
  });
  $("blViewCards").addEventListener("click", () => { blView = "cards"; renderBaseline(); });
  $("blViewTable").addEventListener("click", () => { blView = "table"; renderBaseline(); });
  // clicking a tenant policy name opens its card, same as everywhere else
  $("blBody").addEventListener("click", (e) => {
    const el = e.target.closest("[data-blpol]"); if (!el) return;
    showDetail(el.dataset.blpol);
  });
  $("blMd").addEventListener("click", () => {
    if (!blResult) return;
    showReport("🧬 Baseline gap report", "CA-Baseline-Gap", Baseline.toMd(blResult, tenantName));
  });
  // Refresh: re-read the tenant, then re-compare against the selected catalog.
  // Needed after an import — otherwise the gap still shows what you just fixed.
  $("blRefresh").addEventListener("click", async () => {
    const btn = $("blRefresh");
    btn.disabled = true; btn.textContent = "⟳ Refreshing…";
    try {
      if (isDemo) loadDemo(); else await loadFromGraph(true);
      openBaseline(blCat, true);
      toast("Baseline comparison <span>refreshed</span>");
    } catch (e) {
      toast(`Refresh failed: <span>${esc(e.message || e)}</span>`);
    } finally {
      btn.disabled = false; btn.textContent = "⟳ Refresh";
    }
  });
  // hand off to the Import tool with the gap in hand
  $("blImport").addEventListener("click", () => {
    const n = blResult ? blResult.toImport.length : 0;
    if (blResult && blResult.catalog.url) {
      toast(`This baseline is published at <span>${esc(blResult.catalog.url)}</span> — download it there, then import`);
    }
    $("toolImport").click();
    if (n) {
      $("imDesc").textContent = `Baseline ${BASELINE.release}: ${n} ${n === 1 ? "policy is" : "policies are"} missing or outdated in this tenant. `
        + "Select the baseline backup zip (or its extracted folder). Choose an assignment mode: deploy new policies onto this tenant's persona groups, "
        + "or match & replace — an updated policy keeps the current one's assignment and its old version is switched Off.";
    }
  });

  // ---------- CA Exclusion analyzer ----------
  let exModel = null, exUsers = [], exTab = "matrix", exKind = "all", exQuery = "", exPage = 0;
  let exFocusRow = null, exFocusCol = null;  // pinned exclusion/user row and/or policy column
  const EX_PAGE = 50;
  // Opening the tool does NOT rescan — the scan (which expands group membership
  // over Graph) runs only when the user asks, and the result is cached so
  // switching tabs and coming back keeps the screen intact.
  function openExclusions() {
    show("screen-exclusions");
    $("exRescan").style.display = exModel ? "" : "none";
    if (!policies.length) { $("exHead").innerHTML = '<p class="mini">No policies loaded.</p>'; $("exBody").innerHTML = ""; $("exChips").innerHTML = ""; return; }
    if (exModel) {   // cached — restore the previous screen, no rescan
      $("exSearch").value = exQuery;
      Object.entries(EX_TABS).forEach(([tab, id]) => $(id).classList.toggle("active", tab === exTab));
      renderExclusions();
      return;
    }
    // idle — wait for the user to start the scan
    $("exHead").innerHTML = '<h3>🚪 CA Exclusion analyzer</h3><p class="mini" style="margin:6px 0 0">Every exclusion across all policies — users, groups (expanded to their members), roles, guest types, apps and locations.</p>';
    $("exChips").innerHTML = ""; $("exPager").style.display = "none"; $("exHint").style.display = "none";
    $("exBody").innerHTML = '<div class="run-prompt"><button class="btn primary" data-exrun>▶ Run exclusion scan</button><p class="mini muted">Expands group memberships via Microsoft Graph. The result stays until you rescan.</p></div>';
  }
  async function runExclusionScan() {
    $("exRescan").style.display = "";
    $("exHead").innerHTML = '<h3>🚪 CA Exclusion analyzer</h3><p class="mini" style="margin:6px 0 0">Collecting exclusions…</p>';
    $("exChips").innerHTML = ""; $("exBody").innerHTML = ""; $("exPager").style.display = "none";
    exTab = "matrix"; exKind = "all"; exQuery = ""; exPage = 0; exFocusRow = null; exFocusCol = null; Fs.close(); $("exSearch").value = "";
    Object.entries(EX_TABS).forEach(([tab, id]) => $(id).classList.toggle("active", tab === "matrix"));
    try {
      // the whole tenant's policies — exclusions are a tenant-wide question
      exModel = Exclusions.collect(policies.map(p => p.raw));
      await Exclusions.resolve(exModel, { demo: isDemo, onStatus: (m) => { $("exHead").innerHTML = `<h3>🚪 CA Exclusion analyzer</h3><p class="mini" style="margin:6px 0 0">${esc(m)}</p>`; } });
      exUsers = Exclusions.effectiveUsers(exModel);
      renderExclusions();
    } catch (e) {
      console.error("Exclusion analyzer failed:", e);
      exModel = null;
      $("exHead").innerHTML = `<h3>🚪 CA Exclusion analyzer</h3><p class="mini" style="color:var(--off)">Failed: ${esc(e.message || e)}</p>`;
    }
  }
  $("exRescan").addEventListener("click", runExclusionScan);
  // The filter banner sticks directly under the (sticky) toolbar. The toolbar
  // wraps to more rows on narrow screens, so measure it rather than guess.
  function syncExFocusTop() {
    const tb = $("exToolbar"); if (!tb) return;
    const fs = Fs.isOpen();
    const top = fs ? 0 : 106 + Math.round(tb.getBoundingClientRect().height);
    document.documentElement.style.setProperty("--ex-focus-top", top + "px");
    // Size the grid to the space left under the sticky chrome, so it scrolls
    // inside its own box — that is what keeps the policy header row (and the
    // exclusion column) pinned instead of scrolling off with the page.
    const wrap = $("exBody").querySelector(".mwrap-x");
    if (!wrap) return;
    if (fs) { wrap.style.maxHeight = ""; return; }   // full screen: let it run long
    const banner = $("exBody").querySelector(".ex-focus");
    const chrome = top + (banner ? Math.round(banner.getBoundingClientRect().height) + 10 : 0);
    wrap.style.maxHeight = Math.max(280, Math.round(window.innerHeight - chrome - 28)) + "px";
  }
  window.addEventListener("resize", syncExFocusTop);
  function renderExclusions() {
    if (!exModel) return;
    $("exHead").innerHTML = Exclusions.renderSummary(Exclusions.summary(exModel, exUsers));
    const counts = {};
    exModel.entities.forEach(e => counts[e.kind] = (counts[e.kind] || 0) + 1);
    $("exChips").innerHTML = exTab !== "users"
      ? [["all", `All (${exModel.entities.length})`], ...Object.entries(counts).sort((a, b) => Exclusions.KIND[a[0]].order - Exclusions.KIND[b[0]].order)
          .map(([k, n]) => [k, `${Exclusions.KIND[k].icon} ${Exclusions.KIND[k].label} (${n})`])]
          .map(([k, l]) => `<button class="fchip ${exKind === k ? "active" : ""}" data-exk="${k}">${l}</button>`).join("")
      : "";
    $("exExpand").style.display = "";
    const full = Fs.isOpen();
    const focus = { row: exFocusRow, col: exFocusCol };
    if (exTab === "risk") {
      $("exPager").style.display = "none"; $("exHint").style.display = "none";
      $("exExpand").style.display = "none"; $("exChips").innerHTML = "";
      $("exBody").innerHTML = Exclusions.renderRisk(Exclusions.risk(exModel), exQuery);
      return;
    }
    if (exTab === "matrix") {
      $("exPager").style.display = "none";
      // merge disabled — show every exclusion row so nothing is hidden
      $("exBody").innerHTML = Exclusions.renderMatrix(exModel, exKind, exQuery, false, focus);
    } else {
      // more vertical room full screen, so page in bigger chunks
      const r = Exclusions.renderUsers(exModel, exUsers, exQuery, exPage, full ? EX_PAGE * 4 : EX_PAGE, focus);
      exPage = r.page;
      $("exBody").innerHTML = r.html;
      $("exPager").style.display = "flex";
      $("exPage").textContent = `Page ${r.page + 1} / ${r.pages}`;
    }
    applyColW();
    (window.requestAnimationFrame || setTimeout)(() => {
      const w = $("exBody").querySelector(".mwrap-x");
      $("exHint").style.display = w && w.scrollWidth > w.clientWidth + 4 ? "block" : "none";
      syncExFocusTop();
    });
  }
  $("exChips").addEventListener("click", (e) => {
    const b = e.target.closest("[data-exk]"); if (!b) return;
    // a pinned row may not exist under the new kind filter — drop it
    exKind = b.dataset.exk; exFocusRow = null; renderExclusions();
  });
  // Click-to-filter: a row pins the exclusion/user (hides its out-of-scope
  // policy columns); a policy header pins the policy (hides out-of-scope rows).
  // Clicking the same target again, or the Clear button, releases the pin.
  // "N members" on a group row → list who is actually in it
  let exMemCur = null;
  function openExMembers(key) {
    const ent = exModel && exModel.entities.find((x) => x.key === key);
    if (!ent) return;
    exMemCur = ent;
    const shown = ent.members || [], total = ent.memberTotal;
    $("exMemTitle").textContent = `👥 ${ent.name}`;
    $("exMemSub").innerHTML = `${total == null ? shown.length : total} member${(total ?? shown.length) === 1 ? "" : "s"}`
      + (total != null && total > shown.length ? ` — showing the first ${shown.length}` : "")
      + ` · excluded from ${ent.policyIds.size} polic${ent.policyIds.size === 1 ? "y" : "ies"}`;
    $("exMemBody").innerHTML = shown.length
      ? `<table class="plist"><tbody>${shown.map((m) => `<tr><td>${esc(m.name)}<div class="mini muted">${esc(m.upn || "")}</div></td></tr>`).join("")}</tbody></table>`
      : '<p class="mini">No members resolved for this group.</p>';
    $("exMemModal").classList.add("open");
  }
  $("exMemClose").addEventListener("click", () => $("exMemModal").classList.remove("open"));
  $("exMemModal").addEventListener("click", (e) => { if (e.target.id === "exMemModal") $("exMemModal").classList.remove("open"); });
  $("exMemCsv").addEventListener("click", () => {
    if (!exMemCur) return;
    const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const rows = [[q("Group"), q("Member"), q("UPN")].join(","),
      ...(exMemCur.members || []).map((m) => [q(exMemCur.name), q(m.name), q(m.upn)].join(","))];
    downloadText(`Members-${exMemCur.name}`.replace(/[^\w.-]+/g, "-"), "csv", "text/csv", rows.join("\n"));
    toast("Member list <span>downloaded</span>");
  });

  $("exBody").addEventListener("click", (e) => {
    const mem = e.target.closest("[data-exmembers]");
    if (mem) { e.stopPropagation(); openExMembers(mem.dataset.exmembers); return; }
    if (e.target.closest("[data-exrun]")) { runExclusionScan(); return; }
    const rp = e.target.closest(".pol-link"); if (rp) { showDetail(rp.dataset.polid); return; }
    if (e.target.closest("[data-exclearfocus]")) { exFocusRow = null; exFocusCol = null; exPage = 0; renderExclusions(); return; }
    if (e.target.closest("[data-colgrip]")) return;  // don't pin while resizing the first column
    const col = e.target.closest("[data-expol]");
    if (col) { exFocusCol = exFocusCol === col.dataset.expol ? null : col.dataset.expol; exPage = 0; renderExclusions(); return; }
    const row = e.target.closest("[data-exrow]");
    if (row) { exFocusRow = exFocusRow === row.dataset.exrow ? null : row.dataset.exrow; exPage = 0; renderExclusions(); }
  });
  // Crosshair: highlight the hovered row and its column across the whole table.
  // Delegated once on the document so it survives every re-render, and applied
  // per column rather than per cell (a 143 x 90 matrix is 12k cells).
  let hlTable = null, hlCol = -1, hlRow = null;
  function clearCrosshair() {
    if (hlRow) hlRow.classList.remove("hl-row");
    if (hlTable) hlTable.querySelectorAll(".hl-col").forEach((c) => c.classList.remove("hl-col"));
    hlTable = null; hlCol = -1; hlRow = null;
  }
  document.addEventListener("mouseover", (e) => {
    const cell = e.target.closest("td,th");
    const table = cell && cell.closest(".mtable, table.matrix, .gc-matrix");
    if (!table) { if (hlTable) clearCrosshair(); return; }
    const row = cell.parentElement, col = cell.cellIndex;
    if (table === hlTable && col === hlCol && row === hlRow) return;
    if (hlTable && hlTable !== table) clearCrosshair();
    if (hlRow !== row) {
      if (hlRow) hlRow.classList.remove("hl-row");
      if (row.parentElement.tagName === "TBODY") row.classList.add("hl-row");
      hlRow = row.parentElement.tagName === "TBODY" ? row : null;
    }
    if (col !== hlCol || table !== hlTable) {
      table.querySelectorAll(".hl-col").forEach((c) => c.classList.remove("hl-col"));
      table.querySelectorAll(`tr > *:nth-child(${col + 1})`).forEach((c) => c.classList.add("hl-col"));
    }
    hlTable = table; hlCol = col;
  });
  document.addEventListener("mouseleave", (e) => {
    if (e.target instanceof Element && e.target.classList?.contains("mwrap-x")) clearCrosshair();
  }, true);

  // Drag-to-resize the sticky first column of any matrix (exclusions, users).
  // Width lives on the .mwrap-x element as --ucol-w and survives re-renders.
  let exColW = 260;
  function applyColW() {
    document.querySelectorAll(".mwrap-x")
      .forEach((el) => el.style.setProperty("--ucol-w", exColW + "px"));
  }
  document.addEventListener("mousedown", (e) => {
    const grip = e.target.closest("[data-colgrip]"); if (!grip) return;
    e.preventDefault();
    const th = grip.closest("th");
    const left = th.getBoundingClientRect().left;
    grip.classList.add("drag");
    const move = (ev) => { exColW = Math.min(900, Math.max(90, Math.round(ev.clientX - left))); applyColW(); };
    const up = () => {
      grip.classList.remove("drag");
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  });
  // double-click the grip: shrink to fit / restore
  document.addEventListener("dblclick", (e) => {
    if (!e.target.closest("[data-colgrip]")) return;
    exColW = exColW > 160 ? 150 : 260; applyColW();
  });

  // ---------- generic matrix full screen ----------
  // The view's own toolbar and body are MOVED into the panel and put back on
  // close, so every filter/search/button keeps working with no duplicate state.
  const Fs = (() => {
    let open = false, slots = [];
    function park(el, host) {
      if (!el) return;
      const mark = document.createComment("fs");
      el.parentNode.insertBefore(mark, el);
      slots.push({ el, mark, sticky: el.style.position });
      el.style.position = "static";  // sticky toolbars must not stick inside the panel
      host.appendChild(el);
    }
    return {
      isOpen: () => open,
      open(title, { controls, body, onChange } = {}) {
        if (open) this.close();
        $("fsTitle").textContent = title;
        park(controls, $("fsControls"));
        park(body, $("fsBody"));
        $("fsModal").classList.add("show");
        document.body.style.overflow = "hidden";
        open = true; Fs._onChange = onChange;
        onChange?.(true);
      },
      close() {
        if (!open) return;
        slots.reverse().forEach(({ el, mark, sticky }) => {
          el.style.position = sticky || "";
          mark.parentNode.insertBefore(el, mark);
          mark.remove();
        });
        slots = [];
        $("fsModal").classList.remove("show");
        document.body.style.overflow = "";
        open = false;
        const cb = Fs._onChange; Fs._onChange = null; cb?.(false);
      },
    };
  })();
  $("fsClose").addEventListener("click", () => Fs.close());
  $("fsModal").addEventListener("click", (e) => { if (e.target.id === "fsModal") Fs.close(); });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    // close the top-most layer first: the dependency inspector sits above the
    // policy card, which sits above the full-screen panel
    const open = [...document.querySelectorAll(".modal-bg.open")];
    if (open.length) {
      const top = open.reduce((a, b) =>
        (+getComputedStyle(b).zIndex || 0) >= (+getComputedStyle(a).zIndex || 0) ? b : a);
      top.classList.remove("open");
      return;
    }
    if (Fs.isOpen()) Fs.close();
  });

  $("exExpand").addEventListener("click", () => {
    Fs.open(exTab === "matrix" ? "Exclusion × policy matrix" : "Effectively excluded users × policy",
      { controls: $("exToolbar"), body: $("exBody"), onChange: () => renderExclusions() });
  });
  $("plFull").addEventListener("click", () => Fs.open("Policy settings matrix", { body: $("matrixView") }));
  $("anFull").addEventListener("click", () => Fs.open("Users × policies impact matrix", { body: $("anMatrixWrap") }));
  $("gcFull").addEventListener("click", () => Fs.open("Persona × control coverage", { body: $("gcMatrix") }));
  $("exSearch").addEventListener("input", (e) => { exQuery = e.target.value; exPage = 0; renderExclusions(); });
  const EX_TABS = { matrix: "exTabMatrix", users: "exTabUsers", risk: "exTabRisk" };
  for (const [tab, id] of Object.entries(EX_TABS)) {
    $(id).addEventListener("click", () => {
      // matrix rows are keyed by entity, users rows by user id — a pin from one
      // tab is meaningless in the other, so release it on switch
      exTab = tab; exPage = 0; exFocusRow = null; exFocusCol = null;
      Object.values(EX_TABS).forEach((x) => $(x).classList.toggle("active", x === id));
      renderExclusions();
    });
  }
  $("exPrev").addEventListener("click", () => { exPage--; renderExclusions(); });
  $("exNext").addEventListener("click", () => { exPage++; renderExclusions(); });
  $("exCsv").addEventListener("click", () => {
    if (!exModel) return;
    downloadText("CA-Exclusions", "csv", "text/csv", Exclusions.toCsv(exModel, exUsers));
    toast("Exclusion CSV <span>downloaded</span>");
  });
  $("exMd").addEventListener("click", () => {
    if (!exModel) return;
    showReport("🚪 Exclusion report", "CA-Exclusions", Exclusions.toMd(exModel, exUsers, tenantName));
    toast("Exclusion Markdown <span>downloaded</span>");
  });

  // ---------- CA validator (simulation report) ----------
  // A read-only port of the simulation generator from Jasper Baes' Conditional
  // Access Validator (https://github.com/jasperbaes/Conditional-Access-Validator).
  let vaResult = null, vaFilter = "all", vaQuery = "", vaReportOnly = false, vaTargetObj = null, vaView = "compact", vaNames = null;
  const vaCollapsed = new Set();
  const isGuid = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s || "");

  // Resolve every id the eligible policies reference to a display name — one
  // batched pass, no group-membership expansion (users stay placeholders).
  async function buildValidatorNames(reportOnly) {
    const names = { user: {}, group: {}, role: {}, app: {}, location: {} };
    const refs = Validator.collectRefs(policies.map((p) => p.raw), reportOnly);
    if (isDemo) {
      const dn = (typeof DEMO_DATA !== "undefined" && DEMO_DATA.names) || {};
      [...refs.users].forEach((id) => names.user[id] = dn[id] || id);
      [...refs.groups].forEach((id) => names.group[id] = dn[id] || id);
      [...refs.roles].forEach((id) => names.role[id] = dn[id] || id);
      [...refs.apps].forEach((id) => names.app[id] = dn[id] || id);
      [...refs.locations].forEach((id) => names.location[id] = dn[id] || id);
      return names;
    }
    // users + groups via getByIds (chunks of 1000)
    const dirIds = [...refs.users, ...refs.groups].filter(isGuid);
    for (let i = 0; i < dirIds.length; i += 1000) {
      try {
        const j = await Graph.gpost("/directoryObjects/getByIds", { ids: dirIds.slice(i, i + 1000), types: ["user", "group"] });
        (j.value || []).forEach((o) => {
          const t = (o["@odata.type"] || "").toLowerCase();
          if (t.includes("group")) names.group[o.id] = o.displayName || o.id;
          else names.user[o.id] = o.displayName || o.userPrincipalName || o.id;
        });
      } catch (e) { console.warn("validator: directory lookup failed", e.message); }
    }
    if (refs.roles.length) {
      try {
        const tpl = await Graph.ggetAll("/directoryRoleTemplates");
        refs.roles.forEach((id) => { const t = tpl.find((x) => x.id === id); if (t) names.role[id] = t.displayName; });
      } catch (e) { console.warn("validator: role templates failed", e.message); }
    }
    if (refs.locations.length) {
      try {
        const locs = await Graph.ggetAll("/identity/conditionalAccess/namedLocations");
        refs.locations.forEach((id) => { const l = locs.find((x) => x.id === id); if (l) names.location[id] = l.displayName; });
      } catch (e) { console.warn("validator: named locations failed", e.message); }
    }
    const apps = refs.apps.filter(isGuid);
    for (let i = 0; i < apps.length; i += 15) {
      try {
        const flt = apps.slice(i, i + 15).map((id) => `'${id}'`).join(",");
        const sps = await Graph.ggetAll(`/servicePrincipals?$filter=appId in (${flt})&$select=appId,displayName`);
        apps.slice(i, i + 15).forEach((id) => { const sp = sps.find((s) => s.appId === id); if (sp) names.app[id] = sp.displayName; });
      } catch (e) { console.warn("validator: app lookup failed", e.message); }
    }
    return names;
  }

  function openValidator() {
    crumb("⚡ CA validator");
    show("screen-validator");
    if (!policies.length) { $("vaHead").innerHTML = '<p class="mini">No policies loaded.</p>'; $("vaBody").innerHTML = ""; $("vaChips").innerHTML = ""; return; }
    if (vaResult) {   // cached — restore the previous screen, no re-generate
      $("vaReportOnly").checked = vaReportOnly;
      $("vaTargetClear").style.display = vaTargetObj ? "" : "none";
      $("vaSearch").value = vaQuery;
      renderValidator();
      return;
    }
    runValidatorScan();
  }
  async function runValidatorScan() {
    show("screen-validator");
    if (!policies.length) return;
    $("vaHead").innerHTML = '<h3>⚡ CA validator</h3><p class="mini" style="margin:6px 0 0">Generating simulations…</p>';
    $("vaChips").innerHTML = ""; $("vaBody").innerHTML = ""; vaFilter = "all"; vaQuery = ""; $("vaSearch").value = ""; vaCollapsed.clear();
    $("vaReportOnly").checked = vaReportOnly;
    $("vaTargetClear").style.display = vaTargetObj ? "" : "none";
    try {
      const names = await buildValidatorNames(vaReportOnly);
      vaNames = names;
      vaResult = Validator.simulate(policies.map((p) => p.raw), { names, includeReportOnly: vaReportOnly, target: vaTargetObj });
      renderValidator();
    } catch (e) {
      console.error("CA validator failed:", e);
      $("vaHead").innerHTML = `<h3>⚡ CA validator</h3><p class="mini" style="color:var(--off)">Failed: ${esc(e.message || e)}</p>`;
    }
  }

  // Resolve the free-text target into a group persona or a user (with the
  // user's transitive group + role memberships, so policy scope can be judged).
  async function resolveValidatorTarget(text) {
    const t = (text || "").trim();
    if (!t) return null;
    const guid = isGuid(t);
    if (isDemo) {   // best-effort against demo data
      const dn = (typeof DEMO_DATA !== "undefined" && DEMO_DATA.names) || {};
      const byName = Object.keys(dn).find((id) => (dn[id] || "").toLowerCase() === t.toLowerCase());
      const id = guid ? t : byName;
      if (!id) throw new Error(`"${t}" not found in the demo data`);
      return { kind: "group", id, name: dn[id] || t };
    }
    if (t.includes("@")) {   // a UPN → user
      const u = await Graph.gget(`/users/${encodeURIComponent(t)}?$select=id,displayName,userPrincipalName`);
      return await userTarget(u);
    }
    if (guid) {              // GUID → try group, then user
      try { const g = await Graph.gget(`/groups/${t}?$select=id,displayName`); return await groupTarget(g); }
      catch { const u = await Graph.gget(`/users/${t}?$select=id,displayName,userPrincipalName`); return await userTarget(u); }
    }
    // plain text → group by display name (exact)
    const esc2 = t.replace(/'/g, "''");
    const res = await Graph.ggetAll(`/groups?$filter=displayName eq '${esc2}'&$select=id,displayName`);
    if (!res.length) throw new Error(`No group named "${t}" — use an exact group name, a group ID, or a user UPN (with @)`);
    return await groupTarget(res[0]);
  }
  // A persona group can be nested inside another group that a policy excludes —
  // carry the parents so that exclusion is honoured.
  async function groupTarget(g) {
    const groupIds = new Set([g.id]);
    try {
      const parents = await Graph.ggetAll(`/groups/${g.id}/transitiveMemberOf?$select=id`);
      parents.forEach((o) => groupIds.add(o.id));
    } catch (e) { console.warn("validator: group nesting lookup failed", e.message); }
    return { kind: "group", id: g.id, name: g.displayName || g.id, groupIds };
  }
  async function userTarget(u) {
    const groupIds = new Set(), roleIds = new Set();
    try {
      const mem = await Graph.ggetAll(`/users/${u.id}/transitiveMemberOf?$select=id,roleTemplateId`);
      mem.forEach((o) => {
        const ty = (o["@odata.type"] || "").toLowerCase();
        if (ty.includes("directoryrole")) { if (o.roleTemplateId) roleIds.add(o.roleTemplateId); }
        else groupIds.add(o.id);
      });
    } catch (e) { console.warn("validator: membership lookup failed", e.message); }
    return { kind: "user", id: u.id, name: u.displayName || u.userPrincipalName, upn: u.userPrincipalName, groupIds, roleIds };
  }

  const VA_CTRL_ORDER = ["block", "mfa", "authenticationStrength", "compliantDevice", "domainJoinedDevice", "passwordChange"];

  // Compact view: collapse a policy's whole cross-product into one summary card —
  // what it enforces, on which apps/clients/conditions, and who it excludes.
  function vaCompactCard(g, filter, q) {
    const sims = g.sims; if (!sims.length) return "";
    const uniq = (a) => [...new Set(a)];
    const enforced = uniq(sims.filter((s) => !s.inverted).map((s) => s.expectedControl));
    const shown = filter === "all" ? enforced : enforced.filter((c) => c === filter);
    if (!shown.length) return "";
    const inclUsers = uniq(sims.filter((s) => s.userType === "included").map((s) => s.upn));
    const apps = uniq(sims.filter((s) => s.appType === "included").map((s) => s.appName));
    const clients = uniq(sims.map((s) => s.clientApp)).map(Validator.clientLabel);
    const locs = uniq(sims.filter((s) => s.locationType !== "excluded" && s.ipRange !== "All").map((s) => s.ipRange));
    const plats = uniq(sims.filter((s) => s.platformType !== "excluded" && s.devicePlatform !== "All").map((s) => s.devicePlatform));
    const risks = uniq([...sims.map((s) => s.userRisk), ...sims.map((s) => s.signInRisk)].filter((x) => x !== "All"));
    const acts = uniq(sims.map((s) => s.userAction).filter((x) => x && x !== "All"));
    const exUsers = uniq(sims.filter((s) => s.userType === "excluded").map((s) => s.upn));
    const exApps = uniq(sims.filter((s) => s.appType === "excluded").map((s) => s.appName));
    const exLocs = uniq(sims.filter((s) => s.locationType === "excluded").map((s) => s.ipRange));
    const exPlats = uniq(sims.filter((s) => s.platformType === "excluded").map((s) => s.devicePlatform));
    if (q && !(`${g.name} ${apps.join(" ")} ${inclUsers.join(" ")}`.toLowerCase().includes(q))) return "";

    const list = (a) => a.length ? esc(a.join(", ")) : '<span class="muted">any</span>';
    const stateTag = g.state === "enabledForReportingButNotEnforced" ? ' <span class="tag">report-only</span>' : "";
    const badges = shown.map((c) => `<span class="va-enf">enforces ${esc(Validator.CONTROL_LABEL[c])}</span>`).join(" ");
    const cond = `${locs.length ? esc(locs.join(", ")) : "any location"} · ${plats.length ? esc(plats.join(", ")) : "any platform"} · ${risks.length ? esc(risks.join("/")) + " risk" : "any risk"}${acts.length ? " · " + esc(acts.join(", ")) + " action" : ""}`;
    const rows = [["Users", list(inclUsers)], ["Apps", list(apps)], ["Client apps", list(clients)], ["Conditions", cond]];
    const excl = [
      exUsers.length ? `users ${esc(exUsers.join(", "))}` : "",
      exApps.length ? `apps ${esc(exApps.join(", "))}` : "",
      exLocs.length ? `locations ${esc(exLocs.join(", "))}` : "",
      exPlats.length ? `platforms ${esc(exPlats.join(", "))}` : "",
    ].filter(Boolean).join("; ");
    return `<div class="list-card va-compact">
      <div class="va-c-head"><b class="pol-link" data-polid="${esc(g.id)}" title="Open the policy card">${esc(g.name)}</b>${stateTag} <span class="va-enfs">${badges}</span></div>
      <table class="va-c-tbl"><tbody>${rows.map(([k, v]) => `<tr><td class="va-c-k">${k}</td><td>${v}</td></tr>`).join("")}</tbody></table>
      ${excl ? `<div class="va-c-excl"><span class="tag block">does not apply to</span> ${excl}</div>` : ""}
    </div>`;
  }

  function renderValidator() {
    if (!vaResult) return;
    const r = vaResult;
    $("vaHead").innerHTML = `<div style="display:flex;gap:18px;align-items:flex-start;flex-wrap:wrap">
      <div style="flex:1;min-width:260px">
        <h3>⚡ CA validator <span class="tag new">NEW</span></h3>
        <p style="margin-bottom:6px">For each enabled policy, the sign-in simulations it implies and the control each one should enforce. A simulation on the <b>excluded</b> side inverts to <b>“no &lt;control&gt;”</b>.</p>
        <p class="mini muted" style="margin:0">Ported from <a href="https://github.com/jasperbaes/Conditional-Access-Validator" target="_blank" rel="noopener">Jasper Baes' Conditional Access Validator</a> (CC BY-NC-SA 4.0). Simulation report only; users are representative placeholders.</p>
      </div>
      <div style="text-align:right">
        <div style="font-size:26px;font-weight:700">${r.simCount}<span class="mini" style="font-weight:400"> simulations</span></div>
        <div class="mini">${r.simulatedPolicies} of ${r.policyCount} policies ${r.target ? "apply" : "simulated"}</div>
        ${r.target ? `<div class="mini">${r.outOfScope} not in scope for this target</div>` : ""}
        ${r.skipped.length ? `<div class="mini">${r.skipped.length} with no controls</div>` : ""}
      </div></div>
      ${r.target ? `<div class="va-targetbar">🎯 Running against ${r.target.kind === "user" ? "user" : "persona group"} <b>${esc(r.target.name)}</b>${r.target.upn ? ` <span class="mini muted">${esc(r.target.upn)}</span>` : ""} — showing only the policies that apply. <button class="fchip" data-vacleartarget="1">✕ Clear</button></div>` : ""}`;

    // control filter chips
    const counts = {};
    r.sims.forEach((s) => counts[s.expectedControl] = (counts[s.expectedControl] || 0) + 1);
    const chips = [["all", `All (${r.simCount})`], ...VA_CTRL_ORDER.filter((c) => counts[c]).map((c) => [c, `${Validator.CONTROL_LABEL[c]} (${counts[c]})`])];
    $("vaChips").innerHTML = chips.map(([k, l]) => `<button class="fchip ${vaFilter === k ? "active" : ""}" data-vaf="${esc(k)}">${esc(l)}</button>`).join("");

    // view toggle state
    $("vaExpand").style.display = vaView === "detailed" ? "" : "none";
    [...$("vaViewSeg").children].forEach((b) => b.classList.toggle("active", b.dataset.vaview === vaView));

    const q = vaQuery.toLowerCase();
    const skippedNote = r.skipped.length ? `<p class="mini muted" style="margin-top:10px">Not simulated (no grant or session control configured): ${r.skipped.map((s) => esc(s.name)).join(", ")}</p>` : "";

    // With a target, show the policies that do NOT reach it and why — the
    // overview is only complete if the misses are visible too.
    const nameOf = (id) => (vaNames && (vaNames.group[id] || vaNames.user[id] || vaNames.role[id])) || id;
    const oosHtml = (r.target && r.notInScope && r.notInScope.length) ? `<div class="list-card va-oos">
      <div class="va-oos-h"><b>Does not reach ${esc(r.target.name)}</b> <span class="mini muted">${r.notInScope.length} polic${r.notInScope.length === 1 ? "y" : "ies"}</span></div>
      <ul class="va-oos-l">${r.notInScope.map((x) => `<li>
        <span class="va-oos-n">${esc(x.name)}</span>${x.state === "enabledForReportingButNotEnforced" ? ' <span class="tag">report-only</span>' : ""}
        <span class="va-oos-r">${x.reason === "excluded"
          ? `excluded${x.via ? " via " + esc(nameOf(x.via)) : ""}${x.byAll ? " (targets all users)" : ""}`
          : "does not target this principal"}</span></li>`).join("")}</ul></div>` : "";
    const emptyMsg = () => { $("vaBody").innerHTML = (r.target && r.simulatedPolicies === 0)
      ? `<p class="mini" style="padding:20px">No enabled policy applies to <b>${esc(r.target.name)}</b>${vaReportOnly ? "" : " — tick “Include report-only” to widen the check"}.</p>`
      : '<p class="mini" style="padding:20px">No simulations match the current filter.</p>'; };

    // ---- Compact: one summary card per policy, grouped by persona ----
    if (vaView === "compact") {
      const blocks = (r.personas || []).map((pb) => {
        const cards = pb.groups.map((g) => vaCompactCard(g, vaFilter, q)).filter(Boolean);
        if (!cards.length) return "";
        return `<div class="va-persona"><h4>${esc(pb.label)} <span class="mini muted">${cards.length} polic${cards.length === 1 ? "y" : "ies"}</span></h4></div>${cards.join("")}`;
      }).filter(Boolean);
      if (!blocks.length && !oosHtml) { emptyMsg(); return; }
      $("vaBody").innerHTML = (blocks.length ? blocks.join("") : '<p class="mini" style="padding:14px">No policy enforces a control for this target.</p>') + oosHtml + skippedNote;
      return;
    }

    // ---- Detailed: one row per simulation (the full cross-product) ----
    const match = (s) => (vaFilter === "all" || s.expectedControl === vaFilter);
    const groups = r.groups.map((g) => {
      const sims = g.sims.filter((s) => match(s) && (!q || s.title.toLowerCase().includes(q) || g.name.toLowerCase().includes(q)));
      return { ...g, shown: sims };
    }).filter((g) => g.shown.length);

    if (!groups.length && !oosHtml) { emptyMsg(); return; }
    const stateTag = (st) => st === "enabledForReportingButNotEnforced" ? '<span class="tag">report-only</span>' : "";
    const cell = (v) => v && v !== "All" ? esc(v) : '<span class="muted">·</span>';
    // insert a persona heading whenever the bucket changes
    let lastPersona = null;
    $("vaBody").innerHTML = groups.map((g) => {
      const pl = (g.persona && g.persona.label) || "Other";
      const head = pl !== lastPersona ? (lastPersona = pl, `<div class="va-persona"><h4>${esc(pl)}</h4></div>`) : "";
      return head + vaDetailCard(g, stateTag, cell);
    }).join("") + oosHtml + skippedNote;
  }

  // one policy's simulation table (detailed view)
  function vaDetailCard(g, stateTag, cell) {
    {
      const open = !vaCollapsed.has(g.id);
      const rows = g.shown.map((s) => `<tr>
        <td>${s.inverted ? '<span class="va-no">no ' + esc(s.controlLabel) + '</span>' : '<span class="va-yes">' + esc(s.controlLabel) + '</span>'}</td>
        <td>${esc(s.upn)}${s.userType === "excluded" ? ' <span class="tag block">excl</span>' : ""}</td>
        <td>${esc(s.appName)}${s.appType === "excluded" ? ' <span class="tag block">excl</span>' : ""}</td>
        <td>${cell(Validator.clientLabel(s.clientApp))}</td>
        <td>${cell(s.ipRange)}${s.locationType === "excluded" ? ' <span class="tag block">excl</span>' : ""}</td>
        <td>${cell(s.devicePlatform)}${s.platformType === "excluded" ? ' <span class="tag block">excl</span>' : ""}</td>
        <td>${cell(s.userRisk)}</td><td>${cell(s.signInRisk)}</td><td>${cell(s.userAction)}</td>
      </tr>`).join("");
      return `<div class="list-card va-card">
        <div class="va-h" data-vagroup="${esc(g.id)}">
          <span class="va-caret">${open ? "▾" : "▸"}</span>
          <b class="pol-link" data-polid="${esc(g.id)}" title="Open the policy card">${esc(g.name)}</b> ${stateTag(g.state)}
          <span class="mini muted">${g.shown.length} simulation${g.shown.length === 1 ? "" : "s"}${g.capped ? " · capped" : ""}</span>
        </div>
        <div class="va-tablewrap" style="${open ? "" : "display:none"}">
          <table class="va-table">
            <thead><tr><th>Expected</th><th>User</th><th>Application</th><th>Client</th><th>Location</th><th>Platform</th><th>User risk</th><th>Sign-in risk</th><th>User action</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>`;
    }
  }

  function vaMarkdown() {
    const r = vaResult; if (!r) return "";
    const L = [`# Conditional Access validation — ${tenantName || "tenant"}`, "",
      `Generated ${new Date().toISOString().replace("T", " ").slice(0, 16)} UTC by ENCA — Conditional Access Baseline Tools (enca.limon-it.nl).`, "",
      `Simulation generator ported from [Jasper Baes' Conditional Access Validator](https://github.com/jasperbaes/Conditional-Access-Validator) (CC BY-NC-SA 4.0).`, "",
      ...(r.target ? [`**Target:** ${r.target.kind === "user" ? "user" : "persona group"} ${r.target.name}${r.target.upn ? ` (${r.target.upn})` : ""} — only the policies that apply are shown (${r.outOfScope} not in scope).`, ""] : []),
      `- Policies ${r.target ? "applying" : "simulated"}: **${r.simulatedPolicies}** of ${r.policyCount}`, `- Simulations: **${r.simCount}**`,
      ...(r.skipped.length ? [`- Skipped (session-only / no controls): ${r.skipped.map((s) => s.name).join(", ")}`] : []), ""];
    for (const g of r.groups) {
      L.push(`## ${g.name}${g.state === "enabledForReportingButNotEnforced" ? " *(report-only)*" : ""}`, "");
      L.push("| Expected | User | Application | Client | Location | Platform | User risk | Sign-in risk | User action |", "| --- | --- | --- | --- | --- | --- | --- | --- | --- |");
      for (const s of g.sims) {
        const c = (v) => (v && v !== "All" ? String(v).replace(/\|/g, "\\|") : "·");
        L.push(`| ${s.inverted ? "no " : ""}${s.controlLabel} | ${c(s.upn)} | ${c(s.appName)} | ${c(Validator.clientLabel(s.clientApp))} | ${c(s.ipRange)} | ${c(s.devicePlatform)} | ${c(s.userRisk)} | ${c(s.signInRisk)} | ${c(s.userAction)} |`);
      }
      L.push("");
    }
    return L.join("\n");
  }

  $("vaChips").addEventListener("click", (e) => { const b = e.target.closest("[data-vaf]"); if (!b) return; vaFilter = b.dataset.vaf; renderValidator(); });
  $("vaViewSeg").addEventListener("click", (e) => { const b = e.target.closest("[data-vaview]"); if (!b) return; vaView = b.dataset.vaview; renderValidator(); });
  $("vaBody").addEventListener("click", (e) => {
    // The policy name opens its card. It sits inside the collapse header in the
    // detailed view, so it has to be checked first or the click just toggles.
    const pl = e.target.closest(".pol-link");
    if (pl && pl.dataset.polid) { showDetail(pl.dataset.polid); return; }
    const h = e.target.closest("[data-vagroup]"); if (!h) return;
    const id = h.dataset.vagroup;
    if (vaCollapsed.has(id)) vaCollapsed.delete(id); else vaCollapsed.add(id);
    renderValidator();
  });
  $("vaSearch").addEventListener("input", (e) => { vaQuery = e.target.value; renderValidator(); });
  $("vaExpand").addEventListener("click", () => {
    if (!vaResult) return;
    const allOpen = vaResult.groups.every((g) => !vaCollapsed.has(g.id));
    vaCollapsed.clear();
    if (allOpen) vaResult.groups.forEach((g) => vaCollapsed.add(g.id));
    $("vaExpand").textContent = allOpen ? "⊞ Expand all" : "⊟ Collapse all";
    renderValidator();
  });
  $("vaReportOnly").addEventListener("change", (e) => { vaReportOnly = e.target.checked; runValidatorScan(); });
  $("vaRefresh").addEventListener("click", async () => { if (!isDemo) await loadFromGraph(true); runValidatorScan(); });
  $("vaMd").addEventListener("click", () => { if (!vaResult) return; showReport("⚡ CA validation report", "CA-Validation", vaMarkdown()); });
  // Target: run the simulation against one persona group or user
  async function vaRunTarget() {
    const text = $("vaTarget").value.trim();
    if (!text) { vaTargetObj = null; openValidator(); return; }
    $("vaTargetGo").disabled = true; $("vaTargetGo").textContent = "…";
    try {
      vaTargetObj = await resolveValidatorTarget(text);
      $("vaTarget").value = vaTargetObj.upn || vaTargetObj.name;
      runValidatorScan();
    } catch (e) { toast(`Target: <span>${esc(e.message || e)}</span>`); }
    finally { $("vaTargetGo").disabled = false; $("vaTargetGo").textContent = "Run"; }
  }
  $("vaTargetGo").addEventListener("click", vaRunTarget);
  $("vaTarget").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); vaRunTarget(); } });
  // Type-ahead: suggest matching groups and users as you type, so you don't
  // have to know the exact name. Debounced, read-only, top 10 of each.
  let vaSugTimer = null, vaSugLast = "";
  const vaSugCache = new Map();
  async function vaSuggest(text) {
    const t = text.trim();
    if (t.length < 2 || t === vaSugLast) return;
    vaSugLast = t;
    if (vaSugCache.has(t)) { $("vaTargetList").innerHTML = vaSugCache.get(t); return; }
    let opts = [];
    try {
      if (isDemo) {
        const dn = (typeof DEMO_DATA !== "undefined" && DEMO_DATA.names) || {};
        opts = Object.values(dn).filter((n) => String(n).toLowerCase().includes(t.toLowerCase()))
          .slice(0, 12).map((n) => ({ v: n, l: "demo object" }));
      } else {
        const f = t.replace(/'/g, "''");
        const [groups, users] = await Promise.all([
          Graph.gget(`/groups?$filter=startswith(displayName,'${f}')&$select=displayName&$top=10`).catch(() => null),
          Graph.gget(`/users?$filter=startswith(displayName,'${f}') or startswith(userPrincipalName,'${f}')&$select=displayName,userPrincipalName&$top=10`).catch(() => null),
        ]);
        opts = [
          ...((groups && groups.value) || []).map((g) => ({ v: g.displayName, l: "group" })),
          ...((users && users.value) || []).map((u) => ({ v: u.userPrincipalName, l: `user · ${u.displayName || ""}`.trim() })),
        ];
      }
    } catch (e) { console.warn("validator: suggest failed", e.message); return; }
    const html = opts.map((o) => `<option value="${esc(o.v)}" label="${esc(o.l)}"></option>`).join("");
    vaSugCache.set(t, html);
    $("vaTargetList").innerHTML = html;
  }
  $("vaTarget").addEventListener("input", (e) => {
    const v = e.target.value;
    clearTimeout(vaSugTimer);
    vaSugTimer = setTimeout(() => vaSuggest(v), 250);
  });
  function vaClearTarget() { vaTargetObj = null; $("vaTarget").value = ""; runValidatorScan(); }
  $("vaTargetClear").addEventListener("click", vaClearTarget);
  $("vaHead").addEventListener("click", (e) => { if (e.target.closest("[data-vacleartarget]")) vaClearTarget(); });

  // ---------- Change audit (directory audit log) ----------
  const AU_READ = ["AuditLog.Read.All"];
  let auRes = null, auFilter = "all", auQuery = "", auDays = 7, auWatch = null, auBusy = false, auView = "summary";
  let auSnap = null;   // { meta, cmp } once a previous export is loaded for comparison
  const auOpen = new Set();
  const auBusyPanel = () => '<div class="run-prompt"><div class="spinner"></div><p class="mini muted">Reading the audit log… this keeps running if you switch tabs.</p></div>';

  function openAudit() {
    crumb("🕓 Change audit");
    show("screen-audit");
    $("auRescan").style.display = auRes && !auBusy ? "" : "none";
    // A read in flight has to survive navigating away and back, otherwise the
    // Run prompt reappears and it looks like the read was cancelled.
    if (auBusy) { $("auBody").innerHTML = auBusyPanel(); return; }
    if (auRes) { renderAudit(); return; }
    $("auHead").innerHTML = `<h3>🕓 Change audit <span class="tag new">NEW</span></h3>
      <p style="margin-bottom:4px">Who changed which Conditional Access resource, when, and exactly what changed — policies, named locations, authentication strengths and contexts, and terms of use.</p>
      <p class="mini muted" style="margin:0">Reads the Entra <b>directory audit log</b> (AuditLog.Read.All, requested when you run it). Retention is what your licence keeps — about 30 days on Entra ID P1/P2, 7 days otherwise.</p>`;
    $("auChips").innerHTML = "";
    $("auBody").innerHTML = '<div class="run-prompt"><button class="btn primary" data-aurun>▶ Read the audit log</button><p class="mini muted">Nothing is written. The result stays until you rescan.</p></div>';
  }
  $("toolAudit").addEventListener("click", () => openAudit());
  $("auRescan").addEventListener("click", () => runAudit());
  $("auDays").addEventListener("change", (e) => { auDays = +e.target.value; if (auRes) runAudit(); });

  async function runAudit() {
    if (auBusy) return;                       // already reading — don't start a second pass
    if (!isDemo && !await preConsent([...AUTH_CONFIG.scopes, ...AU_READ])) return;
    auBusy = true;
    $("auRescan").style.display = "none";
    $("auBody").innerHTML = auBusyPanel();
    try {
      // The groups every policy includes/excludes — membership changes on these
      // widen or narrow a policy without the policy itself being touched. The
      // audit record carries the group's display name, so ids are enough here.
      const watch = Audit.watchedGroups(policies.map((p) => p.raw));
      const scopes = [...AUTH_CONFIG.scopes, ...AU_READ];
      const [pol, mem] = isDemo
        ? [((typeof DEMO_DATA !== "undefined" && DEMO_DATA.auditRecords) || []), []]
        : await Promise.all([
            Graph.ggetAll(Audit.queryPolicy(auDays), scopes),
            // only worth asking if any policy actually points at a group
            watch.size ? Graph.ggetAll(Audit.queryMembership(auDays), scopes).catch(() => []) : [],
          ]);
      auRes = Audit.build([...pol, ...mem], { watch });
      auWatch = watch;
      auOpen.clear();
      auBusy = false;
      $("auRescan").style.display = "";
      renderAudit();
      if (!auRes.total) toast("No Conditional Access changes in this window");
    } catch (e) {
      console.error("Change audit failed:", e);
      auBusy = false;
      $("auBody").innerHTML = `<p class="mini" style="padding:20px;color:var(--off)">Could not read the audit log: ${esc(e.message || e)}<br>
        <span class="muted">This needs AuditLog.Read.All and a reader role such as Reports Reader, Security Reader or Security Administrator.</span></p>
        <div class="run-prompt" style="padding:8px 20px 20px"><button class="btn" data-aurun>Try again</button></div>`;
    } finally { auBusy = false; }
  }
  $("auBody").addEventListener("click", (e) => {
    if (e.target.closest("[data-aurun]")) { runAudit(); return; }
    const s = e.target.closest("[data-ausum]");
    if (s) { const k = "s:" + s.dataset.ausum; auOpen.has(k) ? auOpen.delete(k) : auOpen.add(k); renderAudit(); return; }
    const h = e.target.closest("[data-auid]");
    if (h) { const id = h.dataset.auid; auOpen.has(id) ? auOpen.delete(id) : auOpen.add(id); renderAudit(); }
  });
  $("auViewSeg").addEventListener("click", (e) => {
    const b = e.target.closest("[data-auview]"); if (!b) return;
    auView = b.dataset.auview; auOpen.clear(); renderAudit();
  });

  // ---- snapshots: export now, compare later ----
  // Nothing is stored server-side and Entra only keeps ~30 days, so an export
  // is the only way to hold history. A later read can be diffed against it.
  $("auJson").addEventListener("click", () => {
    if (!auRes) { toast("Read the audit log first"); return; }
    const payload = Audit.toExport(auRes, {
      tenant: tenantName, days: auDays,
      build: (typeof APP_BUILD !== "undefined" ? APP_BUILD.label : ""),
    });
    const stamp = new Date().toISOString().slice(0, 10);
    downloadText(`CA-ChangeAudit-${(tenantName || "tenant").replace(/[^\w.-]+/g, "-")}-${stamp}`,
      "json", "application/json", JSON.stringify(payload, null, 2));
    toast(`Snapshot of <span>${auRes.total}</span> changes downloaded — compare against it later`);
  });
  $("auCompare").addEventListener("click", () => $("auFile").click());
  $("auFile").addEventListener("change", async (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = "";                       // let the same file be picked again
    if (!f) return;
    if (!auRes) { toast("Read the audit log first, then compare"); return; }
    try {
      const snap = Audit.fromExport(JSON.parse(await f.text()));
      auSnap = { meta: snap, cmp: Audit.compare(auRes.rows, snap.rows) };
      auFilter = "all"; auOpen.clear();
      renderAudit();
      const c = auSnap.cmp;
      toast(`Compared with ${esc(String(snap.generated).slice(0, 10))} — <span>${c.newSince.length}</span> new since then`);
    } catch (err) {
      console.error("Audit compare failed:", err);
      toast(`Could not load that snapshot: <span>${esc(err.message || err)}</span>`);
    }
  });
  function auClearSnapshot() { auSnap = null; renderAudit(); }
  $("auHead").addEventListener("click", (e) => { if (e.target.closest("[data-auclearsnap]")) auClearSnapshot(); });
  $("auChips").addEventListener("click", (e) => { const b = e.target.closest("[data-auf]"); if (!b) return; auFilter = b.dataset.auf; renderAudit(); });
  $("auSearch").addEventListener("input", (e) => { auQuery = e.target.value; renderAudit(); });

  const auAgo = (iso) => {
    const d = (Date.now() - new Date(iso).getTime()) / 36e5;
    if (d < 1) return `${Math.max(1, Math.round(d * 60))} min ago`;
    if (d < 48) return `${Math.round(d)} h ago`;
    return `${Math.round(d / 24)} d ago`;
  };
  const auVal = (v) => Array.isArray(v) ? v.join(", ") : (v && typeof v === "object" ? JSON.stringify(v) : String(v ?? ""));
  // Records the snapshot has that Entra no longer returns — they fell out of
  // retention, so the snapshot is now the only copy.
  function auAgedHtml() {
    if (!auSnap || !auSnap.cmp.aged.length) return "";
    const a = auSnap.cmp.aged;
    return `<div class="list-card au-card" style="margin-top:12px">
      <div class="au-h" data-auid="aged"><span class="au-act delete">aged out</span>
        <b>${a.length} change${a.length === 1 ? "" : "s"} in the snapshot are no longer in the audit log</b>
        <span class="au-when">retention</span></div>
      <div class="au-sub">Entra has dropped these past its retention window — your export is the only record now. Keep exporting to build history.</div>
      ${auOpen.has("aged") ? `<ul class="wi-list dim" style="margin-top:8px">${a.slice(0, 60).map((x) => `<li>
          <div class="wi-pn">${esc(x.action)} · ${esc(x.target)}</div>
          <div class="wi-why">${esc(new Date(x.when).toLocaleString())} · by ${esc(x.actor && x.actor.name || "?")}</div></li>`).join("")}</ul>
        ${a.length > 60 ? `<p class="mini muted">+${a.length - 60} more in the export file.</p>` : ""}` : ""}
    </div>`;
  }

  function renderAudit() {
    const r = auRes; if (!r) return;
    const K = Audit.KIND;
    $("auHead").innerHTML = `<div style="display:flex;gap:18px;align-items:flex-start;flex-wrap:wrap">
      <div style="flex:1;min-width:280px">
        <h3>🕓 Change audit <span class="tag new">NEW</span></h3>
        <p style="margin-bottom:4px">Every Conditional Access change in the window, newest first — expand one to see the exact fields that moved.</p>
        <p class="mini muted" style="margin:0">From the Entra directory audit log. Retention is licence-bound (≈30 days on P1/P2), so this is a rolling window, not a full history.</p>
      </div>
      <div style="text-align:right">
        <div style="font-size:26px;font-weight:700">${r.total}<span class="mini" style="font-weight:400"> changes</span></div>
        <div class="mini">${Object.entries(r.byAction).map(([k, n]) => `${n} ${k}`).join(" · ") || "—"}</div>
        ${r.failures ? `<div class="mini" style="color:var(--off)">${r.failures} failed</div>` : ""}
      </div></div>
      ${auSnap ? `<div class="va-targetbar">📌 Compared with the snapshot from <b>${esc(String(auSnap.meta.generated).slice(0, 16).replace("T", " "))}</b>
        (${auSnap.meta.count} changes${auSnap.meta.windowDays ? `, ${auSnap.meta.windowDays}-day window` : ""}) —
        <b>${auSnap.cmp.newSince.length} new</b> since then, ${auSnap.cmp.common} already seen${auSnap.cmp.aged.length ? `, ${auSnap.cmp.aged.length} aged out of the log` : ""}.
        <button class="fchip" data-auclearsnap="1">✕ Clear</button></div>` : ""}`;

    const chips = [["all", `All (${r.total})`],
      ...(auSnap ? [["new", `✨ New since snapshot (${auSnap.cmp.newSince.length})`]] : []),
      ...Object.entries(r.byKind).map(([k, n]) => [k, `${K[k] ? K[k].icon : ""} ${K[k] ? K[k].label : k} (${n})`])];
    $("auChips").innerHTML = chips.map(([k, l]) => `<button class="fchip ${auFilter === k ? "active" : ""}" data-auf="${esc(k)}">${esc(l)}</button>`).join("");

    const q = auQuery.toLowerCase();
    const rows = r.rows.filter((x) => (auFilter === "all" || (auFilter === "new" ? auSnap && auSnap.cmp.newIds.has(x.id) : x.kind === auFilter))
      && (!q || `${x.target} ${x.actor.name} ${x.activity} ${x.changes.map((c) => c.path).join(" ")}`.toLowerCase().includes(q)));
    if (!rows.length) { $("auBody").innerHTML = '<p class="mini" style="padding:20px">No change matches the current filter.</p>'; return; }

    [...$("auViewSeg").children].forEach((b) => b.classList.toggle("active", b.dataset.auview === auView));

    // ---- Summary: one row per resource touched (the readable default) ----
    if (auView === "summary") {
      const sum = Audit.summarize(rows);
      $("auBody").innerHTML = `<div class="list-card"><table class="plist au-sum">
        <thead><tr><th>Resource</th><th style="width:150px">Changes</th><th style="width:120px">People moved</th><th>Changed by</th><th style="width:110px">Last change</th></tr></thead>
        <tbody>${sum.map((s) => {
          const open = auOpen.has("s:" + s.key);
          const K = Audit.KIND[s.kind] || {};
          const detail = open ? `<tr class="au-sumdet"><td colspan="5">
            ${s.kind === "membership" && s.usedBy.length ? `<div class="au-why" style="margin:0 0 8px">This group is used as an <b>${esc(s.usedAs)}</b> on ${s.usedBy.length} polic${s.usedBy.length === 1 ? "y" : "ies"}: ${esc(s.usedBy.slice(0, 6).join(", "))}${s.usedBy.length > 6 ? ` +${s.usedBy.length - 6} more` : ""}</div>` : ""}
            <ul class="wi-list">${s.rows.slice(0, 40).map((x) => `<li>
              <div class="wi-pn"><span class="au-act ${x.action}">${x.action}</span> ${esc(x.member || x.activity)}</div>
              <div class="wi-why">${esc(new Date(x.when).toLocaleString())} · by ${esc(x.actor.name)}${x.actor.ip ? ` from ${esc(x.actor.ip)}` : ""}${x.changeCount && x.kind !== "membership" ? ` · ${x.changeCount} field${x.changeCount === 1 ? "" : "s"}` : ""}</div>
            </li>`).join("")}</ul>
            ${s.rows.length > 40 ? `<p class="mini muted">Showing the 40 most recent of ${s.rows.length} — switch to Timeline and search to see the rest.</p>` : ""}
          </td></tr>` : "";
          return `<tr class="au-sumrow" data-ausum="${esc(s.key)}">
            <td><b>${K.icon || ""} ${esc(s.target)}</b><div class="mini muted">${esc(K.label || s.kind)}${s.usedAs ? ` · ${esc(s.usedAs)} group` : ""}</div></td>
            <td>${s.add ? `<span class="au-n add">+${s.add}</span>` : ""}${s.remove ? `<span class="au-n rem">−${s.remove}</span>` : ""}${s.update ? `<span class="au-n upd">~${s.update}</span>` : ""}</td>
            <td>${s.memberCount ? `${s.memberCount} distinct` : '<span class="muted">—</span>'}</td>
            <td class="mini">${esc(s.actors.slice(0, 2).map(([n, c]) => `${n} (${c})`).join(", "))}${s.actors.length > 2 ? ` +${s.actors.length - 2}` : ""}</td>
            <td class="mini">${esc(auAgo(s.last))}</td>
          </tr>${detail}`;
        }).join("")}</tbody></table></div>
        <p class="mini muted" style="margin-top:8px">${sum.length} resource${sum.length === 1 ? "" : "s"} touched across ${rows.length} change${rows.length === 1 ? "" : "s"} — click a row for the individual events.</p>
        ${auAgedHtml()}`;
      return;
    }

    // ---- Timeline: one card per change (capped, it is a lot on a big tenant) ----
    const CAP = 300;
    const shown = rows.slice(0, CAP);
    $("auBody").innerHTML = (rows.length > CAP
      ? `<p class="mini muted" style="margin-bottom:8px">Showing the ${CAP} most recent of ${rows.length} changes — narrow with the filters or use Summary.</p>` : "")
      + shown.map((x) => {
      const open = auOpen.has(x.id);
      const diff = x.changes.length ? `<div class="au-diff">${x.changes.slice(0, 60).map((c) => `<div>
          <span class="au-op ${c.op}">${c.op}</span>
          <span class="au-path">${esc(c.path || "(value)")}</span>
          ${c.op === "change" ? `<span class="au-from">${esc(auVal(c.from))}</span> → <span class="au-to">${esc(auVal(c.to))}</span>`
            : c.op === "remove" || c.op === "clear" ? `<span class="au-from">${esc(auVal(c.value ?? c.from))}</span>`
            : `<span class="au-to">${esc(auVal(c.value ?? c.to))}</span>`}
        </div>`).join("")}${x.changes.length > 60 ? `<div class="mini muted">+${x.changes.length - 60} more</div>` : ""}</div>`
        : '<div class="au-diff mini muted">No field-level detail recorded for this entry.</div>';
      const isNew = auSnap && auSnap.cmp.newIds.has(x.id);
      return `<div class="list-card au-card${isNew ? " au-new" : ""}">
        <div class="au-h" data-auid="${esc(x.id)}">
          ${isNew ? '<span class="au-act add" title="Not in the loaded snapshot">new</span>' : ""}
          <span class="au-act ${x.action}">${x.action}</span>
          <span>${K[x.kind] ? K[x.kind].icon : ""}</span>
          <b>${esc(x.target)}</b>
          ${x.result && x.result.toLowerCase() !== "success" ? `<span class="tag block">${esc(x.result)}</span>` : ""}
          ${x.changeCount ? `<span class="mini muted">${x.changeCount} field${x.changeCount === 1 ? "" : "s"}</span>` : ""}
          <span class="au-when">${esc(auAgo(x.when))}</span>
        </div>
        <div class="au-sub">${esc(x.activity)} · by <b>${esc(x.actor.name)}</b>${x.actor.upn ? ` (${esc(x.actor.upn)})` : ""}${x.actor.ip ? ` from ${esc(x.actor.ip)}` : ""} · ${esc(new Date(x.when).toLocaleString())}</div>
        ${x.kind === "membership" ? `<div class="au-sub au-why">${x.action === "add" ? "⚠ " : ""}<b>${esc(x.member || "")}</b> ${x.action === "add" ? "gained" : "lost"} whatever this group grants —
          ${x.usedAs === "exclude" ? "it is an <b>exclusion</b> group" : x.usedAs === "include" ? "it is an <b>include</b> group" : "it is used as <b>include and exclude</b>"}
          on ${x.usedBy.length} polic${x.usedBy.length === 1 ? "y" : "ies"}: ${esc(x.usedBy.slice(0, 4).join(", "))}${x.usedBy.length > 4 ? ` +${x.usedBy.length - 4} more` : ""}</div>` : ""}
        ${open ? diff : ""}
      </div>`;
    }).join("") + auAgedHtml();
  }

  $("auMd").addEventListener("click", () => {
    const r = auRes; if (!r) return;
    const L = [`# Conditional Access change audit — ${tenantName || "tenant"}`, "",
      `Generated ${new Date().toISOString().replace("T", " ").slice(0, 16)} UTC by ENCA — Conditional Access Baseline Tools (enca.limon-it.nl).`, "",
      `- Window: last ${auDays} days${r.from ? ` (${String(r.from).slice(0, 10)} → ${String(r.to).slice(0, 10)})` : ""}`,
      `- Changes: **${r.total}** — ${Object.entries(r.byAction).map(([k, n]) => `${n} ${k}`).join(", ") || "none"}`,
      `- Most active: ${r.actors.slice(0, 3).map(([n, c]) => `${n} (${c})`).join(", ") || "—"}`,
      `- Most changed: ${r.targets.slice(0, 3).map(([n, c]) => `${n} (${c})`).join(", ") || "—"}`, ""];
    for (const x of r.rows) {
      L.push(`## ${x.action.toUpperCase()} — ${x.target}`, "",
        `- When: ${x.when}`, `- Activity: ${x.activity}`,
        `- By: ${x.actor.name}${x.actor.upn ? ` (${x.actor.upn})` : ""}${x.actor.ip ? ` from ${x.actor.ip}` : ""}`,
        `- Result: ${x.result || "—"}`, "");
      if (x.changes.length) {
        L.push("| Change | Field | Value |", "| --- | --- | --- |");
        x.changes.forEach((c) => L.push(`| ${c.op} | ${String(c.path || "").replace(/\|/g, "\\|")} | ${String(c.op === "change" ? `${auVal(c.from)} → ${auVal(c.to)}` : auVal(c.value ?? c.to ?? c.from)).replace(/\|/g, "\\|")} |`));
        L.push("");
      }
    }
    showReport("🕓 Change audit", "CA-ChangeAudit", L.join("\n"));
  });

  // ---------- Named locations (view / create / edit / delete) ----------
  const LO_WRITE = ["Policy.ReadWrite.ConditionalAccess"];
  let loList = null, loFilter = "all", loQuery = "", loEditing = null, loDeleting = null;
  // Cards sit in a grid (two or more per row); Table is the same information
  // one line per location, for tenants with 80+ of them.
  let loView = "cards";

  async function openLocations(force) {
    crumb("🌐 Named locations");
    show("screen-locations");
    if (loList && !force) { renderLocations(); return; }   // cached
    $("loHead").innerHTML = '<h3>🌐 Named locations</h3><p class="mini" style="margin:6px 0 0">Reading named locations…</p>';
    $("loBody").innerHTML = ""; $("loChips").innerHTML = "";
    try {
      loList = isDemo
        ? ((typeof DEMO_DATA !== "undefined" && DEMO_DATA.namedLocations) || [])
        : await Graph.ggetAll("/identity/conditionalAccess/namedLocations");
      renderLocations();
    } catch (e) {
      console.error("Named locations failed:", e);
      $("loHead").innerHTML = `<h3>🌐 Named locations</h3><p class="mini" style="color:var(--off)">Failed: ${esc(e.message || e)}</p>`;
    }
  }
  $("toolLocations").addEventListener("click", () => openLocations());
  $("loRefresh").addEventListener("click", () => openLocations(true));

  function renderLocations() {
    const raws = policies.map((p) => p.raw);
    const s = Locations.summarize(loList, raws);
    $("loHead").innerHTML = `<div style="display:flex;gap:18px;align-items:flex-start;flex-wrap:wrap">
      <div style="flex:1;min-width:260px">
        <h3>🌐 Named locations <span class="tag new">BETA</span> <span class="tag block">writes to tenant</span></h3>
        <p style="margin-bottom:4px">The IP-range and country locations your Conditional Access policies can target. Create, edit and delete them here — each row shows which policies use it.</p>
        <p class="mini muted" style="margin:0">A location's type is fixed at creation: an IP location cannot become a country location. Deleting one that a policy still references widens that policy.</p>
      </div>
      <div style="text-align:right">
        <div style="font-size:26px;font-weight:700">${s.total}<span class="mini" style="font-weight:400"> locations</span></div>
        <div class="mini">${s.ip} IP (${s.ranges} ranges) · ${s.country} country${s.compliantNetwork ? ` · ${s.compliantNetwork} compliant network` : ""}</div>
        <div class="mini">${s.trusted} trusted${s.viaTrusted ? ` · ${s.viaTrusted} used only via “All trusted”` : ""}${s.unused ? ` · ${s.unused} unused` : ""}</div>
      </div></div>`;

    const counts = { all: loList.length, ip: s.ip, country: s.country, trusted: s.trusted, unused: s.unused };
    $("loChips").innerHTML = [["all", `All (${counts.all})`], ["ip", `🖧 IP ranges (${counts.ip})`],
      ["country", `🌍 Countries (${counts.country})`], ["trusted", `✓ Trusted (${counts.trusted})`],
      ["unused", `Unused (${counts.unused})`]]
      .map(([k, l]) => `<button class="fchip ${loFilter === k ? "active" : ""}" data-lof="${k}">${esc(l)}</button>`).join("");

    const q = loQuery.toLowerCase();
    const rows = loList.filter((l) => {
      const k = Locations.kindOf(l), used = Locations.usedBy(l, raws).length;
      if (loFilter === "ip" && k !== "ip") return false;
      if (loFilter === "country" && k !== "country") return false;
      if (loFilter === "trusted" && !Locations.isTrusted(l)) return false;
      if (loFilter === "unused" && used) return false;
      return !q || `${l.displayName} ${Locations.detail(l)}`.toLowerCase().includes(q);
    }).sort((a, b) => (a.displayName || "").localeCompare(b.displayName || ""));

    [...$("loViewSeg").children].forEach((b) => b.classList.toggle("active", b.dataset.loview === loView));
    if (!rows.length) { $("loBody").innerHTML = '<p class="mini" style="padding:20px">No named location matches the current filter.</p>'; return; }

    // Shared per-location facts, so the card and the table row can never drift.
    const facts = (l) => {
      const used = Locations.usedBy(l, raws);
      return {
        k: Locations.kindOf(l), used, canEdit: Locations.editable(l),
        direct: used.filter((u) => !u.implicit), implicit: used.filter((u) => u.implicit),
      };
    };
    const icon = (k) => k === "ip" ? "🖧" : k === "country" ? "🌍" : "🛡";
    const kindLabel = (k) => k === "ip" ? "IP ranges" : k === "country" ? "countries" : "network access";
    const list = (arr) => arr.map((p) => `<span class="pol-link" data-polid="${esc(p.id)}">${esc(p.name)}</span>`).join(", ");
    const actions = (l, canEdit) => canEdit
      ? `<button class="btn sm" data-loedit="${esc(l.id)}">✎ Edit</button>
         <button class="btn sm danger" data-lodel="${esc(l.id)}">🗑 Delete</button>`
      : '<span class="mini muted">service-managed</span>';

    if (loView === "table") {
      $("loBody").innerHTML = `<div class="list-card" style="padding:0;overflow:hidden">
        <table class="plist lo-table">
          <thead><tr><th>Name</th><th>Type</th><th>Definition</th><th>Used by</th><th></th></tr></thead>
          <tbody>${rows.map((l) => {
            const { k, used, canEdit, direct, implicit } = facts(l);
            return `<tr>
              <td><b>${esc(l.displayName || "(unnamed)")}</b>${Locations.isTrusted(l) ? ' <span class="tag ok">trusted</span>' : ""}</td>
              <td class="mini">${icon(k)} ${esc(kindLabel(k))}</td>
              <td class="mini lo-d">${esc(Locations.detail(l))}</td>
              <td class="mini">${used.length ? [
                  direct.length ? `<b>${direct.length}</b> named: ${list(direct)}` : "",
                  implicit.length ? `<span class="lo-imp"><b>${implicit.length}</b> via “All trusted”: ${list(implicit)}</span>` : "",
                ].filter(Boolean).join("<br>") : '<span class="muted">not referenced</span>'}</td>
              <td class="lo-tact">${actions(l, canEdit)}</td>
            </tr>`;
          }).join("")}</tbody>
        </table></div>`;
      return;
    }

    $("loBody").innerHTML = `<div class="lo-grid">` + rows.map((l) => {
      const { k, used, canEdit, direct, implicit } = facts(l);
      return `<div class="list-card lo-card">
        <div class="lo-h">
          <span class="lo-ic">${icon(k)}</span>
          <b>${esc(l.displayName || "(unnamed)")}</b>
          ${Locations.isTrusted(l) ? '<span class="tag ok">trusted</span>' : ""}
          <span class="tag">${esc(kindLabel(k))}</span>
        </div>
        <div class="mini lo-d">${esc(Locations.detail(l))}</div>
        <div class="lo-u">${used.length ? [
            direct.length ? `Named by ${direct.length} polic${direct.length === 1 ? "y" : "ies"}: ${list(direct)}` : "",
            implicit.length ? `<span class="lo-imp">Covered by ${implicit.length} polic${implicit.length === 1 ? "y" : "ies"} using “All trusted locations”: ${list(implicit)}</span>` : "",
          ].filter(Boolean).join("<br>")
          : '<span class="mini muted">Not referenced by any policy</span>'}</div>
        <div class="lo-act">${actions(l, canEdit)}</div>
      </div>`;
    }).join("") + `</div>`;
  }
  $("loChips").addEventListener("click", (e) => { const b = e.target.closest("[data-lof]"); if (!b) return; loFilter = b.dataset.lof; renderLocations(); });
  $("loViewSeg").addEventListener("click", (e) => { const b = e.target.closest("[data-loview]"); if (!b) return; loView = b.dataset.loview; renderLocations(); });
  $("loSearch").addEventListener("input", (e) => { loQuery = e.target.value; renderLocations(); });
  $("loBody").addEventListener("click", (e) => {
    const ed = e.target.closest("[data-loedit]"); if (ed) { openLoEditor(loList.find((x) => x.id === ed.dataset.loedit)); return; }
    const dl = e.target.closest("[data-lodel]"); if (dl) { openLoDelete(loList.find((x) => x.id === dl.dataset.lodel)); return; }
    const pl = e.target.closest(".pol-link"); if (pl) showDetail(pl.dataset.polid);
  });

  // ---- editor ----
  function loSyncKind() {
    const ip = $("loKind").value === "ip";
    $("loIpFields").style.display = ip ? "" : "none";
    $("loCountryFields").style.display = ip ? "none" : "";
  }
  $("loKind").addEventListener("change", loSyncKind);
  function openLoEditor(loc) {
    loEditing = loc || null;
    const f = Locations.toForm(loc);
    $("loEditTitle").textContent = loc ? "Edit named location" : "New named location";
    $("loEditSub").innerHTML = loc
      ? `<b>${esc(loc.displayName)}</b> — the type cannot be changed after creation.`
      : "Creates a new named location in this tenant.";
    $("loKind").value = f.kind; $("loKind").disabled = !!loc;
    $("loName").value = f.name; $("loRanges").value = f.ranges; $("loTrusted").checked = f.isTrusted;
    $("loCountries").value = f.countries; $("loUnknown").checked = f.includeUnknown; $("loLookup").value = f.lookupMethod;
    loSyncKind();
    // changing isTrusted moves every policy that uses "All trusted locations"
    const at = Locations.trustedConsumers(policies.map((p) => p.raw));
    $("loEditWarn").innerHTML = (f.kind === "ip" && at.length)
      ? `<div class="mini muted">⚠ ${at.length} polic${at.length === 1 ? "y uses" : "ies use"} <b>All trusted locations</b> — changing the trusted flag changes ${at.length === 1 ? "it" : "them"} too.</div>` : "";
    $("loEditModal").classList.add("open");
  }
  $("loNew").addEventListener("click", () => openLoEditor(null));
  $("loEditCancel").addEventListener("click", () => $("loEditModal").classList.remove("open"));
  $("loEditSave").addEventListener("click", async () => {
    const form = {
      kind: $("loKind").value, name: $("loName").value, ranges: $("loRanges").value,
      isTrusted: $("loTrusted").checked, countries: $("loCountries").value,
      includeUnknown: $("loUnknown").checked, lookupMethod: $("loLookup").value,
    };
    const built = Locations.buildPayload(form);
    if (!built.ok) { $("loEditWarn").innerHTML = built.errors.map((x) => `<div class="mini" style="color:var(--off)">✗ ${esc(x)}</div>`).join(""); return; }
    if (!await preConsent([...AUTH_CONFIG.scopes, ...LO_WRITE])) return;
    const btn = $("loEditSave"); btn.disabled = true; btn.textContent = "Saving…";
    try {
      if (isDemo) {
        toast("Demo — <span>save simulated</span>");
      } else if (loEditing) {
        await Graph.gpatch(`/identity/conditionalAccess/namedLocations/${loEditing.id}`, built.payload, [...AUTH_CONFIG.scopes, ...LO_WRITE]);
        toast(`<span>${esc(built.payload.displayName)}</span> updated`);
      } else {
        await Graph.gpost("/identity/conditionalAccess/namedLocations", built.payload, [...AUTH_CONFIG.scopes, ...LO_WRITE]);
        toast(`<span>${esc(built.payload.displayName)}</span> created`);
      }
      $("loEditModal").classList.remove("open");
      await openLocations(true);
    } catch (e) {
      console.error("Save named location failed:", e);
      $("loEditWarn").innerHTML = `<div class="mini" style="color:var(--off)">✗ ${esc(e.message || e)}</div>`;
    } finally { btn.disabled = false; btn.textContent = "Save"; }
  });

  // ---- delete ----
  function openLoDelete(loc) {
    if (!loc) return;
    loDeleting = loc;
    const used = Locations.usedBy(loc, policies.map((p) => p.raw));
    $("loDelDesc").innerHTML = `<b>${esc(loc.displayName)}</b> — ${esc(Locations.detail(loc))}`;
    $("loDelRefs").innerHTML = used.length
      ? `<div class="mini" style="color:var(--off);font-weight:600;margin-bottom:6px">⚠ Still referenced by ${used.length} polic${used.length === 1 ? "y" : "ies"}:</div>
         <ul class="wi-list dim">${used.map((p) => `<li><div class="wi-pn">${esc(p.name)}</div><div class="wi-why">${esc(p.how)} · ${esc(p.state === "enabledForReportingButNotEnforced" ? "report-only" : p.state)}</div></li>`).join("")}</ul>`
      : '<p class="mini muted">Not referenced by any policy — safe to remove.</p>';
    $("loDelConfirmWrap").style.display = used.length ? "" : "none";
    $("loDelConfirm").value = "";
    $("loDelGo").disabled = used.length > 0;
    $("loDelModal").classList.add("open");
  }
  $("loDelConfirm").addEventListener("input", (e) => { $("loDelGo").disabled = e.target.value.trim().toUpperCase() !== "DELETE"; });
  $("loDelCancel").addEventListener("click", () => $("loDelModal").classList.remove("open"));
  $("loDelGo").addEventListener("click", async () => {
    if (!loDeleting) return;
    if (!await preConsent([...AUTH_CONFIG.scopes, ...LO_WRITE])) return;
    const btn = $("loDelGo"); btn.disabled = true; btn.textContent = "Deleting…";
    try {
      if (isDemo) toast("Demo — <span>delete simulated</span>");
      else {
        await Graph.gdelete(`/identity/conditionalAccess/namedLocations/${loDeleting.id}`, [...AUTH_CONFIG.scopes, ...LO_WRITE]);
        toast(`<span>${esc(loDeleting.displayName)}</span> deleted`);
      }
      $("loDelModal").classList.remove("open");
      await openLocations(true);
    } catch (e) {
      console.error("Delete named location failed:", e);
      toast(`Delete failed: <span>${esc(e.message || e)}</span>`);
    } finally { btn.disabled = false; btn.textContent = "Delete permanently"; }
  });

  $("loMd").addEventListener("click", () => {
    if (!loList) return;
    const raws = policies.map((p) => p.raw), s = Locations.summarize(loList, raws);
    const L = [`# Named locations — ${tenantName || "tenant"}`, "",
      `Generated ${new Date().toISOString().replace("T", " ").slice(0, 16)} UTC by ENCA — Conditional Access Baseline Tools (enca.limon-it.nl).`, "",
      `- Total: **${s.total}** — ${s.ip} IP (${s.ranges} ranges), ${s.country} country`,
      `- Trusted: ${s.trusted} · Not referenced by any policy: ${s.unused}`, "",
      "| Location | Type | Trusted | Detail | Used by |", "| --- | --- | --- | --- | --- |"];
    loList.slice().sort((a, b) => (a.displayName || "").localeCompare(b.displayName || "")).forEach((l) => {
      const used = Locations.usedBy(l, raws);
      const e = (v) => String(v ?? "").replace(/\|/g, "\\|");
      L.push(`| ${e(l.displayName)} | ${Locations.kindOf(l) === "ip" ? "IP ranges" : "Countries"} | ${Locations.isTrusted(l) ? "yes" : "—"} | ${e(Locations.detail(l))} | ${used.length ? used.map((p) => `${e(p.name)} (${p.how})`).join("<br>") : "—"} |`);
    });
    showReport("🌐 Named locations", "CA-NamedLocations", L.join("\n"));
  });

  // ---------- What-If (Entra Conditional Access What If tool) ----------
  let wiResult = null, wiScenario = null, wiLocations = null, wiNames = {};
  function openWhatIf() {
    crumb("🧪 What-If");
    show("screen-whatif");
    $("wiHead").innerHTML = `<h3>🧪 What-If</h3>
      <p style="margin-bottom:6px">Describe a sign-in and every <b>enabled</b> or <b>report-only</b> policy is evaluated against it — which would apply (and the controls to satisfy), and which would not, with the first condition that wasn't met.</p>
      <p class="mini muted" style="margin:0">Mirrors the <a href="https://learn.microsoft.com/entra/identity/conditional-access/what-if-tool" target="_blank" rel="noopener">Entra Conditional Access What If tool</a>. Like the Microsoft tool it does not follow Conditional Access <b>service dependencies</b>, an app <i>group</i> (Office 365) never matches — use the app itself — and a condition the scenario leaves unspecified cannot be evaluated, so that policy will not apply.</p>`;
    if (!policies.length) { $("wiBody").innerHTML = '<p class="mini">No policies loaded.</p>'; return; }
    if (wiResult) renderWhatIf();   // keep the last run when returning to the tab
  }
  $("toolWhatIf").addEventListener("click", () => { openWhatIf(); });
  $("wiApp").addEventListener("change", (e) => { $("wiAppIdWrap").style.display = e.target.value === "custom" ? "" : "none"; });
  $("wiReset").addEventListener("click", () => {
    ["wiUser", "wiIp", "wiCountry", "wiAppId"].forEach((id) => $(id).value = "");
    ["wiDevice", "wiSignInRisk", "wiUserRisk", "wiInsiderRisk", "wiFlow"].forEach((id) => $(id).value = "");
    $("wiApp").value = "00000002-0000-0ff1-ce00-000000000000"; $("wiAppIdWrap").style.display = "none";
    $("wiPlatform").value = "windows"; $("wiClient").value = "browser";
    wiResult = null; $("wiBody").innerHTML = ""; $("wiMd").style.display = "none";
  });
  // user type-ahead, same shape as the validator's
  let wiSugTimer = null;
  $("wiUser").addEventListener("input", (e) => {
    const v = e.target.value; clearTimeout(wiSugTimer);
    wiSugTimer = setTimeout(async () => {
      const t = v.trim(); if (t.length < 2 || isDemo) return;
      try {
        const f = t.replace(/'/g, "''");
        const r = await Graph.gget(`/users?$filter=startswith(displayName,'${f}') or startswith(userPrincipalName,'${f}')&$select=displayName,userPrincipalName&$top=10`);
        $("wiUserList").innerHTML = ((r && r.value) || []).map((u) => `<option value="${esc(u.userPrincipalName)}" label="${esc(u.displayName || "")}"></option>`).join("");
      } catch (err) { console.warn("what-if: suggest failed", err.message); }
    }, 250);
  });

  $("wiRun").addEventListener("click", async () => {
    const upn = $("wiUser").value.trim();
    if (!upn) { toast("Pick a <span>user</span> first"); return; }
    const btn = $("wiRun"); btn.disabled = true; btn.textContent = "Evaluating…";
    try {
      // ---- identity: resolve + memberships (groups and directory roles) ----
      let sc = { groupIds: new Set(), roleIds: new Set(), isGuest: false };
      if (isDemo) {
        sc.userId = "demo-user"; sc.userName = upn;
      } else {
        const u = await Graph.gget(`/users/${encodeURIComponent(upn)}?$select=id,displayName,userPrincipalName,userType`);
        sc.userId = u.id; sc.userName = u.displayName || u.userPrincipalName;
        sc.isGuest = (u.userType || "").toLowerCase() === "guest";
        try {
          const mem = await Graph.ggetAll(`/users/${u.id}/transitiveMemberOf?$select=id,roleTemplateId`);
          mem.forEach((o) => {
            const ty = (o["@odata.type"] || "").toLowerCase();
            if (ty.includes("directoryrole")) { if (o.roleTemplateId) sc.roleIds.add(o.roleTemplateId); }
            else sc.groupIds.add(o.id);
          });
          wiNames = {};
          mem.forEach((o) => { if (o.displayName) wiNames[o.id] = o.displayName; });
        } catch (e) { console.warn("what-if: membership lookup failed", e.message); }
      }
      // ---- target resource ----
      const appSel = $("wiApp").value;
      if (appSel.startsWith("action:")) { sc.userAction = appSel.slice(7); sc.appName = "User action"; }
      else if (appSel === "custom") { sc.appId = $("wiAppId").value.trim(); sc.appName = sc.appId || "(App ID)"; }
      else { sc.appId = appSel; sc.appName = $("wiApp").selectedOptions[0].textContent; }
      if (!sc.userAction && !sc.appId) { toast("Enter an <span>App ID</span>"); return; }
      // ---- the rest of the sign-in ----
      sc.platform = $("wiPlatform").value;
      sc.clientApp = $("wiClient").value;
      sc.ip = $("wiIp").value.trim() || null;
      sc.country = $("wiCountry").value.trim().toUpperCase() || null;
      sc.deviceState = $("wiDevice").value || null;
      sc.signInRisk = $("wiSignInRisk").value || null;
      sc.userRisk = $("wiUserRisk").value || null;
      sc.insiderRisk = $("wiInsiderRisk").value || null;
      sc.authFlow = $("wiFlow").value || null;
      // ---- named locations (once) ----
      if (!wiLocations) {
        try { wiLocations = isDemo ? [] : await Graph.ggetAll("/identity/conditionalAccess/namedLocations"); }
        catch (e) { wiLocations = []; console.warn("what-if: named locations failed", e.message); }
      }
      // group names for the "excluded via …" reasons
      try {
        const gids = [...sc.groupIds].filter((x) => !wiNames[x]);
        for (let i = 0; i < gids.length && !isDemo; i += 1000) {
          const j = await Graph.gpost("/directoryObjects/getByIds", { ids: gids.slice(i, i + 1000), types: ["group"] });
          (j.value || []).forEach((o) => wiNames[o.id] = o.displayName || o.id);
        }
      } catch (e) { /* names are cosmetic */ }
      wiScenario = sc;
      wiResult = WhatIfEval.evaluate(policies.map((p) => p.raw), sc, { namedLocations: wiLocations, names: wiNames });
      renderWhatIf();
    } catch (e) {
      console.error("What-If failed:", e);
      toast(`What-If: <span>${esc(e.message || e)}</span>`);
    } finally { btn.disabled = false; btn.textContent = "▶ What If"; }
  });

  const WI_GRANT_LABEL = { block: "Block access", mfa: "Require MFA", compliantDevice: "Require compliant device",
    domainJoinedDevice: "Require hybrid Entra joined device", approvedApplication: "Require approved client app",
    compliantApplication: "Require app protection policy", passwordChange: "Require password change",
    unknownFutureValue: "unknown" };
  const wiCtrl = (c) => c.startsWith("authenticationStrength:") ? "Authentication strength: " + c.slice(23)
    : c.startsWith("termsOfUse:") ? "Terms of use: " + c.slice(11) : (WI_GRANT_LABEL[c] || c);

  function renderWhatIf() {
    const r = wiResult, sc = wiScenario;
    if (!r) return;
    $("wiMd").style.display = "";
    const scLine = [`${esc(sc.userName || "")}`, esc(sc.appName || ""), WhatIfEval.LABEL[sc.platform] || sc.platform,
      WhatIfEval.LABEL[sc.clientApp] || sc.clientApp, sc.ip ? `IP ${esc(sc.ip)}` : "", sc.country ? `country ${esc(sc.country)}` : "",
      sc.deviceState ? WhatIfEval.LABEL[sc.deviceState] : "", sc.signInRisk ? `sign-in risk ${sc.signInRisk}` : "",
      sc.userRisk ? `user risk ${sc.userRisk}` : "", sc.authFlow ? esc(sc.authFlow) : ""].filter(Boolean).join(" · ");

    const allControls = [...new Set(r.applied.flatMap((p) => p.grant || []))];
    const verdict = r.blocked
      ? `<div class="wi-verdict block">⛔ Access would be <b>blocked</b></div>`
      : allControls.length
        ? `<div class="wi-verdict grant">✅ Access granted after satisfying: <b>${esc(allControls.map(wiCtrl).join(", "))}</b></div>`
        : `<div class="wi-verdict none">✅ No grant control required by any applying policy</div>`;

    const applied = r.applied.length ? r.applied.map((p) => `<li>
        <div class="wi-pn"><span class="pol-link" data-polid="${esc(p.id)}">${esc(p.name)}</span>${p.state === "enabledForReportingButNotEnforced" ? ' <span class="tag">report-only</span>' : ""}</div>
        <div class="wi-ctrls">
          ${(p.grant || []).length ? `<span class="wi-g">Grant: ${esc((p.grant || []).map(wiCtrl).join(p.operator === "OR" ? " or " : " and "))}</span>` : ""}
          ${(p.session || []).length ? `<span class="wi-s">Session: ${esc((p.session || []).join(" · "))}</span>` : ""}
          ${!(p.grant || []).length && !(p.session || []).length ? '<span class="mini muted">no controls</span>' : ""}
          ${(p.warnings || []).length ? `<span class="wi-w">⚠ ${esc(p.warnings.join("; "))}</span>` : ""}
        </div></li>`).join("") : '<li class="mini muted">No policy applies to this sign-in.</li>';

    const notApplied = r.notApplied.map((p) => `<li>
        <div class="wi-pn"><span class="pol-link" data-polid="${esc(p.id)}">${esc(p.name)}</span></div>
        <div class="wi-why">${esc(p.reason)}</div></li>`).join("");

    $("wiBody").innerHTML = `
      <div class="list-card wi-res">
        ${verdict}
        <p class="mini muted" style="margin:8px 0 0">${scLine}</p>
      </div>
      <div class="list-card wi-res">
        <h4 class="wi-h">Policies that apply <span class="mini muted">${r.applied.length}</span></h4>
        <ul class="wi-list">${applied}</ul>
      </div>
      <div class="list-card wi-res">
        <h4 class="wi-h">Policies that do not apply <span class="mini muted">${r.notApplied.length}</span></h4>
        <ul class="wi-list dim">${notApplied || '<li class="mini muted">None — every evaluated policy applies.</li>'}</ul>
      </div>
      ${r.notEvaluated.length ? `<p class="mini muted" style="margin-top:10px">Not evaluated (Off): ${r.notEvaluated.map((p) => esc(p.name)).join(", ")}</p>` : ""}`;
  }
  $("wiBody").addEventListener("click", (e) => {
    const pl = e.target.closest(".pol-link"); if (pl) showDetail(pl.dataset.polid);
  });
  $("wiMd").addEventListener("click", () => {
    const r = wiResult, sc = wiScenario; if (!r) return;
    const L = [`# Conditional Access What-If — ${tenantName || "tenant"}`, "",
      `Generated ${new Date().toISOString().replace("T", " ").slice(0, 16)} UTC by ENCA — Conditional Access Baseline Tools (enca.limon-it.nl).`, "",
      "## Sign-in simulated", "",
      `- User: **${sc.userName}**`, `- Target resource: **${sc.appName}**`,
      `- Device platform: ${sc.platform} · Client app: ${sc.clientApp}`,
      `- IP: ${sc.ip || "—"} · Country: ${sc.country || "—"} · Device state: ${sc.deviceState || "not specified"}`,
      `- Sign-in risk: ${sc.signInRisk || "not specified"} · User risk: ${sc.userRisk || "not specified"}`, "",
      `**Result:** ${r.blocked ? "access would be BLOCKED" : "access granted after satisfying the controls below"}`, "",
      `## Policies that apply (${r.applied.length})`, ""];
    r.applied.forEach((p) => L.push(`- **${p.name}**${p.state === "enabledForReportingButNotEnforced" ? " *(report-only)*" : ""} — grant: ${(p.grant || []).map(wiCtrl).join(", ") || "none"}${(p.session || []).length ? `; session: ${p.session.join(" · ")}` : ""}`));
    L.push("", `## Policies that do not apply (${r.notApplied.length})`, "");
    r.notApplied.forEach((p) => L.push(`- ${p.name} — ${p.reason}`));
    if (r.notEvaluated.length) { L.push("", `## Not evaluated (Off)`, ""); r.notEvaluated.forEach((p) => L.push(`- ${p.name}`)); }
    showReport("🧪 What-If report", "CA-WhatIf", L.join("\n"));
  });

  // ---------- MS Learn documented exclusion checks ----------
  let mlGroups = null, mlFilter = "all", mlStrengths = new Map(), mlFixes = null, mlTab = "findings";
  const mlExpanded = new Set();
  async function openMsLearn() {
    show("screen-mslearn");
    if (!policies.length) { $("mlHead").innerHTML = '<p class="mini">No policies loaded.</p>'; $("mlBody").innerHTML = ""; $("mlChips").innerHTML = ""; return; }
    $("mlHead").innerHTML = '<h3>📘 MS Learn: documented exclusion checks</h3><p class="mini" style="margin:6px 0 0">Running checks…</p>';
    $("mlChips").innerHTML = ""; $("mlBody").innerHTML = "";
    mlTab = "findings"; mlFixes = null;
    // baseline tenant → include Off + persona-only; note the scope
    const baseline = isBaselineTenant();
    $("mlDisabled").checked = baseline;
    $("mlDisabled").disabled = baseline;
    $("mlDisabledNote").textContent = scopeNote(checkScope(baseline), policies.filter(p => p.raw.state === "disabled").length);
    // authentication strengths are needed to detect external authentication
    // methods (EAM) inside strength policies — one read, Policy.Read.All
    mlStrengths = new Map();
    try {
      if (isDemo) {
        Object.entries(DEMO_DATA.depSettings || {}).forEach(([k, v]) => { if (k.startsWith("authStrength:")) mlStrengths.set(v.id, v); });
      } else {
        (await Graph.ggetAll("/policies/authenticationStrengthPolicies")).forEach(s => mlStrengths.set(s.id, s));
      }
    } catch (e) { console.warn("Auth strength fetch failed (EAM check limited):", e.message); }
    await runMsLearn();
  }
  // Resolve a group by the baseline naming convention — the first name that
  // actually exists in the tenant wins. Returns null when none exist, which
  // makes the dependent fixes decline rather than invent an exclusion.
  async function findGroupByConvention(names) {
    for (const name of names) {
      try {
        if (isDemo) {
          if (DEMO_DATA.scopeGroups && DEMO_DATA.scopeGroups[name]) return { id: name, name };
          continue;
        }
        const j = await Graph.gget(`/groups?$filter=displayName eq '${encodeURIComponent(name).replace(/'/g, "''")}'&$select=id,displayName&$top=1`);
        const g = (j.value || [])[0];
        if (g) return { id: g.id, name: g.displayName };
      } catch (e) { console.warn(`Group lookup failed for ${name}:`, e.message); }
    }
    return null;
  }

  async function runMsLearn() {
    const scope = checkScope($("mlDisabled").checked);
    const findings = MSLearn.run(scope.raws, mlStrengths, { includeDisabled: scope.includeDisabled });
    mlGroups = MSLearn.group(findings);
    mlFilter = "all"; mlExpanded.clear();
    renderMsLearn();                       // show the findings before the lookups

    // Fixes that add an exclusion need a real group. The baseline names them
    // predictably (break-glass is always CAB-SEC-U-BreakGlass), so resolve by
    // convention; only if that fails fall back to the detected break-glass.
    const ctx = {};
    ctx.breakGlass = await findGroupByConvention(MSLearn.CONVENTION.breakGlass);
    if (ctx.breakGlass) ctx.breakGlass.type = "group";
    else {
      try {
        const c = GapCheck.identifyBreakGlass(scope.raws);
        if (c) ctx.breakGlass = { id: c.id, type: c.type, name: policies.find(p => p.id === c.id)?.name || `ID ${c.id.slice(0, 8)}…` };
      } catch { /* GapCheck optional */ }
    }
    ctx.sharedDevices = await findGroupByConvention(MSLearn.CONVENTION.sharedDevices);

    mlFixes = MSLearn.buildFixes(findings, scope.raws, ctx);
    // A policy cannot reference a service principal the tenant does not have.
    // Resolve every app our fixes touch and drop the ones that do not exist —
    // otherwise Graph rejects the create with an unhelpful 400.
    if (!isDemo) {
      try {
        const ids = MSLearn.referencedAppIds(mlFixes);
        if (ids.length) MSLearn.markUnknownApps(mlFixes, await Graph.existingAppIds(ids));
      } catch (e) { console.warn("App reference check failed:", e.message); }
    }
    renderMsLearn();
  }
  $("mlDisabled").addEventListener("change", () => { runMsLearn(); });
  function renderMsLearn() {
    if (!mlGroups) return;
    const incDis = $("mlDisabled").checked;
    const nFix = mlFixes ? mlFixes.fixes.length : 0;
    $("mlTabFixes").textContent = nFix ? `Suggested fixes (${nFix})` : "Suggested fixes";
    $("mlTabFindings").classList.toggle("active", mlTab === "findings");
    $("mlTabFixes").classList.toggle("active", mlTab === "fixes");
    $("mlHead").innerHTML = MSLearn.renderSummary(mlGroups, MSLearn.checksCount, incDis);

    if (mlTab === "fixes") {
      $("mlChips").innerHTML = "";
      $("mlFixZip").style.display = nFix ? "" : "none";
      // writing back is offered only in a recognised baseline tenant
      $("mlApply").style.display = nFix && isBaselineTenant() && !isDemo ? "" : "none";
      $("mlBody").innerHTML = MSLearn.renderFixes(mlFixes || { fixes: [], skipped: [] });
      return;
    }
    $("mlFixZip").style.display = "none";
    $("mlApply").style.display = "none";
    if (!mlGroups.length) {
      $("mlChips").innerHTML = "";
      $("mlBody").innerHTML = MSLearn.renderEmpty();
      return;
    }
    const count = (s) => s === "all" ? mlGroups.length : mlGroups.filter(g => g.check.severity === s).length;
    $("mlChips").innerHTML = [["all", "All"], ["critical", "Critical"], ["high", "High"], ["medium", "Medium"], ["info", "Info"]]
      .filter(([k]) => count(k) > 0 || k === "all")
      .map(([k, l]) => `<button class="fchip ${mlFilter === k ? "active" : ""}" data-mlf="${k}">${l} (${count(k)})</button>`).join("");
    $("mlBody").innerHTML = MSLearn.renderGroups(mlGroups, mlFilter, mlExpanded);
  }
  $("mlTabFindings").addEventListener("click", () => { mlTab = "findings"; renderMsLearn(); });
  $("mlTabFixes").addEventListener("click", () => { mlTab = "fixes"; renderMsLearn(); });
  // Refresh: re-read the tenant, then re-run the MS Learn checks.
  $("mlRefresh").addEventListener("click", async () => {
    const btn = $("mlRefresh"); btn.disabled = true; btn.textContent = "⟳ Refreshing…";
    try {
      if (isDemo) loadDemo(); else await loadFromGraph(true);
      await openMsLearn();
      toast("MS Learn checks <span>refreshed</span>");
    } catch (e) { toast(`Refresh failed: <span>${esc(e.message || e)}</span>`); }
    finally { btn.disabled = false; btn.textContent = "⟳ Refresh"; }
  });

  // Create a missing convention group (e.g. CAB-SEC-U-SharedDevices) so the
  // dependent fixes stop declining. Role-assignable security group, empty —
  // the resource accounts are added by the operator afterwards.
  $("mlBody").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-mkgroup]"); if (!b) return;
    const key = b.dataset.mkgroup;
    const name = MSLearn.CONVENTION[key][0];
    if (isDemo) { toast("Demo mode — <span>no group created</span>"); return; }
    b.disabled = true; b.textContent = `Creating ${name}…`;
    try {
      const g = await Graph.gpostGroupCreate("/groups", {
        displayName: name,
        mailNickname: name.replace(/[^\w-]+/g, ""),
        description: MSLearn.GROUP_PURPOSE[key] || "Created by ENCA — Conditional Access Baseline Tools",
        securityEnabled: true, mailEnabled: false, isAssignableToRole: true,
      });
      toast(`Role-assignable group <span>${esc(g.displayName || name)}</span> created — add the resource accounts, then re-run the fixes`);
      await runMsLearn();
    } catch (err) {
      b.disabled = false; b.innerHTML = `➕ Create ${esc(name)} <span class="tag block">writes</span>`;
      toast(`Could not create ${esc(name)}: <span>${esc(err.message || err)}</span>`);
    }
  });

  // a finding card's Fix button jumps to the generated policy
  $("mlBody").addEventListener("click", (e) => {
    if (e.target.closest("[data-mlfix]")) { mlTab = "fixes"; renderMsLearn(); return; }
    const dl = e.target.closest("[data-fxjson]");
    if (!dl || !mlFixes) return;
    const f = mlFixes.fixes[+dl.dataset.fxjson]; if (!f) return;
    downloadText(safeFile(f.newName), "json", "application/json", f.json);
    toast(`<span>${esc(f.newName)}</span> downloaded`);
  });
  const safeFile = (n) => String(n).replace(/[^\w.\- ]+/g, "").trim().replace(/\s+/g, "-").slice(0, 80) || "policy";

  // ---------- apply the suggested fixes in the tenant (baseline tenants) ----------
  // Create-then-delete, per policy: the replacement must exist before the
  // original goes, so a failure never leaves the control missing entirely.
  // Everything lands Off, and the confirmation lists every create and delete.
  const ML_WRITE = ["Policy.ReadWrite.ConditionalAccess"];
  function openApplyModal() {
    if (!mlFixes || !mlFixes.fixes.length) return;
    const n = mlFixes.fixes.length;
    $("mlApplyTenant").textContent = tenantName || "this tenant";
    $("mlApplyDesc").innerHTML = `${n} new polic${n === 1 ? "y" : "ies"} will be created <b>Off (disabled)</b>, `
      + "each replacing the policy it was built from. Nothing is switched on — review and enable them yourself afterwards.";
    const miss = mlFixes.missingApps || [];
    $("mlApplyList").innerHTML = (miss.length ? `<div class="ml-apply-row">
        <div><span class="ml-op create">CREATE</span> ${miss.length} Microsoft service principal${miss.length === 1 ? "" : "s"} — required before the policies can reference them</div>
        <div class="mini">${miss.map((m) => `${esc(m.label)} (${esc(m.appId)})`).join(" · ")}</div>
      </div>` : "") + mlFixes.fixes.map((f) => `<div class="ml-apply-row">
        <div><span class="ml-op create">CREATE</span> ${esc(f.newName)} <span class="mini">· Off</span></div>
        <div><span class="ml-op delete">DELETE</span> ${esc(f.originalName)} <span class="mini">· currently ${esc(f.originalState)}</span></div>
        <div class="mini">${f.changes.length} adjustment${f.changes.length === 1 ? "" : "s"}: ${esc(f.changes.join("; "))}</div>
      </div>`).join("");
    $("mlApplyResult").style.display = "none"; $("mlApplyResult").innerHTML = "";
    $("mlApplyOk").checked = false; $("mlApplyDelete").checked = true;
    $("mlApplyGo").disabled = true; $("mlApplyGo").textContent = "Apply";
    $("mlApplyModal").classList.add("open");
  }
  $("mlApply").addEventListener("click", openApplyModal);
  $("mlApplyCancel").addEventListener("click", () => $("mlApplyModal").classList.remove("open"));
  $("mlApplyOk").addEventListener("change", (e) => { $("mlApplyGo").disabled = !e.target.checked; });
  $("mlApplyDelete").addEventListener("change", () => {
    const del = $("mlApplyDelete").checked;
    $("mlApplyModal").querySelectorAll(".ml-op.delete").forEach((el) => el.classList.toggle("skip", !del));
  });
  $("mlApplyGo").addEventListener("click", async () => {
    if (!mlFixes || !$("mlApplyOk").checked) return;
    const del = $("mlApplyDelete").checked;
    // Applying fixes may also have to create service principals, so both write
    // scopes are consented here rather than deep inside the loop.
    if (!await preConsent([...AUTH_CONFIG.scopes, "Policy.ReadWrite.ConditionalAccess", "Application.ReadWrite.All"])) return;
    const btn = $("mlApplyGo"); btn.disabled = true;
    const out = $("mlApplyResult"); out.style.display = ""; out.innerHTML = "";
    const log = (cls, msg) => { out.insertAdjacentHTML("beforeend", `<div class="ml-apply-row ${cls}">${msg}</div>`); out.scrollTop = out.scrollHeight; };
    let created = 0, deleted = 0, failed = 0;
    const results = [];
    // Step 0: instantiate the Microsoft apps the fixes reference. A policy that
    // names an app with no service principal is rejected outright, so this has
    // to happen before any policy is written.
    const spCreated = [], spFailed = [];
    for (const m of (mlFixes.missingApps || [])) {
      btn.textContent = "Creating service principals…";
      try {
        const sp = await Graph.createServicePrincipal(m.appId);
        spCreated.push({ ...m, name: sp.displayName || m.label });
        log("ok", `✓ Created service principal <b>${esc(sp.displayName || m.label)}</b> (${esc(m.appId)})`);
      } catch (e) {
        spFailed.push({ ...m, error: e.message || String(e) });
        log("bad", `✗ Could not create the service principal for <b>${esc(m.label)}</b> (${esc(m.appId)}): ${esc(e.message || e)} — that app reference will be dropped.`);
      }
    }
    // whatever could not be created must come out of the drafts
    if (spFailed.length) MSLearn.dropApps(mlFixes, spFailed.map((x) => x.appId));
    for (const f of mlFixes.fixes) {
      const rec = { fix: f, created: false, deleted: false, error: null, deleteError: null };
      results.push(rec);
      btn.textContent = `Applying ${created + failed + 1}/${mlFixes.fixes.length}…`;
      try {
        // Entra rejects some payloads without saying why; try the full policy
        // first, then progressively simpler variants, so one awkward property
        // does not cost the whole fix.
        const variants = MSLearn.createVariants(f);
        let res = null, lastErr = null;
        for (let vi = 0; vi < variants.length; vi++) {
          try {
            res = await Graph.gpost("/identity/conditionalAccess/policies", JSON.parse(variants[vi].json), [...AUTH_CONFIG.scopes, ...ML_WRITE]);
            if (vi > 0) {
              rec.variantNote = variants[vi].note;
              f.changes.push(variants[vi].note);
              log("ok", `↻ ${esc(variants[vi].note)}`);
            }
            break;
          } catch (err) { lastErr = err; res = null; }
        }
        if (!res) throw lastErr;
        created++; rec.created = true; rec.createdId = res && res.id;
        log("ok", `✓ Created <b>${esc(f.newName)}</b> (Off)`);
        if (del) {
          try {
            await Graph.gdelete(`/identity/conditionalAccess/policies/${f.policyId}`, [...AUTH_CONFIG.scopes, ...ML_WRITE]);
            deleted++; rec.deleted = true;
            log("ok", `✓ Deleted <b>${esc(f.originalName)}</b>`);
          } catch (e) {
            failed++; rec.deleteError = e.message || String(e);
            log("bad", `✗ Created the replacement but could NOT delete <b>${esc(f.originalName)}</b>: ${esc(e.message || e)} — both policies now exist, remove the old one manually.`);
          }
        }
        if (res && res.id) f.createdId = res.id;
      } catch (e) {
        failed++; rec.error = e.message || String(e);
        log("bad", `✗ Failed to create <b>${esc(f.newName)}</b>: ${esc(e.message || e)} — <b>${esc(f.originalName)}</b> was left untouched.`);
      }
    }
    btn.textContent = "Done";
    log("", `<b>${created}</b> created · <b>${deleted}</b> deleted · <b>${failed}</b> failed. Reloading policies…`);
    const mlMd = applyReport(results, { created, deleted, failed, del, spCreated, spFailed });
    toast(`${created} polic${created === 1 ? "y" : "ies"} created${deleted ? `, ${deleted} removed` : ""}`);
    try { await loadFromGraph(true); } catch { /* surfaced by loadFromGraph */ }
    show("screen-mslearn");
    await openMsLearn();
    showReport("📘 MS Learn fixes applied", "CA-MSLearn-Applied", mlMd);
  });

  // Markdown record of what the apply actually did — one row per policy, the
  // adjustments that were written, and every failure with its Graph message.
  function applyReport(results, sum) {
    const e = (v) => String(v ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
    const L = [];
    L.push(`# MS Learn fixes applied — ${e(tenantName || "tenant")}`);
    L.push("");
    L.push(`Applied ${new Date().toISOString().replace("T", " ").slice(0, 16)} UTC by ENCA — Conditional Access Baseline Tools (enca.limon-it.nl).`);
    L.push("");
    L.push(`- Created: **${sum.created}** (all in the **Off / disabled** state)`);
    L.push(`- Deleted: **${sum.deleted}**${sum.del ? "" : " — the originals were kept on purpose"}`);
    L.push(`- Failed: **${sum.failed}**`);
    if ((sum.spCreated || []).length) L.push(`- Service principals created: **${sum.spCreated.length}**`);
    if ((sum.spFailed || []).length) L.push(`- Service principals that could NOT be created: **${sum.spFailed.length}**`);
    L.push("");
    if ((sum.spCreated || []).length) {
      L.push("## Service principals created");
      L.push("");
      L.push("These Microsoft first-party apps had no service principal in the tenant, so the policies could not reference them.");
      L.push("Creating one only materialises the object — no permissions are consented.");
      L.push("");
      sum.spCreated.forEach((m) => L.push(`- ${e(m.name || m.label)} — \`${e(m.appId)}\``));
      L.push("");
    }
    if ((sum.spFailed || []).length) {
      L.push("## Service principals that could not be created");
      L.push("");
      sum.spFailed.forEach((m) => L.push(`- ${e(m.label)} (\`${e(m.appId)}\`) — ${e(m.error)}. The reference was dropped from the policies that wanted it.`));
      L.push("");
    }
    L.push("| Result | New policy | Replaced | Adjustments |");
    L.push("| --- | --- | --- | --- |");
    for (const r of results) {
      const result = r.error ? "❌ create failed"
        : r.deleteError ? "⚠ created, delete failed"
        : r.deleted ? "✅ created + original deleted"
        : "✅ created (original kept)";
      L.push(`| ${result} | ${e(r.fix.newName)} | ${e(r.fix.originalName)} | ${r.fix.changes.length} |`);
    }
    L.push("");

    const done = results.filter((r) => r.created);
    if (done.length) {
      L.push("## What changed, policy by policy");
      L.push("");
      for (const r of done) {
        L.push(`### ${e(r.fix.newName)}`);
        L.push("");
        L.push(`Built from **${e(r.fix.originalName)}** (was ${e(r.fix.originalState)}), created **Off**.`);
        L.push(r.deleted ? "The original policy was deleted." : r.deleteError
          ? `⚠ The original could NOT be deleted: ${e(r.deleteError)} — both policies exist, remove the old one manually.`
          : "The original policy was kept.");
        L.push("");
        r.fix.changes.forEach((c) => L.push(`- ${e(c)}`));
        L.push("");
        L.push(`Based on: ${e(r.fix.checks.map((c) => c.title).join("; "))}`);
        L.push("");
      }
    }

    const bad = results.filter((r) => r.error);
    if (bad.length) {
      L.push("## Failures");
      L.push("");
      for (const r of bad) {
        L.push(`### ${e(r.fix.newName)}`);
        L.push("");
        L.push(`${e(r.error)}`);
        L.push("");
        L.push(`\`${e(r.fix.originalName)}\` was left untouched.`);
        L.push("");
        if (r.fix.changes.length) {
          L.push("The adjustments it was trying to write:");
          L.push("");
          r.fix.changes.forEach((c) => L.push(`- ${e(c)}`));
          L.push("");
        }
        // the payload is what a support case or a manual retry actually needs
        L.push("<details><summary>Policy JSON that was rejected</summary>");
        L.push("");
        L.push("```json");
        L.push(r.fix.json);
        L.push("```");
        L.push("");
        L.push("</details>");
        L.push("");
      }
    }
    L.push("---");
    L.push("");
    L.push("Every created policy is disabled. Review it, switch it to report-only, check the sign-in impact, then enable.");
    return L.join("\n");
  }

  // all generated policies in one zip, alongside a README describing them
  $("mlFixZip").addEventListener("click", async () => {
    if (!mlFixes || !mlFixes.fixes.length) return;
    const btn = $("mlFixZip"); btn.disabled = true;
    try {
      const zip = new JSZip();
      const folder = zip.folder("SuggestedPolicies");
      const lines = ["# MS Learn suggested policies", "",
        `Generated ${new Date().toISOString().replace("T", " ").slice(0, 16)} UTC from ${tenantName || "the connected tenant"}.`, "",
        "Every file is a NEW Conditional Access policy built from an existing one with the",
        "documented Microsoft Learn adjustment applied. The version in the name is bumped and",
        "the state is **disabled** — nothing was changed in the tenant. Review, then bring them",
        "in through the Import tool and enable deliberately.", ""];
      for (const f of mlFixes.fixes) {
        folder.file(`${safeFile(f.newName)}.json`, f.json);
        lines.push(`## ${f.newName}`, "", `From: ${f.originalName} (state: ${f.originalState})`, "");
        f.changes.forEach((c) => lines.push(`- ${c}`));
        lines.push("", `Based on: ${f.checks.map((c) => c.title).join("; ")}`, "");
      }
      zip.file("README.md", lines.join("\n"));
      const blob = await zip.generateAsync({ type: "blob" });
      const d = new Date(), pad = (n) => String(n).padStart(2, "0");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `CA-SuggestedFixes-${(tenantName || "tenant").replace(/[^\w-]+/g, "-")}-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      toast(`${mlFixes.fixes.length} suggested polic${mlFixes.fixes.length === 1 ? "y" : "ies"} <span>downloaded</span>`);
    } catch (err) {
      toast(`Zip failed: <span>${esc(err.message || err)}</span>`);
    } finally { btn.disabled = false; }
  });
  $("mlChips").addEventListener("click", (e) => {
    const b = e.target.closest("[data-mlf]"); if (!b) return;
    mlFilter = b.dataset.mlf; renderMsLearn();
  });
  $("mlBody").addEventListener("click", (e) => {
    const pl = e.target.closest(".pol-link");
    if (pl) { showDetail(pl.dataset.polid); return; }
    const t = e.target.closest("[data-mltoggle]"); if (!t) return;
    const id = t.dataset.mltoggle;
    mlExpanded.has(id) ? mlExpanded.delete(id) : mlExpanded.add(id);
    renderMsLearn();
  });

  // ---------- gap analysis (best-practice & bypass checks) ----------
  let gcResult = null, gcFilter = "all", gcCtx = null, gcMeta = null;
  const gcExpanded = new Set();
  function openGapCheck() {
    show("screen-gapcheck");
    if (!policies.length) { $("gcHead").innerHTML = '<p class="mini">No policies loaded.</p>'; $("gcMatrix").innerHTML = ""; $("gcChips").innerHTML = ""; $("gcBody").innerHTML = ""; return; }
    if (gcResult) { renderGapCheck(); return; }   // cached — keep the previous screen
    // idle — wait for the user to start the checks
    $("gcHead").innerHTML = '<h3>🛡 Best-practice &amp; bypass checks</h3><p class="mini" style="margin:6px 0 0">Check the baseline against known Conditional Access bypasses and the Swiss-cheese model — MFA coverage, break-glass, known bypass apps, and a persona × control matrix.</p>';
    $("gcMatrix").innerHTML = ""; $("gcChips").innerHTML = "";
    $("gcBody").innerHTML = '<div class="run-prompt"><button class="btn primary" data-gcrun>▶ Run checks</button><p class="mini muted">Reads authentication strengths and named locations via Microsoft Graph. Results stay until you refresh.</p></div>';
  }
  async function runGapCheckScan() {
    show("screen-gapcheck");
    if (!policies.length) return;
    $("gcHead").innerHTML = '<h3>🛡 Best-practice &amp; bypass checks</h3><p class="mini" style="margin:6px 0 0">Running checks…</p>';
    $("gcMatrix").innerHTML = ""; $("gcChips").innerHTML = ""; $("gcBody").innerHTML = "";
    // baseline tenant → include Off + persona-only; note the scope
    const baseline = isBaselineTenant();
    $("gcDisabled").checked = baseline;
    $("gcDisabled").disabled = baseline;
    $("gcDisabledNote").textContent = scopeNote(checkScope(baseline), policies.filter(p => p.raw.state === "disabled").length);
    const raws = policies.map(p => p.raw);
    // context: auth strengths (phishing-resistant detection), named locations
    // (trusted-network detection), break-glass display name — all Policy.Read.All
    gcCtx = { strengths: new Map(), namedLocations: [], names: {} };
    try {
      if (isDemo) {
        Object.entries(DEMO_DATA.depSettings || {}).forEach(([k, v]) => { if (k.startsWith("authStrength:")) gcCtx.strengths.set(v.id, v); });
        gcCtx.names = DEMO_DATA.names || {};
      } else {
        const [strengths, locations] = await Promise.all([
          Graph.ggetAll("/policies/authenticationStrengthPolicies").catch(() => []),
          Graph.ggetAll("/identity/conditionalAccess/namedLocations").catch(() => []),
        ]);
        strengths.forEach(s => gcCtx.strengths.set(s.id, s));
        gcCtx.namedLocations = locations;
        const bg = GapCheck.identifyBreakGlass(raws);
        if (bg) {
          try {
            const j = await Graph.gpost("/directoryObjects/getByIds", { ids: [bg.id], types: ["user", "group"] });
            (j.value || []).forEach(o => gcCtx.names[o.id] = o.displayName);
          } catch (e) { console.warn("Break-glass name lookup failed:", e.message); }
        }
      }
    } catch (e) { console.warn("Best-practice checks context fetch failed:", e.message); }
    runGapCheck();
  }
  function runGapCheck() {
    const scope = checkScope($("gcDisabled").checked);
    gcResult = GapCheck.run(scope.raws, gcCtx, { includeDisabled: scope.includeDisabled });
    gcMeta = { tenantName, policyCount: scope.raws.length, includeDisabled: scope.includeDisabled, skipped: scope.skipped };
    gcFilter = "all"; gcExpanded.clear();
    renderGapCheck();
  }
  // Refresh: pull the policies again from Entra, then re-run every gap check.
  $("gcRefresh").addEventListener("click", async () => {
    const btn = $("gcRefresh");
    btn.disabled = true; btn.textContent = "⟳ Refreshing…";
    try {
      if (isDemo) loadDemo(); else await loadFromGraph(true);
      gcCtx = null;
      await runGapCheckScan();
      toast("Best-practice &amp; bypass checks <span>refreshed</span>");
    } catch (e) {
      toast(`Refresh failed: <span>${esc(e.message || e)}</span>`);
    } finally {
      btn.disabled = false; btn.textContent = "⟳ Refresh";
    }
  });
  $("gcMd").addEventListener("click", () => {
    if (!gcResult) return;
    showReport("🛡 Best-practice & bypass checks", "CA-BestPractice-Checks", GapCheck.toMd(gcResult, gcMeta || { tenantName }));
    toast("Best-practice checks Markdown <span>downloaded</span>");
  });
  $("gcDisabled").addEventListener("change", runGapCheck);
  function renderGapCheck() {
    if (!gcResult) return;
    $("gcHead").innerHTML = GapCheck.renderSummary(gcResult);
    $("gcMatrix").innerHTML = GapCheck.renderPersonaMatrix(gcResult.personas);
    $("gcFull").style.display = gcResult.personas.length ? "" : "none";
    const n = (s) => s === "all" ? gcResult.findings.length : gcResult.findings.filter(f => f.severity === s).length;
    $("gcChips").innerHTML = [["all", "All"], ["critical", "Critical"], ["high", "High"], ["medium", "Medium"], ["low", "Low"], ["info", "Info"]]
      .filter(([k]) => n(k) > 0 || k === "all")
      .map(([k, l]) => `<button class="fchip ${gcFilter === k ? "active" : ""}" data-gcf="${k}">${l} (${n(k)})</button>`).join("");
    $("gcBody").innerHTML = GapCheck.renderFindings(gcResult, gcFilter, gcExpanded);
  }
  $("gcChips").addEventListener("click", (e) => {
    const b = e.target.closest("[data-gcf]"); if (!b) return;
    gcFilter = b.dataset.gcf; renderGapCheck();
  });
  $("gcBody").addEventListener("click", (e) => {
    if (e.target.closest("[data-gcrun]")) { runGapCheckScan(); return; }
    const pl = e.target.closest(".pol-link");
    if (pl) { showDetail(pl.dataset.polid); return; }
    const t = e.target.closest("[data-gctoggle]"); if (!t) return;
    const id = t.dataset.gctoggle;
    gcExpanded.has(id) ? gcExpanded.delete(id) : gcExpanded.add(id);
    renderGapCheck();
  });

  // ---------- events ----------
  $("signInBtn").addEventListener("click", async () => {
    if (AUTH_CONFIG.clientId.startsWith("00000000")) {
      alert("No clientId configured yet in js/authConfig.js — see README.md step 1.\nUse the demo link below to preview the app.");
      return;
    }
    const btn = $("signInBtn"); btn.disabled = true;
    try {
      await Graph.signIn();
      await loadFromGraph();
    } catch (e) {
      const code = e.errorCode || e.name || "";
      if (code === "user_cancelled") return;               // user closed the popup
      console.error("Sign-in failed:", e);
      const msg = e.errorMessage || e.message || String(e);
      if (code === "popup_window_error" || /popup/i.test(msg)) {
        alert("The sign-in popup was blocked by the browser. Allow popups for this site and try again.");
      } else if (/redirect_uri|AADSTS50011/i.test(msg)) {
        alert(`Sign-in failed — redirect URI mismatch.\n\nThe app registration must have this exact SPA redirect URI:\n${window.location.origin + window.location.pathname}\n\nAdd it under App registration → Authentication → Single-page application.`);
      } else {
        alert(`Sign-in failed.\n\n${code ? code + "\n\n" : ""}${msg}`);
      }
    } finally { btn.disabled = false; }
  });
  $("signOutBtn").addEventListener("click", () => {
    $("tenantBox").style.display = "none";
    $("homeBtn").style.display = "none";
    $("toolNav").style.display = "none";
    policies = []; selected.clear();
    Graph.signOut?.();
    show("screen-login");
  });

  $("searchBox").addEventListener("input", (e) => { query = e.target.value.toLowerCase(); refreshViews(); });
  $("stateChips").addEventListener("click", (e) => {
    const b = e.target.closest("[data-state]"); if (!b) return;
    stateFilter = b.dataset.state; refreshViews();
  });
  // matrix: expand/collapse long cell lists
  $("mtable").addEventListener("click", (e) => {
    const b = e.target.closest(".clip-btn"); if (!b) return;
    const rest = b.closest(".clipgrp")?.querySelector(".clip-rest"); if (!rest) return;
    rest.hidden = !rest.hidden;
    b.textContent = rest.hidden ? `▾ ${b.dataset.more} more` : "▴ show less";
  });

  $("viewCards").addEventListener("click", () => setView("cards"));
  $("viewList").addEventListener("click", () => setView("list"));
  $("viewMatrix").addEventListener("click", () => setView("matrix"));
  $("clearSelBtn").addEventListener("click", () => { selected.clear(); refreshViews(); });

  // list view: name opens detail, checkbox selects, group header collapses/selects group
  document.querySelector("#ptable tbody").addEventListener("click", (e) => {
    const fb = e.target.closest("[data-flowkey]");
    if (fb) { e.stopPropagation(); openPersonaFlow(+fb.dataset.flowkey); return; }
    const gr = e.target.closest(".grouprow");
    if (gr) {
      if (e.target.matches("[data-gsel]")) return; // handled by change event
      const k = gr.dataset.gkey;
      collapsedGroups.has(k) ? collapsedGroups.delete(k) : collapsedGroups.add(k);
      refreshViews();
      return;
    }
    const open = e.target.closest("[data-open]");
    if (open) showDetail(open.dataset.open);
  });
  document.querySelector("#ptable tbody").addEventListener("change", (e) => {
    const g = e.target.closest("[data-gsel]");
    if (g) { toggleGroupSel(g.dataset.gsel, g.checked); return; }
    const cb = e.target.closest("[data-sel]"); if (!cb) return;
    cb.checked ? selected.add(cb.dataset.sel) : selected.delete(cb.dataset.sel);
    refreshViews();
  });
  // operates on the data (all filtered policies), including collapsed groups
  function toggleSelectAll(on) {
    visible().forEach(p => on ? selected.add(p.id) : selected.delete(p.id));
    refreshViews();
  }
  $("selAll").addEventListener("change", (e) => toggleSelectAll(e.target.checked));
  $("selAllTop").addEventListener("change", (e) => toggleSelectAll(e.target.checked));

  // cards view: checkbox selects, click elsewhere opens detail modal
  $("cardsView").addEventListener("click", (e) => {
    const fb = e.target.closest("[data-flowkey]");
    if (fb) { e.stopPropagation(); openPersonaFlow(+fb.dataset.flowkey); return; }
    const gh = e.target.closest(".cardgroup"); // persona header: collapse/expand or group-select
    if (gh) {
      if (e.target.matches("[data-gsel]")) return; // handled by change event
      const k = gh.dataset.gkey;
      collapsedGroups.has(k) ? collapsedGroups.delete(k) : collapsedGroups.add(k);
      refreshViews();
      return;
    }
    if (e.target.matches("[data-sel]")) return; // handled by change event
    const sc = e.target.closest("[data-open]"); if (!sc) return;
    showDetail(sc.dataset.open);
  });
  $("cardsView").addEventListener("change", (e) => {
    const g = e.target.closest("[data-gsel]");
    if (g) { toggleGroupSel(g.dataset.gsel, g.checked); return; }
    const cb = e.target.closest("[data-sel]"); if (!cb) return;
    cb.checked ? selected.add(cb.dataset.sel) : selected.delete(cb.dataset.sel);
    refreshViews();
  });

  // ---------- dependency settings viewer ----------
  const DEP_TYPE_MAP = { authStrength: "authStrengths", termsOfUse: "termsOfUse", namedLocation: "namedLocations", authContext: "authContexts", group: "groups" };
  const DEP_TITLES = { authStrength: "Authentication strength", termsOfUse: "Terms of use", namedLocation: "Named location", authContext: "Authentication context", group: "Group" };
  const depCache = new Map();
  let currentDepObj = null;
  function stripFileData(o) {
    const c = JSON.parse(JSON.stringify(o));
    (c.files || []).forEach(f => { if (f.fileData?.data) f.fileData.data = `(base64 PDF, ${f.fileData.data.length} chars)`; });
    return c;
  }
  function depKv(rows) {
    return `<ul class="dep-kv">${rows.filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => `<li><b>${k}</b><span>${v}</span></li>`).join("")}</ul>`;
  }
  function depSettingsHtml(type, o) {
    const rows = [["Name", esc(o.displayName || "")], ["Id", esc(o.id || "")]];
    if (type === "authStrength") rows.push(["Description", esc(o.description || "")], ["Policy type", esc(o.policyType || "")],
      ["Allowed combinations", (o.allowedCombinations || []).map(esc).join("<br>") || "—"]);
    if (type === "termsOfUse") rows.push(
      ["View before accepting required", String(o.isViewingBeforeAcceptanceRequired ?? "—")],
      ["Per-device acceptance", String(o.isPerDeviceAcceptanceRequired ?? "—")],
      ["Re-accept frequency", esc(o.userReacceptRequiredFrequency || "—")],
      ["Expiration", o.termsExpiration ? esc(JSON.stringify(o.termsExpiration)) : "—"],
      ["Files", (o.files || []).map((f, i) => `${esc(f.language || f.fileName || "file")} ${f.fileData?.data ? `<button class="btn" data-toupdf="${i}" style="font-size:11px;padding:2px 8px">Download PDF</button>` : ""}`).join("<br>") || "—"]);
    if (type === "namedLocation") {
      const t = o["@odata.type"] || "";
      if (t.includes("ipNamedLocation")) rows.push(["Type", "IP ranges"], ["Trusted", String(o.isTrusted ?? "—")],
        ["IP ranges", (o.ipRanges || []).map(r => esc(r.cidrAddress || "")).join("<br>") || "—"]);
      else if (t.includes("countryNamedLocation")) rows.push(["Type", "Countries"],
        ["Countries", (o.countriesAndRegions || []).map(esc).join(", ") || "—"],
        ["Include unknown regions", String(o.includeUnknownCountriesAndRegions ?? "—")],
        ["Lookup method", esc(o.countryLookupMethod || "—")]);
    }
    if (type === "authContext") rows.push(["Description", esc(o.description || "")], ["Available", String(o.isAvailable ?? "—")]);
    if (type === "group") rows.push(["Description", esc(o.description || "")], ["Security enabled", String(o.securityEnabled ?? "—")],
      ["Role-assignable", String(o.isAssignableToRole ?? "false")], ["Group types", (o.groupTypes || []).join(", ") || "assigned"],
      ["Membership rule", o.membershipRule ? `<code>${esc(o.membershipRule)}</code>` : "—"],
      ["On-prem synced", String(o.onPremisesSyncEnabled ?? "—")],
      [`Members${o._members ? ` (first ${o._members.items.length}${o._members.count != null ? ` of ${o._members.count}` : ""})` : ""}`,
        o._members
          ? (o._members.items.map(m => `${esc(m.displayName || m.userPrincipalName || m.id)}${m.userPrincipalName ? ` <span class="mini">${esc(m.userPrincipalName)}</span>` : ""}`).join("<br>") || "no members")
          : "—"]);
    return depKv(rows) + `<details class="dep-raw"><summary class="mini">Raw JSON</summary><pre>${esc(JSON.stringify(stripFileData(o), null, 2))}</pre></details>`;
  }
  async function openDepView(type, id, label) {
    $("depTitle").textContent = `${DEP_TITLES[type] || type} — ${label}`;
    $("depBody").innerHTML = '<p class="mini">Loading settings…</p>';
    $("depModal").classList.add("open");
    try {
      const key = type + ":" + id;
      let obj = depCache.get(key);
      if (!obj) {
        obj = isDemo
          ? (DEMO_DATA.depSettings?.[key] || { id, displayName: label, description: "Demo mode — no live settings for this item" })
          : await Graph.gget(DEP_ENDPOINTS[DEP_TYPE_MAP[type]](id), DEP_SCOPES[DEP_TYPE_MAP[type]]);
        // groups: also fetch the first 5 members (+ total count)
        if (type === "group" && !isDemo) {
          try {
            const m = await Graph.gget(`/groups/${id}/members?$top=5&$count=true&$select=displayName,userPrincipalName`);
            obj._members = { count: m["@odata.count"], items: m.value || [] };
          } catch (e) { console.warn("Member fetch failed:", e.message); }
        }
        depCache.set(key, obj);
      }
      currentDepObj = obj;
      $("depBody").innerHTML = depSettingsHtml(type, obj);
    } catch (e) {
      console.error(e);
      $("depBody").innerHTML = `<p class="mini" style="color:var(--off)">Could not load settings: ${esc(e.message || e)}</p>`;
    }
  }
  $("depClose").addEventListener("click", () => $("depModal").classList.remove("open"));
  $("depModal").addEventListener("click", (e) => {
    if (e.target.id === "depModal") { $("depModal").classList.remove("open"); return; }
    const b = e.target.closest("[data-toupdf]"); if (!b) return;
    const f = currentDepObj?.files?.[+b.dataset.toupdf]; if (!f?.fileData?.data) return;
    const bytes = Uint8Array.from(atob(f.fileData.data), c => c.charCodeAt(0));
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
    a.download = `${(currentDepObj.displayName || "terms-of-use").replace(/[^\w-]+/g, "-")}-${f.language || "file"}.pdf`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  });

  // detail modal: backdrop closes, dependency chips open settings, Save PNG exports
  $("detailModal").addEventListener("click", (e) => {
    if (e.target.id === "detailModal") { $("detailModal").classList.remove("open"); return; }
    const dl = e.target.closest(".dep-link");
    if (dl) { openDepView(dl.dataset.dept, dl.dataset.depid, dl.dataset.deplabel); return; }
    const b = e.target.closest("[data-png]"); if (!b) return;
    const p = policies.find(x => x.id === b.dataset.png);
    toast(`Exporting <span>${p.seq}.png</span>…`);
    Exporter.policyPng(p, tenantName, tenantLogo).catch(err => { console.error(err); toast("Export failed"); });
  });

  // refresh: re-fetch policies from Entra (keeps current view; analysis becomes stale and is reset)
  $("refreshBtn").addEventListener("click", async () => {
    if (isDemo) { loadDemo(); toast("Demo data <span>reloaded</span>"); return; }
    await loadFromGraph(true);
  });

  // ---------- impact analysis (on demand only) ----------
  $("selActAnalyze").addEventListener("click", () => setView("analyze"));

  $("anRun").addEventListener("click", async () => {
    const scope = $("anScope").value;
    const includeRO = $("anReportOnly").checked;
    const vms = policies.filter(p => p.raw.state === "enabled" || (includeRO && p.raw.state === "enabledForReportingButNotEnforced"));
    if (!vms.length) { $("anStatus").textContent = "No enabled policies to analyse."; return; }
    $("anRun").disabled = true;
    const status = (m) => $("anStatus").textContent = m;
    try {
      const { lookup, users, scopeGroups, ctx } = isDemo
        ? Analyzer.collectDemo(vms)
        : await Analyzer.collect(vms, scope, status);
      status(`Evaluating ${users.length} users × ${lookup.length} policies…`);
      await new Promise(r => setTimeout(r, 30)); // let the status paint
      anReport = Analyzer.evaluate(lookup, users, ctx);
      anPols = Analyzer.policyMeta(lookup);
      anMaps = Analyzer.buildMatrixMaps(anReport);
      anGroups = scopeGroups || []; anGroupSel = "";
      refreshGroupSelect();
      anFilter = "all"; anQuery = ""; anPage = 0; anType = ""; $("anSearch").value = ""; $("anType").value = "";
      renderAnalysis();
      status(`Done — ${users.length} users, ${lookup.length} policies.`);
    } catch (e) {
      console.error("Analysis failed:", e);
      status("Analysis failed — see browser console.");
    } finally { $("anRun").disabled = false; }
  });

  function refreshGroupSelect() {
    const sel = $("anGroup");
    sel.innerHTML = '<option value="">All groups</option>' + anGroups.map((g, i) =>
      `<option value="${i}" ${String(i) === anGroupSel ? "selected" : ""}>${(g.category ? g.category + " · " : "")}${g.label} (${g.users.size})</option>`).join("");
  }
  function groupMemberSet() {
    return anGroupSel === "" ? null : anGroups[+anGroupSel]?.users || null;
  }
  function renderAnalysis() {
    if (!anReport) return;
    const s = Analyzer.summary(anReport);
    $("anCards").innerHTML = [
      ["all", s.users, "Users", ""],
      ["risky", s.risky, "Risky bypasses", "risk"],
      ["nomfa", s.noMfa, "No MFA from CA", "gap"],
      ["noenforce", s.noEnforce, "No enforcing policy", "gap"],
    ].map(([f, n, l, cls]) => `<div class="an-card ${cls} ${anFilter === f ? "active" : ""}" data-f="${f}"><div class="n">${n}</div><div class="l">${l}</div></div>`).join("");
    $("anUsersWrap").style.display = anTab === "users" ? "block" : "none";
    $("anMatrixWrap").style.display = anTab === "matrix" ? "block" : "none";
    $("anFull").style.display = anTab === "matrix" ? "" : "none";
    $("anTabUsers").classList.toggle("active", anTab === "users");
    $("anTabMatrix").classList.toggle("active", anTab === "matrix");
    if (anTab === "users") {
      $("anBody").innerHTML = Analyzer.userRows(anReport, anFilter, anQuery, groupMemberSet(), anType);
    } else {
      const rows = Analyzer.filterRows(anReport, anFilter, anQuery, groupMemberSet(), anType);
      // Only show policy columns that are actually in scope of the visible users
      // — a policy no shown user is targeted by (all "·" not-in-scope) is just
      // empty noise, especially when a group or user filter is applied.
      const scoped = anPols.filter(p => rows.some(i => anMaps[i] && anMaps[i].m[p.name]));
      const cols = scoped.length ? scoped : anPols;
      const m = Analyzer.matrixTable(anReport, anMaps, cols, rows, anPage, AN_PAGE_SIZE);
      anPage = m.page;
      $("anMHead").innerHTML = m.head;
      $("anMBody").innerHTML = m.body;
      $("anMPage").textContent = `Page ${m.page + 1} / ${m.pages}`;
      $("anMScope").textContent = cols.length < anPols.length
        ? `Showing ${cols.length} of ${anPols.length} policies — only those in scope of the ${anGroupSel !== "" ? "selected group" : "shown users"}.`
        : "";
    }
    // export button reflects the current filter scope
    const n = Analyzer.filterRows(anReport, anFilter, anQuery, groupMemberSet(), anType).length;
    $("anExport").textContent = n === anReport.length
      ? "Export HTML report"
      : `Export HTML report (${n} of ${anReport.length} users)`;
    $("anResults").style.display = "block";
  }

  $("anCards").addEventListener("click", (e) => {
    const c = e.target.closest("[data-f]"); if (!c) return;
    anFilter = c.dataset.f; renderAnalysis();
  });
  $("anSearch").addEventListener("input", (e) => { anQuery = e.target.value.toLowerCase(); anPage = 0; renderAnalysis(); });
  $("anTabUsers").addEventListener("click", () => { anTab = "users"; if (!anReport) { $("anStatus").textContent = "Run the analysis first."; return; } renderAnalysis(); });
  $("anTabMatrix").addEventListener("click", () => { anTab = "matrix"; if (!anReport) { $("anStatus").textContent = "Run the analysis first."; return; } renderAnalysis(); });
  $("anMPrev").addEventListener("click", () => { anPage--; renderAnalysis(); });
  $("anMNext").addEventListener("click", () => { anPage++; renderAnalysis(); });
  $("anGroup").addEventListener("change", (e) => { anGroupSel = e.target.value; anPage = 0; renderAnalysis(); });
  $("anType").addEventListener("change", (e) => { anType = e.target.value; anPage = 0; renderAnalysis(); });
  $("anGroupAdd").addEventListener("click", async () => {
    const val = $("anGroupInput").value.trim(); if (!val || !anReport) return;
    $("anGroupAdd").disabled = true;
    try {
      let g = null;
      if (isDemo) {
        const ids = DEMO_DATA.scopeGroups?.[val];
        g = ids ? { label: val, category: "Custom", users: new Set(ids) } : null;
      } else {
        g = await Analyzer.resolveGroup(val);
        if (g) g.category = "Custom";
      }
      if (!g) { toast("Group <span>not found</span>"); return; }
      if (!anGroups.some(x => x.label === g.label)) anGroups.push(g);
      anGroupSel = String(anGroups.findIndex(x => x.label === g.label));
      $("anGroupInput").value = "";
      refreshGroupSelect(); anPage = 0; renderAnalysis();
      toast(`Group <span>${g.label}</span> added (${g.users.size} members)`);
    } finally { $("anGroupAdd").disabled = false; }
  });
  // policy names in analysis (detail lists + matrix column headers) open the policy card
  function openPolicyByName(name) {
    const p = policies.find(x => x.name === name);
    if (p) showDetail(p.id);
  }

  $("anBody").addEventListener("click", (e) => {
    const pl = e.target.closest(".pol-link");
    if (pl) { openPolicyByName(pl.dataset.pol); return; }
    const tr = e.target.closest(".urow"); if (!tr) return;
    const next = tr.nextElementSibling;
    if (next && next.classList.contains("detail")) { next.remove(); tr.classList.remove("open"); return; }
    tr.insertAdjacentHTML("afterend", Analyzer.userDetail(anReport[+tr.dataset.user]));
    tr.classList.add("open");
  });
  $("anMHead").addEventListener("click", (e) => {
    const pl = e.target.closest(".pol-link");
    if (pl) openPolicyByName(pl.dataset.pol);
  });

  $("anExport").addEventListener("click", () => {
    if (!anReport) return;
    // export exactly what is currently filtered (cards filter + search + group)
    const rowsIdx = Analyzer.filterRows(anReport, anFilter, anQuery, groupMemberSet(), anType);
    if (!rowsIdx.length) { toast("Nothing to export — current filter matches <span>0 users</span>"); return; }
    const subset = rowsIdx.map(i => anReport[i]);
    const filterBits = [];
    if (anType) filterBits.push(anType === "member" ? "members only" : "guests only");
    if (anGroupSel !== "") filterBits.push("group: " + (anGroups[+anGroupSel]?.label || ""));
    if (anFilter !== "all") filterBits.push({ risky: "risky bypasses only", nomfa: "no MFA from CA", noenforce: "no enforcing policy" }[anFilter]);
    if (anQuery) filterBits.push(`search: "${anQuery}"`);
    const meta = {
      tenant: tenantName || "tenant",
      date: new Date().toISOString().slice(0, 10),
      policies: anPols.length,
      scope: `${$("anScope").value} users${$("anReportOnly").checked ? ", incl. report-only" : ""}`
        + (filterBits.length ? ` | filtered: ${filterBits.join(", ")} (${subset.length} of ${anReport.length} users)` : ""),
    };
    const html = Analyzer.exportHtml(meta, subset, anPols, anGroups);
    const blob = new Blob([html], { type: "text/html" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `CA-Impact-${meta.tenant.replace(/[^\w-]+/g, "-")}-${meta.date}.html`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast("HTML report <span>downloaded</span> — single file, safe to share");
  });

  // export modal (Document) / JSON zip (Backup) / wizard (Assign) / state modal (Set Policy state)
  function runToolMode(mode) {
    return mode === "backup" ? runBackup()
      : mode === "assign" ? openAssign()
      : mode === "state" ? openStateModal()
      : openExport();
  }
  // The selection bar is the only place these are offered — the toolbar used to
  // duplicate Documentation and Gap analyse, which said the same thing twice.
  SEL_ACTIONS.forEach(([id, mode]) => $(id).addEventListener("click", () => {
    setToolMode(mode);
    runToolMode(mode);
  }));
  // Delete is not a tool mode — it has no "browse then act" phase, so it never
  // takes the highlight and always opens its own confirmation.
  $("selActDelete").addEventListener("click", openDeleteModal);

  // expand/collapse all persona sections (cards + list views)
  function syncCollapseAllBtn() {
    const keys = [...new Set(visible().map(p => String(Render.caGroup(p.name).key)))];
    const allCollapsed = keys.length > 0 && keys.every(k => collapsedGroups.has(k));
    $("collapseAllBtn").textContent = allCollapsed ? "⊞ Expand all" : "⊟ Collapse all";
    $("collapseAllBtn").style.display = (viewMode === "cards" || viewMode === "list") ? "inline-flex" : "none";
  }
  $("collapseAllBtn").addEventListener("click", () => {
    const keys = [...new Set(visible().map(p => String(Render.caGroup(p.name).key)))];
    const allCollapsed = keys.length > 0 && keys.every(k => collapsedGroups.has(k));
    allCollapsed ? keys.forEach(k => collapsedGroups.delete(k)) : keys.forEach(k => collapsedGroups.add(k));
    refreshViews();
  });
  ["png", "pdf", "docx", "zip", "md", "json"].forEach(f => $("expOpt" + f[0].toUpperCase() + f.slice(1)).addEventListener("click", () => { fmt = f; syncFmt(); }));
  $("expCancel").addEventListener("click", () => $("exportModal").classList.remove("open"));
  $("expGo").addEventListener("click", doExport);

  // ---------- boot ----------
  // Keep the user informed during a throttle back-off instead of looking hung.
  buildToolNav();
  Graph.setThrottleHandler((ms) => toast(`Microsoft Graph is throttling — waiting <span>${Math.ceil(ms / 1000)}s</span> then continuing…`));
  Graph.init().then(() => {
    if (new URLSearchParams(location.search).get("demo")) loadDemo();
  }).catch(e => console.error("MSAL init failed", e));
})();
