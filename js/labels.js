// Friendly labels for Graph enum values and well-known IDs.
const LABELS = {
  state: { enabled: "on", disabled: "off", enabledForReportingButNotEnforced: "report" },
  stateText: { on: "On", off: "Off", report: "Report-only" },

  users: {
    All: "All users", None: "None",
    GuestsOrExternalUsers: "Guests & external users",
  },
  guestTypes: {
    internalGuest: "Local guests", b2bCollaborationGuest: "B2B collaboration guests",
    b2bCollaborationMember: "B2B collaboration members", b2bDirectConnectUser: "B2B direct connect",
    otherExternalUser: "Other external users", serviceProvider: "Service provider users",
  },

  apps: {
    All: "All resources", None: "None",
    Office365: "Office 365",
    MicrosoftAdminPortals: "Microsoft Admin Portals",
  },
  userActions: {
    "urn:user:registersecurityinfo": "Register security information",
    "urn:user:registerdevice": "Register or join devices",
  },

  clientAppTypes: {
    all: "Any client app", browser: "Browser",
    mobileAppsAndDesktopClients: "Mobile apps & desktop clients",
    exchangeActiveSync: "Exchange ActiveSync clients",
    easSupported: "Exchange ActiveSync (supported)",
    other: "Other clients (legacy authentication)",
  },

  platforms: {
    all: "Any device", android: "Android", iOS: "iOS", windows: "Windows",
    windowsPhone: "Windows Phone", macOS: "macOS", linux: "Linux",
  },

  risk: { high: "High", medium: "Medium", low: "Low", none: "No risk" },
  insiderRisk: { minor: "Minor", moderate: "Moderate", elevated: "Elevated" },

  locations: { All: "Any network or location", AllTrusted: "All trusted networks and locations" },

  authFlows: {
    deviceCodeFlow: "Device code flow",
    authenticationTransfer: "Authentication transfer",
  },

  grantControls: {
    block: "Block access", mfa: "Require multifactor authentication",
    compliantDevice: "Require device to be marked compliant",
    domainJoinedDevice: "Require Microsoft Entra hybrid joined device",
    approvedApplication: "Require approved client app",
    compliantApplication: "Require app protection policy",
    passwordChange: "Require password change",
    riskRemediation: "Require risk remediation",
  },

  servicePrincipals: { ServicePrincipalsInMyTenant: "All owned service principals" },

  persistentBrowser: { always: "Always persistent", never: "Never persistent" },
  cloudAppSecurity: {
    mcasConfigured: "Use custom policy (Defender for Cloud Apps)",
    monitorOnly: "Monitor only", blockDownloads: "Block downloads",
  },
  signInFrequencyType: { days: "day(s)", hours: "hour(s)" },
};

// Values that are newer CA settings — highlighted with a "new" tag in the UI.
const NEW_SETTING_KEYS = ["authFlows", "insiderRisk", "tokenProtection", "globalSecureAccess"];
