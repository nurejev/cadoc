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
  ];

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
  // EVERY group this tool creates is role-assignable (isAssignableToRole:true).
  // That flag is immutable — it can only be set at creation — so getting it
  // right here is the only chance.
  //
  // Graph does not allow role-assignable AND dynamic membership on the same
  // group. Role-assignable wins: a dynamic template is created as an assigned
  // (static) role-assignable group and its membership rule is reported back so
  // the caller can surface it, rather than silently creating a group that can
  // never hold a role assignment.
  function buildGroupPayload(t) {
    const nickname = (String(t.mailNickname || t.displayName || "grp").replace(/[^A-Za-z0-9]/g, "").slice(0, 60)) || "CADSECgroup";
    return {
      displayName: t.displayName,
      description: t.description || "Conditional Access target group. Created by Conditional Access Baseline Tools.",
      mailEnabled: false,
      securityEnabled: true,
      mailNickname: nickname,
      isAssignableToRole: true,
    };
  }

  // Create (or reuse) a group. Returns
  // {id, name, created, roleAssignable, ruleDropped?, membershipRule?}
  async function createGroup(template) {
    const existing = await findGroup(template.displayName);
    if (existing) return { ...existing, created: false };
    const g = await Graph.gpostGroupCreate("/groups", buildGroupPayload(template));
    const out = { id: g.id, name: g.displayName, created: true, roleAssignable: true };
    if (template.dynamic) {
      out.ruleDropped = true;
      out.membershipRule = template.membershipRule || "";
    }
    return out;
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
  async function apply(policyIds, action, groupIds, onStatus) {
    const results = [];
    for (let i = 0; i < policyIds.length; i++) {
      let name = policyIds[i];
      try {
        const fresh = await Graph.gget(`/identity/conditionalAccess/policies/${policyIds[i]}`);
        name = fresh.displayName || name;
        onStatus?.(`Updating ${name} (${i + 1}/${policyIds.length})…`);
        const { users } = newUsersBlock(fresh, action, groupIds);
        await Graph.gpatch(`/identity/conditionalAccess/policies/${policyIds[i]}`, { conditions: { users } });
        results.push({ name, ok: true });
      } catch (e) {
        console.error(`Assign: ${name} failed`, e);
        results.push({ name, ok: false, error: e.message || String(e) });
      }
    }
    return results;
  }

  return { ACTIONS, PREDEFINED, findGroup, resolveGroups, newUsersBlock, apply, buildGroupPayload, createGroup, templates };
})();
