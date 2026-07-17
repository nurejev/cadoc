// ======================================================================
// App wiring. One main screen with three views: Cards (default) · List · Matrix.
// ======================================================================
(() => {
  const $ = (id) => document.getElementById(id);
  let policies = [];          // view models
  let tenantName = "";
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
  function toast(msg) {
    const t = $("toast"); t.innerHTML = msg; t.classList.add("show");
    clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("show"), 3200);
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
    ["Png", "Pdf", "Docx", "Zip", "Json"].forEach(f => $("expOpt" + f).classList.toggle("sel", fmt === f.toLowerCase()));
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
    show("screen-home");
    toast(`Demo mode — <span>${policies.length}</span> sample policies loaded`);
  }

  // ---------- tools home ----------
  function exportOrder(ps) {
    return [...ps].sort((a, b) => {
      const ga = Render.caGroup(a.name), gb = Render.caGroup(b.name);
      return ga.key - gb.key || (ga.num ?? 1e9) - (gb.num ?? 1e9) || a.name.localeCompare(b.name);
    });
  }
  function setToolMode(mode) {
    toolMode = mode;
    $("exportBtn").textContent = mode === "backup" ? "Backup (JSON)" : mode === "assign" ? "Assign groups" : "Document";
    $("exportBtn").classList.toggle("primary", mode === "assign");
    $("exportBtn").classList.toggle("lemon", mode !== "assign");
  }
  async function runBackup() {
    const ps = exportOrder((selected.size ? [...selected] : visible().map(p => p.id)).map(id => policies.find(p => p.id === id)));
    if (!ps.length) { toast("Nothing to back up"); return; }
    toast(`Building JSON backup of <span>${ps.length}</span> policies…`);
    try {
      await Exporter.policiesJson(ps, tenantName);
      toast(`JSON backup <span>downloaded</span> — ${ps.length} policies`);
    } catch (e) { console.error(e); toast(`Backup failed: <span>${esc(e.message || e)}</span>`); }
  }
  $("homeBtn").addEventListener("click", () => show("screen-home"));
  $("toolPolicies").addEventListener("click", () => { setToolMode("document"); setView("cards"); show("screen-list"); });
  // Document tool: opens the policy overview first — select policies (or none
  // for all), then click "Document" in the toolbar to choose the format.
  $("toolDocument").addEventListener("click", () => {
    setToolMode("document"); setView("cards"); show("screen-list");
    toast("Document mode — select policies (or none for all), then click <span>Document</span>");
  });
  $("toolAnalyze").addEventListener("click", () => { setToolMode("document"); setView("analyze"); show("screen-list"); });
  // Backup tool: opens the policy overview in backup mode — select policies
  // (or leave unselected for all), then click "Backup (JSON)" in the toolbar.
  $("toolJson").addEventListener("click", () => {
    setToolMode("backup"); setView("cards"); show("screen-list");
    toast("Backup mode — select policies (or none for all), then click <span>Backup (JSON)</span>");
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
      b.innerHTML = `<h4 class="mini" style="margin-bottom:8px">TARGET GROUPS</h4>` +
        (asGroups.map((g, i) => `<label class="chk" style="margin:5px 0"><input type="checkbox" data-asg="${i}" ${g.checked ? "checked" : ""}> ${assignEsc(g.name)}</label>`).join("") || '<p class="mini">No predefined persona groups found in this tenant.</p>') +
        `<div style="display:flex;gap:8px;margin-top:12px">
          <input id="asCustom" class="btn" style="flex:1;cursor:text" placeholder="Add another group by exact name…">
          <button class="btn" id="asCustomAdd">+ Add</button>
        </div>
        <p class="mini" style="margin-top:10px">Creating new role-assignable groups is not available here — use the PowerShell script for that.</p>`;
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
  $("asBody").addEventListener("click", async (e) => {
    if (e.target.id !== "asCustomAdd") return;
    const name = $("asCustom").value.trim(); if (!name) return;
    e.target.disabled = true;
    try {
      const g = isDemo ? { id: "g-" + name, name } : await Assign.findGroup(name);
      if (!g) { toast("Group <span>not found</span>"); return; }
      if (!asGroups.some(x => x.id === g.id)) asGroups.push({ ...g, checked: true });
      else asGroups.find(x => x.id === g.id).checked = true;
      renderAssign();
    } finally { e.target.disabled = false; }
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

  // ---------- events ----------
  $("signInBtn").addEventListener("click", async () => {
    if (AUTH_CONFIG.clientId.startsWith("00000000")) {
      alert("No clientId configured yet in js/authConfig.js — see README.md step 1.\nUse the demo link below to preview the app.");
      return;
    }
    try { await Graph.signIn(); await loadFromGraph(); }
    catch (e) { if (e.errorCode !== "user_cancelled") { console.error(e); toast("Sign-in failed"); } }
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

  // detail modal: backdrop closes, Save PNG exports
  $("detailModal").addEventListener("click", (e) => {
    if (e.target.id === "detailModal") { $("detailModal").classList.remove("open"); return; }
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

  // export modal (Document mode) / direct JSON zip (Backup mode) / wizard (Assign mode)
  $("exportBtn").addEventListener("click", () => toolMode === "backup" ? runBackup() : toolMode === "assign" ? openAssign() : openExport());
  ["png", "pdf", "docx", "zip", "json"].forEach(f => $("expOpt" + f[0].toUpperCase() + f.slice(1)).addEventListener("click", () => { fmt = f; syncFmt(); }));
  $("expCancel").addEventListener("click", () => $("exportModal").classList.remove("open"));
  $("expGo").addEventListener("click", doExport);

  // ---------- boot ----------
  Graph.init().then(() => {
    if (new URLSearchParams(location.search).get("demo")) loadDemo();
  }).catch(e => console.error("MSAL init failed", e));
})();
