// ======================================================================
// Import tool (BETA) — restores a CA Doc backup zip into the tenant.
// Order: dependencies first (groups, named locations, auth strengths,
// auth contexts), then the CA policies. Policies are ALWAYS imported in
// the disabled ("Off") state, skipped when a policy with the same CA
// number AND version (vX.Y[.Z]) already exists, and their INCLUDE
// assignment is remapped to the deploy/test persona group.
// ======================================================================
const Importer = (() => {
  // Application.Read.All is required by Graph whenever a policy carries an
  // application condition — without it the create fails with 403.
  const WRITE = ["Policy.ReadWrite.ConditionalAccess", "Application.Read.All"];
  const STRENGTH_WRITE = [...WRITE, "Policy.ReadWrite.AuthenticationMethod"];

  // Template placeholders used by the CA baseline policy files, e.g.
  //   "{{group:CAB-SEC-U-BreakGlass}}", "{{location:BG_TrustedLocation}}",
  //   "{{authstrength:Phishing-resistant MFA + TAP}}"
  const PLACEHOLDER = /^\{\{(group|location|authstrength|authcontext|tou):(.+)\}\}$/;
  const parsePlaceholder = (v) => {
    const m = PLACEHOLDER.exec(String(v || "").trim());
    return m ? { kind: m[1], name: m[2] } : null;
  };
  function collectPlaceholders(policies) {
    const found = [];
    const walk = (o) => {
      if (Array.isArray(o)) return o.forEach(walk);
      if (o && typeof o === "object") return Object.values(o).forEach(walk);
      const p = parsePlaceholder(o);
      if (p && !found.some(x => x.kind === p.kind && x.name === p.name)) found.push(p);
    };
    policies.forEach(walk);
    return found;
  }

  const PERSONA_GROUPS = {
    global: "CAD-SEC-U-DG-GLO", admins: "CAD-SEC-U-DG-ADM", internals: "CAD-SEC-U-DG-INT",
    externals: "CAD-SEC-U-DG-EXT", guestusers: "CAD-SEC-U-DG-GUESTUSERS", g_admins: "CAD-SEC-U-DG-GUESTAdmins",
    serviceaccounts: "CAD-SEC-U-DG-SA", devops: "CAD-SEC-U-DG-DevOps", factoryworkers: "CAD-SEC-U-DG-FW",
  };

  // E-Admins (emergency/break-glass) policies are imported AS-IS: no persona
  // remap, original state kept, assignments unchanged.
  function isEAdmins(name) {
    const n = (name || "").toLowerCase();
    return /\be[-_]?admins?\b/.test(n) || Render.caGroup(name).key === 1100;
  }

  // persona from the policy name (token first, CA-number range as fallback)
  function personaOf(name) {
    const n = (name || "").toLowerCase();
    if (/g[_-]?admin|guestadmin/.test(n)) return "g_admins";
    if (/guest/.test(n)) return "guestusers";
    if (/factory|[-_]fw\b/.test(n)) return "factoryworkers";
    if (/serviceaccount|svcaccount|[-_]sa[-_]/.test(n)) return "serviceaccounts";
    if (/devops/.test(n)) return "devops";
    if (/external/.test(n)) return "externals";
    if (/internal/.test(n)) return "internals";
    if (/admin/.test(n)) return "admins";
    if (/global/.test(n)) return "global";
    const k = Render.caGroup(name).key;
    return { 0: "global", 100: "admins", 200: "internals", 300: "externals", 400: "guestusers", 500: "g_admins", 600: "serviceaccounts", 700: "serviceaccounts", 800: "serviceaccounts", 1000: "devops", 1100: "admins" }[k] || null;
  }

  function parseCaVersion(name) {
    const m = /v(\d+(?:\.\d+)+)/i.exec(name || "");
    return { num: Render.caGroup(name).num, ver: m ? m[1] : null };
  }

  // ---------- read a backup (zip file OR selected folder), same structure ----------
  const FOLDER_KEY = { Groups: "groups", NamedLocations: "namedLocations", AuthenticationStrengths: "authStrengths", AuthenticationContexts: "authContexts", TermsOfUse: "termsOfUse" };

  function parseEntries(entries) { // entries: [{path, text}]
    const bundle = { policies: [], groups: [], namedLocations: [], authStrengths: [], authContexts: [], termsOfUse: [] };
    let allPolicies = null;
    for (const { path, text } of entries) {
      if (!path.endsWith(".json")) continue;
      const name = path.split("/").pop();
      if (name === "MigrationTable.json") continue;
      let obj;
      try { obj = JSON.parse(text); } catch { continue; }
      if (name === "all-policies.json") { allPolicies = obj; continue; }
      const base = path.includes("/") ? path.split("/").slice(-2)[0] : null;
      if (base && FOLDER_KEY[base]) bundle[FOLDER_KEY[base]].push(obj);
      else if (obj && obj.displayName && obj.conditions) bundle.policies.push(obj);
    }
    if (!bundle.policies.length && Array.isArray(allPolicies)) bundle.policies = allPolicies;
    return bundle;
  }

  async function readZip(data) {
    const zip = await JSZip.loadAsync(data);
    const entries = [];
    for (const [path, entry] of Object.entries(zip.files)) {
      if (entry.dir || !path.endsWith(".json")) continue;
      entries.push({ path, text: await entry.async("string") });
    }
    return parseEntries(entries);
  }

  // folder picker (webkitdirectory): paths include the selected root folder — keep
  // the last two segments so Groups/x.json etc. are recognised at any depth.
  async function readFolder(fileList) {
    const entries = [];
    for (const f of fileList) {
      if (!f.name.endsWith(".json")) continue;
      entries.push({ path: (f.webkitRelativePath || f.name), text: await f.text() });
    }
    return parseEntries(entries);
  }

  // ---------- plan: which policies import / skip ----------
  function plan(bundle, existingNames) {
    const existing = existingNames.map(parseCaVersion).filter(x => x.num != null && x.ver);
    return bundle.policies.map(raw => {
      const { num, ver } = parseCaVersion(raw.displayName);
      const exists = num != null && ver != null && existing.some(e => e.num === num && e.ver === ver);
      const asIs = isEAdmins(raw.displayName);
      const persona = asIs ? null : personaOf(raw.displayName);
      return {
        raw, name: raw.displayName, num, ver, asIs,
        persona, personaGroup: persona ? PERSONA_GROUPS[persona] : null,
        exists,
        reason: exists ? `already exists (CA${num} v${ver})`
          : asIs ? "E-Admins — imported as-is (state & assignments unchanged)"
          : !persona ? "no persona detected — include assignment kept as-is" : null,
      };
    });
  }

  // ---------- dependencies: create-if-missing, build old-id → new-id maps ----------
  async function ensureDependencies(bundle, onStatus) {
    const maps = { group: {}, loc: {}, strength: {}, ctx: {}, tou: {}, ph: {} };
    const log = { created: [], reused: [], warnings: [] };
    // Groups are always created role-assignable; a dynamic source group loses
    // its membership rule as a result (Graph forbids the combination), so say so.
    const noteGroup = (g, label) => {
      (g.created ? log.created : log.reused).push(`${label}${g.created ? " (role-assignable)" : ""}`);
      if (g.ruleDropped) {
        log.warnings.push(`"${g.name}" was created as an ASSIGNED role-assignable group — Entra does not allow role-assignable groups to use dynamic membership. `
          + `Add the members manually${g.membershipRule ? `, or recreate it as a dynamic group without the role-assignable flag. Original rule: ${g.membershipRule}` : "."}`);
      }
    };

    // ---- template placeholders ({{group:…}} / {{location:…}} / {{authstrength:…}}) ----
    const placeholders = collectPlaceholders(bundle.policies);
    if (placeholders.length) {
      onStatus?.(`Resolving ${placeholders.length} template placeholder(s)…`);
      const key = (p) => `{{${p.kind}:${p.name}}}`;
      let locs = null, strengths = null, ctxs = null, tous = null;
      for (const p of placeholders) {
        try {
          if (p.kind === "group") {
            // create-if-missing, always role-assignable (template if we have one)
            const tpl = Assign.templates().find(t => t.displayName === p.name) || { displayName: p.name };
            const g = await Assign.createGroup(tpl);
            maps.ph[key(p)] = g.id;
            noteGroup(g, `Group (template): ${p.name}`);
          } else if (p.kind === "location") {
            locs = locs || await Graph.ggetAll("/identity/conditionalAccess/namedLocations");
            const f = locs.find(x => x.displayName === p.name);
            if (f) { maps.ph[key(p)] = f.id; log.reused.push(`Named location: ${p.name}`); }
            else log.warnings.push(`Named location "${p.name}" not found in this tenant — policies using it are skipped. Create it first, then re-import.`);
          } else if (p.kind === "authstrength") {
            strengths = strengths || await Graph.ggetAll("/policies/authenticationStrengthPolicies");
            const f = strengths.find(x => x.displayName === p.name);
            if (f) { maps.ph[key(p)] = f.id; log.reused.push(`Auth strength: ${p.name}`); }
            else log.warnings.push(`Authentication strength "${p.name}" not found in this tenant — policies using it are skipped. Create it first, then re-import.`);
          } else if (p.kind === "authcontext") {
            ctxs = ctxs || await Graph.ggetAll("/identity/conditionalAccess/authenticationContextClassReferences");
            const f = ctxs.find(x => x.displayName === p.name || x.id === p.name);
            if (f) { maps.ph[key(p)] = f.id; log.reused.push(`Auth context: ${p.name}`); }
            else log.warnings.push(`Authentication context "${p.name}" not found in this tenant — policies using it are skipped.`);
          } else if (p.kind === "tou") {
            tous = tous || await Graph.ggetAll("/identityGovernance/termsOfUse/agreements", [...AUTH_CONFIG.scopes, "Agreement.Read.All"]);
            const f = tous.find(x => x.displayName === p.name);
            if (f) { maps.ph[key(p)] = f.id; log.reused.push(`Terms of use: ${p.name}`); }
            else log.warnings.push(`Terms of use "${p.name}" not found in this tenant — policies using it are skipped.`);
          }
        } catch (e) { log.warnings.push(`Placeholder ${key(p)}: ${e.message}`); }
      }
    }

    // persona groups needed by the policies themselves
    const personaNames = [...new Set(bundle.policies.map(p => personaOf(p.displayName)).filter(Boolean).map(p => PERSONA_GROUPS[p]))];
    maps.personaGroupIds = {};
    for (const gname of personaNames) {
      onStatus?.(`Persona group ${gname}…`);
      try {
        const g = await Assign.createGroup({ displayName: gname });
        maps.personaGroupIds[gname] = g.id;
        noteGroup(g, `Group (persona): ${gname}`);
      } catch (e) { log.warnings.push(`Persona group ${gname}: ${e.message}`); }
    }

    for (const raw of bundle.groups) {
      onStatus?.(`Group ${raw.displayName}…`);
      try {
        const dyn = (raw.groupTypes || []).includes("DynamicMembership");
        const g = await Assign.createGroup({ displayName: raw.displayName, description: raw.description, mailNickname: raw.mailNickname, dynamic: dyn, membershipRule: raw.membershipRule });
        maps.group[raw.id] = g.id;
        noteGroup(g, `Group: ${raw.displayName}`);
      } catch (e) { log.warnings.push(`Group ${raw.displayName}: ${e.message}`); }
    }

    if (bundle.namedLocations.length) {
      onStatus?.("Named locations…");
      let existing = [];
      try { existing = await Graph.ggetAll("/identity/conditionalAccess/namedLocations"); } catch {}
      for (const raw of bundle.namedLocations) {
        const found = existing.find(x => x.displayName === raw.displayName);
        if (found) { maps.loc[raw.id] = found.id; log.reused.push(`Named location: ${raw.displayName}`); continue; }
        try {
          const t = raw["@odata.type"] || "";
          const body = t.includes("country")
            ? { "@odata.type": "#microsoft.graph.countryNamedLocation", displayName: raw.displayName, countriesAndRegions: raw.countriesAndRegions || [], includeUnknownCountriesAndRegions: !!raw.includeUnknownCountriesAndRegions, countryLookupMethod: raw.countryLookupMethod || "clientIpAddress" }
            : { "@odata.type": "#microsoft.graph.ipNamedLocation", displayName: raw.displayName, isTrusted: !!raw.isTrusted, ipRanges: (raw.ipRanges || []).map(r => ({ "@odata.type": r["@odata.type"] || "#microsoft.graph.iPv4CidrRange", cidrAddress: r.cidrAddress })) };
          const created = await Graph.gpost("/identity/conditionalAccess/namedLocations", body, [...AUTH_CONFIG.scopes, ...WRITE]);
          maps.loc[raw.id] = created.id;
          log.created.push(`Named location: ${raw.displayName}`);
        } catch (e) { log.warnings.push(`Named location ${raw.displayName}: ${e.message}`); }
      }
    }

    if (bundle.authStrengths.length) {
      onStatus?.("Authentication strengths…");
      let existing = [];
      try { existing = await Graph.ggetAll("/policies/authenticationStrengthPolicies"); } catch {}
      for (const raw of bundle.authStrengths) {
        const found = existing.find(x => x.displayName === raw.displayName || x.id === raw.id);
        if (found) { maps.strength[raw.id] = found.id; log.reused.push(`Auth strength: ${raw.displayName}`); continue; }
        if (raw.policyType === "builtIn") { maps.strength[raw.id] = raw.id; log.reused.push(`Auth strength (built-in): ${raw.displayName}`); continue; }
        try {
          const created = await Graph.gpost("/policies/authenticationStrengthPolicies",
            { displayName: raw.displayName, description: raw.description || "", allowedCombinations: raw.allowedCombinations || [] },
            [...AUTH_CONFIG.scopes, ...STRENGTH_WRITE]);
          maps.strength[raw.id] = created.id;
          log.created.push(`Auth strength: ${raw.displayName}`);
        } catch (e) { log.warnings.push(`Auth strength ${raw.displayName}: ${e.message}`); }
      }
    }

    if (bundle.authContexts.length) {
      onStatus?.("Authentication contexts…");
      let existing = [];
      try { existing = await Graph.ggetAll("/identity/conditionalAccess/authenticationContextClassReferences"); } catch {}
      for (const raw of bundle.authContexts) {
        if (existing.some(x => x.id === raw.id)) { maps.ctx[raw.id] = raw.id; log.reused.push(`Auth context: ${raw.displayName} (${raw.id})`); continue; }
        try {
          await Graph.gpatch(`/identity/conditionalAccess/authenticationContextClassReferences/${raw.id}`,
            { id: raw.id, displayName: raw.displayName, description: raw.description || "", isAvailable: raw.isAvailable !== false });
          maps.ctx[raw.id] = raw.id;
          log.created.push(`Auth context: ${raw.displayName} (${raw.id})`);
        } catch (e) { log.warnings.push(`Auth context ${raw.displayName}: ${e.message}`); }
      }
    }

    if (bundle.termsOfUse.length) {
      onStatus?.("Terms of use (lookup only)…");
      let existing = [];
      try { existing = await Graph.ggetAll("/identityGovernance/termsOfUse/agreements", [...AUTH_CONFIG.scopes, "Agreement.Read.All"]); } catch {}
      for (const raw of bundle.termsOfUse) {
        const found = existing.find(x => x.displayName === raw.displayName);
        if (found) { maps.tou[raw.id] = found.id; log.reused.push(`Terms of use: ${raw.displayName}`); }
        else log.warnings.push(`Terms of use "${raw.displayName}" does not exist in this tenant and cannot be created automatically — policies requiring it will be skipped.`);
      }
    }

    return { maps, log };
  }

  // ---------- build the create payload for one policy ----------
  const stripOdata = (o) => {
    if (Array.isArray(o)) return o.map(stripOdata);
    if (o && typeof o === "object") {
      const r = {};
      for (const [k, v] of Object.entries(o)) if (!k.includes("@odata")) r[k] = stripOdata(v);
      return r;
    }
    return o;
  };

  function buildPolicyPayload(raw, maps, personaGroupId, warnings, asIs = false) {
    const ph = maps.ph || {};
    // resolve a value that may be a template placeholder, a known old id, or a literal
    const resolveRef = (v, kindMap) => {
      const p = parsePlaceholder(v);
      if (p) {
        const hit = ph[`{{${p.kind}:${p.name}}}`];
        if (hit) return hit;
        throw new Error(`unresolved ${p.kind} "${p.name}" — create it in this tenant first`);
      }
      return (kindMap && kindMap[v]) || v;
    };
    const p = stripOdata(JSON.parse(JSON.stringify(raw)));
    delete p.id; delete p.createdDateTime; delete p.modifiedDateTime; delete p.templateId; delete p.partialEnablementStrategy;
    if (!asIs) p.state = "disabled"; // always import as Off — except E-Admins (as-is)
    const c = p.conditions = p.conditions || {};
    const u = c.users = c.users || {};

    const mapGroups = (arr) => (arr || []).flatMap(id => {
      try { return [resolveRef(id, maps.group)]; }
      catch (e) { warnings.push(`${raw.displayName}: ${e.message} — group reference dropped`); return []; }
    });

    if (asIs) {
      // as-is: keep all assignments; resolve placeholders / known ids only
      u.includeGroups = mapGroups(u.includeGroups);
      u.excludeGroups = mapGroups(u.excludeGroups);
    } else {
      // include assignment → persona deploy group
      if (personaGroupId) {
        u.includeUsers = ["None"];
        u.includeGroups = [personaGroupId];
        u.includeRoles = [];
        delete u.includeGuestsOrExternalUsers;
      } else {
        u.includeGroups = mapGroups(u.includeGroups);
      }
      // exclude users from the old tenant cannot be mapped — drop non-specials
      const specials = ["All", "None", "GuestsOrExternalUsers"];
      const droppedUsers = (u.excludeUsers || []).filter(x => !specials.includes(x) && !parsePlaceholder(x));
      if (droppedUsers.length) { warnings.push(`${raw.displayName}: dropped ${droppedUsers.length} excluded user(s) from the source tenant`); }
      u.excludeUsers = (u.excludeUsers || []).filter(x => specials.includes(x));
      u.excludeGroups = mapGroups(u.excludeGroups);
    }
    // locations → placeholders / remap
    if (c.locations) {
      for (const k of ["includeLocations", "excludeLocations"]) {
        if (!c.locations[k]) continue;
        c.locations[k] = c.locations[k].flatMap(id => {
          if (id === "All" || id === "AllTrusted") return [id];
          try { return [resolveRef(id, maps.loc)]; }
          catch (e) { throw new Error(`${e.message} (named location)`); } // location is material — fail the policy
        });
      }
    }
    // grant controls: auth strength + terms of use
    if (p.grantControls?.authenticationStrength) {
      // built-in strength ids are identical across tenants; placeholders resolve by name
      p.grantControls.authenticationStrength = { id: resolveRef(p.grantControls.authenticationStrength.id, maps.strength) };
    }
    if (p.grantControls?.termsOfUse?.length) {
      p.grantControls.termsOfUse = p.grantControls.termsOfUse.map(id => resolveRef(id, maps.tou));
    }
    if (c.applications?.includeAuthenticationContextClassReferences?.length) {
      c.applications.includeAuthenticationContextClassReferences =
        c.applications.includeAuthenticationContextClassReferences.map(id => resolveRef(id, maps.ctx));
    }
    // auth contexts keep their ids (ensured earlier)
    return p;
  }

  // ---------- apply ----------
  async function importPolicies(items, maps, onStatus) {
    const results = [], warnings = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      onStatus?.(`Importing ${it.name} (${i + 1}/${items.length})…`);
      try {
        const gid = it.personaGroup ? maps.personaGroupIds?.[it.personaGroup] : null;
        const payload = buildPolicyPayload(it.raw, maps, gid, warnings, it.asIs);
        await Graph.gpost("/identity/conditionalAccess/policies", payload, [...AUTH_CONFIG.scopes, ...WRITE]);
        results.push({ name: it.name, ok: true, persona: it.persona, personaGroup: it.personaGroup, asIs: it.asIs });
      } catch (e) {
        console.error("Import failed:", it.name, e);
        results.push({ name: it.name, ok: false, error: e.message || String(e) });
      }
    }
    return { results, warnings };
  }

  // ---------- markdown change report ----------
  function buildReport({ tenantName, fileName, depLog, planItems, results, warnings }) {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    const skipped = planItems.filter(p => p.exists);
    const lines = [
      `# Conditional Access import report`,
      ``,
      `- **Tenant:** ${tenantName}`,
      `- **Date:** ${stamp}`,
      `- **Source:** ${fileName}`,
      `- **Policies imported:** ${results.filter(r => r.ok).length} (all in state **Off/disabled**)`,
      `- **Policies skipped (already exist):** ${skipped.length}`,
      `- **Failures:** ${results.filter(r => !r.ok).length}`,
      ``,
      `## Dependencies`,
      ``,
      ...(depLog.created.length ? [`### Created`, ``, ...depLog.created.map(x => `- ${x}`), ``] : []),
      ...(depLog.reused.length ? [`### Reused (already existed)`, ``, ...depLog.reused.map(x => `- ${x}`), ``] : []),
      `## Imported policies`,
      ``,
      ...(results.filter(r => r.ok).map(r => r.asIs
        ? `- ✅ **${r.name}** — **imported as-is** (E-Admins: state and assignments unchanged)`
        : `- ✅ **${r.name}** — state set to Off; include assignment → ${r.personaGroup ? `\`${r.personaGroup}\` (persona: ${r.persona})` : "kept as in source"}`)),
      ``,
      ...(skipped.length ? [`## Skipped (already exist by CA number + version)`, ``, ...skipped.map(p => `- ⏭ ${p.name} — ${p.reason}`), ``] : []),
      ...(results.some(r => !r.ok) ? [`## Failed`, ``, ...results.filter(r => !r.ok).map(r => `- ❌ ${r.name} — ${r.error}`), ``] : []),
      ...((warnings.length || depLog.warnings.length) ? [`## Warnings`, ``, ...[...depLog.warnings, ...warnings].map(w => `- ⚠ ${w}`), ``] : []),
      `---`,
      `Generated by Conditional Access Baseline Tools — Import (BETA)`,
    ];
    return lines.join("\n");
  }

  return { PERSONA_GROUPS, personaOf, isEAdmins, parseCaVersion, parsePlaceholder, collectPlaceholders, parseEntries, readZip, readFolder, plan, ensureDependencies, buildPolicyPayload, importPolicies, buildReport };
})();
