// ======================================================================
// Gap analysis — best-practice & bypass checks.
// Evaluates the tenant's CA policies against known bypass research and
// the Swiss-cheese layered-defense model:
//   MFA coverage, FOCI token sharing, resource-exclusion scope leaks,
//   CA-immune resources, device registration bypass, grant-operator
//   weaknesses, legacy auth, known bypass apps, phishing-resistant MFA
//   detection, guest auth strength, break-glass coverage, and a
//   persona × control coverage matrix.
// Sources: Fabian Bader / Dirk-jan Mollema CA-bypass research
// (cloudbrothers.info, entrascopes.com), Secureworks FOCI research,
// Claus Jespersen's Zero Trust persona framework, Microsoft docs.
// Independent reimplementation of the check set from
// github.com/Jhope188/ca-policy-analyzer.
// ======================================================================
const GapCheck = (() => {
  const esc = (s) => String(s).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));

  // ─── Data: FOCI family (Family of Client IDs) ─────────────────────
  // These apps share refresh tokens: excluding ONE from a policy
  // effectively excludes ALL of them. (Secureworks / EntraScopes data.)
  const FOCI = {
    "1fec8e78-bce4-4aaf-ab1b-5451cc387264": "Microsoft Teams",
    "d3590ed6-52b3-4102-aeff-aad2292ab01c": "Microsoft Office",
    "27922004-5251-4030-b22d-91ecd9a37ea4": "Outlook Mobile",
    "4e291c71-d680-4d0e-9640-0a3358e31177": "PowerApps",
    "d326c1ce-6cc6-4de2-bebc-4591e5e13ef0": "SharePoint",
    "ab9b8c07-8f02-4f72-87fa-80105867a763": "OneDrive SyncEngine",
    "af124e86-4e96-495a-b70a-90f90ab96707": "OneDrive iOS App",
    "b26aadf8-566f-4478-926f-589f601d9c74": "OneDrive",
    "c0d2a505-13b8-4ae0-aa9e-cddd5eab0b12": "Microsoft Power BI",
    "4813382a-8fa7-425e-ab75-3b753aab3abb": "Microsoft Authenticator App",
    "0ec893e0-5785-4de6-99da-4ed124e5296c": "Microsoft 365 Copilot",
    "57fcbcfa-7cee-4eb1-8b25-12d2030b4ee0": "Microsoft Flow Mobile",
    "66375f6b-983f-4c2c-9701-d680650f588f": "Microsoft Planner",
    "9ba1a5c7-f17a-4de9-a1f1-6178c8d51223": "Microsoft Intune Company Portal",
    "22098786-6e16-43cc-a27d-191a01a1e3b5": "Microsoft To-Do client",
    "0922ef46-e1b9-4f7e-9134-9ad00547eb41": "Loop",
    "26a7ee05-5602-4d76-a7ba-eae8b7b67941": "Windows Search",
    "f44b1140-bc5e-48c6-8dc0-5cf5a53c0e34": "Microsoft Edge",
    "e9c51622-460d-4d3d-952d-966a5b1da34c": "Microsoft Edge (alt)",
    "872cd9fa-d31f-45e0-9eab-6e460a02d1f1": "Visual Studio (Legacy)",
    "cf36b471-5b44-428c-9ce7-313bf84528de": "Microsoft Bing Search",
    "844cca35-0656-46ce-b636-13f48b0eecbd": "Microsoft Stream Mobile",
    "87749df4-7ccf-48f8-aa87-704bad0e0e16": "Teams Device Admin Agent",
    "a569458c-7f2b-45cb-bab9-b7dee514d112": "Yammer iPhone",
    "e9cee14e-f26a-4349-886f-10048e3ef4b8": "Yammer Android",
    "b87b6fc6-536c-411d-9005-110ee6db77dc": "Yammer iPad",
    "c1c74fed-04c9-4704-80dc-9f79a2e515cb": "Yammer Web",
    "a40d7d7d-59aa-447e-a655-679a4107e548": "Accounts Control UI",
    "a670efe7-64b6-454f-9ae9-4f1cf27aba58": "Microsoft Lists (Android)",
    "540d4ff4-b4c0-44c1-bd06-cab1782d582a": "ODSP Mobile Lists App",
    "dd47d17a-3194-4d86-bfd5-c6ae6f5651e3": "Microsoft Defender for Mobile",
    "f05ff7c9-f75a-4acd-a3b5-f4b6a870245d": "SharePoint Android",
    "d7b530a4-7680-4c23-a8bf-c52c121d2e87": "Edge Enterprise New Tab Page",
    "e9b154d0-7658-433b-bb25-6b8e0a8a7c59": "Outlook Lite",
    "cab96880-db5b-4e15-90a7-f3f1d62ffe39": "Microsoft Defender Platform",
    "be1918be-3fe3-4be9-b32b-b542fc27f02e": "M365 Compliance Drive Client",
    "8ec6bc83-69c8-4392-8f08-b3c986009232": "Microsoft Teams-T4L",
    "eb20f3e3-3dce-4d2c-b721-ebb8d4414067": "Managed Meeting Rooms",
    "14638111-3389-403d-b206-a6a71d9f8f16": "Copilot App",
    "038ddad9-5bbe-4f64-b0cd-12434d1e633b": "ZTNA Network Access Client",
    "760282b4-0cfc-4952-b467-c8e0298fee16": "ZTNA Client — Private",
    "d5e23a82-d7e1-4886-af25-27037a0fdc2a": "ZTNA Client — M365",
    "ca01d00c-bfd6-46d6-ae7d-be5b5267d037": "ZTNA Policy Service Client",
    "cde6adac-58fd-4b78-8d6d-9beaf1b0d668": "Global Secure Access Client",
    "00b41c95-dab0-4487-9791-b9d2c32c80f2": "Office 365 Management",
  };
  const FOCI_COUNT = Object.keys(FOCI).length;

  // ─── Data: known CA-bypass apps (non-FOCI public clients) ─────────
  const BYPASS_APPS = {
    "04b07795-8ddb-461a-bbee-02f9e1bf7b46": ["Microsoft Azure CLI", "Public client reaching 462 resources."],
    "1950a258-227b-4e31-a9cf-717495945fc2": ["Microsoft Azure PowerShell", "649 resources — broadest non-FOCI resource access."],
    "1b730954-1685-4b74-9bfd-dac224a7b894": ["Azure Active Directory PowerShell", "Legacy module with broad directory access (260 resources)."],
    "cb1056e2-e479-49de-ae31-7812af012ed8": ["Microsoft Entra Connect (AAD Connect)", "Hybrid identity sync client with broad access (262 resources)."],
    "aebc6443-996d-45c2-90f0-388ff96faa56": ["Visual Studio Code", "IDE with Azure extension access (77 resources)."],
    "fc0f3af4-6835-4174-b806-f7db311fd2f3": ["Microsoft Intune Windows Agent", "Device enrollment path that bypasses compliant-device requirements."],
    "dd762716-544d-4aeb-a526-687b73838a22": ["Microsoft Device Registration Client", "Device registration bypasses location-based CA — only MFA protects it."],
    "de50c81f-5f80-4771-b66b-cebd28ccdfc1": ["Device Management Client", "1590 resources — the broadest resource access of ANY app."],
    "a672d62c-fc7b-4e81-a576-e60dc46e951d": ["Microsoft Power Query for Excel", "Data connection client with broad access (70 resources)."],
    "cf710c6e-dfcc-4fa8-a093-d47294e44c66": ["Azure Analysis Services Client", "15 resources."],
    "c58637bb-e2e1-4312-8a00-04b5ffcd3403": ["SharePoint Online Client Extensibility", "22 resources."],
    "268761a2-03f3-40df-8a8b-c3db24145b6b": ["Universal Store Native Client", "21 resources."],
    "1b3c667f-cde3-4090-b60b-3d2abd0117f0": ["Windows Spotlight", "17 resources."],
  };

  // ─── Data: resources always immune to CA (status: notApplied) ─────
  const CA_IMMUNE = [
    ["Microsoft Intune Checkin", "26a4ae64-5862-427f-a9b0-044e62572a4f", "Usable for password verification without triggering MFA failure logs."],
    ["Windows Notification Service", "04436913-cf0d-4d2a-9cc6-2ffe7f1d3d1c", "Push notification service."],
    ["Microsoft Mobile Application Management", "0a5f63c0-b750-4f38-a71c-4fc0d58b89e2", "Any app with pre-consented permissions can access without CA."],
    ["Azure Multi-Factor Auth Connector", "1f5530b3-261a-47a9-b357-ded261e17918", "Usable for password spraying without 50074 errors."],
    ["OCaaS Client Interaction Service", "c2ada927-a9e2-4564-aae2-70775a2fa0af", "Office client interaction service."],
    ["Authenticator App", "ff9ebd75-fe62-434a-a6ce-b3f0a8592eaf", "Required for passwordless flows; CA always notApplied."],
  ];

  const DRS_ID = "01cb2876-7ebd-4aa4-9cc9-d28bd4d359a9"; // Device Registration Service
  const REGISTER_DEVICE_ACTION = "urn:user:registerdevice";
  const AAD_GRAPH = "00000002-0000-0000-c000-000000000000";

  // ─── Phishing-resistant MFA detection ─────────────────────────────
  const PR_BUILTIN_ID = "00000000-0000-0000-0000-000000000004";
  const PR_TOKENS = ["fido2", "windowshelloforbusiness", "x509certificatemultifactor", "x509certificatesinglefactor", "deviceboundpasskey", "hardwareoath"];
  const PR_NAME_RE = /phishing.?resistant|fido2|windows hello|certificate.?based/i;

  // Resolves the policy's authenticationStrength.id against the tenant's
  // auth-strength catalog and inspects allowedCombinations — catches custom
  // strengths whose displayName doesn't say "phishing-resistant".
  function usesPhishingResistant(p, strengths) {
    const s = p.grantControls?.authenticationStrength;
    if (!s?.id) return /phishing.?resistant/i.test(p.displayName || "");
    if (s.id === PR_BUILTIN_ID) return true;
    if (PR_NAME_RE.test(s.displayName || "")) return true;
    const resolved = strengths?.get(s.id);
    for (const combo of resolved?.allowedCombinations || []) {
      const tokens = String(combo).toLowerCase().split(/[,\s]+/).filter(Boolean);
      if (tokens.some((t) => PR_TOKENS.includes(t))) return true;
    }
    return /phishing.?resistant/i.test(p.displayName || "");
  }

  // ─── Raw-policy helpers (fields may be missing) ───────────────────
  const U = (p) => p.conditions?.users || {};
  const A = (p) => p.conditions?.applications || {};
  const G = (p) => p.grantControls || {};
  const S = (p) => p.sessionControls || {};
  const grants = (p) => G(p).builtInControls || [];
  const appsInc = (p) => A(p).includeApplications || [];
  const appsExc = (p) => A(p).excludeApplications || [];
  const isEnabled = (p) => p.state === "enabled";
  const isReportOnly = (p) => p.state === "enabledForReportingButNotEnforced";
  // Off policies are evaluated too when INCLUDE_DISABLED is set (baseline tenants
  // stage the persona policies Off before enforcement).
  let INCLUDE_DISABLED = false;
  const isActive = (p) => isEnabled(p) || isReportOnly(p) || (INCLUDE_DISABLED && p.state === "disabled");
  const allUsers = (p) => (U(p).includeUsers || []).includes("All");
  const allApps = (p) => appsInc(p).includes("All");
  const hasMfa = (p) => grants(p).includes("mfa") || G(p).authenticationStrength != null;
  const hasBlock = (p) => grants(p).includes("block");
  const hasCompliance = (p) => grants(p).includes("compliantDevice") || grants(p).includes("domainJoinedDevice");
  const targetsLegacy = (p) => {
    const t = p.conditions?.clientAppTypes || [];
    return t.includes("exchangeActiveSync") || t.includes("other");
  };
  const targetsGuests = (p) =>
    (U(p).includeUsers || []).includes("GuestsOrExternalUsers") || U(p).includeGuestsOrExternalUsers != null;
  // Whether a policy targets real (human) users — includeUsers:["None"] is the
  // workload-identity sentinel and must not count.
  const targetsUsers = (p) => {
    const u = U(p);
    return (u.includeUsers || []).filter((x) => x !== "None").length > 0 ||
      (u.includeGroups || []).length > 0 || (u.includeRoles || []).length > 0;
  };

  // Controls of equivalent strength — an OR between members of the same group
  // is a Microsoft-recommended pattern, not a weakest-link weakness.
  const EQUIV_GROUP = {
    compliantDevice: "device-trust", domainJoinedDevice: "device-trust",
    approvedApplication: "app-protection", compliantApplication: "app-protection",
  };
  const CONTROL_LABEL = {
    mfa: "Require MFA", compliantDevice: "Require compliant device",
    domainJoinedDevice: "Require hybrid joined device", approvedApplication: "Require approved client app",
    compliantApplication: "Require app protection policy", passwordChange: "Require password change",
  };

  // ─── Finding factory ──────────────────────────────────────────────
  // ctx: { strengths: Map, namedLocations: [], names: {id:name} }
  function F(list, severity, category, title, p, description, recommendation) {
    list.push({
      severity, category, title,
      policyId: p ? p.id : null,
      policyName: p ? (p.displayName || "(unnamed policy)") : "Tenant-wide",
      description, recommendation,
    });
  }

  // ─── Break-glass identification ───────────────────────────────────
  // The most consistently excluded user/group across active All-users policies.
  function identifyBreakGlass(raws) {
    const cand = new Map();
    for (const p of raws.filter(isActive)) {
      if (!allUsers(p)) continue;
      for (const id of U(p).excludeUsers || []) {
        if (id === "GuestsOrExternalUsers") continue;
        const c = cand.get(id) || { id, type: "user", count: 0 };
        c.count++; cand.set(id, c);
      }
      for (const id of U(p).excludeGroups || []) {
        const c = cand.get(id) || { id, type: "group", count: 0 };
        c.count++; cand.set(id, c);
      }
    }
    let best = null;
    for (const c of cand.values()) if (!best || c.count > best.count) best = c;
    return best;
  }

  // ─── Tenant-wide checks ───────────────────────────────────────────
  function tenantChecks(raws, ctx, out) {
    const enabled = raws.filter(isEnabled);
    const reportOnly = raws.filter(isReportOnly);

    // 1. MFA coverage (report-only aware)
    const isMfaForAll = (p) => allUsers(p) && hasMfa(p);
    if (!enabled.some(isMfaForAll)) {
      const ro = reportOnly.find(isMfaForAll);
      if (ro) {
        F(out, "medium", "MFA Coverage", "MFA for All Users exists but is Report-only", ro,
          `"${ro.displayName}" requires MFA for All Users but runs in report-only mode — sign-ins are logged, not blocked, so users can still authenticate without MFA.`,
          "After 7–14 days of report-only telemetry with no unexpected blocks, switch the policy to On. Confirm break-glass accounts are excluded before flipping the state.");
      } else {
        F(out, "critical", "MFA Coverage", "No policy requires MFA for All Users", null,
          "No enabled or report-only policy requires MFA (or an authentication strength) for All Users — some users can authenticate with only a password.",
          "Create a baseline policy requiring MFA for All Users and All resources. This is the foundation layer of the Swiss cheese model.");
      }
    }

    // 2. Legacy authentication blocked?
    const blocksLegacy = enabled.some((p) => targetsLegacy(p) && hasBlock(p));
    if (!blocksLegacy) {
      F(out, "critical", "Legacy Authentication", "No policy blocks legacy authentication", null,
        "No enabled policy blocks legacy authentication protocols (Exchange ActiveSync / Other clients). Legacy auth cannot perform MFA and is the top vector for password spray and credential stuffing.",
        "Create a policy that blocks the Exchange ActiveSync and Other client app types for All Users.");
    }

    // 3. Break-glass coverage
    const bg = ctx.breakGlass;
    if (!bg) {
      const critical = enabled.filter((p) => allUsers(p) && (hasMfa(p) || hasBlock(p) || hasCompliance(p)));
      F(out, "critical", "Break-Glass Coverage", `No break-glass account or group detected across ${raws.length} policies`, null,
        `No consistent user or group exclusion was found across your policies that would indicate a break-glass (emergency access) account. A CA misconfiguration can lock out ALL administrators.${critical.length ? ` Enforcing broad policies without an emergency exclusion: ${critical.slice(0, 8).map((p) => p.displayName).join(", ")}${critical.length > 8 ? "…" : ""}.` : ""}`,
        "Create 2 cloud-only break-glass accounts (long random passwords, no mailbox), exclude them from every CA policy, alert on any sign-in, and test quarterly.");
    } else {
      const name = ctx.names?.[bg.id] || `ID ${bg.id.slice(0, 8)}…`;
      const label = bg.type === "user" ? "break-glass account" : "break-glass group";
      const userPolicies = raws.filter((p) => isActive(p) && targetsUsers(p));
      const missing = userPolicies.filter((p) =>
        !(bg.type === "user" ? (U(p).excludeUsers || []).includes(bg.id) : (U(p).excludeGroups || []).includes(bg.id)));
      if (!missing.length) {
        F(out, "info", "Break-Glass Coverage", `Break-glass ${bg.type} "${name}" excluded from all ${userPolicies.length} user-targeting policies ✓`, null,
          `The ${label} "${name}" (detected from exclusion patterns) is excluded from every active user-targeting policy — emergency access is preserved tenant-wide.`,
          "Verify this is your intended break-glass identity, alert on any sign-in activity, test emergency access quarterly, and keep excluding it from new policies.");
      } else {
        const enabledMissing = missing.filter(isEnabled);
        F(out, enabledMissing.length ? "high" : "medium", "Break-Glass Coverage",
          `Break-glass ${bg.type} "${name}" missing from ${missing.length} of ${userPolicies.length} user-targeting policies`, null,
          `The ${label} "${name}" (detected from exclusion patterns across your policies) is NOT excluded from: ${missing.slice(0, 10).map((p) => p.displayName).join(", ")}${missing.length > 10 ? ` and ${missing.length - 10} more` : ""}. A misconfiguration in one of these can lock out all admins including emergency access.`,
          `Edit each listed policy → Users → Exclude → add "${name}". Microsoft recommends excluding break-glass accounts from every CA policy.`);
        // Per-policy findings for enabled policies
        for (const p of enabledMissing) {
          const sev = hasBlock(p) && allUsers(p) && allApps(p) ? "high"
            : (hasMfa(p) || hasCompliance(p) || hasBlock(p)) && allUsers(p) ? "medium" : "low";
          F(out, sev, "Break-Glass Coverage", `Break-glass ${bg.type} not excluded`, p,
            `The ${label} "${name}" is not excluded from this enabled policy. If the policy misfires, emergency access is blocked with it.`,
            `Add "${name}" to this policy's ${bg.type === "user" ? "excluded users" : "excluded groups"}.`);
        }
      }
    }

    // 4. Resource exclusion bypass — low-privilege scope enforcement (March–June 2026)
    const exclPolicies = enabled.filter((p) => allApps(p) && appsExc(p).length > 0);
    if (exclPolicies.length) {
      const hasAadGraphPolicy = enabled.some((p) => appsInc(p).some((a) => String(a).toLowerCase() === AAD_GRAPH));
      const total = exclPolicies.reduce((s, p) => s + appsExc(p).length, 0);
      F(out, hasAadGraphPolicy ? "info" : "medium", "Resource Exclusion Bypass",
        `${exclPolicies.length} "All resources" policy(ies) with exclusions — low-privilege scope leak`, null,
        `${exclPolicies.length} enabled policy(ies) target All resources with ${total} app exclusion(s): ${exclPolicies.map((p) => p.displayName).join(", ")}. Legacy behavior: excluding ANY app leaks the low-privilege scopes openid, profile, email, offline_access, User.Read (plus User.Read.All, People.Read.All, GroupMember.Read.All and Member.Read.Hidden for confidential clients) from CA enforcement — a directory enumeration path. Microsoft is closing this March–June 2026 by mapping these scopes to Azure AD Graph (${AAD_GRAPH}) as the enforcement audience.` +
        (hasAadGraphPolicy ? " A policy explicitly targeting Azure AD Graph exists, which covers the enforcement audience." : " No policy explicitly targets Azure AD Graph — apps requesting only low-privilege scopes may face unexpected CA challenges once enforcement lands."),
        "Prefer All-resources policies with NO exclusions (move exempted apps to separate targeted policies). Review sign-ins against the Windows Azure Active Directory resource to spot apps that will start receiving CA challenges, and test with a report-only policy targeting Azure AD Graph.");
    }

    // 5. CA-immune resources — awareness
    if (raws.some((p) => isActive(p) && allApps(p))) {
      F(out, "info", "CA-Immune Resources", "6 Microsoft resources are always immune to Conditional Access", null,
        `Even policies targeting "All resources" never apply to: ${CA_IMMUNE.map(([n]) => n).join(", ")}. These always show notApplied in sign-in logs. Notably, ${CA_IMMUNE[0][0]} and the ${CA_IMMUNE[3][0]} can be used to verify passwords (password spraying) without triggering CA or MFA failure logs.`,
        "By design — cannot be changed. Monitor sign-in logs for these resource IDs, as they allow password verification without CA evaluation.");
    }
  }

  // ─── Per-policy checks ────────────────────────────────────────────
  function policyChecks(p, raws, ctx, out) {
    if (!isActive(p)) return;

    // FOCI token sharing
    const fociExcluded = appsExc(p).filter((id) => FOCI[String(id).toLowerCase()]);
    if (fociExcluded.length) {
      const names = fociExcluded.map((id) => FOCI[String(id).toLowerCase()]);
      F(out, "critical", "FOCI Token Sharing", `${names.length} excluded app(s) share tokens with the entire FOCI family`, p,
        `Excluded: ${names.join(", ")}. These belong to the FOCI family (Family of Client IDs) — all ${FOCI_COUNT}+ members share refresh tokens, so any family app can obtain an access token for any other. Excluding one effectively excludes ALL of them (Teams, Office, Outlook, OneDrive, Edge, Authenticator, Company Portal, …).`,
        "Remove the exclusion, or accept that the whole FOCI family bypasses this policy. Prefer a separate targeted policy with reduced controls over excluding FOCI apps from a broad policy.");
    }

    // Known CA-bypass apps excluded
    const bypassExcluded = appsExc(p)
      .map((id) => ({ id, e: BYPASS_APPS[String(id).toLowerCase()] }))
      .filter((x) => x.e);
    if (bypassExcluded.length) {
      F(out, "high", "Known CA Bypass Apps", `${bypassExcluded.length} app(s) with documented CA bypass capability excluded`, p,
        "Excluded apps with documented bypass capability: " +
        bypassExcluded.map((x) => `${x.e[0]} — ${x.e[1]}`).join(" · "),
        "Review each exclusion for a documented business justification. These public clients reach a very broad set of resources; excluding them from CA gives an attacker with a password a wide-open path.");
    }

    // Device registration bypass (MSRC VULN-153600, by design)
    (function checkDrs() {
      const explicit = appsInc(p).includes(DRS_ID) || (A(p).includeUserActions || []).includes(REGISTER_DEVICE_ACTION);
      if (!explicit && !allApps(p)) return;
      const loc = p.conditions?.locations;
      const usesLocation = !!loc && ((loc.includeLocations || []).length > 0 || (loc.excludeLocations || []).length > 0);
      if (!usesLocation && !hasCompliance(p)) return;   // nothing the DRS would ignore
      if (hasMfa(p)) return;                            // DRS honors MFA — protected
      // A dedicated registration-MFA policy is the documented mitigation
      const covered = raws.some((q) => q.id !== p.id && isActive(q) && hasMfa(q) &&
        ((A(q).includeUserActions || []).includes(REGISTER_DEVICE_ACTION) || appsInc(q).includes(DRS_ID)));
      if (covered) return;
      const leans = [usesLocation ? "location-based conditions" : null, hasCompliance(p) ? "a compliant/hybrid-joined device requirement" : null].filter(Boolean).join(" and ");
      F(out, explicit ? "high" : "medium", "Device Registration Bypass",
        explicit ? "Device registration protected only by controls the service ignores" : "Device Registration Service not covered by this policy's controls", p,
        `This policy relies on ${leans}, but the Device Registration Service ignores location and device-compliance conditions — only MFA / authentication strength is honored (MSRC VULN-153600, confirmed by-design). No separate policy requires MFA for the register-device user action, so device registration currently has no working control from this policy: an attacker can register a device from an untrusted location.`,
        'Create a dedicated policy requiring MFA or authentication strength for the "Register or join devices" user action. Never rely on location or device compliance to protect device enrollment.');
    })();

    // Swiss cheese: grant OR across controls of differing strength
    (function checkOr() {
      const g = G(p);
      if (g.operator !== "OR") return;
      const controls = grants(p).filter((c) => c !== "block");
      if (controls.length <= 1) return;
      const groupsOf = new Set(controls.map((c) => EQUIV_GROUP[c] || `unique:${c}`));
      const labels = controls.map((c) => CONTROL_LABEL[c] || c);
      if (groupsOf.size === 1 && ["device-trust", "app-protection"].includes([...groupsOf][0])) {
        F(out, "info", "Swiss Cheese Model", 'Grant OR between equivalent-strength controls — accepted pattern', p,
          `Requires ${labels.join(" OR ")} — both are controls of the same strength tier (a Microsoft-recommended pattern such as compliant OR hybrid-joined device), so there is no weaker control to downgrade to.`,
          "No change required. If these controls are meant to be layered on top of MFA, enforce the MFA layer in a separate policy — do not rely on this policy alone for MFA.");
        return;
      }
      F(out, "high", "Swiss Cheese Model", 'Grant controls use "OR" — weakest control is effective', p,
        `Requires ${labels.join(" OR ")}. With OR across controls of differing strength, an attacker only needs to satisfy the WEAKEST control and can skip the rest — contradicting the layered (Swiss cheese) defense model.`,
        'Change the operator to "AND" so all controls must be satisfied, or split into separate policies each requiring a single control.');
    })();

    // Swiss cheese: policy with grant controls but no MFA baseline
    (function checkNoMfa() {
      const g = G(p);
      if (!grants(p).length || hasBlock(p) || hasMfa(p)) return;
      if (!targetsUsers(p)) return; // workload/agent policies can't do interactive MFA
      if (grants(p).every((c) => c in EQUIV_GROUP)) return; // pure device-trust/app-protection layer is fine
      F(out, "medium", "Swiss Cheese Model", "Policy grants access without requiring MFA", p,
        `Grants access with: ${grants(p).map((c) => CONTROL_LABEL[c] || c).join(", ")} — but no MFA. Per the Swiss cheese model, MFA should be the baseline layer under everything else.`,
        "Add MFA (or an authentication strength) as a grant control, or ensure a separate All-Users MFA baseline policy covers these users.");
    })();

    // Legacy auth targeted but not blocked
    if (targetsLegacy(p) && !hasBlock(p)) {
      F(out, "high", "Legacy Authentication", "Legacy auth clients targeted but NOT blocked", p,
        "This policy targets legacy authentication clients (Exchange ActiveSync / Other) but does not block them. Legacy auth protocols cannot perform MFA.",
        "Change the grant to Block access. Legacy auth is a primary vector for password spray and credential stuffing.");
    }

    // Guest authentication strength
    (function checkGuestStrength() {
      if (!targetsGuests(p) || !hasMfa(p)) return;
      const strength = G(p).authenticationStrength;
      const pr = strength != null && usesPhishingResistant(p, ctx.strengths);
      const what = pr ? `phishing-resistant MFA (auth strength "${strength.displayName || strength.id}")`
        : strength ? `authentication strength "${strength.displayName || strength.id}"` : "MFA";
      F(out, pr ? "high" : "medium", "Guest Authentication Strength",
        pr ? "Guests must satisfy phishing-resistant MFA — high blocking risk" : `Guests must satisfy ${strength ? "an authentication strength" : "MFA"} — verify cross-tenant trust`, p,
        `This policy requires ${what} for guest/external users. Guests authenticate in their HOME tenant — to satisfy this requirement you must trust inbound MFA claims via Cross-Tenant Access Settings, and the guest's home tenant must support the required methods.` +
        (pr ? " Very few tenants have phishing-resistant methods (FIDO2, Windows Hello for Business, certificates) deployed, so most guests will be unable to comply and will be blocked." : " Without inbound MFA trust configured, guests are blocked (or forced to register MFA in your tenant)."),
        "Entra admin center → External Identities → Cross-tenant access settings → Inbound → Trust settings: enable 'Trust multi-factor authentication from Entra tenants' (default or per-organization). " +
        (pr ? "Consider a separate guest policy accepting standard Entra MFA, and scope phishing-resistant requirements to internal users or specific partners that support it." : "Test with a guest from a partner tenant in report-only mode before enforcing."));
    })();
  }

  // ─── Persona × control coverage matrix ────────────────────────────
  const CONTROLS = [
    ["require-mfa", "MFA"],
    ["phishing-resistant-mfa", "Phishing-resistant MFA"],
    ["require-compliant-device", "Compliant device"],
    ["sign-in-risk", "Sign-in risk"],
    ["user-risk", "User risk"],
    ["session-sif", "Sign-in frequency"],
    ["block-legacy-auth", "Legacy auth block"],
    ["block-countries", "Country block"],
    ["block-non-corp-network", "Non-corp network block"],
    ["block-high-risk-apps", "High-risk app block"],
  ];
  // Personas are the CA-number ranges used everywhere else in the app (same
  // source of truth as Render.caGroup / the Policies view). Ids are the range
  // base as a string: "0" = Global, "100" = Admins, …
  const PERSONAS = [
    ["0", "🌐 Global", ["block-legacy-auth", "block-countries"]],
    ["100", "🛡 Admins", ["require-mfa", "phishing-resistant-mfa", "require-compliant-device", "sign-in-risk", "user-risk", "session-sif"]],
    ["200", "👤 Internals", ["require-mfa", "require-compliant-device", "sign-in-risk", "user-risk"]],
    ["300", "🤝 Externals", ["require-mfa"]],
    ["400", "🙋 Guest users", ["require-mfa"]],
    ["500", "🛡🤝 Guest admins", ["require-mfa", "phishing-resistant-mfa", "session-sif"]],
    ["600", "🔧 Microsoft 365 service accounts", ["block-non-corp-network"]],
    ["700", "☁ Azure service accounts", ["block-non-corp-network"]],
    ["800", "⚙ Corp service accounts", ["block-non-corp-network"]],
    ["900", "🤖 Workload identities", ["block-non-corp-network", "sign-in-risk"]],
    ["1000", "💻 DevOps", ["require-mfa", "require-compliant-device", "user-risk"]],
    ["1100", "🚨 E-Admins", ["require-mfa", "phishing-resistant-mfa"]],
  ];
  // Personas always shown even when the tenant has no policy for them — a gap
  // here is meaningful. Other ranges are only shown when populated.
  const CORE_PERSONAS = new Set(["0", "100", "200"]);

  const TB = "(?<=^|[^A-Za-z0-9])", TE = "(?=$|[^a-z0-9])";
  // Fallback for tenants that do not use the CA-number naming convention.
  const PERSONA_PATTERNS = [
    ["1100", new RegExp(`${TB}(e[\\s_-]?admins?|emergency[\\s_-]?(?:access|admins?)|break[\\s_-]?glass)${TE}`, "i")],
    ["600", new RegExp(`${TB}(microsoft365serviceaccounts?|m365service|m365svc|directorysynchronization|aadc?onnect|entraconnect)${TE}`, "i")],
    ["700", new RegExp(`${TB}(azure[\\s_-]?service[\\s_-]?accounts?|azuresvc)${TE}`, "i")],
    ["900", new RegExp(`${TB}(workload[\\s_-]?identit(?:y|ies)|workloadid|serviceprincipals?|managedidentit(?:y|ies)|agents?|aiagents?|copilotagents?)${TE}`, "i")],
    ["800", new RegExp(`${TB}(corp(?:orate)?[\\s_-]?serviceaccounts?|corpservice|corpsvc|svcaccounts?|service[\\s_-]?accounts?)${TE}`, "i")],
    ["500", new RegExp(`${TB}(guestadmins?|externaladmins?|gdap|cspadmins?|partneradmins?)${TE}`, "i")],
    ["1000", new RegExp(`${TB}(devops|developers?|devs?|engineers?)${TE}`, "i")],
    ["100", new RegExp(`${TB}(admins?|privilegedusers?|privrole|priv[\\s_-]?roles?)${TE}`, "i")],
    ["400", new RegExp(`${TB}(guestusers?|guests?)${TE}`, "i")],
    ["300", new RegExp(`${TB}(externals?|b2b|external[\\s_-]?users?|externalcollabs?)${TE}`, "i")],
    ["200", new RegExp(`${TB}(internals?|employees?|members?|staff|users?[\\s_-]?internal)${TE}`, "i")],
    ["0", new RegExp(`${TB}(global|alluser|tenantwide|baseline|allapps?|allcloudapps?)${TE}`, "i")],
  ];

  function detectPersona(name) {
    if (!name) return null;
    // primary: the CA number, exactly as the Policies view groups them
    try {
      const g = Render.caGroup(name);
      if (g && g.num != null && PERSONAS.some(([id]) => id === String(g.key))) return String(g.key);
    } catch { /* Render not available — fall through to name patterns */ }
    for (const [persona, re] of PERSONA_PATTERNS) if (re.test(name)) return persona;
    return null;
  }

  // A policy can cover multiple personas (CA number / name + structural).
  function policyPersonas(p) {
    const out = new Set();
    const named = detectPersona(p.displayName);
    if (named) out.add(named);
    // structural signals only add personas when the name did not classify it,
    // so a correctly numbered baseline policy stays in its own persona row.
    if (!named) {
      if (allUsers(p)) { out.add("0"); out.add("200"); out.add("100"); }
      if ((U(p).includeRoles || []).length) out.add("100");
      if (targetsGuests(p)) { out.add("400"); out.add("300"); }
    }
    return out;
  }

  // Control detectors on a raw policy
  function makeDetectors(ctx) {
    const trustedLocIds = new Set((ctx.namedLocations || []).filter((l) => l.isTrusted).map((l) => l.id));
    const hasLoc = (p) => {
      const l = p.conditions?.locations;
      return !!l && ((l.includeLocations || []).length > 0 || (l.excludeLocations || []).length > 0);
    };
    return {
      "require-mfa": (p) => hasMfa(p),
      "phishing-resistant-mfa": (p) => usesPhishingResistant(p, ctx.strengths),
      "require-compliant-device": (p) => hasCompliance(p),
      "sign-in-risk": (p) => (p.conditions?.signInRiskLevels || []).length > 0 || !!p.conditions?.agentIdRiskLevels,
      "user-risk": (p) => (p.conditions?.userRiskLevels || []).length > 0,
      "session-sif": (p) => !!(S(p).signInFrequency?.isEnabled || S(p).persistentBrowser?.isEnabled),
      "block-legacy-auth": (p) => targetsLegacy(p) && hasBlock(p),
      "block-countries": (p) => hasLoc(p) && hasBlock(p),
      "block-non-corp-network": (p) => {
        const l = p.conditions?.locations;
        if (!l || !hasBlock(p)) return false;
        const exc = l.excludeLocations || [], inc = l.includeLocations || [];
        if (exc.some((x) => x === "AllTrusted" || String(x).toLowerCase().includes("trusted"))) return true;
        if (exc.some((x) => trustedLocIds.has(x))) return true;
        return inc.includes("All") && exc.length > 0;
      },
      "block-high-risk-apps": (p) => hasBlock(p) && appsInc(p).length > 0 && !allApps(p),
    };
  }

  function severityForGap(persona, control) {
    if (persona === "100" || persona === "1100") return control === "require-mfa" || control === "phishing-resistant-mfa" ? "critical" : "high";
    if (persona === "200") return control === "require-mfa" ? "critical" : control === "block-legacy-auth" ? "high" : "medium";
    if (persona === "0") return control === "block-legacy-auth" ? "high" : "medium";
    if ((persona === "300" || persona === "400" || persona === "500") && control === "require-mfa") return "high";
    return "medium";
  }

  function personaCoverage(raws, ctx, out) {
    const det = makeDetectors(ctx);
    const buckets = new Map(PERSONAS.map(([id]) => [id, []]));
    for (const p of raws) for (const per of policyPersonas(p)) buckets.get(per)?.push(p);

    const rows = [];
    for (const [id, label, expected] of PERSONAS) {
      const assigned = buckets.get(id);
      // ranges the tenant does not use are left out entirely (the Policies view
      // does the same); core personas stay so a real gap is still reported.
      if (!assigned.length && !CORE_PERSONAS.has(id)) continue;
      const cells = CONTROLS.map(([cid]) => {
        if (!expected.includes(cid)) return { control: cid, status: "na", policies: [] };
        const hit = assigned.filter((p) => isEnabled(p) && det[cid](p));
        const roHit = assigned.filter((p) => isReportOnly(p) && det[cid](p));
        const status = hit.length ? "present" : roHit.length ? "partial" : "missing";
        if (status === "missing") {
          const [, clabel] = CONTROLS.find(([c]) => c === cid);
          F(out, severityForGap(id, cid), "Persona Coverage", `${label.replace(/^\S+\s*/, "")}: missing ${clabel}`, null,
            `No enabled policy in the ${label.replace(/^\S+\s*/, "")} persona implements "${clabel}". Personas are matched on policy naming conventions (Claus Jespersen's Zero Trust framework, CA-number blocks) plus structural signals (All-users, roles, guests).`,
            "Add this control to an existing policy for this persona or deploy a dedicated one. Community baselines to compare against: Kenneth van Surksum, Joey Verlinden, Limon-IT.");
        }
        return { control: cid, status, policies: (hit.length ? hit : roHit).map((p) => p.displayName) };
      });
      const exp = cells.filter((c) => c.status !== "na");
      const scored = exp.filter((c) => c.status === "present").length + exp.filter((c) => c.status === "partial").length * 0.5;
      rows.push({ id, label, policies: assigned.length, cells, score: exp.length ? Math.round((scored / exp.length) * 100) : 100 });
    }
    return rows;
  }

  // ─── Run everything ───────────────────────────────────────────────
  // raws: raw Graph policies. ctx: { strengths: Map<id, authStrengthPolicy>,
  // namedLocations: [], names: {id: displayName} }
  function run(raws, ctx, opts = {}) {
    INCLUDE_DISABLED = !!opts.includeDisabled;
    ctx = ctx || {};
    ctx.breakGlass = identifyBreakGlass(raws);
    const findings = [];
    try { tenantChecks(raws, ctx, findings); } catch (e) { console.warn("GapCheck tenant checks failed:", e); }
    for (const p of raws) {
      try { policyChecks(p, raws, ctx, findings); } catch (e) { console.warn(`GapCheck failed on ${p.displayName}:`, e); }
    }
    let personas = [];
    try { personas = personaCoverage(raws, ctx, findings); } catch (e) { console.warn("GapCheck persona coverage failed:", e); }
    return { findings, personas, breakGlass: ctx.breakGlass };
  }

  // ─── Rendering ────────────────────────────────────────────────────
  const SEV_ORDER = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
  const SEV_LABEL = { critical: "Critical", high: "High", medium: "Medium", low: "Low", info: "Info" };
  const sevBadge = (s) => `<span class="sev ${s}">${SEV_LABEL[s] || s}</span>`;

  function renderSummary(result) {
    const f = result.findings;
    const n = (s) => f.filter((x) => x.severity === s).length;
    const chips = ["critical", "high", "medium", "low", "info"].filter((s) => n(s))
      .map((s) => `<span class="sev ${s}">${n(s)} ${SEV_LABEL[s]}</span>`).join(" ");
    return `<div style="display:flex;gap:18px;align-items:flex-start;flex-wrap:wrap">
      <div style="flex:1;min-width:260px">
        <h3>🧀 Gap analysis: best-practice &amp; bypass checks</h3>
        <p style="margin-bottom:0">Your policies checked against known Conditional Access bypasses and the Swiss-cheese layered-defense model:
        MFA coverage, FOCI token sharing, resource-exclusion scope leaks, CA-immune resources, device registration bypass, grant-operator
        weaknesses, legacy auth, known bypass apps, guest authentication strength and break-glass coverage — plus a persona × control matrix.
        Based on research by Fabian Bader &amp; Dirk-jan Mollema and the Zero Trust persona framework.</p>
      </div>
      <div style="text-align:right">
        <div style="font-size:26px;font-weight:700">${f.length}<span class="mini" style="font-weight:400"> finding${f.length === 1 ? "" : "s"}</span></div>
        <div style="margin-top:8px;display:flex;gap:6px;justify-content:flex-end;flex-wrap:wrap;max-width:280px">${chips}</div>
      </div>
    </div>`;
  }

  const CELL = {
    present: ["✓", "Present — enforced by an enabled policy"],
    partial: ["◐", "Partial — only a report-only policy matches"],
    missing: ["✗", "Missing — no policy implements this control"],
    "na": ["·", "Not expected for this persona"],
  };

  function renderPersonaMatrix(personas) {
    if (!personas.length) return "";
    const head = CONTROLS.map(([, l]) => `<th class="gc-ch"><span>${esc(l)}</span></th>`).join("");
    const rows = personas.map((r) => {
      const cells = r.cells.map((c) => {
        const [sym, tip] = CELL[c.status];
        const pol = c.policies.length ? ` — ${c.policies.slice(0, 3).join(", ")}${c.policies.length > 3 ? "…" : ""}` : "";
        return `<td class="gc-cell ${c.status}" title="${esc(tip + pol)}">${sym}</td>`;
      }).join("");
      return `<tr><th class="gc-rh">${r.label}<span class="mini" style="font-weight:400"> · ${r.policies} ${r.policies === 1 ? "policy" : "policies"} · ${r.score}%</span></th>${cells}</tr>`;
    }).join("");
    return `<div class="list-card" style="margin-bottom:18px;overflow:auto">
      <div style="padding:16px 18px 6px"><h4 style="font-size:13px;color:var(--accent2);text-transform:uppercase;letter-spacing:.05em">Persona × control coverage</h4>
      <p class="mini" style="margin:4px 0 8px">✓ enforced · ◐ report-only · ✗ missing · &nbsp;·&nbsp; not expected — personas matched on policy naming + structure; hover a cell for the matching policies.</p></div>
      <table class="gc-matrix"><thead><tr><th class="gc-rh"></th>${head}</tr></thead><tbody>${rows}</tbody></table>
    </div>`;
  }

  function renderFindings(result, filter, expanded) {
    let list = result.findings.slice().sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity]);
    if (filter !== "all") list = list.filter((f) => f.severity === filter);
    if (!list.length) return `<p class="mini" style="padding:20px">No findings match the current filter.</p>`;

    // group by category, ordered by the worst severity inside each
    const cats = new Map();
    for (const f of list) {
      if (!cats.has(f.category)) cats.set(f.category, []);
      cats.get(f.category).push(f);
    }
    return [...cats.entries()].map(([cat, items]) => {
      const cards = items.map((f, i) => {
        const uid = `${cat}:${i}:${f.title}`;
        const open = expanded.has(uid);
        return `<div class="list-card ml-card">
          <button class="ml-head ${open ? "open" : ""}" data-gctoggle="${esc(uid)}">
            <span class="caret">▶</span>
            ${sevBadge(f.severity)}
            <span class="ml-title">${esc(f.title)}</span>
            <span class="mini">${esc(f.policyName)}</span>
          </button>
          ${open ? `<div class="ml-detail">
            <h5>Assessment</h5><p>${esc(f.description)}</p>
            <h5 class="ml-green">Recommendation</h5><p>${esc(f.recommendation)}</p>
            ${f.policyId ? `<p style="margin-top:12px"><span class="pol-link" data-polid="${esc(f.policyId)}">Open policy: ${esc(f.policyName)} →</span></p>` : ""}
          </div>` : ""}
        </div>`;
      }).join("");
      return `<h4 class="gc-cat">${esc(cat)} <span class="mini">(${items.length})</span></h4>${cards}`;
    }).join("");
  }

  return { run, identifyBreakGlass, renderSummary, renderPersonaMatrix, renderFindings };
})();
