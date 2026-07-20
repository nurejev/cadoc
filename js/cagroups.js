// ======================================================================
// Conditional Access Groups — the groups a CA baseline depends on, as one
// tool. Four things you actually do with them:
//
//   1. Check     — is the expected set of groups present in this tenant?
//   2. Create    — make the missing ones (role-assignable, or dynamic with
//                  their rule where the template says so).
//   3. Members   — who is in them, as a members × groups matrix.
//   4. Assign    — point policies at them (the assign-groups wizard).
//
// "Expected" is the union of three sources, because no single one is complete:
//   · GROUP_TEMPLATES        — the reference group export
//   · the baseline catalog   — every group named in an include/exclude list
//   · the tenant's policies  — groups the deployment already references
// A group referenced by a policy but absent from the directory is the case
// worth catching: Entra keeps the dangling GUID and the policy silently
// targets nothing.
//
// Read-only except Create. Directory.Read.All covers the scan; creation
// consents Group.ReadWrite.All + RoleManagement.ReadWrite.Directory on demand
// via Assign.createGroup, so the rules about role-assignable vs dynamic live
// in exactly one place.
// ======================================================================
const CaGroups = (() => {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  const isGuid = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s || "");
  const MEMBER_CAP = 500;   // per group — a 10k group would stall the matrix
  const chunk = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };

  const STATUS = {
    present: { icon: "✓", label: "Present", cls: "ok", order: 2 },
    missing: { icon: "✗", label: "Missing", cls: "bad", order: 0 },
    dangling: { icon: "⚠", label: "Referenced but gone", cls: "warn", order: 1 },
    extra: { icon: "＋", label: "Not in the baseline", cls: "info", order: 3 },
  };

  // ---- what the baseline expects -----------------------------------------
  // Catalog entries carry assignment as display strings like
  // "CAB-SEC-U-CA001-Exclusion (group)" — only the "(group)" ones are groups;
  // roles, guest types and "All users" are not.
  const GROUP_SUFFIX = /\s*\(group\)\s*$/i;

  // Which catalogs' groups count as "expected" here. The Limon-IT catalog is
  // this app's own baseline and always counts. A second catalog only counts if
  // the tenant actually deploys it — otherwise every group of a baseline you
  // never chose would be reported missing, which is noise, not a finding.
  const JOEY_MIN_MATCH = 3;
  function activeCatalogs(raws) {
    const out = [];
    if (typeof BASELINE !== "undefined") out.push(BASELINE);
    if (typeof BASELINE_JOEY !== "undefined") {
      const theirs = new Set((BASELINE_JOEY.policies || []).map((p) => String(p.name).toLowerCase()));
      const hits = (raws || []).filter((p) => theirs.has(String(p.name || "")
        .replace(/^\(?(NEW|UP)\)\s*/i, "").trim().toLowerCase())).length;
      if (hits >= JOEY_MIN_MATCH) out.push(BASELINE_JOEY);
    }
    return out;
  }

  function catalogGroupNames(raws) {
    const out = new Set();
    for (const cat of activeCatalogs(raws)) {
      for (const p of cat.policies || []) {
        for (const v of [...(p.include || []), ...(p.exclude || [])]) {
          if (GROUP_SUFFIX.test(v)) out.add(String(v).replace(GROUP_SUFFIX, "").trim());
        }
      }
      // Joey's catalog names its groups directly rather than per policy
      for (const g of cat.groups || []) if (!/^one /i.test(g)) out.add(g);
      if (cat.breakGlassGroup) out.add(cat.breakGlassGroup);
    }
    return out;
  }

  function templateNames() {
    const m = new Map();
    (typeof GROUP_TEMPLATES !== "undefined" ? GROUP_TEMPLATES : [])
      .forEach((t) => m.set(t.displayName, t));
    return m;
  }

  // Group ids referenced by the tenant's own policies, with the policies that
  // reference them — this is what makes a dangling reference findable.
  function policyRefs(raws) {
    const byId = new Map();
    for (const p of raws || []) {
      const u = (p.raw || p).conditions?.users || {};
      for (const [ids, how] of [[u.includeGroups, "include"], [u.excludeGroups, "exclude"]]) {
        for (const id of ids || []) {
          if (!isGuid(id)) continue;
          let e = byId.get(id);
          if (!e) { e = { id, include: [], exclude: [] }; byId.set(id, e); }
          e[how].push({ id: p.id, name: p.name || p.displayName || p.id });
        }
      }
    }
    return byId;
  }

  // ---- scan ---------------------------------------------------------------
  // onStatus is called with human-readable progress; the caller decides
  // whether to show it. Nothing here writes.
  async function scan(raws, opts) {
    const o = opts || {};
    const tpl = templateNames();
    const cat = catalogGroupNames(raws);
    const refs = policyRefs(raws);

    // Every expected name, with where the expectation comes from. A name in
    // more than one source is one row, not three.
    const expected = new Map();
    const want = (name, src) => {
      const n = String(name || "").trim(); if (!n) return;
      let e = expected.get(n);
      if (!e) { e = { name: n, sources: new Set(), template: tpl.get(n) || null }; expected.set(n, e); }
      e.sources.add(src);
    };
    tpl.forEach((t, n) => want(n, "template"));
    cat.forEach((n) => want(n, "catalog"));

    // Resolve the expected names in one $filter per chunk rather than one call
    // per group — 100+ sequential lookups is a visibly slow tool.
    const names = [...expected.keys()];
    const found = new Map();  // lowercased name -> {id,name,...}
    let done = 0;
    for (const part of chunk(names, 15)) {
      o.onStatus?.(`Looking up groups… ${done}/${names.length}`);
      const flt = part.map((n) => `displayName eq '${String(n).replace(/'/g, "''")}'`).join(" or ");
      try {
        const gs = await Graph.ggetAll(`/groups?$filter=${encodeURIComponent(flt)}`
          + `&$select=id,displayName,description,isAssignableToRole,groupTypes,membershipRule,securityEnabled,mailEnabled&$top=999`);
        gs.forEach((g) => found.set(String(g.displayName).toLowerCase(), g));
      } catch (e) { console.warn("CaGroups: name lookup failed", e.message); }
      done += part.length;
    }

    // Referenced-by-policy groups, resolved by id — these may not be in the
    // expected set at all (someone pointed a policy at an ad-hoc group).
    const byId = new Map();
    const refIds = [...refs.keys()];
    done = 0;
    for (const part of chunk(refIds, 15)) {
      o.onStatus?.(`Resolving referenced groups… ${done}/${refIds.length}`);
      const flt = part.map((i) => `id eq '${i}'`).join(" or ");
      try {
        const gs = await Graph.ggetAll(`/groups?$filter=${encodeURIComponent(flt)}`
          + `&$select=id,displayName,description,isAssignableToRole,groupTypes,membershipRule,securityEnabled,mailEnabled&$top=999`);
        gs.forEach((g) => byId.set(g.id, g));
      } catch (e) { console.warn("CaGroups: id lookup failed", e.message); }
      done += part.length;
    }

    const rows = [];
    const claimed = new Set();
    for (const e of expected.values()) {
      const g = found.get(e.name.toLowerCase()) || null;
      if (g) claimed.add(g.id);
      rows.push(row({
        name: e.name, group: g, template: e.template,
        sources: [...e.sources],
        status: g ? "present" : "missing",
        refs: g ? refs.get(g.id) : null,
      }));
    }
    // referenced groups that are not part of the expected set
    for (const [id, ref] of refs) {
      if (claimed.has(id)) continue;
      const g = byId.get(id) || null;
      rows.push(row({
        name: g ? g.displayName : id, group: g, template: null,
        sources: ["policy"],
        // referenced by a policy but not resolvable = the dangling case
        status: g ? "extra" : "dangling",
        refs: ref,
      }));
    }

    rows.sort((a, b) => STATUS[a.status].order - STATUS[b.status].order || a.name.localeCompare(b.name));
    const counts = rows.reduce((acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc; }, {});
    const expectedTotal = rows.filter((r) => r.status === "present" || r.status === "missing").length;
    return {
      rows, counts, expectedTotal,
      present: counts.present || 0,
      coverage: expectedTotal ? Math.round(((counts.present || 0) / expectedTotal) * 100) : 100,
      scanned: new Date(),
    };
  }

  function row(r) {
    const g = r.group;
    const dynamic = !!(g && (g.groupTypes || []).includes("DynamicMembership"));
    const nRef = r.refs ? (r.refs.include.length + r.refs.exclude.length) : 0;
    return {
      name: r.name, status: r.status, sources: r.sources, template: r.template,
      id: g ? g.id : null,
      description: g ? g.description || "" : (r.template?.description || ""),
      roleAssignable: g ? !!g.isAssignableToRole : null,
      dynamic, membershipRule: g ? g.membershipRule || "" : (r.template?.membershipRule || ""),
      refs: r.refs || { include: [], exclude: [] },
      refCount: nRef,
      members: null, memberTotal: null, memberError: null,
      // A role-assignable expectation that came back as a plain group is worth
      // knowing about: isAssignableToRole is immutable, so it cannot be fixed
      // in place — the group has to be recreated.
      drift: g && r.template && !r.template.membershipRule && !dynamic && !g.isAssignableToRole
        ? "not role-assignable (immutable — recreate to change)"
        : (g && r.template && r.template.membershipRule && !dynamic
          ? "template is dynamic but this group is assigned" : null),
    };
  }

  // Which expected groups can be created, i.e. we have a template for them.
  // Without one we would be inventing a mailNickname and a membership model.
  function creatable(res) {
    return res.rows.filter((r) => r.status === "missing" && r.template);
  }
  function missingNoTemplate(res) {
    return res.rows.filter((r) => r.status === "missing" && !r.template);
  }

  // ---- members ------------------------------------------------------------
  // One call per group, so this is opt-in and reports progress. `shouldStop`
  // lets the UI cancel a long scan without leaving half-filled rows lying.
  async function loadMembers(rows, opts) {
    const o = opts || {};
    const targets = rows.filter((r) => r.id);
    let i = 0;
    for (const r of targets) {
      if (o.shouldStop?.()) break;
      i++;
      o.onStatus?.(`Reading members… ${i}/${targets.length} · ${r.name}`, i, targets.length);
      try {
        const ms = await Graph.ggetAll(`/groups/${r.id}/transitiveMembers/microsoft.graph.user`
          + `?$select=id,displayName,userPrincipalName,accountEnabled&$top=999`);
        r.memberTotal = ms.length;
        r.members = ms.slice(0, MEMBER_CAP).map((m) => ({
          id: m.id, name: m.displayName || m.id, upn: m.userPrincipalName || "",
          disabled: m.accountEnabled === false,
        }));
        r.memberError = null;
      } catch (e) {
        r.members = []; r.memberTotal = null; r.memberError = e.message || String(e);
      }
      o.onProgress?.(i, targets.length);
    }
    return rows;
  }

  // members × groups. Only groups that were actually scanned become columns,
  // so an unscanned or failed group never reads as "nobody is in it".
  function matrix(rows) {
    const cols = rows.filter((r) => r.members);
    const users = new Map();
    cols.forEach((c) => {
      (c.members || []).forEach((m) => {
        let u = users.get(m.id);
        if (!u) { u = { ...m, groups: new Set() }; users.set(m.id, u); }
        u.groups.add(c.name);
      });
    });
    const list = [...users.values()].sort((a, b) =>
      b.groups.size - a.groups.size || a.name.localeCompare(b.name));
    return { cols, users: list, empty: cols.filter((c) => (c.memberTotal || 0) === 0) };
  }

  // ---- rendering ----------------------------------------------------------
  function renderSummary(res, tenant) {
    const chip = (k) => res.counts[k]
      ? `<span class="bl-chip ${STATUS[k].cls}">${STATUS[k].icon} ${res.counts[k]} ${esc(STATUS[k].label.toLowerCase())}</span>` : "";
    return `<div style="display:flex;gap:18px;align-items:flex-start;flex-wrap:wrap">
      <div style="flex:1;min-width:280px">
        <h3>👥 Conditional Access groups — ${esc(tenant || "this tenant")}</h3>
        <p style="margin-bottom:10px">The groups your Conditional Access baseline depends on: every group named in the
          bundled templates or in a baseline catalog, plus every group your own policies point at.
          A group a policy references but the directory no longer has is flagged — Entra keeps the GUID and the policy targets nobody.</p>
        <div class="bl-chips">${["missing", "dangling", "present", "extra"].map(chip).join("")}</div>
      </div>
      <div style="text-align:right;min-width:150px">
        <div style="font-size:34px;font-weight:700;color:${res.coverage >= 90 ? "var(--on)" : res.coverage >= 60 ? "var(--report)" : "var(--off)"}">${res.coverage}<span style="font-size:15px">%</span></div>
        <div class="mini muted">${res.present} of ${res.expectedTotal} expected groups exist</div>
      </div>
    </div>`;
  }

  function chips(res, active) {
    const all = res.rows.length;
    const c = [`<button class="chip ${active === "all" ? "active" : ""}" data-cgf="all">All (${all})</button>`];
    for (const k of ["missing", "dangling", "present", "extra"]) {
      if (res.counts[k]) c.push(`<button class="chip ${active === k ? "active" : ""}" data-cgf="${k}">${STATUS[k].icon} ${esc(STATUS[k].label)} (${res.counts[k]})</button>`);
    }
    return c.join("");
  }

  const filtered = (res, filter, q) => res.rows.filter((r) =>
    (filter === "all" || r.status === filter)
    && (!q || r.name.toLowerCase().includes(q) || (r.id || "").toLowerCase().includes(q)));

  function renderTable(res, filter, q) {
    const rows = filtered(res, filter, q);
    if (!rows.length) return '<p class="mini" style="padding:20px">No groups match the current filter.</p>';
    // Deliberately NOT .mtable: that class makes the header row sticky for the
    // wide scrolling matrices, which here just slides it under the sticky
    // toolbar and leaves the list looking headerless.
    return `<div class="cg-tablewrap"><table class="cg-table">
      <thead><tr><th style="width:34px"></th><th>Group</th><th style="width:150px">Type</th><th style="width:120px">Policies</th><th style="width:140px">Expected by</th><th style="width:110px">Members</th></tr></thead>
      <tbody>${rows.map((r) => {
        const st = STATUS[r.status];
        const type = r.status === "missing"
          ? (r.template ? (r.template.membershipRule ? "dynamic (template)" : "role-assignable (template)") : "unknown — no template")
          : r.dynamic ? "dynamic"
          : r.roleAssignable ? "role-assignable" : "assigned";
        // The member column doubles as the per-group scan trigger, so you can
        // read one group without paying for all of them.
        const mem = r.memberError ? '<span class="cg-err" title="scan failed">error</span>'
          : r.members ? `<b>${r.memberTotal}</b>${r.memberTotal > MEMBER_CAP ? ` <span class="mini">(first ${MEMBER_CAP})</span>` : ""}`
          : r.id ? `<button class="btn sm cg-scan" data-cgscan="${esc(r.name)}">Scan</button>`
          : '<span class="mini muted">—</span>';
        return `<tr class="cg-row" data-cgrow="${esc(r.name)}">
          <td class="cg-ic ${st.cls}">${st.icon}</td>
          <td><b>${esc(r.name)}</b>${r.id ? `<div class="mini muted">${esc(r.id)}</div>` : ""}
            ${r.drift ? `<div class="mini" style="color:var(--report)">⚠ ${esc(r.drift)}</div>` : ""}
            ${r.status === "dangling" ? '<div class="mini" style="color:var(--off)">Referenced by a policy but not found in the directory</div>' : ""}</td>
          <td class="mini">${esc(type)}</td>
          <td class="mini">${r.refCount ? `${r.refCount} <span class="muted">(${r.refs.include.length} inc / ${r.refs.exclude.length} exc)</span>` : '<span class="muted">unused</span>'}</td>
          <td class="mini">${r.sources.map((s) => `<span class="tag">${esc(s)}</span>`).join(" ")}</td>
          <td class="mini cg-mem">${mem}</td>
        </tr>`;
      }).join("")}</tbody></table></div>`;
  }

  // members × groups, users as rows — same shape as the exclusion matrix
  function renderMatrix(m, q) {
    if (!m.cols.length) return '<p class="mini" style="padding:20px">No members loaded yet — run the member scan.</p>';
    const users = q ? m.users.filter((u) => u.name.toLowerCase().includes(q) || (u.upn || "").toLowerCase().includes(q)) : m.users;
    if (!users.length) return '<p class="mini" style="padding:20px">No members match the search.</p>';
    return `<div class="tablewrap"><table class="mtable cg-matrix">
      <thead><tr>
        <th class="stick">Member (${users.length})</th>
        ${m.cols.map((c) => `<th class="vert" title="${esc(c.name)}"><span>${esc(c.name)}</span></th>`).join("")}
        <th style="width:60px">In</th>
      </tr></thead>
      <tbody>${users.map((u) => `<tr>
        <td class="stick">${esc(u.name)}${u.disabled ? ' <span class="tag block">disabled</span>' : ""}<div class="mini muted">${esc(u.upn || "")}</div></td>
        ${m.cols.map((c) => u.groups.has(c.name)
          ? '<td class="cellv ok" title="member">●</td>' : '<td class="cellv"></td>').join("")}
        <td class="mini"><b>${u.groups.size}</b></td>
      </tr>`).join("")}</tbody></table></div>`;
  }

  // ---- markdown -----------------------------------------------------------
  const mdEsc = (s) => String(s ?? "").replace(/\|/g, "\\|");
  function toMd(res, tenant, withMembers) {
    const L = [];
    L.push(`# Conditional Access groups — ${mdEsc(tenant || "tenant")}`);
    L.push("");
    L.push(`- **Expected groups present:** ${res.present} of ${res.expectedTotal} (${res.coverage}%)`);
    for (const k of ["missing", "dangling", "extra"]) {
      if (res.counts[k]) L.push(`- **${STATUS[k].label}:** ${res.counts[k]}`);
    }
    L.push("");
    L.push("## Groups");
    L.push("");
    L.push("| | Group | Type | Policies | Expected by | Members |");
    L.push("|---|---|---|---|---|---|");
    for (const r of res.rows) {
      const type = r.status === "missing"
        ? (r.template ? (r.template.membershipRule ? "dynamic (template)" : "role-assignable (template)") : "no template")
        : r.dynamic ? "dynamic" : r.roleAssignable ? "role-assignable" : "assigned";
      L.push(`| ${STATUS[r.status].icon} | ${mdEsc(r.name)} | ${type} | ${r.refCount || "—"} | ${r.sources.join(", ")} | ${r.members ? r.memberTotal : "—"} |`);
    }
    const dangling = res.rows.filter((r) => r.status === "dangling");
    if (dangling.length) {
      L.push("");
      L.push("## Dangling references");
      L.push("");
      L.push("These object IDs are referenced by a policy but do not resolve to a group. The policy still carries the GUID and targets nobody through it.");
      L.push("");
      for (const r of dangling) {
        L.push(`- \`${mdEsc(r.name)}\` — ${[...r.refs.include.map((p) => `include in ${p.name}`), ...r.refs.exclude.map((p) => `exclude from ${p.name}`)].join("; ")}`);
      }
    }
    if (withMembers) {
      const withM = res.rows.filter((r) => r.members && r.members.length);
      if (withM.length) {
        L.push("");
        L.push("## Members");
        for (const r of withM) {
          L.push("");
          L.push(`### ${mdEsc(r.name)} (${r.memberTotal})`);
          L.push("");
          r.members.forEach((m) => L.push(`- ${mdEsc(m.name)}${m.upn ? ` — ${mdEsc(m.upn)}` : ""}${m.disabled ? " _(disabled)_" : ""}`));
        }
      }
    }
    L.push("");
    L.push("---");
    L.push("Generated by Conditional Access Baseline Tools — Conditional Access Groups");
    return L.join("\n");
  }

  return {
    STATUS, MEMBER_CAP, scan, loadMembers, matrix, creatable, missingNoTemplate,
    renderSummary, chips, renderTable, renderMatrix, toMd, filtered,
    catalogGroupNames, templateNames, policyRefs,
  };
})();
