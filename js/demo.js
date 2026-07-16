// Sample policies (raw Graph shape) for demo mode (?demo=1) and local testing.
const DEMO_DATA = {
  tenantName: "Contoso B.V. (demo)",
  policies: [
    {
      id: "d1", displayName: "Require MFA for all admins", state: "enabled", modifiedDateTime: "2026-06-28T09:00:00Z",
      conditions: {
        users: { includeRoles: ["62e90394-69f5-4237-9190-012177145e10"], excludeUsers: ["u-break1"] },
        applications: { includeApplications: ["All"] },
        clientAppTypes: ["browser", "mobileAppsAndDesktopClients"],
      },
      grantControls: { operator: "OR", builtInControls: [], authenticationStrength: { id: "s1", displayName: "Phishing-resistant MFA" } },
      sessionControls: { signInFrequency: { isEnabled: true, frequencyInterval: "timeBased", value: 12, type: "hours" } },
    },
    {
      id: "d2", displayName: "Block legacy authentication", state: "enabled", modifiedDateTime: "2026-05-11T09:00:00Z",
      conditions: {
        users: { includeUsers: ["All"], excludeUsers: ["u-svc"] },
        applications: { includeApplications: ["All"] },
        clientAppTypes: ["exchangeActiveSync", "other"],
      },
      grantControls: { operator: "OR", builtInControls: ["block"] },
    },
    {
      id: "d3", displayName: "Require compliant device for Office 365", state: "enabled", modifiedDateTime: "2026-06-02T09:00:00Z",
      conditions: {
        users: { includeUsers: ["All"], excludeGuestsOrExternalUsers: { guestOrExternalUserTypes: "b2bCollaborationGuest" } },
        applications: { includeApplications: ["Office365"] },
        platforms: { includePlatforms: ["windows", "macOS"] },
        clientAppTypes: ["browser", "mobileAppsAndDesktopClients"],
        devices: { deviceFilter: { mode: "exclude", rule: 'device.isCompliant -eq True' } },
      },
      grantControls: { operator: "OR", builtInControls: ["compliantDevice", "domainJoinedDevice"] },
    },
    {
      id: "d4", displayName: "Block device code flow & auth transfer", state: "enabled", modifiedDateTime: "2026-07-01T09:00:00Z",
      conditions: {
        users: { includeUsers: ["All"], excludeUsers: ["u-break1"] },
        applications: { includeApplications: ["All"] },
        clientAppTypes: ["all"],
        authenticationFlows: { transferMethods: "deviceCodeFlow,authenticationTransfer" },
      },
      grantControls: { operator: "OR", builtInControls: ["block"] },
    },
    {
      id: "d5", displayName: "Block elevated insider risk", state: "enabledForReportingButNotEnforced", modifiedDateTime: "2026-07-10T09:00:00Z",
      conditions: {
        users: { includeUsers: ["All"], excludeUsers: ["u-break1", "u-break2"] },
        applications: { includeApplications: ["All"] },
        clientAppTypes: ["all"],
        insiderRiskLevels: "elevated",
      },
      grantControls: { operator: "OR", builtInControls: ["block"] },
    },
    {
      id: "d6", displayName: "Unmanaged devices — limited web session", state: "disabled", modifiedDateTime: "2026-03-19T09:00:00Z",
      conditions: {
        users: { includeUsers: ["All"] },
        applications: { includeApplications: ["00000003-0000-0ff1-ce00-000000000000"] },
        clientAppTypes: ["browser"],
        signInRiskLevels: ["medium", "high"],
        devices: { deviceFilter: { mode: "include", rule: 'device.trustType -ne "AzureAD"' } },
      },
      grantControls: { operator: "OR", builtInControls: ["mfa"] },
      sessionControls: {
        applicationEnforcedRestrictions: { isEnabled: true },
        persistentBrowser: { isEnabled: true, mode: "never" },
        signInFrequency: { isEnabled: true, frequencyInterval: "everyTime" },
        secureSignInSession: { isEnabled: true },
      },
    },
  ],
  names: {
    "62e90394-69f5-4237-9190-012177145e10": "Global Administrator",
    "u-break1": "breakglass-01", "u-break2": "breakglass-02", "u-svc": "svc-legacyapp",
    "00000003-0000-0ff1-ce00-000000000000": "Office 365 SharePoint Online",
  },

  // ---- impact-analysis demo data (users + memberships) ----
  analyzeUsers: [
    { id: "u-admin", displayName: "Alex Admin", userPrincipalName: "alex.admin@contoso.com", userType: "Member", accountEnabled: true },
    { id: "u-break1", displayName: "breakglass-01", userPrincipalName: "breakglass-01@contoso.com", userType: "Member", accountEnabled: true },
    { id: "u-break2", displayName: "breakglass-02", userPrincipalName: "breakglass-02@contoso.com", userType: "Member", accountEnabled: true },
    { id: "u-svc", displayName: "svc-legacyapp", userPrincipalName: "svc-legacyapp@contoso.com", userType: "Member", accountEnabled: true },
    { id: "u-emp1", displayName: "Eva Employee", userPrincipalName: "eva@contoso.com", userType: "Member", accountEnabled: true },
    { id: "u-emp2", displayName: "Milan Medewerker", userPrincipalName: "milan@contoso.com", userType: "Member", accountEnabled: true },
    { id: "u-guest1", displayName: "Gary Guest", userPrincipalName: "gary_ext#EXT#@contoso.com", userType: "Guest", accountEnabled: true },
    { id: "u-old", displayName: "Olga Offboarded", userPrincipalName: "olga@contoso.com", userType: "Member", accountEnabled: false },
  ],
  roleMembers: { "62e90394-69f5-4237-9190-012177145e10": ["u-admin"] },
  groupMembers: {},
};
