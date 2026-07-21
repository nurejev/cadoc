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

  // Does this policy grant a Terms of use? Either a real termsOfUse id in the
  // grant controls, or a {{tou:Name}} placeholder. Returns the count (>0 = yes).
  function touReferences(raw) {
    const g = raw.grantControls || {};
    let n = (g.termsOfUse || []).length;
    const blob = JSON.stringify(raw);
    n += (blob.match(/\{\{tou:[^}]+\}\}/gi) || []).length;
    return n;
  }

  // ---------- plan: which policies import / skip / update ----------
  // `existing` may be a legacy array of display-name strings, or the tenant's
  // raw policy objects. The objects carry the id + assignments needed for the
  // "match & replace" mode (copy the current scoping, disable the old policy).
  function plan(bundle, existing) {
    const ex = (existing || []).map((e) => {
      const name = typeof e === "string" ? e : (e && (e.displayName || e.name)) || "";
      const raw = typeof e === "string" ? null : (e && (e.raw || e));
      const { num, ver } = parseCaVersion(name);
      return { num, ver, name, raw, id: raw && raw.id };
    }).filter((e) => e.num != null && e.ver);
    return bundle.policies.map(raw => {
      const { num, ver } = parseCaVersion(raw.displayName);
      const sameNum = num != null ? ex.filter((e) => e.num === num) : [];
      const exact = sameNum.find((e) => e.ver === ver);        // same CA number + same version
      const other = sameNum.find((e) => e.ver !== ver);        // present, but a different version
      const asIs = isEAdmins(raw.displayName);
      const exists = !!exact;
      // "upgrade": the tenant already has this CA number at another version, so
      // it can be replaced in place rather than deployed alongside. E-Admins are
      // always handled as-is, never auto-replaced.
      const upgrade = !exact && !!other && !asIs;
      const persona = asIs ? null : personaOf(raw.displayName);
      // A ToU has no Graph create API, so a policy granting one needs a manual
      // step (create the ToU in the portal, re-import). Flag it up front.
      const needsTou = touReferences(raw);
      return {
        raw, name: raw.displayName, num, ver, asIs,
        persona, personaGroup: persona ? PERSONA_GROUPS[persona] : null,
        exists, upgrade,
        existing: upgrade ? { id: other.id, name: other.name, ver: other.ver, raw: other.raw } : null,
        needsTou,
        reason: exists ? `already exists (CA${num} v${ver})`
          : upgrade ? `already in tenant as v${other.ver}`
          : asIs ? "E-Admins — imported as-is (state & assignments unchanged)"
          : !persona ? "no persona detected — include assignment kept as-is" : null,
      };
    });
  }

  // ---------- dependencies: create-if-missing, build old-id → new-id maps ----------
  // Narrow a bundle to only the dependencies the chosen policies actually
  // reference, so importing one persona does not create all 97 groups. Matching
  // is by id presence in the raw policy JSON — a dependency object is kept if
  // any chosen policy mentions its id anywhere (include/exclude group, location,
  // auth strength/context, terms of use, or a {{…}} placeholder by name).
  function scopeBundle(bundle, chosenRaws) {
    const blobs = chosenRaws.map(r => JSON.stringify(r));
    const used = (id) => id != null && blobs.some(b => b.includes(id));
    const keep = (arr) => (arr || []).filter(x => used(x.id));
    // placeholders reference by name, e.g. {{group:CAB-SEC-U-Persona-Admins}}
    const usedName = (name) => name && blobs.some(b => b.includes(name));
    return {
      ...bundle,
      policies: chosenRaws,
      groups: (bundle.groups || []).filter(g => used(g.id) || usedName(g.displayName)),
      namedLocations: keep(bundle.namedLocations),
      authStrengths: keep(bundle.authStrengths),
      authContexts: keep(bundle.authContexts),
      termsOfUse: keep(bundle.termsOfUse),
    };
  }

  async function ensureDependencies(bundle, onStatus, opts = {}) {
    // Policies being replaced keep their current tenant assignment, so they need
    // no deploy persona group — don't create one just for them.
    const matchedNames = new Set(opts.matchedNames || []);
    const maps = { group: {}, loc: {}, strength: {}, ctx: {}, tou: {}, ph: {} };
    // missingTou: ToU display names the tenant lacks. A ToU has no Graph create
    // API (the PDF/localised content must be uploaded in the portal), so these
    // are collected for the report as a to-create checklist rather than a
    // generic warning.
    const log = { created: [], reused: [], warnings: [], missingTou: [] };
    const noteMissingTou = (name) => { if (name && !log.missingTou.includes(name)) log.missingTou.push(name); };
    // Assigned groups are created role-assignable; dynamic groups keep their
    // membership rule (Entra forbids role-assignable + dynamic). Say which.
    const noteGroup = (g, label) => {
      const kind = !g.created ? "" : g.dynamic ? " (dynamic, membership rule preserved)" : " (assigned, role-assignable)";
      (g.created ? log.created : log.reused).push(`${label}${kind}`);
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
            else noteMissingTou(p.name);
          }
        } catch (e) { log.warnings.push(`Placeholder ${key(p)}: ${e.message}`); }
      }
    }

    // persona groups needed by the policies themselves (not the replaced ones)
    const personaNames = [...new Set(bundle.policies.filter(p => !matchedNames.has(p.displayName)).map(p => personaOf(p.displayName)).filter(Boolean).map(p => PERSONA_GROUPS[p]))];
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
        else noteMissingTou(raw.displayName);
      }
    }

    return { maps, log };
  }

  // ---------- build the create payload for one policy ----------
  const stripOdata = (o) => {
    if (Array.isArray(o)) return o.map(stripOdata);
    if (o && typeof o === "object") {
      const r = {};
      for (const [k, v] of Object.entries(o)) {
        if (k.startsWith("#")) continue;
        // keep a genuine type discriminator (derived types need it), drop the
        // links and the sibling "xxx@odata.type": "#Collection(String)" hints
        if (k.includes("@odata") && !(k === "@odata.type" && typeof v === "string" && v.startsWith("#microsoft.graph."))) continue;
        r[k] = stripOdata(v);
      }
      return r;
    }
    return o;
  };

  function buildPolicyPayload(raw, maps, personaGroupId, warnings, asIs = false, matchFrom = null) {
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

    if (matchFrom) {
      // Match & replace: this CA number already exists in the tenant. Keep the
      // NEW version's controls/conditions, but take the whole USER assignment
      // (include/exclude users, groups, roles, guests) verbatim from the policy
      // already deployed — those ids are valid in this tenant. The old policy is
      // disabled afterwards by importPolicies.
      const eu = (matchFrom.conditions && matchFrom.conditions.users) || {};
      u.includeUsers = Array.isArray(eu.includeUsers) ? [...eu.includeUsers] : ["None"];
      u.includeGroups = Array.isArray(eu.includeGroups) ? [...eu.includeGroups] : [];
      u.includeRoles = Array.isArray(eu.includeRoles) ? [...eu.includeRoles] : [];
      u.excludeUsers = Array.isArray(eu.excludeUsers) ? [...eu.excludeUsers] : [];
      u.excludeGroups = Array.isArray(eu.excludeGroups) ? [...eu.excludeGroups] : [];
      u.excludeRoles = Array.isArray(eu.excludeRoles) ? [...eu.excludeRoles] : [];
      if (eu.includeGuestsOrExternalUsers) u.includeGuestsOrExternalUsers = eu.includeGuestsOrExternalUsers; else delete u.includeGuestsOrExternalUsers;
      if (eu.excludeGuestsOrExternalUsers) u.excludeGuestsOrExternalUsers = eu.excludeGuestsOrExternalUsers; else delete u.excludeGuestsOrExternalUsers;
    } else if (asIs) {
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
  // opts.mode: "deploy" (default) → new/updated policies scoped to the deploy
  // persona group; "replace" → policies already in the tenant keep their current
  // assignment and the old version is switched Off.
  async function importPolicies(items, maps, onStatus, opts = {}) {
    const replace = opts.mode === "replace";
    const results = [], warnings = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      onStatus?.(`Importing ${it.name} (${i + 1}/${items.length})…`);
      try {
        const gid = it.personaGroup ? maps.personaGroupIds?.[it.personaGroup] : null;
        const matchFrom = replace && it.upgrade && it.existing ? it.existing.raw : null;
        const payload = buildPolicyPayload(it.raw, maps, gid, warnings, it.asIs, matchFrom);
        await Graph.gpost("/identity/conditionalAccess/policies", payload, [...AUTH_CONFIG.scopes, ...WRITE]);
        let disabledOld = false;
        const oldName = it.existing?.name || null;
        if (matchFrom && it.existing?.id) {
          // switch the superseded policy Off; both land disabled, so the admin
          // reviews the new one and removes the old when satisfied.
          try {
            await Graph.gpatch(`/identity/conditionalAccess/policies/${it.existing.id}`, { state: "disabled" }, [...AUTH_CONFIG.scopes, ...WRITE]);
            disabledOld = true;
          } catch (e) {
            warnings.push(`${it.name}: the new version was created, but disabling the current policy "${oldName}" failed — disable it manually: ${e.message}`);
          }
        }
        results.push({ name: it.name, ok: true, persona: it.persona, personaGroup: matchFrom ? null : it.personaGroup, asIs: it.asIs, matched: !!matchFrom, disabledOld, oldName: matchFrom ? oldName : null });
      } catch (e) {
        console.error("Import failed:", it.name, e);
        results.push({ name: it.name, ok: false, error: e.message || String(e) });
      }
    }
    return { results, warnings };
  }

  // ---------- markdown change report ----------
  function buildReport({ tenantName, fileName, depLog, planItems, results, warnings, mode }) {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    const skipped = planItems.filter(p => p.exists);
    const replaced = results.filter(r => r.ok && r.matched);
    const lines = [
      `# Conditional Access import report`,
      ``,
      `- **Tenant:** ${tenantName}`,
      `- **Date:** ${stamp}`,
      `- **Source:** ${fileName}`,
      `- **Assignment mode:** ${mode === "replace" ? "Match & replace — existing policies keep their current assignment; the superseded version is switched Off" : "Deployment groups — includes remapped to the deploy persona group (CAD-SEC-U-DG-*)"}`,
      `- **Policies imported:** ${results.filter(r => r.ok).length} (all in state **Off/disabled**)`,
      ...(replaced.length ? [`- **Policies replaced (old version disabled):** ${replaced.filter(r => r.disabledOld).length} of ${replaced.length}`] : []),
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
        : r.matched
        ? `- ♻️ **${r.name}** — state Off; **assignment copied from the current policy**${r.disabledOld ? `; previous version **${r.oldName}** switched Off` : `; ⚠ could not disable previous version${r.oldName ? ` **${r.oldName}**` : ""}`}`
        : `- ✅ **${r.name}** — state set to Off; include assignment → ${r.personaGroup ? `\`${r.personaGroup}\` (persona: ${r.persona})` : "kept as in source"}`)),
      ``,
      ...(skipped.length ? [`## Skipped (already exist by CA number + version)`, ``, ...skipped.map(p => `- ⏭ ${p.name} — ${p.reason}`), ``] : []),
      ...(results.some(r => !r.ok) ? [`## Failed`, ``, ...results.filter(r => !r.ok).map(r => `- ❌ ${r.name} — ${r.error}`), ``] : []),
      ...((depLog.missingTou || []).length ? [
        `## ⚠ Terms of use to create first (manual step)`,
        ``,
        `A Terms of use has **no Graph create API** — its PDF and localised content must be uploaded in the portal. Any policy that grants one of these was imported **without** the ToU control (so it does not enforce it yet).`,
        ``,
        `**Create each one, then re-run the import** — the importer resolves them by display name on the next pass:`,
        ``,
        ...depLog.missingTou.map(n => `- [ ] **${n}**`),
        ``,
        `Portal: **Entra admin center → Identity Governance → Terms of use → New terms** — https://entra.microsoft.com/#view/Microsoft_AAD_ERM/DashboardBlade/~/TermsOfUse . Use the exact display name above.`,
        ``,
      ] : []),
      ...((warnings.length || depLog.warnings.length) ? [`## Warnings`, ``, ...[...depLog.warnings, ...warnings].map(w => `- ⚠ ${w}`), ``] : []),
      `---`,
      `Generated by Conditional Access Baseline Tools — Import (BETA)`,
    ];
    return lines.join("\n");
  }

  return { PERSONA_GROUPS, personaOf, isEAdmins, touReferences, parseCaVersion, parsePlaceholder, collectPlaceholders, parseEntries, readZip, readFolder, plan, scopeBundle, ensureDependencies, buildPolicyPayload, importPolicies, buildReport };
})();
