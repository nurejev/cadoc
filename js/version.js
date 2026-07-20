// ======================================================================
// Build stamp. Shown on the sign-in screen and in the footer so you can
// tell at a glance whether the deployed site is the version you pushed —
// GitHub Pages and the browser cache can both lag a commit behind.
//
// `build` matches the ?v= cache-busting number on every asset URL in
// index.html; bump both together when releasing.
// ======================================================================
const APP_BUILD = {
  version: "1.0",
  build: 117,
  date: "2026-07-20",
  get label() { return `v${this.version}.${this.build}`; },
  get full() { return `${this.label} · ${this.date}`; },
};

// Per-tool versions, keyed by the tile id in index.html. Each tool moves at
// its own pace, so a tenant-side reviewer can tell which one changed since
// they last looked without diffing the whole app. Bump the tool you touched.
const TOOL_VERSIONS = {
  toolPolicies:     { v: "2.0", note: "cards / list / settings matrix, persona grouping, dependency inspector, full-screen matrix, selection actions, delete with typed confirmation, per-policy what-if flow" },
  toolDocument:     { v: "1.4", note: "Word, PDF, PNG and PNG-bundle export with tenant branding" },
  toolAnalyze:      { v: "1.5", note: "users × policies impact matrix, group filters, standalone HTML report, scoped matrix columns, what-if simulator" },
  toolGapCheck:     { v: "1.6", note: "bypass checks, persona × control matrix, deployed-but-Off state, Markdown export" },
  toolExclusions:   { v: "1.3", note: "grouped exclusion sets, effective users, merged matrix rows, CSV and Markdown" },
  toolBaseline:     { v: "1.5", note: "Limon-IT catalog, card and table views, number-clash detection, collapsible personas, catalog revision 2026-07-20, refresh, on-screen gap report" },
  toolBaselineJoey: { v: "1.1", note: "Joey Verlinden catalog 2026.6.1, verified against commit 38469a4" },
  toolMsLearn:      { v: "1.9", note: "17 documented checks, 14 buildable fixes, apply-in-tenant with service-principal creation and change report" },
  toolJson:         { v: "1.2", note: "policy zip including dependencies and terms-of-use PDFs" },
  toolCaGroups:     { v: "1.4", note: "baseline group check, creation, members × groups matrix, and policy assignment in one tool, per-group member scan, manual group builder, remove-group action, final confirm, assignment change report, pick-by-persona" },
  toolState:        { v: "1.0", note: "On / report-only / Off switching" },
  toolImport:       { v: "1.7", note: "dependencies first, persona remapping, placeholder resolution, change report, on-screen report, claims-challenge step-up, up-front consent, import by persona, dependency scoping to selection" },
};
