// ======================================================================
// Rendering: policy list, cards, matrix.
// ======================================================================
const Render = (() => {
  const esc = (s) => String(s).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  const stateChip = (s) => `<span class="state ${s}">${LABELS.stateText[s]}</span>`;
  // Long lists (e.g. a policy targeting ~100 roles) flow inline instead of one
  // item per line, so an exported card still fits on a single page.
  const FLOW_AT = 10;
  const li = (items, cls) => {
    if (!items.length) return "";
    if (items.length > FLOW_AT) {
      const txt = items.map(x => (cls === "excl" ? "− " : "") + esc(x)).join(" · ");
      return `<li class="mini">${items.length} entries:</li><li class="flow${cls ? " " + cls : ""}">${txt}</li>`;
    }
    return items.map(i => `<li${cls ? ` class="${cls}"` : ""}>${cls === "excl" ? "− " : ""}${esc(i)}</li>`).join("");
  };

  function listRows(policies, selected, stateFilter, query) {
    return policies
      .filter(p => stateFilter === "all" || p.state === stateFilter)
      .filter(p => !query || p.name.toLowerCase().includes(query))
      .map(p => `<tr>
        <td><input type="checkbox" data-sel="${p.id}" ${selected.has(p.id) ? "checked" : ""}></td>
        <td><div class="pname" data-open="${p.id}">${esc(p.name)}</div>
            <div class="mini">${p.seq}${p.usesNew ? ' · <span class="tag new">uses new CA settings</span>' : ""}</div></td>
        <td>${stateChip(p.state)}</td>
        <td class="mini">${esc(p.users.inc[0] || "")}${p.users.exc.length ? `<br><span class="excl-note">− ${p.users.exc.length} excluded</span>` : ""}</td>
        <td class="mini">${esc(p.apps.inc.slice(0, 2).join(", "))}${p.apps.inc.length > 2 ? "…" : ""}</td>
        <td class="mini">${esc(p.grant.controls[0] || "")}</td>
        <td class="mini">${p.modified}</td>
      </tr>`).join("");
  }

  function stateChips(policies, active) {
    const counts = { all: policies.length, on: 0, report: 0, off: 0 };
    policies.forEach(p => counts[p.state]++);
    return [["all", "All"], ["on", "On"], ["report", "Report-only"], ["off", "Off"]]
      .map(([k, t]) => `<button class="fchip ${active === k ? "active" : ""}" data-state="${k}">${t} (${counts[k]})</button>`).join("");
  }

  // Persona group from the CA number in the policy name (persona-based CA framework):
  // CA000-099 Global, CA100-199 Admins, CA200-299 Internals, CA300-399 Externals,
  // CA400-499 Guest users, CA500-599 Guest admins, CA600-699 M365 service accounts,
  // CA700-799 Azure service accounts, CA800-899 Corp service accounts,
  // CA900-999 Workload identities, CA1000-1099 DevOps.
  const CA_RANGES = {
    0: "Global", 100: "Admins", 200: "Internals", 300: "Externals",
    400: "Guest users", 500: "Guest admins", 600: "Microsoft 365 service accounts",
    700: "Azure service accounts", 800: "Corp service accounts",
    900: "Workload identities", 1000: "DevOps",
  };
  function caGroup(name) {
    const m = /CA(\d{3,4})/i.exec(name || "");
    if (!m) return { key: 99999, num: null, label: "Other / unnumbered" };
    const n = +m[1];
    const base = Math.floor(n / 100) * 100;
    const persona = CA_RANGES[base] || `CA${base}+`;
    const hi = base + 99;
    return { key: base, num: n, label: `${persona} (CA${String(base).padStart(3, "0")}–CA${String(hi).padStart(3, "0")})` };
  }

  // Cards view grouped by CA number range, with a collapsible section header per persona.
  function groupedCards(vis, selected, collapsed) {
    const groups = new Map();
    vis.forEach(p => {
      const g = caGroup(p.name);
      if (!groups.has(g.key)) groups.set(g.key, { label: g.label, items: [] });
      groups.get(g.key).items.push({ p, num: g.num });
    });
    return [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([key, g]) => {
      const isCollapsed = collapsed && collapsed.has(String(key));
      return `<div class="cardgroup${isCollapsed ? " collapsed" : ""}" data-gkey="${key}">
        <span class="caret">▶</span><h3>${esc(g.label)}</h3>
        <span class="mini">${g.items.length} ${g.items.length === 1 ? "policy" : "policies"}${isCollapsed ? " · click to expand" : ""}</span>
      </div>` +
      (isCollapsed ? "" : g.items
        .sort((a, b) => (a.num ?? 1e9) - (b.num ?? 1e9) || a.p.name.localeCompare(b.p.name))
        .map(x => summaryCard(x.p, selected)).join(""));
    }).join("");
  }

  // Compact summary card for the on-site cards view (multiple per row).
  function summaryCard(p, selected) {
    const enforcement = p.grant.mode === "block" ? "Block"
      : p.grant.controls[0] === "No controls (grant)"
        ? (p.session.length ? "Session only" : "Grant")
        : (p.session.length ? "Grant + Session" : "Grant");
    return `<div class="scard" data-open="${p.id}">
      <div class="scard-top">
        <div class="scard-ic"><img src="assets/logo-mark-light.svg" width="24" height="24" alt=""></div>
        <div class="scard-title">
          <h3>${esc(p.name)}</h3>
          <div class="mini">Modified ${p.modified} · ${p.seq}</div>
        </div>
        <div class="scard-right">${stateChip(p.state)}<input type="checkbox" data-sel="${p.id}" ${selected && selected.has(p.id) ? "checked" : ""}></div>
      </div>
      <div class="scard-grid">
        <div><label>User Scope</label><b>${esc(p.users.inc[0] || "")}${p.users.exc.length ? ` <span class="excl-note">(−${p.users.exc.length})</span>` : ""}</b></div>
        <div><label>Applications</label><b>${esc(p.apps.inc[0] || "")}${p.apps.exc.length ? ` <span class="excl-note">(−${p.apps.exc.length})</span>` : ""}</b></div>
        <div><label>Enforcement</label><b>${enforcement}</b></div>
        <div><label>New CA settings</label><b>${p.usesNew ? '<span class="tag new">yes</span>' : "—"}</b></div>
      </div>
      <div class="scard-controls"><label>Grant Controls</label>
        ${p.grant.controls.map(g => `<span class="tag ${p.grant.mode === "block" ? "block" : "grant"}">${esc(g)}</span>`).join("")}
        ${p.session.map(s => `<span class="tag${s.isNew ? " new" : ""}">${esc(s.t)}</span>`).join("")}
      </div>
      <div class="scard-foot">Policy ID: ${esc(p.id)}</div>
    </div>`;
  }

  // opts.export: neutral output (no Limon-IT branding, no buttons);
  // opts.logo: tenant branding logo (data URL) used instead, when available.
  function card(p, tenantName, opts = {}) {
    const c = p.cond;
    const newTags = (arr) => arr.map(f => `<span class="tag new">${esc(f)}</span>`).join("");
    const headLogo = opts.export
      ? (opts.logo ? `<img src="${opts.logo}" style="height:30px;max-width:140px;object-fit:contain" alt="">` : "")
      : `<img src="assets/logo-mark-dark.svg" width="30" height="30" alt="">`;
    const foot = opts.export
      ? `<span class="mini">Conditional Access documentation${tenantName ? " · " + esc(tenantName) : ""} · ${new Date().toISOString().slice(0, 10)}</span>`
      : `<span class="mini">Generated by CA Doc · cadoc.limon-it.nl · ${new Date().toISOString().slice(0, 10)}</span>
         <button class="btn" data-png="${p.id}">↓ Save PNG</button>`;
    return `<div class="pcard${opts.export ? " neutral" : ""}" data-card="${p.id}">
      <div class="pcard-head">
        ${headLogo}
        <div style="flex:1"><h3>${p.seq} — ${esc(p.name)}</h3>
          <div class="meta">Modified ${p.modified}${tenantName ? " · " + esc(tenantName) : ""}</div></div>
        ${stateChip(p.state)}
      </div>
      <div class="pcard-grid">
        <div class="sect${p.users.inc.length + p.users.exc.length > FLOW_AT ? " wide" : ""}"><h4>👤 Users</h4><ul>${li(p.users.inc)}${li(p.users.exc, "excl")}</ul></div>
        <div class="sect${p.apps.inc.length + p.apps.exc.length > FLOW_AT ? " wide" : ""}"><h4>📦 Target resources</h4><ul>${li(p.apps.inc)}${li(p.apps.exc, "excl")}
          ${p.apps.filter ? `<li><b>App filter (${p.apps.filter.mode}):</b> <code>${esc(p.apps.filter.rule)}</code></li>` : ""}</ul></div>
        <div class="sect"><h4>🌐 Network</h4><ul>${li(p.net.inc)}${li(p.net.exc, "excl")}</ul></div>
        <div class="sect"><h4>⚙️ Conditions</h4><ul>
          ${c.platforms.length ? `<li><b>Platforms:</b> ${esc(c.platforms.join(", "))}${c.platformsExc.length ? ` <span class="excl-note">(excl. ${esc(c.platformsExc.join(", "))})</span>` : ""}</li>` : ""}
          ${c.clientApps.length ? `<li><b>Client apps:</b> ${esc(c.clientApps.join(", "))}</li>` : ""}
          ${c.risks.map(r => `<li><b>${esc(r.split(":")[0])}:</b>${esc(r.split(":").slice(1).join(":"))}</li>`).join("")}
          ${c.devFilter ? `<li><b>Device filter (${c.devFilter.mode}):</b> <code>${esc(c.devFilter.rule)}</code></li>` : ""}
          ${c.authFlows.length ? `<li><b>Auth flows:</b> ${newTags(c.authFlows)}</li>` : ""}
          ${c.insider.length ? `<li><b>Insider risk:</b> ${newTags(c.insider)}</li>` : ""}
          ${!c.platforms.length && !c.clientApps.length && !c.risks.length && !c.devFilter && !c.authFlows.length && !c.insider.length ? '<li class="na">No additional conditions</li>' : ""}
        </ul></div>
        <div class="sect"><h4>${p.grant.mode === "block" ? "⛔ Block" : "✅ Grant"}</h4><ul>
          ${p.grant.controls.map(g => `<li><span class="tag ${p.grant.mode === "block" ? "block" : "grant"}">${esc(g)}</span></li>`).join("")}
          ${p.grant.op ? `<li class="mini">Require ${p.grant.op === "OR" ? "one" : "all"} of the selected controls</li>` : ""}
        </ul></div>
        <div class="sect"><h4>⏱ Session</h4><ul>
          ${p.session.length ? p.session.map(s => `<li>${s.isNew ? `<span class="tag new">${esc(s.t)}</span>` : esc(s.t)}</li>`).join("") : '<li class="na">No session controls</li>'}
        </ul></div>
      </div>
      <div class="pcard-foot">${foot}</div>
    </div>`;
  }

  // Collapse long cell lists (e.g. a policy targeting dozens of roles).
  // opts.full disables clipping — used for PDF export so nothing is hidden.
  const CLIP = 6;
  function clipList(lines, full) {
    if (!lines.length) return "—";
    if (full || lines.length <= CLIP + 1) return lines.join("<br>");
    const rest = lines.slice(CLIP);
    return `<span class="clipgrp">${lines.slice(0, CLIP).join("<br>")}` +
      `<span class="clip-rest" hidden><br>${rest.join("<br>")}</span>` +
      `<br><button type="button" class="clip-btn" data-more="${rest.length}">▾ ${rest.length} more</button></span>`;
  }

  function matrix(ps, opts = {}) {
    const full = !!opts.full;
    const rows = [
      ["State", p => stateChip(p.state)],
      ["Users incl.", p => clipList(p.users.inc.map(esc), full)],
      ["Users excl.", p => clipList(p.users.exc.map(x => `<span class="excl-note">− ${esc(x)}</span>`), full)],
      ["Target resources", p => clipList(p.apps.inc.map(esc), full)
        + (p.apps.exc.length ? `<br>${clipList(p.apps.exc.map(x => `<span class="excl-note">− ${esc(x)}</span>`), full)}` : "")
        + (p.apps.filter ? `<br>Filter (${p.apps.filter.mode}): <code>${esc(p.apps.filter.rule)}</code>` : "")],
      ["Network", p => esc(p.net.inc.join(", ")) + (p.net.exc.length ? `<br><span class="excl-note">− ${esc(p.net.exc.join(", "))}</span>` : "")],
      ["Platforms", p => (esc(p.cond.platforms.join(", ")) || "—")
        + (p.cond.platformsExc.length ? ` <span class="excl-note">(excl. ${esc(p.cond.platformsExc.join(", "))})</span>` : "")],
      ["Client apps", p => esc(p.cond.clientApps.join(", ")) || "—"],
      ["Risk", p => esc(p.cond.risks.join("; ")) || "—"],
      ["Auth flows", p => esc(p.cond.authFlows.join(", ")) || "—"],
      ["Insider risk", p => esc(p.cond.insider.join(", ")) || "—"],
      ["Device filter", p => p.cond.devFilter ? `${p.cond.devFilter.mode}: <code>${esc(p.cond.devFilter.rule)}</code>` : "—"],
      ["Grant / Block", p => `<span class="dot ${p.grant.mode === "block" ? "r" : "g"}"></span>${esc(p.grant.controls.join(` ${p.grant.op || ""} `))}`],
      ["Session", p => clipList(p.session.map(s => esc(s.t)), full)],
    ];
    let html = "<thead><tr><th></th>" + ps.map(p => `<th>${p.seq}<br><span style="font-weight:400;opacity:.8">${esc(p.name)}</span></th>`).join("") + "</tr></thead><tbody>";
    rows.forEach(([label, fn]) => { html += `<tr><th>${label}</th>` + ps.map(p => `<td>${fn(p)}</td>`).join("") + "</tr>"; });
    return html + "</tbody>";
  }

  return { listRows, stateChips, card, summaryCard, groupedCards, caGroup, matrix, stateChip };
})();
