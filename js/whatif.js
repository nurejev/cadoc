// ======================================================================
// What-If — two visual tools for "what happens" reasoning:
//
//   1. policyFlow(vm)  — a per-policy flowchart of what the policy does when
//      it triggers: who is in scope, what has to be true, and the controls
//      that then apply. Descriptive, no scenario needed. Shown on demand from
//      the policy card.
//
//   2. simulate(...) / renderSim(...) — a scenario simulator, like the
//      Conditional Access "What If" in the Entra portal: pick a user and a few
//      conditions, and see which policies apply, which do not (and why), and
//      the combined grant / block / session outcome.
//
// Read-only. The simulator needs the subject's group and role memberships,
// fetched once per user via transitiveMemberOf (Directory.Read.All, already
// consented).
// ======================================================================
const WhatIf = (() => {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));

  // ---- 1. per-policy flow (from the view model) -------------------------
  // A vertical flow: Sign-in → in scope? → conditions gates → controls →
  // outcome. Each stage lists the exact assignment so the card doubles as an
  // explanation of the policy's logic.
  function stage(kind, title, body) {
    return `<div class="wf-stage wf-${kind}">
      <div class="wf-stage-h">${title}</div>
      <div class="wf-stage-b">${body}</div>
    </div>`;
  }
  const arrow = (label) => `<div class="wf-arrow">${label ? `<span>${esc(label)}</span>` : ""}▼</div>`;
  const chips = (arr, cls) => (arr && arr.length)
    ? arr.map((x) => `<span class="wf-chip ${cls || ""}">${esc(x)}</span>`).join("")
    : `<span class="wf-chip muted">—</span>`;

  function policyFlow(vm) {
    const c = vm.cond || {};
    const disabled = vm.state === "off";
    const gates = [];
    if (c.platforms?.length) gates.push(`Device platform is ${c.platforms.join(" / ")}${c.platformsExc?.length ? ` (not ${c.platformsExc.join(", ")})` : ""}`);
    if (c.clientApps?.length) gates.push(`Client app is ${c.clientApps.join(" / ")}`);
    (c.risks || []).forEach((r) => gates.push(r));
    if (c.devFilter) gates.push(`Device filter (${c.devFilter.mode}): ${c.devFilter.rule}`);
    if (c.authFlows?.length) gates.push(`Auth flow: ${c.authFlows.join(", ")}`);
    if (c.insider?.length) gates.push(`Insider risk: ${c.insider.join(", ")}`);
    const netScoped = !(vm.net.inc.length === 1 && /any network/i.test(vm.net.inc[0])) || vm.net.exc.length;
    if (netScoped) gates.push(`Location: ${vm.net.inc.join(", ")}${vm.net.exc.length ? ` (excl. ${vm.net.exc.join(", ")})` : ""}`);

    const isBlock = vm.grant.mode === "block";
    const outcome = isBlock
      ? `<div class="wf-outcome block">⛔ Access blocked</div>`
      : vm.grant.controls.length === 1 && /^no controls/i.test(vm.grant.controls[0])
        ? `<div class="wf-outcome allow">✅ Access granted${vm.session.length ? " (with session controls)" : ""}</div>`
        : `<div class="wf-outcome grant">✅ Access granted only if the ${vm.grant.op === "OR" ? "user satisfies one" : "user satisfies all"} of the controls above</div>`;

    return `<div class="wf-flow">
      ${disabled ? `<div class="wf-note">This policy is <b>Off</b> — it is evaluated here as if enabled, but in the tenant it does not apply.</div>` : ""}
      ${stage("start", "① A user signs in", `to <b>${esc(vm.apps.inc.join(", "))}</b>${vm.apps.exc.length ? ` <span class="wf-mut">(except ${esc(vm.apps.exc.join(", "))})</span>` : ""}`)}
      ${arrow("")}
      ${stage("scope", "② Is the user in scope?", `
        <div class="wf-row"><span class="wf-lbl in">Included</span> ${chips(vm.users.inc, "in")}</div>
        ${vm.users.exc.length ? `<div class="wf-row"><span class="wf-lbl ex">Excluded</span> ${chips(vm.users.exc, "ex")}</div>` : ""}
        <div class="wf-hint">In scope only when included <b>and not</b> excluded.</div>`)}
      ${arrow("in scope")}
      ${gates.length ? stage("cond", "③ Do all conditions match?", `<div class="wf-gates">${gates.map((g) => `<div class="wf-gate">◆ ${esc(g)}</div>`).join("")}</div>
        <div class="wf-hint">The policy triggers only when every condition is met.</div>`) + arrow("all match") : ""}
      ${stage(isBlock ? "block" : "grant", isBlock ? "⛔ Access controls — Block" : "✅ Access controls — Grant", isBlock
        ? `<div class="wf-mut">Block access — no controls can satisfy it.</div>`
        : `${vm.grant.controls.map((g) => `<div class="wf-ctrl">${esc(g)}</div>`).join("")}
           ${vm.grant.op ? `<div class="wf-hint">Require <b>${vm.grant.op === "OR" ? "one" : "all"}</b> of these.</div>` : ""}`)}
      ${vm.session.length ? arrow("") + stage("session", "⏱ Session controls", vm.session.map((s) => `<div class="wf-ctrl">${esc(s.t)}</div>`).join("")) : ""}
      ${arrow("")}
      ${outcome}
    </div>`;
  }

  // ---- 2. scenario simulator --------------------------------------------
  const isGuid = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s || "");

  // Resolve the subject once: identity + transitive group and role membership,
  // so a policy targeting a group the user is nested into still matches.
  async function resolveSubject(query) {
    const q = String(query || "").trim();
    if (!q) return null;
    let user;
    if (isGuid(q)) user = await Graph.gget(`/users/${q}?$select=id,displayName,userPrincipalName,userType`);
    else {
      const f = encodeURIComponent(`userPrincipalName eq '${q.replace(/'/g, "''")}' or mail eq '${q.replace(/'/g, "''")}'`);
      const r = await Graph.ggetAll(`/users?$filter=${f}&$select=id,displayName,userPrincipalName,userType&$top=1`);
      user = r[0];
    }
    if (!user) return null;
    const groupIds = new Set(), roleIds = new Set();
    try {
      const mem = await Graph.ggetAll(`/users/${user.id}/transitiveMemberOf?$select=id&$top=999`);
      for (const m of mem) {
        const t = m["@odata.type"] || "";
        if (/directoryRole/i.test(t)) roleIds.add(m.roleTemplateId || m.id);
        else groupIds.add(m.id);
      }
    } catch (e) { console.warn("WhatIf: membership lookup failed", e.message); }
    return {
      id: user.id, upn: user.userPrincipalName || "", name: user.displayName || user.userPrincipalName || user.id,
      isGuest: /guest/i.test(user.userType || ""), groupIds, roleIds,
    };
  }

  const U = (p) => p.conditions?.users || {};
  const A = (p) => p.conditions?.applications || {};

  // Evaluate one raw policy against subject + scenario. Returns why it does or
  // does not apply, transparently — a "maybe" (condition we cannot decide from
  // the scenario) is treated as a match but flagged, never silently dropped.
  function evalPolicy(p, subject, sc) {
    const reasons = [], notes = [];
    const u = U(p);

    if (p.state === "disabled") return { applies: false, state: "off", reasons: ["policy is Off"], notes };
    const reportOnly = p.state === "enabledForReportingButNotEnforced";

    // --- users ---
    const inc = () => {
      if ((u.includeUsers || []).includes("All")) { reasons.push("targets All users"); return true; }
      if ((u.includeUsers || []).includes(subject.id)) { reasons.push("user is named directly"); return true; }
      if ((u.includeGroups || []).some((g) => subject.groupIds.has(g))) { reasons.push("user is in an included group"); return true; }
      if ((u.includeRoles || []).some((r) => subject.roleIds.has(r))) { reasons.push("user holds an included role"); return true; }
      if (subject.isGuest && (u.includeGuestsOrExternalUsers || (u.includeUsers || []).includes("GuestsOrExternalUsers"))) { reasons.push("user is a guest and guests are included"); return true; }
      return false;
    };
    if (!inc()) return { applies: false, reportOnly, reasons: ["user is not in the include scope"], notes };
    if ((u.excludeUsers || []).includes(subject.id)) return { applies: false, reportOnly, reasons: ["user is explicitly excluded"], notes };
    if ((u.excludeGroups || []).some((g) => subject.groupIds.has(g))) return { applies: false, reportOnly, reasons: ["user is in an excluded group"], notes };
    if ((u.excludeRoles || []).some((r) => subject.roleIds.has(r))) return { applies: false, reportOnly, reasons: ["user holds an excluded role"], notes };
    if (subject.isGuest && u.excludeGuestsOrExternalUsers) return { applies: false, reportOnly, reasons: ["guests are excluded"], notes };

    // --- app / resource ---
    const a = A(p);
    if (sc.app && sc.app !== "any") {
      const incApps = a.includeApplications || [];
      if (incApps.includes("All")) reasons.push("targets all cloud apps");
      else if (incApps.includes(sc.app)) reasons.push("target app is included");
      else if (incApps.length) return { applies: false, reportOnly, reasons: [`the app "${sc.app}" is not in this policy's target resources`], notes };
      if ((a.excludeApplications || []).includes(sc.app)) return { applies: false, reportOnly, reasons: ["the app is excluded"], notes };
    } else if ((a.includeApplications || []).length) {
      notes.push("app not specified — assuming the policy's target resources are in play");
    }

    // --- conditions (each only checked when the scenario states it) ---
    const c = p.conditions || {};
    const plat = c.platforms || {};
    if (sc.platform && (plat.includePlatforms || []).length) {
      if (!(plat.includePlatforms.includes(sc.platform) || plat.includePlatforms.includes("all"))) return { applies: false, reportOnly, reasons: [`device platform "${sc.platform}" is not in scope`], notes };
      if ((plat.excludePlatforms || []).includes(sc.platform)) return { applies: false, reportOnly, reasons: [`device platform "${sc.platform}" is excluded`], notes };
    } else if ((plat.includePlatforms || []).length) notes.push("platform not specified — policy has a platform condition");

    const cat = c.clientAppTypes || [];
    if (sc.clientApp && cat.length && !cat.includes("all")) {
      if (!cat.includes(sc.clientApp)) return { applies: false, reportOnly, reasons: [`client app "${sc.clientApp}" is not in scope`], notes };
    } else if (cat.length && !cat.includes("all")) notes.push("client app not specified — policy restricts client apps");

    if (sc.signInRisk && (c.signInRiskLevels || []).length && !c.signInRiskLevels.includes(sc.signInRisk)) return { applies: false, reportOnly, reasons: [`sign-in risk "${sc.signInRisk}" is not in scope`], notes };
    if (!sc.signInRisk && (c.signInRiskLevels || []).length) notes.push("sign-in risk not specified — policy is risk-conditional");
    if (sc.userRisk && (c.userRiskLevels || []).length && !c.userRiskLevels.includes(sc.userRisk)) return { applies: false, reportOnly, reasons: [`user risk "${sc.userRisk}" is not in scope`], notes };
    if (!sc.userRisk && (c.userRiskLevels || []).length) notes.push("user risk not specified — policy is risk-conditional");

    // location: matched loosely — "All" applies anywhere; a trusted-only or
    // named-location condition we cannot fully resolve is flagged, not dropped.
    const loc = c.locations || {};
    if ((loc.includeLocations || []).length || (loc.excludeLocations || []).length) {
      if (sc.location === "trusted" && (loc.excludeLocations || []).some((x) => x === "AllTrusted")) return { applies: false, reportOnly, reasons: ["sign-in is from a trusted location, which this policy excludes"], notes };
      if (!sc.location) notes.push("location not specified — policy has a location condition");
      else notes.push(`location "${sc.location}" — evaluated loosely against the policy's named locations`);
    }
    if (c.devices?.deviceFilter) notes.push(`device filter (${c.devices.deviceFilter.mode}) present — decide manually: ${c.devices.deviceFilter.rule}`);

    return { applies: true, reportOnly, reasons, notes };
  }

  // Combine the applying policies into a single access decision.
  function simulate(raws, subject, sc) {
    const applied = [], notApplied = [];
    for (const p of raws) {
      const r = evalPolicy(p, subject, sc);
      const row = { name: p.displayName, id: p.id, ...r, raw: p };
      (r.applies ? applied : notApplied).push(row);
    }
    // outcome
    const enforcing = applied.filter((r) => !r.reportOnly);
    const grant = new Set(); let block = false; const blockers = []; const session = new Set();
    const controlLabel = (raw) => {
      const g = raw.grantControls || {};
      const out = (g.builtInControls || []).map((x) => (typeof LABELS !== "undefined" && LABELS.grantControls[x]) || x);
      if (g.authenticationStrength) out.push("Authentication strength: " + (g.authenticationStrength.displayName || "custom"));
      (g.termsOfUse || []).forEach(() => out.push("Terms of use"));
      return out;
    };
    for (const r of enforcing) {
      const g = r.raw.grantControls || {};
      if ((g.builtInControls || []).includes("block")) { block = true; blockers.push(r.name); }
      else controlLabel(r.raw).forEach((x) => grant.add(x));
      const s = r.raw.sessionControls || {};
      if (s.signInFrequency?.isEnabled) session.add("Sign-in frequency");
      if (s.persistentBrowser?.isEnabled) session.add("Persistent browser: " + (s.persistentBrowser.mode || ""));
      if (s.applicationEnforcedRestrictions?.isEnabled) session.add("App enforced restrictions");
      if (s.cloudAppSecurity?.isEnabled) session.add("Conditional Access App Control");
      if (s.secureSignInSession?.isEnabled) session.add("Token protection");
    }
    const decision = block ? "block" : grant.size ? "grant" : enforcing.length ? "allow" : "none";
    return {
      subject, scenario: sc, applied, notApplied,
      outcome: { decision, block, blockers, grant: [...grant], session: [...session], reportOnlyCount: applied.length - enforcing.length },
    };
  }

  // ---- simulator rendering ----
  const SC_LABEL = {
    app: "Cloud app", platform: "Device platform", clientApp: "Client app",
    location: "Location", signInRisk: "Sign-in risk", userRisk: "User risk",
  };
  function renderSim(res) {
    const o = res.outcome;
    const banner = o.decision === "block"
      ? `<div class="wf-outcome block">⛔ Access would be <b>blocked</b> by: ${o.blockers.map(esc).join(", ")}</div>`
      : o.decision === "grant"
        ? `<div class="wf-outcome grant">✅ Access granted, but the user must satisfy: ${o.grant.map(esc).join(", ")}</div>`
        : o.decision === "allow"
          ? `<div class="wf-outcome allow">✅ Access granted with no extra controls${o.session.length ? " (session controls apply)" : ""}</div>`
          : `<div class="wf-outcome none">— No enabled policy applies to this sign-in</div>`;
    const scBits = Object.entries(SC_LABEL)
      .filter(([k]) => res.scenario[k] && res.scenario[k] !== "any")
      .map(([k, l]) => `<span class="wf-chip">${esc(l)}: ${esc(res.scenario[k])}</span>`).join("") || '<span class="wf-chip muted">defaults</span>';

    const policyRow = (r, applied) => `<div class="wf-pol ${applied ? "on" : "off"}">
      <div class="wf-pol-h"><span class="wf-dot ${applied ? (r.reportOnly ? "ro" : "on") : "off"}"></span>
        <b class="pol-link" data-pol="${esc(r.name)}">${esc(r.name)}</b>
        ${r.reportOnly ? '<span class="wf-chip ro">report-only</span>' : ""}
        ${r.state === "off" ? '<span class="wf-chip muted">Off</span>' : ""}</div>
      <div class="wf-pol-why">${esc((r.reasons || []).join("; "))}${(r.notes || []).length ? ` · <span class="wf-mut">${esc(r.notes.join("; "))}</span>` : ""}</div>
    </div>`;

    return `<div class="wf-sim">
      <div class="wf-sub"><b>${esc(res.subject.name)}</b> <span class="wf-mut">${esc(res.subject.upn)}</span>
        ${res.subject.isGuest ? '<span class="wf-chip">guest</span>' : ""}
        <span class="wf-mut">· ${res.subject.groupIds.size} groups · ${res.subject.roleIds.size} roles</span></div>
      <div class="wf-scrow">${scBits}</div>
      ${banner}
      ${o.session.length ? `<div class="wf-mut" style="margin:6px 0">Session controls: ${o.session.map(esc).join(", ")}</div>` : ""}
      ${o.reportOnlyCount ? `<div class="wf-mut" style="margin:6px 0">${o.reportOnlyCount} more polic${o.reportOnlyCount === 1 ? "y" : "ies"} would apply in <b>report-only</b> (not enforced).</div>` : ""}
      <div class="wf-cols">
        <div><h4 class="wf-colh">✅ Policies that apply (${res.applied.length})</h4>
          ${res.applied.length ? res.applied.map((r) => policyRow(r, true)).join("") : '<p class="wf-mut">None.</p>'}</div>
        <div><h4 class="wf-colh">✗ Policies that do not apply (${res.notApplied.length})</h4>
          ${res.notApplied.map((r) => policyRow(r, false)).join("")}</div>
      </div>
    </div>`;
  }

  return { policyFlow, resolveSubject, evalPolicy, simulate, renderSim };
})();
