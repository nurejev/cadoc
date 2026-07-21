// ======================================================================
// Conditional Access validator (BETA)
//
// A faithful, read-only re-implementation of the *simulation generator*
// from Jasper Baes' Conditional Access Validator:
//   https://github.com/jasperbaes/Conditional-Access-Validator   (by Jasper Baes)
// Licensed CC BY-NC-SA 4.0 — non-commercial, share-alike, attribution.
//
// For every enabled (optionally report-only) policy it derives the set of
// sign-in *simulations* the policy implies — the concrete combinations of
// user × application × client app × location × device platform × user risk ×
// sign-in risk × user action — and, per grant control, the expected outcome.
// When the principal / app / location / platform is on the EXCLUDED side, the
// expectation is inverted ("no <control>"), exactly as the original does.
//
// This port produces the *report* only (no Maester Pester code) and uses
// representative placeholders for users rather than sampling real accounts.
// ======================================================================
const Validator = (() => {
  // Office 365 application group expands to these three (same as the source tool)
  const O365_APPS = [
    { id: "00000002-0000-0ff1-ce00-000000000000", name: "Office 365 Exchange Online" },
    { id: "00000003-0000-0ff1-ce00-000000000000", name: "Office 365 SharePoint Online" },
    { id: "00000006-0000-0ff1-ce00-000000000000", name: "Office 365 Portal" },
  ];
  const ALL_PLATFORMS = ["android", "iOS", "windows", "macOS", "linux"];
  const CLIENT_ALL = ["browser", "mobileAppsAndDesktopClients", "other"];

  // grant controls we can assert an expectation for (session-only policies have none)
  const CONTROL_LABEL = {
    block: "Block access", mfa: "MFA", passwordChange: "Password change",
    compliantDevice: "Compliant device", domainJoinedDevice: "Hybrid Entra joined device",
    authenticationStrength: "Authentication strength",
  };
  const clientLabel = (c) => (c === "mobileAppsAndDesktopClients" ? "modern" : c === "other" ? "legacy" : c);

  // ---- placeholder resolvers (no membership sampling) ----
  // names: { user:{id:name}, group:{}, role:{}, app:{appId:name}, location:{} }
  const NAMES = { user: {}, group: {}, role: {}, app: {}, location: {} };
  const nm = (kind, id, names) => (names[kind] && names[kind][id]) || id;

  function usersFor(u, names) {
    const out = [];
    const push = (upn, type, kind) => out.push({ upn, type, kind: kind || "user" });
    (u.includeUsers || []).forEach((id) => {
      if (id === "None") return;
      if (id === "All") push("(all users)", "included", "all");
      else if (id === "GuestsOrExternalUsers") push("(guest / external users)", "included", "guest");
      else push(nm("user", id, names), "included");
    });
    (u.excludeUsers || []).forEach((id) => {
      if (id === "All" || id === "None") return;
      if (id === "GuestsOrExternalUsers") push("(guest / external users)", "excluded", "guest");
      else push(nm("user", id, names), "excluded");
    });
    (u.includeGroups || []).forEach((id) => push("members of " + nm("group", id, names), "included", "group"));
    (u.excludeGroups || []).forEach((id) => push("members of " + nm("group", id, names), "excluded", "group"));
    (u.includeRoles || []).forEach((id) => push("role: " + nm("role", id, names), "included", "role"));
    (u.excludeRoles || []).forEach((id) => push("role: " + nm("role", id, names), "excluded", "role"));
    if (u.includeGuestsOrExternalUsers) push("(guest / external users)", "included", "guest");
    if (u.excludeGuestsOrExternalUsers) push("(guest / external users)", "excluded", "guest");
    return out;
  }

  // friendly label for a built-in "user action" target
  const USER_ACTION_TARGET = {
    "urn:user:registersecurityinfo": "Register security information",
    "urn:user:registerdevice": "Register or join devices",
  };

  function appsFor(a, names) {
    const out = [];
    const inc = a.includeApplications || [], exc = a.excludeApplications || [];
    const addO365 = (type) => O365_APPS.forEach((x) => out.push({ name: x.name, type }));
    if (inc.includes("All") || inc.includes("Office365")) addO365("included");
    if (exc.includes("All") || exc.includes("Office365")) addO365("excluded");
    // first three concrete included / excluded apps
    inc.filter((id) => id !== "All" && id !== "Office365").slice(0, 3)
      .forEach((id) => out.push({ name: nm("app", id, names), type: "included" }));
    exc.filter((id) => id !== "All" && id !== "Office365").slice(0, 3)
      .forEach((id) => out.push({ name: nm("app", id, names), type: "excluded" }));
    // user actions / auth context instead of apps
    (a.includeUserActions || []).forEach((x) => out.push({ name: "User action: " + (USER_ACTION_TARGET[x] || x), type: "included" }));
    (a.includeAuthenticationContextClassReferences || []).forEach((x) => out.push({ name: "Auth context: " + x, type: "included" }));
    // nothing targeted → a single placeholder so the scenario still lists
    if (!out.some((x) => x.type === "included")) out.unshift({ name: "(the targeted resource)", type: "included" });
    return out;
  }

  function locationsFor(l, names) {
    if (!l || ((l.includeLocations || []).length === 0 && (l.excludeLocations || []).length === 0))
      return [{ label: "All", type: "included" }];
    const out = [];
    const label = (id) => id === "All" ? "Any location" : id === "AllTrusted" ? "All trusted locations" : nm("location", id, names);
    (l.includeLocations || []).forEach((id) => out.push({ label: label(id), type: "included" }));
    (l.excludeLocations || []).forEach((id) => out.push({ label: label(id), type: "excluded" }));
    return out.length ? out : [{ label: "All", type: "included" }];
  }

  function platformsFor(p) {
    const inc = (p && p.includePlatforms) || [], exc = (p && p.excludePlatforms) || [];
    if (!inc.length && !exc.length) return [{ os: "All", type: "included" }];
    const out = inc.map((os) => ({ os, type: "included" }));
    if (inc.length) ALL_PLATFORMS.filter((x) => !inc.includes(x)).forEach((os) => out.push({ os, type: "excluded" }));
    exc.forEach((os) => out.push({ os, type: "excluded" }));
    return out;
  }

  function controlsFor(g) {
    if (!g) return [];
    const out = (g.builtInControls || []).filter((c) => CONTROL_LABEL[c]);
    if (g.authenticationStrength) out.push("authenticationStrength");
    return out;
  }

  function title(inverted, control, s) {
    let t = `${inverted ? "no " : ""}${CONTROL_LABEL[control]} for ${s.upn} on ${s.appName}`;
    if (s.clientApp !== "All") t += ` with ${clientLabel(s.clientApp)} auth`;
    if (s.ipRange !== "All") t += ` from ${s.ipRange}`;
    if (s.devicePlatform !== "All") t += ` on ${s.devicePlatform}`;
    if (s.userRisk !== "All") t += ` with ${s.userRisk} user risk`;
    if (s.signInRisk !== "All") t += ` with ${s.signInRisk} sign-in risk`;
    if (s.userAction && s.userAction !== "All") t += ` with ${s.userAction} user action`;
    return t;
  }

  const PER_POLICY_CAP = 400;   // safety valve against a huge cartesian product

  function simulatePolicy(p, names) {
    const c = p.conditions || {}, g = p.grantControls || {};
    const controls = controlsFor(g);
    if (!controls.length) return { sims: [], skipped: "session-only (no grant control to assert)" };

    const users = usersFor(c.users || {}, names);
    if (!users.length) return { sims: [], skipped: "no user assignment resolved" };
    const apps = appsFor(c.applications || {}, names);
    const clients = (!c.clientAppTypes || c.clientAppTypes.includes("all")) ? CLIENT_ALL : c.clientAppTypes;
    const locations = locationsFor(c.locations, names);
    const platforms = platformsFor(c.platforms);
    const userRisks = (c.userRiskLevels && c.userRiskLevels.length) ? c.userRiskLevels : ["All"];
    const signInRisks = (c.signInRiskLevels && c.signInRiskLevels.length) ? c.signInRiskLevels : ["All"];
    const transfer = c.authenticationFlows && c.authenticationFlows.transferMethods;
    const userActions = transfer ? String(transfer).split(",").map((x) => x.trim()) : ["All"];

    const sims = [];
    let capped = false;
    outer:
    for (const u of users) for (const a of apps) for (const cl of clients) for (const loc of locations)
      for (const pl of platforms) for (const ur of userRisks) for (const sr of signInRisks) for (const ua of userActions) {
        const inverted = u.type === "excluded" || a.type === "excluded" || loc.type === "excluded" || pl.type === "excluded";
        for (const ctrl of controls) {
          const s = {
            policyId: p.id, policyName: p.displayName, state: p.state,
            expectedControl: ctrl, controlLabel: CONTROL_LABEL[ctrl], inverted,
            upn: u.upn, userType: u.type, userKind: u.kind,
            appName: a.name, appType: a.type,
            clientApp: cl, ipRange: loc.label, locationType: loc.type,
            devicePlatform: pl.os, platformType: pl.type,
            userRisk: ur, signInRisk: sr, userAction: ua,
          };
          s.title = title(inverted, ctrl, s);
          sims.push(s);
          if (sims.length >= PER_POLICY_CAP) { capped = true; break outer; }
        }
      }
    return { sims, capped };
  }

  // ---- main ----
  function simulate(rawPolicies, opts = {}) {
    const names = opts.names || NAMES;
    const includeReportOnly = !!opts.includeReportOnly;
    const eligible = rawPolicies.filter((p) =>
      p.state === "enabled" || (includeReportOnly && p.state === "enabledForReportingButNotEnforced"));

    const groups = [], all = [], skipped = [];
    for (const p of eligible.slice().sort((a, b) => (a.displayName || "").localeCompare(b.displayName || ""))) {
      const r = simulatePolicy(p, names);
      if (r.skipped) { skipped.push({ name: p.displayName, reason: r.skipped }); continue; }
      groups.push({ id: p.id, name: p.displayName, state: p.state, sims: r.sims, capped: r.capped });
      all.push(...r.sims);
    }
    return {
      policyCount: eligible.length,
      simulatedPolicies: groups.length,
      simCount: all.length,
      groups, sims: all, skipped,
      controlCounts: all.reduce((m, s) => { const k = (s.inverted ? "no " : "") + s.expectedControl; m[k] = (m[k] || 0) + 1; return m; }, {}),
    };
  }

  // Collect every directory id / appId / location id referenced by the eligible
  // policies, so app.js can resolve them to names in one batched pass.
  function collectRefs(rawPolicies, includeReportOnly) {
    const refs = { users: new Set(), groups: new Set(), roles: new Set(), apps: new Set(), locations: new Set() };
    const isGuid = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(s || "");
    for (const p of rawPolicies) {
      if (!(p.state === "enabled" || (includeReportOnly && p.state === "enabledForReportingButNotEnforced"))) continue;
      const u = p.conditions?.users || {}, a = p.conditions?.applications || {}, l = p.conditions?.locations || {};
      [...(u.includeUsers || []), ...(u.excludeUsers || [])].forEach((x) => isGuid(x) && refs.users.add(x));
      [...(u.includeGroups || []), ...(u.excludeGroups || [])].forEach((x) => isGuid(x) && refs.groups.add(x));
      [...(u.includeRoles || []), ...(u.excludeRoles || [])].forEach((x) => isGuid(x) && refs.roles.add(x));
      [...(a.includeApplications || []), ...(a.excludeApplications || [])].forEach((x) => isGuid(x) && refs.apps.add(x));
      [...(l.includeLocations || []), ...(l.excludeLocations || [])].forEach((x) => isGuid(x) && refs.locations.add(x));
    }
    return { users: [...refs.users], groups: [...refs.groups], roles: [...refs.roles], apps: [...refs.apps], locations: [...refs.locations] };
  }

  return { simulate, collectRefs, CONTROL_LABEL, clientLabel };
})();
