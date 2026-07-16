// ======================================================================
// CA Impact analysis — client-side port of Invoke-CAMatrix.ps1's engine.
// Builds a users × policies matrix: who is included, who bypasses which
// policy (and why), whether a bypass is covered elsewhere, and MFA gaps.
// Runs ONLY on demand (Analyze button) — it fetches all users and expands
// every group/role referenced by the policies.
// ======================================================================
const Analyzer = (() => {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));

  // ---------- policy lookup (from raw Graph policies) ----------
  function buildLookup(vms) {
    return vms.filter(vm => vm.raw.state !== "disabled").map(vm => {
      const p = vm.raw, c = p.conditions || {}, u = c.users || {}, a = c.applications || {}, g = p.grantControls || {};
      const controls = new Set(g.builtInControls || []);
      if (g.authenticationStrength) controls.add("authStrength:" + (g.authenticationStrength.displayName || g.authenticationStrength.id));
      return {
        name: p.displayName, seq: vm.seq, enforced: p.state === "enabled",
        includeAll: (u.includeUsers || []).includes("All"),
        incUsers: new Set(u.includeUsers || []), excUsers: new Set(u.excludeUsers || []),
        incGroups: u.includeGroups || [], excGroups: u.excludeGroups || [],
        incRoles: u.includeRoles || [], excRoles: u.excludeRoles || [],
        incGuests: !!u.includeGuestsOrExternalUsers, excGuests: !!u.excludeGuestsOrExternalUsers,
        appInc: (a.includeApplications || []).length ? a.includeApplications : ["All"],
        appExc: a.excludeApplications || [],
        platInc: (c.platforms?.includePlatforms || []).length ? c.platforms.includePlatforms : ["all"],
        platExc: c.platforms?.excludePlatforms || [],
        locInc: (c.locations?.includeLocations || []).length ? c.locations.includeLocations : ["All"],
        locExc: c.locations?.excludeLocations || [],
        clientApps: c.clientAppTypes || [], signInRisk: c.signInRiskLevels || [], userRisk: c.userRiskLevels || [],
        controls, isBlock: controls.has("block"),
        controlsLabel: vm.grant.controls.join(vm.grant.op ? ` ${vm.grant.op} ` : ", "),
      };
    });
  }

  // ---------- condition coverage (superset tests) ----------
  const hasTok = (arr, x) => arr.some(v => String(v).toLowerCase() === String(x).toLowerCase());
  function dimCovered(incP, excP, incQ, excQ, all) {
    const pAll = hasTok(incP, all), qAll = hasTok(incQ, all);
    if (pAll) { if (!qAll) return false; return excQ.every(x => hasTok(excP, x)); }
    const pSet = incP.filter(x => !hasTok(excP, x));
    if (qAll) return pSet.every(x => !hasTok(excQ, x));
    const qSet = incQ.filter(x => !hasTok(excQ, x));
    return pSet.every(x => hasTok(qSet, x));
  }
  function listCovered(lp, lq) {
    lp = lp.filter(Boolean); lq = lq.filter(Boolean);
    const pU = !lp.length || lp.includes("all"), qU = !lq.length || lq.includes("all");
    if (pU) return qU;
    if (qU) return true;
    return lp.every(x => lq.includes(x));
  }
  function shortfall(P, Q) {
    const s = [];
    if (!dimCovered(P.appInc, P.appExc, Q.appInc, Q.appExc, "All")) s.push("applications");
    if (!dimCovered(P.platInc, P.platExc, Q.platInc, Q.platExc, "all")) s.push("platforms");
    if (!dimCovered(P.locInc, P.locExc, Q.locInc, Q.locExc, "All")) s.push("locations");
    if (!listCovered(P.clientApps, Q.clientApps)) s.push("client apps");
    if (!listCovered(P.signInRisk, Q.signInRisk)) s.push("sign-in risk");
    if (!listCovered(P.userRisk, Q.userRisk)) s.push("user risk");
    return s;
  }

  // ---------- per-user inclusion state ----------
  function stateFor(P, uid, ctx) {
    const inGroup = (ids) => ids.some(g => ctx.groups.get(g)?.has(uid));
    const inRole = (ids) => ids.some(r => ctx.roles.get(r)?.has(uid));
    const included = P.includeAll || P.incUsers.has(uid) || inGroup(P.incGroups) || inRole(P.incRoles) || (P.incGuests && ctx.guests.has(uid));
    if (!included) return ["NotInScope"];
    if (P.excUsers.has(uid)) return ["Excluded", "direct user list"];
    for (const g of P.excGroups) if (ctx.groups.get(g)?.has(uid)) return ["Excluded", "group: " + (ctx.names[g] || g)];
    for (const r of P.excRoles) if (ctx.roles.get(r)?.has(uid)) return ["Excluded", "role: " + (ctx.names[r] || r)];
    if (P.excGuests && ctx.guests.has(uid)) return ["Excluded", "guest user type"];
    return ["Included"];
  }

  // ---------- data collection via Graph ----------
  async function collect(vms, scope, onStatus) {
    const lookup = buildLookup(vms);
    const gids = new Set(), rids = new Set();
    lookup.forEach(P => {
      [...P.incGroups, ...P.excGroups].forEach(g => gids.add(g));
      [...P.incRoles, ...P.excRoles].forEach(r => rids.add(r));
    });

    onStatus("Fetching users…");
    let users = await Graph.ggetAll("/users?$select=id,userPrincipalName,displayName,accountEnabled,userType&$top=999");
    if (scope === "member") users = users.filter(u => u.userType !== "Guest");
    if (scope === "guest") users = users.filter(u => u.userType === "Guest");

    const groups = new Map(); let i = 0;
    for (const g of gids) {
      onStatus(`Expanding group ${++i}/${gids.size}…`);
      try {
        const m = await Graph.ggetAll(`/groups/${g}/transitiveMembers/microsoft.graph.user?$select=id&$top=999`);
        groups.set(g, new Set(m.map(x => x.id)));
      } catch { groups.set(g, new Set()); }
    }

    const roles = new Map();
    if (rids.size) {
      onStatus("Resolving role members…");
      try {
        const dirRoles = await Graph.ggetAll("/directoryRoles?$select=id,displayName,roleTemplateId");
        const byTemplate = Object.fromEntries(dirRoles.map(r => [r.roleTemplateId, r]));
        let j = 0;
        for (const rid of rids) {
          onStatus(`Role members ${++j}/${rids.size}…`);
          const role = byTemplate[rid]; const set = new Set();
          if (role) {
            try {
              const ms = await Graph.ggetAll(`/directoryRoles/${role.id}/members?$select=id`);
              for (const m of ms) {
                const t = m["@odata.type"];
                if (!t || t === "#microsoft.graph.user") set.add(m.id);
                else if (t === "#microsoft.graph.group") {
                  let gm = groups.get(m.id);
                  if (!gm) {
                    try { gm = new Set((await Graph.ggetAll(`/groups/${m.id}/transitiveMembers/microsoft.graph.user?$select=id&$top=999`)).map(x => x.id)); }
                    catch { gm = new Set(); }
                    groups.set(m.id, gm);
                  }
                  gm.forEach(x => set.add(x));
                }
              }
            } catch {}
          }
          roles.set(rid, set);
        }
      } catch {}
    }

    onStatus("Resolving names…");
    const names = {};
    try { (await Graph.ggetAll("/directoryRoleTemplates")).forEach(r => names[r.id] = r.displayName); } catch {}
    if (gids.size) {
      try { ((await Graph.gpost("/directoryObjects/getByIds", { ids: [...gids], types: ["group"] })).value || []).forEach(o => names[o.id] = o.displayName); } catch {}
    }

    const guests = new Set(users.filter(u => u.userType === "Guest").map(u => u.id));
    return { lookup, users, ctx: { groups, roles, guests, names } };
  }

  // Demo-mode collection: uses DEMO_DATA instead of Graph.
  function collectDemo(vms) {
    const lookup = buildLookup(vms);
    const groups = new Map(Object.entries(DEMO_DATA.groupMembers || {}).map(([k, v]) => [k, new Set(v)]));
    const roles = new Map(Object.entries(DEMO_DATA.roleMembers || {}).map(([k, v]) => [k, new Set(v)]));
    const users = DEMO_DATA.analyzeUsers || [];
    const guests = new Set(users.filter(u => u.userType === "Guest").map(u => u.id));
    return { lookup, users, ctx: { groups, roles, guests, names: DEMO_DATA.names } };
  }

  // ---------- evaluation ----------
  function evaluate(lookup, users, ctx) {
    const report = [];
    for (const u of users) {
      const enforcedIncluded = [], applied = [], excluded = [];
      for (const P of lookup) {
        const [st, reason] = stateFor(P, u.id, ctx);
        if (st === "Included") { applied.push(P); if (P.enforced) enforcedIncluded.push(P); }
        else if (st === "Excluded") excluded.push({ P, reason });
      }
      const bypassing = excluded.map(({ P, reason }) => {
        const coveredBy = [], partial = [];
        for (const Q of enforcedIncluded) {
          let shares = false;
          for (const c of P.controls) if (Q.controls.has(c)) { shares = true; break; }
          if (!shares) continue;
          const s = shortfall(P, Q);
          if (!s.length) { if (!coveredBy.includes(Q.name)) coveredBy.push(Q.name); }
          else partial.push({ policy: Q.name, shortfall: s });
        }
        const covered = coveredBy.length > 0;
        return { policy: P.name, controls: P.controlsLabel, reason, reportOnly: !P.enforced, covered, coveredBy, partial, risky: P.enforced && !covered };
      });
      const mfaVia = enforcedIncluded
        .filter(Q => !Q.isBlock && (Q.controls.has("mfa") || [...Q.controls].some(c => c.startsWith("authStrength:"))))
        .map(Q => Q.name);
      report.push({
        user: u.displayName || u.userPrincipalName, upn: u.userPrincipalName || "",
        enabled: !!u.accountEnabled, guest: u.userType === "Guest",
        applied: applied.map(P => ({ policy: P.name, controls: P.controlsLabel, reportOnly: !P.enforced })),
        enforcedCount: enforcedIncluded.length,
        bypassing, riskyCount: bypassing.filter(b => b.risky).length,
        mfaCovered: mfaVia.length > 0, mfaVia,
      });
    }
    report.sort((a, b) => b.riskyCount - a.riskyCount || b.bypassing.length - a.bypassing.length || a.user.localeCompare(b.user));
    return report;
  }

  function summary(report) {
    return {
      users: report.length,
      noEnforce: report.filter(r => r.enforcedCount === 0).length,
      noMfa: report.filter(r => !r.mfaCovered).length,
      risky: report.filter(r => r.riskyCount > 0).length,
    };
  }

  // ---------- results rendering (in-app) ----------
  function pill(n, cls) { return `<span class="pill ${n ? cls : "zero"}">${n}</span>`; }
  function userRows(report, filter, query) {
    const rows = report.filter(r => {
      if (filter === "risky" && !r.riskyCount) return false;
      if (filter === "nomfa" && r.mfaCovered) return false;
      if (filter === "noenforce" && r.enforcedCount) return false;
      return !query || r.user.toLowerCase().includes(query) || r.upn.toLowerCase().includes(query);
    });
    return rows.map((r, i) => {
      const idx = report.indexOf(r);
      return `<tr class="urow" data-user="${idx}">
        <td><span class="caret">▶</span> <span class="uname">${esc(r.user)}</span>${r.guest ? ' <span class="tag new">guest</span>' : ""}${r.enabled ? "" : ' <span class="tag block">disabled</span>'}<div class="uupn">${esc(r.upn)}</div></td>
        <td class="num">${pill(r.applied.length, "green")}</td>
        <td class="num">${pill(r.enforcedCount, "green")}</td>
        <td class="num">${pill(r.bypassing.length, "amber")}</td>
        <td class="num">${pill(r.riskyCount, "red")}</td>
        <td>${r.mfaCovered ? '<span class="tag grant">yes</span>' : '<span class="tag block">no</span>'}</td>
      </tr>`;
    }).join("") || `<tr><td colspan="6" class="mini" style="padding:18px">No users match.</td></tr>`;
  }

  function userDetail(r) {
    const ap = r.applied.map(a => `<li>${esc(a.policy)}<div class="mini">${esc(a.controls)}${a.reportOnly ? " · report-only" : ""}</div></li>`).join("") || '<li class="mini">None</li>';
    const by = r.bypassing.map(b => `<li>${esc(b.policy)} <span class="mini">(${esc(b.reason || "excluded")})</span>
      ${b.risky ? '<span class="tag block">risky</span>' : b.covered ? `<span class="tag grant">covered</span>` : ""}
      <div class="mini">${esc(b.controls)}${b.coveredBy.length ? " · covered by: " + esc(b.coveredBy.join(", ")) : ""}${b.partial.length ? " · partial: " + esc(b.partial.map(p => `${p.policy} (missing ${p.shortfall.join(", ")})`).join("; ")) : ""}</div></li>`).join("") || '<li class="mini">None</li>';
    return `<tr class="detail"><td colspan="6"><div class="detail-grid">
      <div class="panel enforced"><div class="panel-h">Applied policies (${r.applied.length})</div><ul class="plist2">${ap}</ul></div>
      <div class="panel bypass"><div class="panel-h">Bypassing (${r.bypassing.length})</div><ul class="plist2">${by}</ul></div>
    </div></td></tr>`;
  }

  // ---------- standalone shareable HTML export (neutral branding) ----------
  function exportHtml(meta, report) {
    const sum = summary(report);
    const data = JSON.stringify(report).replace(/</g, "\\u003c");
    return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Conditional Access Impact Report — ${esc(meta.tenant)}</title>
<style>
*{box-sizing:border-box}body{margin:0;font-family:'Segoe UI',system-ui,sans-serif;background:#f4f5fa;color:#1f2330}
header{padding:18px 26px;background:#1f2933;color:#fff}h1{margin:0;font-size:19px}.meta{color:#c8d1d9;font-size:12px;margin-top:4px}
.cards{display:flex;gap:14px;padding:14px 26px;background:#fff;border-bottom:1px solid #e6e6ee;flex-wrap:wrap}
.card{background:#f7f8fc;border:1px solid #e6e6ee;border-radius:10px;padding:10px 16px;min-width:130px;cursor:pointer}
.card.active{border-color:#323f4b;box-shadow:0 0 0 1px #323f4b inset}
.card .n{font-size:22px;font-weight:700}.card .l{font-size:11px;color:#6b7280;text-transform:uppercase}
.card.risk .n{color:#c0392b}.card.gap .n{color:#b9770e}
.controls{padding:12px 26px;background:#fff;border-bottom:1px solid #e6e6ee}.controls input{padding:7px 11px;border:1px solid #d1d5db;border-radius:7px;width:320px;font-size:13px}
table{border-collapse:collapse;width:100%;font-size:13px;background:#fff}
thead th{position:sticky;top:0;background:#f1f2f8;padding:9px 14px;text-align:left;border-bottom:1px solid #d1d5db;white-space:nowrap}
td{padding:8px 14px;border-bottom:1px solid #f0f0f5;vertical-align:top}.num{text-align:right}
tr.urow{cursor:pointer}tr.urow:hover{background:#fafbff}
.uname{font-weight:600}.uupn{color:#6b7280;font-family:monospace;font-size:11px}
.caret{display:inline-block;width:13px;color:#999;font-size:10px}
.pill{display:inline-block;padding:1px 9px;border-radius:11px;font-weight:700;font-size:11px}
.pill.green{background:#e6f5ec;color:#0a7d39}.pill.amber{background:#fff3cd;color:#8a5a00}.pill.red{background:#fde8e6;color:#c0392b}.pill.zero{background:#f0f1f6;color:#9aa0ab}
.tag{padding:1px 7px;border-radius:4px;font-size:10px;font-weight:600;background:#f0f1f6}
.tag.grant{background:#e6f5ec;color:#0a7d39}.tag.block{background:#fde8e6;color:#c0392b}.tag.new{background:#fff3cd;color:#8a5a00}
.detail td{background:#fafbfd}.detail-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}@media(max-width:1000px){.detail-grid{grid-template-columns:1fr}}
.panel{background:#fff;border:1px solid #e6e6ee;border-radius:8px}.panel.enforced{border-left:3px solid #0a7d39}.panel.bypass{border-left:3px solid #c0392b}
.panel-h{padding:8px 12px;font-size:12px;font-weight:700;text-transform:uppercase;color:#6b7280;border-bottom:1px solid #f0f0f5}
.plist2{list-style:none;margin:0;padding:0}.plist2 li{padding:8px 12px;border-bottom:1px solid #f4f4f8}
.mini{font-size:12px;color:#6b7280}footer{padding:14px 26px;color:#6b7280;font-size:12px}
</style></head><body>
<header><h1>Conditional Access Impact Report</h1><div class="meta">${esc(meta.tenant)} · ${esc(meta.date)} · ${meta.policies} policies analysed · scope: ${esc(meta.scope)}</div></header>
<div class="cards">
  <div class="card active" data-f="all"><div class="n">${sum.users}</div><div class="l">Users</div></div>
  <div class="card risk" data-f="risky"><div class="n">${sum.risky}</div><div class="l">Risky bypasses</div></div>
  <div class="card gap" data-f="nomfa"><div class="n">${sum.noMfa}</div><div class="l">No MFA from CA</div></div>
  <div class="card gap" data-f="noenforce"><div class="n">${sum.noEnforce}</div><div class="l">No enforcing policy</div></div>
</div>
<div class="controls"><input id="q" placeholder="Search user or UPN…"></div>
<table><thead><tr><th>User</th><th class="num">Applied</th><th class="num">Enforced</th><th class="num">Bypassing</th><th class="num">Risky</th><th>MFA</th></tr></thead><tbody id="tb"></tbody></table>
<footer>Generated ${esc(meta.date)} · Conditional Access impact analysis · static report, data embedded — safe to share as a single file</footer>
<script>
const R=${data};let F="all",Q="";
const esc=s=>String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
const pill=(n,c)=>'<span class="pill '+(n?c:"zero")+'">'+n+'</span>';
function rows(){return R.map((r,i)=>({r,i})).filter(({r})=>{
 if(F==="risky"&&!r.riskyCount)return false;if(F==="nomfa"&&r.mfaCovered)return false;if(F==="noenforce"&&r.enforcedCount)return false;
 return !Q||r.user.toLowerCase().includes(Q)||r.upn.toLowerCase().includes(Q);})
 .map(({r,i})=>'<tr class="urow" data-i="'+i+'"><td><span class="caret">▶</span> <span class="uname">'+esc(r.user)+'</span>'+(r.guest?' <span class="tag new">guest</span>':'')+(r.enabled?'':' <span class="tag block">disabled</span>')+'<div class="uupn">'+esc(r.upn)+'</div></td><td class="num">'+pill(r.applied.length,"green")+'</td><td class="num">'+pill(r.enforcedCount,"green")+'</td><td class="num">'+pill(r.bypassing.length,"amber")+'</td><td class="num">'+pill(r.riskyCount,"red")+'</td><td>'+(r.mfaCovered?'<span class="tag grant">yes</span>':'<span class="tag block">no</span>')+'</td></tr>').join("")||'<tr><td colspan="6" class="mini" style="padding:18px">No users match.</td></tr>';}
function detail(r){const ap=r.applied.map(a=>'<li>'+esc(a.policy)+'<div class="mini">'+esc(a.controls)+(a.reportOnly?' · report-only':'')+'</div></li>').join("")||'<li class="mini">None</li>';
 const by=r.bypassing.map(b=>'<li>'+esc(b.policy)+' <span class="mini">('+esc(b.reason||'excluded')+')</span> '+(b.risky?'<span class="tag block">risky</span>':b.covered?'<span class="tag grant">covered</span>':'')+'<div class="mini">'+esc(b.controls)+(b.coveredBy.length?' · covered by: '+esc(b.coveredBy.join(", ")):'')+(b.partial.length?' · partial: '+esc(b.partial.map(p=>p.policy+' (missing '+p.shortfall.join(", ")+')').join("; ")):'')+'</div></li>').join("")||'<li class="mini">None</li>';
 return '<tr class="detail"><td colspan="6"><div class="detail-grid"><div class="panel enforced"><div class="panel-h">Applied ('+r.applied.length+')</div><ul class="plist2">'+ap+'</ul></div><div class="panel bypass"><div class="panel-h">Bypassing ('+r.bypassing.length+')</div><ul class="plist2">'+by+'</ul></div></div></td></tr>';}
const tb=document.getElementById("tb");function draw(){tb.innerHTML=rows();}
document.getElementById("q").addEventListener("input",e=>{Q=e.target.value.toLowerCase();draw();});
document.querySelectorAll(".card").forEach(c=>c.addEventListener("click",()=>{F=c.dataset.f;document.querySelectorAll(".card").forEach(x=>x.classList.remove("active"));c.classList.add("active");draw();}));
tb.addEventListener("click",e=>{const tr=e.target.closest(".urow");if(!tr)return;const d=tr.nextElementSibling;
 if(d&&d.classList.contains("detail")){d.remove();return;}tr.insertAdjacentHTML("afterend",detail(R[+tr.dataset.i]));});
draw();
</script></body></html>`;
  }

  return { collect, collectDemo, evaluate, summary, userRows, userDetail, exportHtml };
})();
