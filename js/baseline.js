// ======================================================================
// Baseline Policies — match the tenant's Conditional Access policies
// against the Limon-IT baseline catalog (js/baselineData.js).
//
// Matching is by CA number, which is the stable identity in the naming
// convention: the (NEW)/(UP) staging prefixes, the persona label and the
// descriptive middle of a policy name all change between releases, the
// number does not. Versions are compared numerically per segment, so
// v1.0.10 correctly sorts above v1.0.9.
//
// Every policy lands in exactly one bucket:
//   ok        present, version matches the baseline
//   outdated  present, but the tenant runs an older version
//   ahead     present, but the tenant runs a newer version than the catalog
//   unversioned present, but one side carries no version to compare
//   missing   in the baseline, not in the tenant
//   conflict  the CA number matches but the name contradicts it — a number
//             clash between two baselines, not a deployed policy
//   extra     numbered policy in the tenant that the baseline does not define
// ======================================================================
const Baseline = (() => {
  // Catalogs the tool can compare against. BASELINE is the Limon-IT one
  // (bundled from its documentation); BASELINE_JOEY is the community baseline
  // by Joey Verlinden. Both are bundled rather than fetched at runtime — the
  // app's CSP only allows Graph, and a baseline should not change under you
  // mid-session.
  function catalogs() {
    const out = [];
    if (typeof BASELINE !== "undefined") {
      out.push({ id: "limonit", label: "Limon-IT", icon: "🧬",
        // `revised` marks a re-cut of the same release (documented fixes folded
        // back in) — worth showing, because a tenant on the older patch versions
        // is not out of release, only out of revision.
        release: BASELINE.release, line: BASELINE.line, author: "Limon-IT",
        released: BASELINE.revised || null,
        url: null, policies: BASELINE.policies });
    }
    if (typeof BASELINE_JOEY !== "undefined") out.push(BASELINE_JOEY);
    return out;
  }
  const catalog = (id) => catalogs().find((c) => c.id === id) || catalogs()[0];

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));

  // ---- corroboration ----------------------------------------------------
  // The CA number alone is only a reliable identity WITHIN one baseline. Across
  // baselines the numbering diverges (Joey's CA501 is an agent policy; the
  // Limon-IT CA501 is a guest-admin policy), so a number match must be backed
  // by the name: the persona segment must not contradict, and the descriptive
  // tokens must overlap. Otherwise the row is a number clash, not a match.
  const PERSONA_KEYS = [
    // most specific first — "g_admin" must win over "admin"
    ["eadmin", /\b(e[-_ ]?admins?|emergency[_ ]?access|breakglass|break[-_ ]glass)\b/i],
    ["guestadmin", /\b(g[-_ ]?admins?|guest ?admins?|guestadmins)\b/i],
    ["guest", /\b(guests?|guestusers?|externals?)\b/i],
    ["agent", /\b(agents?|agentid|workloadids?|workload ?identit(y|ies))\b/i],
    ["serviceaccount", /\b(serviceaccounts?|svc|msa|sa)\b/i],
    ["devops", /\b(devops)\b/i],
    ["admin", /\b(admins?)\b/i],
    ["internal", /\b(internals?|employees?)\b/i],
    ["global", /\b(global)\b/i],
  ];
  function personaKey(name) {
    const n = String(name || "").replace(/[-_]/g, " ");
    for (const [key, re] of PERSONA_KEYS) if (re.test(n)) return key;
    return null;
  }

  // words that appear in nearly every policy name and so carry no signal
  const STOP = new Set(["ca", "v", "new", "up", "the", "and", "or", "for", "to", "of", "a",
    "anyapp", "anyapps", "allapps", "anyplatform", "allplatforms", "policy", "access"]);
  function tokens(name) {
    return new Set(String(name || "").toLowerCase()
      .replace(/\bca\d{3,4}\b/g, " ")           // the number is compared separately
      .replace(/\bv?\d+(\.\d+)*\b/g, " ")       // versions
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 2 && !STOP.has(t)));
  }
  // overlap relative to the smaller set — a long tenant name should not be
  // penalised for carrying extra descriptive words
  function similarity(a, b) {
    const A = tokens(a), B = tokens(b);
    if (!A.size || !B.size) return 0;
    let hit = 0;
    for (const t of A) if (B.has(t)) hit++;
    return hit / Math.min(A.size, B.size);
  }

  const MIN_SIMILARITY = 0.25;

  // Does the tenant policy plausibly correspond to this baseline policy?
  // Returns null when it does, or a reason string when it clearly does not.
  function mismatchReason(baselineName, tenantName) {
    const bp = personaKey(baselineName), tp = personaKey(tenantName);
    if (bp && tp && bp !== tp) return `different persona — the baseline policy is ${bp}, this one is ${tp}`;
    const sim = similarity(baselineName, tenantName);
    if (sim < MIN_SIMILARITY) return `the names have almost nothing in common (${Math.round(sim * 100)}% overlap)`;
    return null;
  }

  const STATUS = {
    ok: { icon: "✓", label: "Up to date", cls: "ok", order: 3 },
    outdated: { icon: "⬆", label: "Outdated", cls: "warn", order: 1 },
    ahead: { icon: "⬇", label: "Newer than baseline", cls: "info", order: 4 },
    present: { icon: "✓", label: "Present", cls: "ok", order: 2 },
    unversioned: { icon: "?", label: "Version unknown", cls: "info", order: 5 },
    missing: { icon: "✗", label: "Missing", cls: "bad", order: 0 },
    conflict: { icon: "⚠", label: "Number clash", cls: "warn", order: 0.5 },
    extra: { icon: "＋", label: "Not in baseline", cls: "info", order: 6 },
  };

  const caNum = (name) => { const m = /CA(\d{3,4})/i.exec(name || ""); return m ? +m[1] : null; };
  const version = (name) => { const m = /v\s?(\d+\.\d+(?:\.\d+)?)\s*$/i.exec((name || "").trim()); return m ? m[1] : null; };

  // -1 a<b, 0 equal, 1 a>b — segment-wise, so 1.0.10 > 1.0.9
  function cmpVersion(a, b) {
    const pa = String(a).split(".").map(Number), pb = String(b).split(".").map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const x = pa[i] || 0, y = pb[i] || 0;
      if (x !== y) return x < y ? -1 : 1;
    }
    return 0;
  }

  // Render.caGroup matches CA followed by 3-4 digits, so the number has to be
  // zero-padded first — CA1 would otherwise fall through as "unnumbered".
  const caLabel = (num) => `CA${String(num).padStart(3, "0")}`;
  // A catalog policy may carry its own persona label (Joey's ranges differ from
  // the Limon-IT ones — his CA300 block is service accounts, not externals).
  const personaOf = (num, pol) => {
    if (pol && pol.persona) return pol.persona;
    try { return Render.caGroup(caLabel(num)).label; } catch { return "Other"; }
  };

  // ---- compare tenant policies against the catalog ----
  // vms: the app's view models ({ id, name, state, raw }).
  function compare(vms, catId) {
    const cat = catalog(catId);
    const byNum = new Map();
    for (const p of vms) {
      const n = caNum(p.name);
      if (n == null) continue;
      // duplicate CA numbers in a tenant are real (a leftover copy) — keep both
      if (!byNum.has(n)) byNum.set(n, []);
      byNum.get(n).push(p);
    }

    const rows = [];
    for (const b of cat.policies) {
      const hits = byNum.get(b.num) || [];
      if (!hits.length) {
        rows.push({ num: b.num, baseline: b, tenant: null, status: "missing" });
        continue;
      }
      // when a number appears twice, judge on the best (newest) match
      const scored = hits.map((p) => {
        const tv = version(p.name);
        let status;
        // a number match that the name contradicts is a clash, not a match
        const why = mismatchReason(b.name, p.name);
        if (why) return { p, tv, status: "conflict", why };
        if (tv && b.version) {
          const c = cmpVersion(tv, b.version);
          status = c === 0 ? "ok" : c < 0 ? "outdated" : "ahead";
        } else if (!b.version) {
          // this baseline does not version its policy names — being there is
          // the whole test, so do not report it as "version unknown"
          status = "present";
        } else {
          status = "unversioned";
        }
        return { p, tv, status };
      }).sort((a, b2) => STATUS[b2.status].order - STATUS[a.status].order);
      const best = scored[0];
      // every candidate contradicted the baseline → the policy is really absent
      rows.push({
        num: b.num, baseline: b, tenant: best.p, tenantVersion: best.tv,
        status: best.status, why: best.why || null,
        duplicates: hits.length > 1 ? hits.length : 0,
      });
      byNum.delete(b.num);
    }
    // numbered policies the baseline does not define
    for (const [num, hits] of byNum) {
      rows.push({ num, baseline: null, tenant: hits[0], tenantVersion: version(hits[0].name), status: "extra", duplicates: hits.length > 1 ? hits.length : 0 });
    }
    rows.sort((a, b) => a.num - b.num);

    const counts = {};
    rows.forEach((r) => { counts[r.status] = (counts[r.status] || 0) + 1; });
    const covered = rows.filter((r) => r.baseline && r.tenant && r.status !== "conflict").length;
    return {
      rows, counts,
      catalog: cat,
      baselineTotal: cat.policies.length,
      covered,
      coverage: cat.policies.length ? Math.round((covered / cat.policies.length) * 100) : 0,
      // what an import would actually bring in
      toImport: rows.filter((r) => ["missing", "outdated", "conflict"].includes(r.status)),
    };
  }

  // ---- rendering ----
  function renderSummary(res) {
    const chip = (k) => res.counts[k] ? `<span class="bl-chip ${STATUS[k].cls}">${STATUS[k].icon} ${res.counts[k]} ${esc(STATUS[k].label.toLowerCase())}</span>` : "";
    const order = ["missing", "conflict", "outdated", "ok", "present", "ahead", "unversioned", "extra"];
    return `<div style="display:flex;gap:18px;align-items:flex-start;flex-wrap:wrap">
      <div style="flex:1;min-width:280px">
        <h3>${esc(res.catalog.icon || "🧬")} ${esc(res.catalog.label)} baseline — ${esc(res.catalog.release)}${res.catalog.line ? ` (${esc(res.catalog.line)})` : ""}${!res.catalog.url && res.catalog.released ? ` <span class="mini muted">rev ${esc(res.catalog.released)}</span>` : ""}</h3>
        <p style="margin-bottom:10px">Your tenant matched against the ${esc(res.catalog.author || res.catalog.label)} Conditional Access baseline, policy by policy on the CA number.
          ${res.catalog.url ? `Source: <a href="${esc(res.catalog.url)}" target="_blank" rel="noopener noreferrer">${esc(res.catalog.url)}</a>${res.catalog.released ? ` · released ${esc(res.catalog.released)}` : ""}. ` : ""}
          ${res.catalog.importerUrl ? `Deploy it with the author's importer at <a href="${esc(res.catalog.importerUrl)}" target="_blank" rel="noopener noreferrer">${esc(res.catalog.importerUrl)}</a>. ` : ""}
          Version differences are compared per segment, so an older deployment shows as <b>outdated</b> rather than present.</p>
        <div style="display:flex;gap:6px;flex-wrap:wrap">${order.map(chip).join("")}</div>
      </div>
      <div style="text-align:right">
        <div style="font-size:26px;font-weight:700">${res.coverage}%<span class="mini" style="font-weight:400"> coverage</span></div>
        <div class="mini">${res.covered} of ${res.baselineTotal} baseline policies present</div>
        <div class="mini">${res.toImport.length} would be imported or updated</div>
        ${res.catalog.note ? `<div class="mini" style="max-width:280px;margin-top:6px">${esc(res.catalog.note)}</div>` : ""}
      </div>
    </div>`;
  }

  function chips(res, active) {
    const all = res.rows.length;
    const items = [["all", `All (${all})`]].concat(
      ["missing", "conflict", "outdated", "ok", "present", "ahead", "unversioned", "extra"]
        .filter((k) => res.counts[k])
        .map((k) => [k, `${STATUS[k].icon} ${STATUS[k].label} (${res.counts[k]})`]));
    return items.map(([k, l]) => `<button class="fchip ${active === k ? "active" : ""}" data-blf="${k}">${esc(l)}</button>`).join("");
  }

  // ---- what changed between the tenant's policy and the baseline version ----
  // The catalog stores an assignment list and rendered control strings; the
  // tenant side is the same view model the cards use, so assignments compare
  // directly and the controls compare as normalised text.
  const normTxt = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
  const setDiff = (a, b) => {   // in a, not in b (case-insensitive)
    const B = new Set((b || []).map(normTxt));
    return (a || []).filter((x) => !B.has(normTxt(x)));
  };
  function changes(r) {
    if (!r.baseline || !r.tenant) return [];
    const b = r.baseline, vm = r.tenant, out = [];
    const bInc = b.include || [], bExc = b.exclude || [];
    const tInc = (vm.users && vm.users.inc) || [], tExc = (vm.users && vm.users.exc) || [];
    setDiff(bExc, tExc).forEach((x) => out.push({ k: "add", t: "exclude " + x }));
    setDiff(tExc, bExc).forEach((x) => out.push({ k: "del", t: "exclude " + x }));
    setDiff(bInc, tInc).forEach((x) => out.push({ k: "add", t: "include " + x }));
    setDiff(tInc, bInc).forEach((x) => out.push({ k: "del", t: "include " + x }));
    // grant / block
    const bGrant = b.block ? "Block access" : (b.grant || "");
    const tGrant = vm.grant && vm.grant.mode === "block" ? "Block access" : ((vm.grant && vm.grant.controls) || []).join(" + ");
    if (normTxt(bGrant) !== normTxt(tGrant) && (bGrant || tGrant)) out.push({ k: "chg", t: `grant: ${tGrant || "—"} → ${bGrant || "—"}` });
    // session controls
    const bSess = b.session || "";
    const tSess = ((vm.session) || []).map((s) => s.t).join(" · ");
    if (normTxt(bSess) !== normTxt(tSess) && (bSess || tSess)) out.push({ k: "chg", t: `session: ${tSess || "none"} → ${bSess || "none"}` });
    return out;
  }

  function renderTable(res, filter, query, collapsed) {
    const q = (query || "").toLowerCase();
    const isCollapsed = (g) => collapsed && collapsed.has(g);
    let rows = res.rows;
    if (filter && filter !== "all") rows = rows.filter((r) => r.status === filter);
    if (q) rows = rows.filter((r) => `${r.num} ${r.baseline?.name || ""} ${r.tenant?.name || ""}`.toLowerCase().includes(q));
    if (!rows.length) return '<p class="mini" style="padding:20px">No baseline policies match the current filter.</p>';

    // how many rows each persona holds, so a collapsed header can still say
    const perGroup = new Map();
    rows.forEach((r) => {
      const g = personaOf(r.num, r.baseline);
      perGroup.set(g, (perGroup.get(g) || 0) + 1);
    });

    let body = "", lastGroup = null;
    for (const r of rows) {
      const g = personaOf(r.num, r.baseline);
      if (g !== lastGroup) {
        const n = perGroup.get(g), col = isCollapsed(g);
        body += `<tr class="grouprow${col ? " collapsed" : ""}" data-blgroup="${esc(g)}"><td colspan="6">
          <span class="caret">▶</span> <b>${esc(g)}</b>
          <span class="mini">${n} ${n === 1 ? "policy" : "policies"}${col ? " · click to expand" : ""}</span></td></tr>`;
        lastGroup = g;
      }
      if (isCollapsed(g)) continue;
      const s = STATUS[r.status];
      const bName = r.baseline ? r.baseline.name : "—";
      const tag = r.baseline?.tag ? `<span class="tag new">${esc(r.baseline.tag)}</span>` : "";
      const tenant = r.tenant
        ? `<span class="pname" data-blpol="${esc(r.tenant.id)}">${esc(r.tenant.name)}</span>
           <div class="mini">state: ${esc(r.tenant.state === "report" ? "report-only" : r.tenant.state)}${r.duplicates ? ` · ⚠ ${r.duplicates} policies share CA${r.num}` : ""}${r.why ? ` · <b>${esc(r.why)}</b>` : ""}</div>`
        : '<span class="mini">not present in this tenant</span>';
      const ver = r.status === "outdated"
        ? `<span class="bl-ver warn">${esc(r.tenantVersion)} → ${esc(r.baseline.version)}</span>`
        : r.status === "missing" ? `<span class="mini">${esc(r.baseline.version || "—")}</span>`
        : r.status === "extra" ? `<span class="mini">${esc(r.tenantVersion || "—")}</span>`
        : `<span class="mini">${esc(r.tenantVersion || r.baseline?.version || "—")}</span>`;
      const ch = changes(r);
      const chCell = r.status === "missing" ? '<span class="mini muted">new policy</span>'
        : r.status === "extra" ? '<span class="mini muted">not in baseline</span>'
        : ch.length
          ? `<div class="bl-ch">${ch.slice(0, 6).map((c) =>
              `<span class="bl-chip ${c.k}" title="${esc(c.t)}">${c.k === "add" ? "+" : c.k === "del" ? "−" : "~"} ${esc(c.t)}</span>`).join("")}
             ${ch.length > 6 ? `<span class="mini muted">+${ch.length - 6} more</span>` : ""}</div>`
          : '<span class="mini muted">no assignment or control change</span>';
      body += `<tr>
        <td class="bl-st"><span class="bl-badge ${s.cls}" title="${esc(s.label)}">${s.icon}</span></td>
        <td><b>CA${String(r.num).padStart(3, "0")}</b></td>
        <td>${esc(bName)} ${tag}<div class="mini">${esc(r.baseline ? `${r.baseline.resources} · ${r.baseline.grant}` : "")}</div></td>
        <td>${tenant}</td>
        <td>${ver}</td>
        <td class="bl-chcell">${chCell}</td>
      </tr>`;
    }
    return `<div class="list-card"><table class="plist bl-table">
      <thead><tr><th style="width:44px"></th><th style="width:78px">CA</th><th>Baseline policy (${esc(BASELINE.release)})</th><th>In this tenant</th><th style="width:150px">Version</th><th style="width:280px">Changes</th></tr></thead>
      <tbody>${body}</tbody></table></div>`;
  }


  // ---- card view: render a baseline policy from the catalog alone ----
  // Same shape as the tenant policy cards, so a baseline policy reads the
  // same way as a deployed one — plus a status ribbon showing how this
  // tenant compares.
  const ICON = (p) => p.block ? "🚫" : /SESSION/i.test(p.name) ? "🕒" : "🔐";

  function policyCard(r) {
    const b = r.baseline;
    const s = STATUS[r.status];
    const sect = (label, body, cls) => body
      ? `<div class="bc-sect"><label>${esc(label)}</label><div class="${cls || ""}">${body}</div></div>` : "";
    const items = (arr, cls) => arr.length
      ? `<ul class="bc-list${cls ? " " + cls : ""}">${arr.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : "";

    const status = `<div class="bc-status ${s.cls}">
        <b>${s.icon} ${esc(s.label)}</b>
        <span class="mini">${r.status === "conflict"
          ? `CA${String(r.num).padStart(3, "0")} in this tenant is <b>${esc(r.tenant.name)}</b> — ${esc(r.why)}. Treat the baseline policy as not deployed.`
          : r.tenant
          ? `in tenant: ${esc(r.tenant.name)}${r.status === "outdated" ? ` — v${esc(r.tenantVersion)} vs baseline v${esc(b.version)}` : ""}`
          : "not present in this tenant"}</span>
      </div>`;

    return `<div class="list-card bc-card ${s.cls}">
      <div class="bc-head">
        <div class="bc-ic">${ICON(b)}</div>
        <div style="flex:1;min-width:0">
          <h3>${esc(b.name)}</h3>
          <div class="mini">CA${String(b.num).padStart(3, "0")} · ${esc(personaOf(b.num, b))}${b.version ? ` · v${esc(b.version)}` : ""}</div>
        </div>
        ${b.tag ? `<span class="tag new">${esc(b.tag)}</span>` : ""}
      </div>
      ${status}
      <div class="bc-body">
        ${b.description ? `<div class="bc-sect"><p class="mini" style="line-height:1.5">${esc(b.description)}</p></div>` : ""}
        ${sect("Users — include", items(b.include || []))}
        ${sect("Users — exclude", items(b.exclude || [], "excl"))}
        ${sect("Target resources", esc(b.resources || "—"))}
        ${sect("Device platforms", b.platform ? esc(b.platform) : "")}
        ${sect("Network", esc(b.network || "Any network or location"))}
        ${sect("Conditions", Array.isArray(b.conditions) ? items(b.conditions) : esc(b.conditions || ""))}
        ${sect(b.block ? "Block" : "Grant", `<b>${esc(b.grant || "—")}</b>`)}
        ${sect("Session", esc(b.session))}
        ${b.docUrl ? `<a class="ml-doc" href="${esc(b.docUrl)}" target="_blank" rel="noopener noreferrer">↗ Documentation</a>` : ""}
        ${b.fileUrl ? `<a class="ml-doc" href="${esc(b.fileUrl)}" target="_blank" rel="noopener noreferrer">↗ Policy JSON in the repository</a>` : ""}
      </div>
    </div>`;
  }

  function renderCards(res, filter, query, collapsed) {
    const q = (query || "").toLowerCase();
    const isCollapsed = (g) => collapsed && collapsed.has(g);
    let rows = res.rows.filter((r) => r.baseline);   // the catalog is the subject here
    if (filter && filter !== "all") rows = rows.filter((r) => r.status === filter);
    if (q) rows = rows.filter((r) => `${r.num} ${r.baseline.name} ${r.tenant?.name || ""}`.toLowerCase().includes(q));
    if (!rows.length) return '<p class="mini" style="padding:20px">No baseline policies match the current filter.</p>';

    // per-persona counts, including how many are missing — that is the number
    // worth seeing on a collapsed header
    const stats = new Map();
    rows.forEach((r) => {
      const g = personaOf(r.num, r.baseline);
      const st = stats.get(g) || { n: 0, gap: 0 };
      st.n++;
      if (r.status === "missing" || r.status === "conflict" || r.status === "outdated") st.gap++;
      stats.set(g, st);
    });

    let html = "", lastGroup = null;
    for (const r of rows) {
      const g = personaOf(r.num, r.baseline);
      if (g !== lastGroup) {
        const st = stats.get(g), col = isCollapsed(g);
        html += `<div class="cardgroup${col ? " collapsed" : ""}" data-blgroup="${esc(g)}">
          <span class="caret">▶</span><h3>${esc(g)}</h3>
          <span class="mini">${st.n} ${st.n === 1 ? "policy" : "policies"}${st.gap ? ` · ${st.gap} to address` : " · all present"}${col ? " · click to expand" : ""}</span>
        </div>`;
        lastGroup = g;
      }
      if (isCollapsed(g)) continue;
      html += policyCard(r);
    }
    return `<div class="bc-grid">${html}</div>`;
  }

  // every persona currently on screen, for collapse-all / expand-all
  function personas(res, filter, query) {
    const q = (query || "").toLowerCase();
    let rows = res.rows.filter((r) => r.baseline);
    if (filter && filter !== "all") rows = rows.filter((r) => r.status === filter);
    if (q) rows = rows.filter((r) => `${r.num} ${r.baseline.name} ${r.tenant?.name || ""}`.toLowerCase().includes(q));
    return [...new Set(rows.map((r) => personaOf(r.num, r.baseline)))];
  }

  // ---- Markdown export ----
  const mdEsc = (v) => String(v ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
  function toMd(res, tenantName) {
    const L = [];
    L.push(`# Baseline comparison — ${mdEsc(tenantName || "tenant")} vs the ${mdEsc(res.catalog.label)} baseline ${mdEsc(res.catalog.release)}`);
    L.push("");
    L.push(`Generated ${new Date().toISOString().replace("T", " ").slice(0, 16)} UTC by Conditional Access Baseline Tools (cadoc.limon-it.nl).`);
    if (res.catalog.url) L.push(`Baseline source: ${res.catalog.url}`);
    L.push("");
    L.push(`- Baseline coverage: **${res.coverage}%** — ${res.covered} of ${res.baselineTotal} baseline policies present in the tenant.`);
    ["missing", "conflict", "outdated", "ok", "present", "ahead", "unversioned", "extra"].forEach((k) => {
      if (res.counts[k]) L.push(`- ${STATUS[k].label}: **${res.counts[k]}**`);
    });
    L.push(`- Import would add or update **${res.toImport.length}** policies.`);
    L.push("");
    L.push("| Status | CA | Baseline policy | In tenant | Version |");
    L.push("| --- | --- | --- | --- | --- |");
    for (const r of res.rows) {
      const v = r.status === "outdated" ? `${r.tenantVersion} → ${r.baseline.version}` : (r.tenantVersion || r.baseline?.version || "—");
      L.push(`| ${STATUS[r.status].label} | CA${String(r.num).padStart(3, "0")} | ${mdEsc(r.baseline?.name || "—")} | ${mdEsc(r.tenant?.name || "—")}${r.why ? ` — ${mdEsc(r.why)}` : ""} | ${mdEsc(v)} |`);
    }
    L.push("");
    if (res.toImport.length) {
      L.push("## Would be imported or updated");
      L.push("");
      for (const r of res.toImport) L.push(`- **CA${String(r.num).padStart(3, "0")}** ${mdEsc(r.baseline.name)}${
        r.status === "outdated" ? ` — currently v${mdEsc(r.tenantVersion)}`
        : r.status === "conflict" ? ` — CA${String(r.num).padStart(3, "0")} is taken by "${mdEsc(r.tenant.name)}" (${mdEsc(r.why)})`
        : " — not present"}`);
      L.push("");
    }
    return L.join("\n");
  }

  return { catalogs, catalog, compare, personas, personaKey, similarity, mismatchReason, renderSummary, chips, renderTable, renderCards, changes, toMd, STATUS, caNum, version, cmpVersion };
})();
