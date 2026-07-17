// ======================================================================
// Graph data layer: MSAL sign-in, policy fetch, GUID resolution.
// ======================================================================
const Graph = (() => {
  let msalApp = null, account = null;

  function init() {
    msalApp = new msal.PublicClientApplication({
      auth: {
        clientId: AUTH_CONFIG.clientId,
        authority: AUTH_CONFIG.authority,
        redirectUri: window.location.origin + window.location.pathname,
      },
      cache: { cacheLocation: "sessionStorage" },
    });
    return msalApp.initialize();
  }

  async function signIn() {
    const res = await msalApp.loginPopup({ scopes: AUTH_CONFIG.scopes, prompt: "select_account" });
    account = res.account;
    return account;
  }

  function signOut() {
    const acc = account;
    account = null;
    return msalApp.logoutPopup({ account: acc }).catch(() => {});
  }

  async function token(scopes) {
    scopes = scopes || AUTH_CONFIG.scopes;
    try {
      const r = await msalApp.acquireTokenSilent({ scopes, account });
      return r.accessToken;
    } catch {
      const r = await msalApp.acquireTokenPopup({ scopes, account });
      return r.accessToken;
    }
  }

  // Write scope — requested on demand (incremental consent) only for the
  // Assign-groups tool; every other tool stays read-only.
  const WRITE_SCOPES = ["Policy.ReadWrite.ConditionalAccess"];

  async function gpatch(url, body) {
    const t = await token([...AUTH_CONFIG.scopes, ...WRITE_SCOPES]);
    const r = await fetch(safeGraphUrl(url), {
      method: "PATCH",
      headers: { Authorization: "Bearer " + t, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      let msg = `Graph request failed (${r.status})`;
      try { msg += ": " + ((await r.json()).error?.message || ""); } catch {}
      throw new Error(msg);
    }
    return r.status === 204 ? null : r.json();
  }

  // never attach the access token to anything but Microsoft Graph
  function safeGraphUrl(url) {
    const full = url.startsWith("http") ? url : AUTH_CONFIG.graphBase + url;
    if (new URL(full).hostname !== "graph.microsoft.com") throw new Error("Blocked non-Graph URL");
    return full;
  }

  async function gget(url) {
    const t = await token();
    const r = await fetch(safeGraphUrl(url), {
      headers: { Authorization: "Bearer " + t, ConsistencyLevel: "eventual" },
    });
    if (!r.ok) throw new Error(`Graph request failed (${r.status})`);
    return r.json();
  }

  async function ggetAll(url) {
    let out = [], next = url;
    while (next) {
      const j = await gget(next);
      out = out.concat(j.value || []);
      next = j["@odata.nextLink"] || null;
    }
    return out;
  }

  async function gpost(url, body) {
    const t = await token();
    const r = await fetch(safeGraphUrl(url), {
      method: "POST",
      headers: { Authorization: "Bearer " + t, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`Graph request failed (${r.status})`);
    return r.json();
  }

  const isGuid = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s || "");
  const chunk = (arr, n) => { const o = []; for (let i = 0; i < arr.length; i += n) o.push(arr.slice(i, i + n)); return o; };

  // ---------- resolve all GUIDs referenced by the policies into names ----------
  async function buildResolver(policies, onStatus) {
    const names = {}; // guid -> display name

    onStatus?.("Resolving directory roles…");
    try { (await ggetAll("/directoryRoleTemplates")).forEach(r => names[r.id] = r.displayName); } catch {}

    onStatus?.("Resolving named locations…");
    try { (await ggetAll("/identity/conditionalAccess/namedLocations")).forEach(l => names[l.id] = l.displayName); } catch {}

    onStatus?.("Resolving authentication contexts…");
    try { (await ggetAll("/identity/conditionalAccess/authenticationContextClassReferences")).forEach(c => names[c.id] = c.displayName); } catch {}

    try { (await ggetAll("/policies/authenticationStrengthPolicies")).forEach(s => names[s.id] = s.displayName); } catch {}

    // terms of use names (needs Agreement.Read.All; shown as GUID if not granted)
    try { (await ggetAll("/identityGovernance/termsOfUse/agreements")).forEach(a => names[a.id] = a.displayName); } catch {}

    // collect user/group/app/service-principal GUIDs from all policies
    const dirIds = new Set(), appIds = new Set();
    for (const p of policies) {
      const c = p.conditions || {};
      const u = c.users || {};
      [...(u.includeUsers || []), ...(u.excludeUsers || []),
       ...(u.includeGroups || []), ...(u.excludeGroups || [])].filter(isGuid).forEach(id => dirIds.add(id));
      const a = c.applications || {};
      [...(a.includeApplications || []), ...(a.excludeApplications || [])].filter(isGuid).forEach(id => appIds.add(id));
      const ca = c.clientApplications || {};
      [...(ca.includeServicePrincipals || []), ...(ca.excludeServicePrincipals || [])].filter(isGuid).forEach(id => dirIds.add(id));
      (p.grantControls?.termsOfUse || []).filter(isGuid).forEach(id => dirIds.add(id));
    }

    onStatus?.("Resolving users and groups…");
    for (const ids of chunk([...dirIds], 1000)) {
      try {
        const j = await gpost("/directoryObjects/getByIds", { ids, types: ["user", "group", "servicePrincipal"] });
        (j.value || []).forEach(o => names[o.id] = o.displayName);
      } catch {}
    }

    onStatus?.("Resolving applications…");
    for (const ids of chunk([...appIds], 15)) {
      try {
        const flt = ids.map(id => `'${id}'`).join(",");
        (await ggetAll(`/servicePrincipals?$filter=appId in (${flt})&$select=appId,displayName`))
          .forEach(sp => names[sp.appId] = sp.displayName);
      } catch {}
    }

    return (id, fallbackMap) => (fallbackMap && fallbackMap[id]) || names[id] || id;
  }

  async function loadTenant(onStatus) {
    onStatus?.("Fetching Conditional Access policies…");
    const policies = await ggetAll("/identity/conditionalAccess/policies");
    onStatus?.("Fetching organization info…");
    let org = null;
    try { org = (await gget("/organization"))?.value?.[0] || null; } catch {}
    // tenant branding logo (used in exports); fails silently if not set / no permission
    let logo = null;
    if (org?.id) {
      try {
        const t = await token();
        const r = await fetch(safeGraphUrl(`/organization/${org.id}/branding/localizations/default/bannerLogo`),
          { headers: { Authorization: "Bearer " + t } });
        if (r.ok) {
          const b = await r.blob();
          if (b.size > 0) logo = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(b); });
        }
      } catch {}
    }
    const resolve = await buildResolver(policies, onStatus);
    return { policies, org, logo, resolve, account };
  }

  return { init, signIn, signOut, loadTenant, gget, ggetAll, gpost, gpatch, get account() { return account; } };
})();
