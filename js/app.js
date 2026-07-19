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
  function show(id) {
    document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
    $(id).classList.add("active");
    window.scrollTo(0, 0);
  }
  const esc = (s) => String(s).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
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
    try { localStorage.setItem("cadoc-theme", t.id); } catch { /* private mode */ }
    return t.id;
  }
  let theme = (() => { try { return localStorage.getItem("cadoc-theme") || "auto"; } catch { return "auto"; } })();
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
  function visible() {
    return policies.filter(p => (stateFilter === "all" || p.state === stateFilter)
      && (!query || p.name.toLowerCase().includes(query)));
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
    $("analyzeBtn").classList.toggle("active", v === "analyze");
  }
  function updateSelbar() {
    const n = selected.size;
    $("selCount").textContent = n;
    $("selbar").classList.toggle("visible", n > 0);
    $("exportBtn").disabled = policies.length === 0;
    $("analyzeBtn").disabled = policies.length === 0;
    $("refreshBtn").disabled = policies.length === 0;
    $("selHint").textContent = n <= 1
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
    $("detailBody").innerHTML = Render.card(p, tenantName);
    $("detailModal").classList.add("open");
  }

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
      selected = new Set();
      refreshViews();
      renderPermissions();
      show(isRefresh ? "screen-list" : "screen-home");
      toast(isRefresh
        ? `Refreshed from Entra — <span>${policies.length}</span> Conditional Access policies`
        : `Signed in to <span>${esc(tenantName)}</span> — ${policies.length} Conditional Access policies loaded`);
      warnUnresolved();
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
    refreshViews();
    renderPermissions();
    show("screen-home");
    toast(`Demo mode — <span>${policies.length}</span> sample policies loaded`);
  }

  // ---------- permissions overview (home) ----------
  const SCOPE_INFO = [
    { scope: "Policy.Read.All", use: "Read CA policies, named locations, auth strengths & contexts", tools: "all tools", onDemand: false },
    { scope: "Directory.Read.All", use: "Resolve users/groups/roles/apps to names; expand memberships", tools: "all tools", onDemand: false },
    { scope: "Agreement.Read.All", use: "Read terms-of-use agreements", tools: "Backup", onDemand: true },
    { scope: "Policy.ReadWrite.ConditionalAccess", use: "Update policy group assignments / state, create policies", tools: "Assign groups, Set Policy state, Import", onDemand: true },
    { scope: "Application.Read.All", use: "Required by Graph to create policies with app conditions", tools: "Import", onDemand: true },
    { scope: "Policy.ReadWrite.AuthenticationMethod", use: "Create authentication strengths", tools: "Import", onDemand: true },
    { scope: "Group.ReadWrite.All", use: "Create missing persona groups", tools: "Assign groups", onDemand: true },
    { scope: "RoleManagement.ReadWrite.Directory", use: "Create groups as role-assignable", tools: "Assign groups", onDemand: true },
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
  function setToolMode(mode) {
    toolMode = mode;
    $("exportBtn").innerHTML = mode === "backup" ? "Backup (JSON)"
      : mode === "assign" ? 'Assign groups <span class="tag new">BETA</span>'
      : mode === "state" ? 'Set Policy state <span class="tag new">BETA</span>'
      : "Create documentation";
    const write = mode === "assign" || mode === "state";
    $("exportBtn").classList.toggle("primary", write);
    $("exportBtn").classList.toggle("lemon", !write);
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
  $("homeBtn").addEventListener("click", () => show("screen-home"));
  // logo returns to the tools overview when signed in (does nothing on login)
  $("logoHome").addEventListener("click", () => { if (policies.length) show("screen-home"); });
  $("toolPolicies").addEventListener("click", () => { setToolMode("document"); setView("cards"); show("screen-list"); });
  // Document tool: opens the policy overview first — select policies (or none
  // for all), then click "Create documentation" in the toolbar to choose the format.
  $("toolDocument").addEventListener("click", () => {
    setToolMode("document"); setView("cards"); show("screen-list");
    toast("Documentation mode — select policies (or none for all), then click <span>Create documentation</span>");
  });
  $("toolAnalyze").addEventListener("click", () => { setToolMode("document"); setView("analyze"); show("screen-list"); });
  $("toolMsLearn").addEventListener("click", openMsLearn);
  $("toolGapCheck").addEventListener("click", openGapCheck);
  $("toolExclusions").addEventListener("click", openExclusions);
  // Backup tool: opens the policy overview in backup mode — select policies
  // (or leave unselected for all), then click "Backup (JSON)" in the toolbar.
  $("toolJson").addEventListener("click", () => {
    setToolMode("backup"); setView("cards"); show("screen-list");
    toast("Backup mode — select policies (or none for all), then click <span>Backup (JSON)</span>");
  });
  // Set-state tool (BETA): select policies, choose On / Report-only / Off, apply.
  $("toolState").addEventListener("click", () => {
    setToolMode("state"); setView("cards"); show("screen-list");
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

  // ---------- import tool (BETA) ----------
  let imBundle = null, imPlan = null, imFileName = "";
  $("toolImport").addEventListener("click", () => {
    imBundle = null; imPlan = null;
    $("imBody").innerHTML = ""; $("imGo").style.display = "none"; $("imPick").style.display = "flex";
    $("imDesc").textContent = "Select a CA Doc backup zip, or pick the extracted backup folder — both use the same structure.";
    $("importModal").classList.add("open");
  });
  $("imCancel").addEventListener("click", () => $("importModal").classList.remove("open"));
  async function imLoaded(bundle, fileName) {
    imBundle = bundle; imFileName = fileName;
    imPlan = Importer.plan(bundle, policies.map(p => p.name));
    const dep = ["groups", "namedLocations", "authStrengths", "authContexts", "termsOfUse"].map(k => `${bundle[k].length} ${k}`).join(", ");
    const importable = imPlan.filter(p => !p.exists);
    $("imDesc").textContent = `${fileName}: ${bundle.policies.length} policies, dependencies: ${dep}.`;
    $("imBody").innerHTML = `
      <p class="mini" style="margin:8px 0">Dependencies are imported first (create-if-missing). Policies are imported in state <b>Off</b>,
      skipped when a policy with the same CA number + version already exists, and their INCLUDE assignment is remapped to the deploy persona group (CAD-SEC-U-DG-*).${isDemo ? " <b>Demo — simulated.</b>" : ""}</p>
      <ul class="plist2" style="border:1px solid var(--border);border-radius:8px">` +
      imPlan.map((p, i) => `<li><label class="chk" style="margin:0">
        <input type="checkbox" data-imp="${i}" ${p.exists ? "disabled" : "checked"}>
        ${p.exists ? '<span class="tag">skip</span>' : p.asIs ? '<span class="tag new">as-is</span>' : `<span class="tag grant">import</span>`}
        ${esc(p.name)}
        <span class="mini">${p.exists ? esc(p.reason) : p.personaGroup ? `→ ${esc(p.personaGroup)}` : esc(p.reason || "")}</span>
      </label></li>`).join("") + "</ul>";
    $("imPick").style.display = "none";
    $("imGo").style.display = importable.length ? "inline-flex" : "none";
  }
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
    $("imGo").disabled = true;
    try {
      let depLog = { created: [], reused: [], warnings: [] }, maps = { group: {}, loc: {}, strength: {}, ctx: {}, tou: {}, personaGroupIds: {} }, res = { results: [], warnings: [] };
      if (isDemo) {
        chosen.forEach(p => { if (p.personaGroup) maps.personaGroupIds[p.personaGroup] = "g-" + p.personaGroup; });
        res.results = chosen.map(p => ({ name: p.name, ok: true, persona: p.persona, personaGroup: p.personaGroup }));
        depLog.created = imBundle.groups.map(g => "Group: " + g.displayName);
      } else {
        const dep = await Importer.ensureDependencies(imBundle, (m) => toast(esc(m)));
        depLog = dep.log; maps = dep.maps;
        res = await Importer.importPolicies(chosen, maps, (m) => toast(esc(m)));
      }
      // markdown change report
      const md = Importer.buildReport({ tenantName, fileName: imFileName, depLog, planItems: imPlan, results: res.results, warnings: res.warnings });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([md], { type: "text/markdown" }));
      const d = new Date(), pad = (n) => String(n).padStart(2, "0");
      a.download = `CA-Import-Report-${(tenantName || "tenant").replace(/[^\w-]+/g, "-")}-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.md`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      const failed = res.results.filter(r => !r.ok).length;
      $("importModal").classList.remove("open");
      toast(failed ? `Import done with <span>${failed} failure(s)</span> — report downloaded`
        : `Imported <span>${res.results.length}</span> policies (Off) — report downloaded${isDemo ? " (simulated)" : ""}`);
      if (!isDemo && res.results.some(r => r.ok)) await loadFromGraph(true);
    } catch (e) {
      console.error(e); toast(`Import failed: <span>${esc(e.message || e)}</span>`);
    } finally { $("imGo").disabled = false; }
  });

  // Assign-groups tool: select policies in the overview, then run the wizard.
  $("toolAssign").addEventListener("click", () => {
    setToolMode("assign"); setView("cards"); show("screen-list");
    toast("Assign mode — select the policies to change, then click <span>Assign groups</span>");
  });

  // ---------- assign-groups wizard ----------
  let asStep = 0, asAction = null, asGroups = [], asPolicies = [], asResults = null;
  function openAssign() {
    if (!selected.size) { toast("Select at least one policy first"); return; }
    asPolicies = exportOrder([...selected].map(id => policies.find(p => p.id === id)));
    asStep = 0; asAction = null; asGroups = []; asResults = null;
    renderAssign();
    $("assignModal").classList.add("open");
  }
  function assignEsc(s) { return esc(s); }
  async function renderAssign() {
    const b = $("asBody"), next = $("asNext"), back = $("asBack");
    $("asSub").textContent = `${asPolicies.length} ${asPolicies.length === 1 ? "policy" : "policies"} selected · step ${Math.min(asStep + 1, 3)} of 3`;
    back.style.display = asStep > 0 && asStep < 3 ? "inline-flex" : "none";
    next.style.display = "inline-flex";
    if (asStep === 0) {
      next.textContent = "Next";
      b.innerHTML = `<h4 class="mini" style="margin-bottom:8px">ACTION</h4>` + Assign.ACTIONS.map((a, i) =>
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
      b.innerHTML = `<h4 class="mini" style="margin-bottom:8px">TARGET GROUPS</h4>` +
        (asGroups.map((g, i) => `<label class="chk" style="margin:5px 0"><input type="checkbox" data-asg="${i}" ${g.checked ? "checked" : ""}> ${assignEsc(g.name)}${g.created ? ' <span class="tag grant">created</span>' : ""}</label>`).join("") || '<p class="mini">No predefined persona groups found in this tenant yet — create them from a template below.</p>') +
        `<div style="display:flex;gap:8px;margin-top:12px">
          <input id="asCustom" class="btn" style="flex:1;cursor:text" placeholder="Add existing group by exact name…">
          <button class="btn" id="asCustomAdd">+ Add</button>
        </div>
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
      next.textContent = "Apply changes";
      const gsel = asGroups.filter(g => g.checked);
      const notes = asAction === 2 && asPolicies.some(p => (p.raw.conditions?.users?.includeUsers || []).includes("All"))
        ? '<p class="mini" style="color:var(--report)">⚠ Policies currently targeting "All users" will switch to the selected groups.</p>' : "";
      b.innerHTML = `<h4 class="mini">REVIEW — this WRITES to your tenant</h4>
        <p style="margin:8px 0"><b>Action:</b> ${assignEsc(Assign.ACTIONS[asAction])}</p>
        <p style="margin:8px 0"><b>Policies (${asPolicies.length}):</b></p>
        <ul class="plist2" style="border:1px solid var(--border);border-radius:8px;margin-bottom:10px">${asPolicies.map(p => `<li>${assignEsc(p.name)}</li>`).join("")}</ul>
        ${asAction === 4 ? '<p><b>Target:</b> All users (include groups will be cleared)</p>'
          : `<p style="margin:8px 0"><b>Groups (${gsel.length}):</b></p><ul class="plist2" style="border:1px solid var(--border);border-radius:8px">${gsel.map(g => `<li>${assignEsc(g.name)} <span class="mini">${assignEsc(g.id)}</span></li>`).join("")}</ul>`}
        ${notes}
        ${isDemo ? '<p class="mini" style="color:var(--report)">Demo mode — changes will be simulated, nothing is written.</p>' : ""}`;
    } else {
      // results
      next.textContent = "Close";
      back.style.display = "none";
      b.innerHTML = `<h4 class="mini">RESULT</h4><ul class="plist2" style="border:1px solid var(--border);border-radius:8px">` +
        asResults.map(r => `<li>${r.ok ? '<span class="tag grant">ok</span>' : '<span class="tag block">failed</span>'} ${assignEsc(r.name)}${r.error ? `<div class="mini">${assignEsc(r.error)}</div>` : ""}</li>`).join("") + "</ul>";
    }
  }
  $("asBody").addEventListener("change", (e) => {
    const r = e.target.closest('[name="asAct"]'); if (r) { asAction = +r.value; return; }
    const g = e.target.closest("[data-asg]"); if (g) asGroups[+g.dataset.asg].checked = g.checked;
  });
  async function asAddCreated(g) {
    if (!asGroups.some(x => x.id === g.id)) asGroups.push({ ...g, checked: true });
    else asGroups.find(x => x.id === g.id).checked = true;
    renderAssign();
  }
  $("asBody").addEventListener("click", async (e) => {
    if (e.target.id === "asCustomAdd") {
      const name = $("asCustom").value.trim(); if (!name) return;
      e.target.disabled = true;
      try {
        const g = isDemo ? { id: "g-" + name, name } : await Assign.findGroup(name);
        if (!g) { toast("Group <span>not found</span> — use Create below to make it"); return; }
        asAddCreated(g);
      } finally { e.target.disabled = false; }
      return;
    }
    if (e.target.id === "asTplCreate") {
      const tpls = Assign.templates().filter(t => !asGroups.some(g => g.name === t.displayName));
      const t = tpls[+($("asTpl").value || 0)]; if (!t) return;
      e.target.disabled = true;
      try {
        const g = isDemo
          ? { id: "g-" + t.displayName, name: t.displayName, created: true }
          : await Assign.createGroup(t);
        toast(g.created ? `Group <span>${esc(g.name)}</span> created${isDemo ? " (simulated)" : ""}` : `Group <span>${esc(g.name)}</span> already existed — reused`);
        asAddCreated(g);
      } catch (err) { console.error(err); toast(`Create failed: <span>${esc(err.message || err)}</span>`); }
      finally { e.target.disabled = false; }
      return;
    }
    if (e.target.id === "asNewCreate") {
      const name = $("asNewName").value.trim(); if (!name) return;
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
      const gids = asGroups.filter(g => g.checked).map(g => g.id);
      $("asNext").disabled = true;
      try {
        if (isDemo) {
          asResults = asPolicies.map(p => ({ name: p.name, ok: true }));
          toast("Demo — changes <span>simulated</span>");
        } else {
          asResults = await Assign.apply(asPolicies.map(p => p.id), asAction, gids, (m) => toast(m));
        }
        asStep = 3; renderAssign();
        const failed = asResults.filter(r => !r.ok).length;
        toast(failed ? `Done with <span>${failed} failure(s)</span>` : `All <span>${asResults.length}</span> policies updated`);
      } catch (e) {
        console.error(e); toast(`Assign failed: <span>${esc(e.message || e)}</span>`);
      } finally { $("asNext").disabled = false; }
    } else {
      $("assignModal").classList.remove("open");
      if (!isDemo && asResults?.some(r => r.ok)) await loadFromGraph(true); // reload changed policies
    }
  });

  // ---------- CA Exclusion analyzer ----------
  let exModel = null, exUsers = [], exTab = "all", exKind = "all", exQuery = "", exPage = 0, exMerge = true, exFull = false;
  const EX_PAGE = 50;
  async function openExclusions() {
    show("screen-exclusions");
    if (!policies.length) { $("exHead").innerHTML = '<p class="mini">No policies loaded.</p>'; $("exBody").innerHTML = ""; $("exChips").innerHTML = ""; return; }
    $("exHead").innerHTML = '<h3>🚪 CA Exclusion analyzer</h3><p class="mini" style="margin:6px 0 0">Collecting exclusions…</p>';
    $("exChips").innerHTML = ""; $("exBody").innerHTML = ""; $("exPager").style.display = "none";
    exTab = "all"; exKind = "all"; exQuery = ""; exPage = 0; exFull = false; $("exFull").classList.remove("show"); $("exSearch").value = "";
    $("exTabAll").classList.add("active"); $("exTabUsers").classList.remove("active");
    try {
      // the whole tenant's policies — exclusions are a tenant-wide question
      exModel = Exclusions.collect(policies.map(p => p.raw));
      await Exclusions.resolve(exModel, { demo: isDemo, onStatus: (m) => { $("exHead").innerHTML = `<h3>🚪 CA Exclusion analyzer</h3><p class="mini" style="margin:6px 0 0">${esc(m)}</p>`; } });
      exUsers = Exclusions.effectiveUsers(exModel);
      renderExclusions();
    } catch (e) {
      console.error("Exclusion analyzer failed:", e);
      $("exHead").innerHTML = `<h3>🚪 CA Exclusion analyzer</h3><p class="mini" style="color:var(--off)">Failed: ${esc(e.message || e)}</p>`;
    }
  }
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
    $("exMergeWrap").style.display = exTab === "matrix" ? "" : "none";
    $("exExpand").style.display = exTab === "all" ? "none" : "";
    // the matrices are far wider than the page column — when expanded they are
    // rendered into the near-fullscreen overlay instead of the page body.
    const target = exFull && exTab !== "all" ? "exFullBody" : "exBody";
    if (exFull && exTab !== "all") {
      $("exBody").innerHTML = '<p class="mini" style="padding:20px">Matrix is open full screen.</p>';
      $("exFullChips").innerHTML = $("exChips").innerHTML;
      $("exFullSearch").value = exQuery;
      $("exFullMergeWrap").style.display = exTab === "matrix" ? "" : "none";
      $("exFullTitle").textContent = exTab === "matrix" ? "Exclusion × policy matrix" : "Effectively excluded users × policy";
      $("exFullLegend").innerHTML = exTab === "matrix" ? "✗ excluded" : "✗ excluded directly · ◐ via group membership";
    }
    if (exTab === "all") {
      $("exPager").style.display = "none";
      $("exBody").innerHTML = Exclusions.renderGroups(exModel, exKind, exQuery);
    } else if (exTab === "matrix") {
      $("exPager").style.display = "none";
      $(target).innerHTML = Exclusions.renderMatrix(exModel, exKind, exQuery, exMerge);
    } else {
      const r = Exclusions.renderUsers(exModel, exUsers, exQuery, exPage, exFull ? EX_PAGE * 4 : EX_PAGE);
      exPage = r.page;
      $(target).innerHTML = r.html;
      $("exPager").style.display = exFull ? "none" : "flex";
      $("exPage").textContent = `Page ${r.page + 1} / ${r.pages}`;
    }
    applyColW();
    (window.requestAnimationFrame || setTimeout)(() => {
      const w = $("exBody").querySelector(".mwrap-x");
      $("exHint").style.display = w && w.scrollWidth > w.clientWidth + 4 ? "block" : "none";
    });
  }
  $("exChips").addEventListener("click", (e) => {
    const b = e.target.closest("[data-exk]"); if (!b) return;
    exKind = b.dataset.exk; renderExclusions();
  });
  // Drag-to-resize the sticky first column of any matrix (exclusions, users).
  // Width lives on the .mwrap-x element as --ucol-w and survives re-renders.
  let exColW = 260;
  function applyColW() {
    document.querySelectorAll("#exBody .mwrap-x, #exFullBody .mwrap-x")
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

  function setExFull(on) {
    exFull = on;
    $("exFull").classList.toggle("show", on);
    document.body.style.overflow = on ? "hidden" : "";
    renderExclusions();
  }
  $("exExpand").addEventListener("click", () => setExFull(true));
  $("exFullClose").addEventListener("click", () => setExFull(false));
  $("exFull").addEventListener("click", (e) => { if (e.target.id === "exFull") setExFull(false); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && exFull) setExFull(false); });
  $("exFullChips").addEventListener("click", (e) => {
    const b = e.target.closest("[data-exk]"); if (!b) return;
    exKind = b.dataset.exk; renderExclusions();
  });
  $("exFullSearch").addEventListener("input", (e) => { exQuery = e.target.value; exPage = 0; $("exSearch").value = exQuery; renderExclusions(); });
  $("exFullMergeChk").addEventListener("change", (e) => { exMerge = e.target.checked; $("exMergeChk").checked = exMerge; renderExclusions(); });
  $("exMergeChk").addEventListener("change", (e) => { exMerge = e.target.checked; $("exFullMergeChk").checked = exMerge; renderExclusions(); });
  $("exSearch").addEventListener("input", (e) => { exQuery = e.target.value; exPage = 0; renderExclusions(); });
  const EX_TABS = { all: "exTabAll", matrix: "exTabMatrix", users: "exTabUsers" };
  for (const [tab, id] of Object.entries(EX_TABS)) {
    $(id).addEventListener("click", () => {
      exTab = tab; exPage = 0;
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
    downloadText("CA-Exclusions", "md", "text/markdown", Exclusions.toMd(exModel, exUsers, tenantName));
    toast("Exclusion Markdown <span>downloaded</span>");
  });

  // ---------- MS Learn documented exclusion checks ----------
  let mlGroups = null, mlFilter = "all", mlStrengths = new Map();
  const mlExpanded = new Set();
  async function openMsLearn() {
    show("screen-mslearn");
    if (!policies.length) { $("mlHead").innerHTML = '<p class="mini">No policies loaded.</p>'; $("mlBody").innerHTML = ""; $("mlChips").innerHTML = ""; return; }
    $("mlHead").innerHTML = '<h3>📘 MS Learn: documented exclusion checks</h3><p class="mini" style="margin:6px 0 0">Running checks…</p>';
    $("mlChips").innerHTML = ""; $("mlBody").innerHTML = "";
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
    runMsLearn();
  }
  function runMsLearn() {
    const scope = checkScope($("mlDisabled").checked);
    mlGroups = MSLearn.group(MSLearn.run(scope.raws, mlStrengths, { includeDisabled: scope.includeDisabled }));
    mlFilter = "all"; mlExpanded.clear();
    renderMsLearn();
  }
  $("mlDisabled").addEventListener("change", runMsLearn);
  function renderMsLearn() {
    if (!mlGroups) return;
    const incDis = $("mlDisabled").checked;
    if (!mlGroups.length) {
      $("mlHead").innerHTML = MSLearn.renderSummary(mlGroups, MSLearn.checksCount, incDis);
      $("mlChips").innerHTML = "";
      $("mlBody").innerHTML = MSLearn.renderEmpty();
      return;
    }
    $("mlHead").innerHTML = MSLearn.renderSummary(mlGroups, MSLearn.checksCount, incDis);
    const count = (s) => s === "all" ? mlGroups.length : mlGroups.filter(g => g.check.severity === s).length;
    $("mlChips").innerHTML = [["all", "All"], ["critical", "Critical"], ["high", "High"], ["medium", "Medium"], ["info", "Info"]]
      .filter(([k]) => count(k) > 0 || k === "all")
      .map(([k, l]) => `<button class="fchip ${mlFilter === k ? "active" : ""}" data-mlf="${k}">${l} (${count(k)})</button>`).join("");
    $("mlBody").innerHTML = MSLearn.renderGroups(mlGroups, mlFilter, mlExpanded);
  }
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
  async function openGapCheck() {
    show("screen-gapcheck");
    if (!policies.length) { $("gcHead").innerHTML = '<p class="mini">No policies loaded.</p>'; $("gcMatrix").innerHTML = ""; $("gcChips").innerHTML = ""; $("gcBody").innerHTML = ""; return; }
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
      await openGapCheck();
      toast("Best-practice &amp; bypass checks <span>refreshed</span>");
    } catch (e) {
      toast(`Refresh failed: <span>${esc(e.message || e)}</span>`);
    } finally {
      btn.disabled = false; btn.textContent = "⟳ Refresh";
    }
  });
  $("gcMd").addEventListener("click", () => {
    if (!gcResult) return;
    downloadText("CA-BestPractice-Checks", "md", "text/markdown", GapCheck.toMd(gcResult, gcMeta || { tenantName }));
    toast("Best-practice checks Markdown <span>downloaded</span>");
  });
  $("gcDisabled").addEventListener("change", runGapCheck);
  function renderGapCheck() {
    if (!gcResult) return;
    $("gcHead").innerHTML = GapCheck.renderSummary(gcResult);
    $("gcMatrix").innerHTML = GapCheck.renderPersonaMatrix(gcResult.personas);
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
  $("clearSelBtn").addEventListener("click", () => { selected.clear(); refreshViews(); $("selAll").checked = false; });

  // list view: name opens detail, checkbox selects, group header collapses/selects group
  document.querySelector("#ptable tbody").addEventListener("click", (e) => {
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
  $("selAll").addEventListener("change", (e) => {
    // operates on the data (all filtered policies), including collapsed groups
    visible().forEach(p => e.target.checked ? selected.add(p.id) : selected.delete(p.id));
    refreshViews();
  });

  // cards view: checkbox selects, click elsewhere opens detail modal
  $("cardsView").addEventListener("click", (e) => {
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
  $("analyzeBtn").addEventListener("click", () => setView("analyze"));

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
    $("anTabUsers").classList.toggle("active", anTab === "users");
    $("anTabMatrix").classList.toggle("active", anTab === "matrix");
    if (anTab === "users") {
      $("anBody").innerHTML = Analyzer.userRows(anReport, anFilter, anQuery, groupMemberSet(), anType);
    } else {
      const rows = Analyzer.filterRows(anReport, anFilter, anQuery, groupMemberSet(), anType);
      const m = Analyzer.matrixTable(anReport, anMaps, anPols, rows, anPage, AN_PAGE_SIZE);
      anPage = m.page;
      $("anMHead").innerHTML = m.head;
      $("anMBody").innerHTML = m.body;
      $("anMPage").textContent = `Page ${m.page + 1} / ${m.pages}`;
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
  $("exportBtn").addEventListener("click", () =>
    toolMode === "backup" ? runBackup()
    : toolMode === "assign" ? openAssign()
    : toolMode === "state" ? openStateModal()
    : openExport());

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
  Graph.init().then(() => {
    if (new URLSearchParams(location.search).get("demo")) loadDemo();
  }).catch(e => console.error("MSAL init failed", e));
})();
