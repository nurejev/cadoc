// ======================================================================
// Assign groups — web port of Update-CAPolicyGroupAssignments.ps1.
// Changes the include/exclude groups of selected CA policies from a
// predefined persona-group list (or any group resolved by name).
// WRITE operation: uses Policy.ReadWrite.ConditionalAccess, requested on
// demand. Creating role-assignable groups is NOT ported (needs PRA +
// RoleManagement.ReadWrite.Directory) — use the PowerShell script for that.
// ======================================================================
const Assign = (() => {
  const ACTIONS = [
    "Set INCLUDE groups (replace current include groups)",
    "Set EXCLUDE groups (replace current exclude groups)",
    "ADD to INCLUDE groups (keep existing, add selected)",
    "ADD to EXCLUDE groups (keep existing, add selected)",
    "Set INCLUDE to All Users (clear include groups)",
    "REMOVE from INCLUDE groups (keep the rest)",
    "REMOVE from EXCLUDE groups (keep the rest)",
  ];
  // Which actions read a group selection (everything except "All Users").
  const NEEDS_GROUPS = (a) => a !== 4;

  // The baseline personas and the group that represents each. Lets the wizard
  // offer "pick by persona" instead of hunting for the exact group name — and
  // create it from a template if the tenant does not have it yet. Order matches
  // the CA-number ranges the rest of the app groups by.
  const PERSONAS = [
    { key: "global", label: "🌐 Global", group: null },  // no single persona group; global policies use All-users − exclusions
    { key: "admins", label: "🛡 Admins", group: "CAB-SEC-U-Persona-Admins" },
    { key: "internals", label: "👤 Internals", group: "CAB-SEC-U-Persona-Internals" },
    { key: "externals", label: "🤝 Externals", group: "CAB-SEC-U-Persona-Externals" },
    { key: "guestusers", label: "👥 Guest users", group: "CAB-SEC-U-Persona-GuestUsers" },
    { key: "guestadmins", label: "🔑 Guest admins", group: "CAB-SEC-U-Persona-GuestAdmins" },
    { key: "serviceaccounts", label: "⚙ M365 service accounts", group: "CAB-SEC-U-Persona-Microsoft365ServiceAccounts" },
    { key: "devops", label: "🧰 DevOps", group: "CAB-SEC-U-Persona-DevOps" },
    { key: "breakglass", label: "🚨 Break-glass", group: "CAB-SEC-U-BreakGlass" },
  ];
  // Only personas that map to a real group can be picked directly.
  const personasWithGroup = () => PERSONAS.filter((p) => p.group);
  const templateFor = (name) => templates().find((t) => t.displayName === name)
    || { displayName: name, mailNickname: name.replace(/[^A-Za-z0-9]/g, "") };
  // Which actions only ever remove — safe to run tenant-wide without the ALL
  // guard, like ADD-to-exclude, because they never rewrite what stays.
  const REMOVE_ACTIONS = new Set([5, 6]);

  const PREDEFINED = [
    // deploy / test
    "CAD-SEC-U-DG-GLO", "CAD-SEC-U-DG-ADM", "CAD-SEC-U-DG-INT", "CAD-SEC-U-DG-EXT",
    "CAD-SEC-U-DG-GUESTUSERS", "CAD-SEC-U-DG-GUESTAdmins", "CAD-SEC-U-DG-SA",
    "CAD-SEC-U-DG-DevOps", "CAD-SEC-U-DG-FW",
    // production
    "CAB-SEC-U-BreakGlass", "Emergency_Access1", "Emergency_Access2",
    "CAB-SEC-U-Persona-Admins", "CAB-SEC-U-Persona-GuestAdmins", "CAB-SEC-U-Persona-Guests",
    "CAB-SEC-U-Persona-Internals", "CAB-SEC-U-Persona-Externals",
    "CAB-SEC-U-Persona-Microsoft365ServiceAccounts", "CAB-SEC-U-Persona-DevOps",
  ];

  async function findGroup(name) {
    const flt = encodeURIComponent(`displayName eq '${name.replace(/'/g, "''")}'`);
    const found = await Graph.ggetAll(`/groups?$filter=${flt}&$select=id,displayName`);
    return found.length ? { id: found[0].id, name: found[0].displayName } : null;
  }

  // Free-text group lookup, so any group can be picked as an exclusion target —
  // not only the persona groups the baseline knows about. Accepts an object ID
  // (exact) or a name prefix; exact-name matches are hoisted to the top so
  // typing a full name still behaves like findGroup did.
  const isGuid = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s || "");
  async function searchGroups(q, limit) {
    const term = String(q || "").trim();
    if (!term) return [];
    if (isGuid(term)) {
      try {
        const g = await Graph.gget(`/groups/${term}?$select=id,displayName`);
        return [{ id: g.id, name: g.displayName }];
      } catch { return []; }
    }
    const esc = term.replace(/'/g, "''");
    const flt = encodeURIComponent(`startswith(displayName,'${esc}')`);
    const found = await Graph.ggetAll(`/groups?$filter=${flt}&$select=id,displayName&$top=${limit || 25}`);
    const out = found.map((g) => ({ id: g.id, name: g.displayName }));
    out.sort((a, b) => (a.name.toLowerCase() === term.toLowerCase() ? -1 : 0)
      - (b.name.toLowerCase() === term.toLowerCase() ? -1 : 0) || a.name.localeCompare(b.name));
    return out.slice(0, limit || 25);
  }

  // Resolve the predefined groups that exist in this tenant.
  async function resolveGroups(onStatus) {
    const out = [];
    for (const name of PREDEFINED) {
      onStatus?.(`Checking ${name}…`);
      try { const g = await findGroup(name); if (g) out.push(g); } catch {}
    }
    return out;
  }

  // ---------- group creation (pure Graph, no PowerShell) ----------
  // ASSIGNED groups are always created role-assignable (isAssignableToRole:true
  // — immutable, so it must be set at creation).
  //
  // DYNAMIC groups are left exactly as designed: they keep their membership
  // rule and are NOT role-assignable, because Entra does not allow the two
  // together. A dynamic group's whole point is its rule, so the rule wins.
  // Build the Graph payload. Two axes, decoupled: assigned-vs-dynamic, and
  // role-assignable-or-not. The one combination Entra rejects is dynamic +
  // role-assignable, so that is the only thing forced here. For a baseline
  // template with no explicit roleAssignable, keep the historical default:
  // assigned groups are role-assignable, dynamic ones are not.
  function buildGroupPayload(t) {
    const nickname = (String(t.mailNickname || t.displayName || "grp").replace(/[^A-Za-z0-9]/g, "").slice(0, 60)) || "CADSECgroup";
    const dynamic = !!t.dynamic;
    // explicit wins; otherwise assigned⇒role-assignable, dynamic⇒not
    const wantRole = t.roleAssignable != null ? !!t.roleAssignable : !dynamic;
    const roleAssignable = wantRole && !dynamic;   // Entra forbids the combination
    const p = {
      displayName: t.displayName,
      description: t.description || "Conditional Access target group. Created by Conditional Access Baseline Tools.",
      mailEnabled: false,
      securityEnabled: true,
      mailNickname: nickname,
    };
    if (dynamic) {
      p.groupTypes = ["DynamicMembership"];
      p.membershipRule = t.membershipRule || "";
      p.membershipRuleProcessingState = "On";
    }
    if (roleAssignable) p.isAssignableToRole = true;
    return p;
  }

  // Create (or reuse) a group. Returns {id, name, created, dynamic, roleAssignable}.
  async function createGroup(template) {
    const existing = await findGroup(template.displayName);
    if (existing) return { ...existing, created: false };
    const payload = buildGroupPayload(template);
    const g = await Graph.gpostGroupCreate("/groups", payload);
    return { id: g.id, name: g.displayName, created: true,
      dynamic: !!template.dynamic, roleAssignable: !!payload.isAssignableToRole };
  }

  function templates() { return typeof GROUP_TEMPLATES !== "undefined" ? GROUP_TEMPLATES : []; }

  // Same semantics as the PowerShell script's action switch.
  function newUsersBlock(raw, action, groupIds) {
    const u = raw.conditions?.users || {};
    const cur = {
      includeUsers: u.includeUsers || [], excludeUsers: u.excludeUsers || [],
      includeGroups: u.includeGroups || [], excludeGroups: u.excludeGroups || [],
      includeRoles: u.includeRoles || [], excludeRoles: u.excludeRoles || [],
    };
    let { includeUsers, includeGroups, excludeGroups } = cur;
    const notes = [];
    switch (action) {
      case 0: // replace include groups — groups take over from includeUsers
        includeUsers = ["None"]; includeGroups = [...groupIds];
        break;
      case 1: // replace exclude groups
        excludeGroups = [...groupIds];
        break;
      case 2: // add to include groups
        if (includeUsers.includes("All")) { includeUsers = ["None"]; notes.push("clears 'All users' from include (groups take over)"); }
        includeGroups = [...new Set([...cur.includeGroups, ...groupIds])];
        break;
      case 3: // add to exclude groups
        excludeGroups = [...new Set([...cur.excludeGroups, ...groupIds])];
        break;
      case 4: // include All Users, clear include groups
        includeUsers = ["All"]; includeGroups = [];
        break;
      case 5: { // remove selected from include groups
        const drop = new Set(groupIds);
        includeGroups = cur.includeGroups.filter((g) => !drop.has(g));
        break;
      }
      case 6: { // remove selected from exclude groups
        const drop = new Set(groupIds);
        excludeGroups = cur.excludeGroups.filter((g) => !drop.has(g));
        break;
      }
    }
    return {
      users: {
        includeUsers, excludeUsers: cur.excludeUsers,
        includeGroups, excludeGroups,
        includeRoles: cur.includeRoles, excludeRoles: cur.excludeRoles,
      },
      notes,
    };
  }

  // Apply to each policy: GET a fresh copy, compute the new users block, PATCH.
  // Would this new users block actually change the group assignment? Removal
  // (and add) is a no-op on a policy that never referenced the group; skipping
  // the PATCH there means a tenant-wide remove only writes the policies that
  // really had it, and the result list can say "unchanged" for the rest.
  function groupsChanged(raw, users) {
    const u = raw.conditions?.users || {};
    const same = (a, b) => { const A = new Set(a || []), B = new Set(b || []); return A.size === B.size && [...A].every((x) => B.has(x)); };
    return !same(u.includeGroups, users.includeGroups)
      || !same(u.excludeGroups, users.excludeGroups)
      || !same(u.includeUsers, users.includeUsers);
  }

  async function apply(policyIds, action, groupIds, onStatus) {
    const results = [];
    for (let i = 0; i < policyIds.length; i++) {
      let name = policyIds[i];
      try {
        const fresh = await Graph.gget(`/identity/conditionalAccess/policies/${policyIds[i]}`);
        name = fresh.displayName || name;
        onStatus?.(`Updating ${name} (${i + 1}/${policyIds.length})…`);
        const { users } = newUsersBlock(fresh, action, groupIds);
        if (!groupsChanged(fresh, users)) { results.push({ name, ok: true, changed: false }); continue; }
        await Graph.gpatch(`/identity/conditionalAccess/policies/${policyIds[i]}`, { conditions: { users } });
        results.push({ name, ok: true, changed: true });
      } catch (e) {
        console.error(`Assign: ${name} failed`, e);
        results.push({ name, ok: false, error: e.message || String(e) });
      }
    }
    return results;
  }

  return { ACTIONS, NEEDS_GROUPS, REMOVE_ACTIONS, PERSONAS, personasWithGroup, templateFor, PREDEFINED, findGroup, searchGroups, resolveGroups, newUsersBlock, apply, buildGroupPayload, createGroup, templates };
})();
