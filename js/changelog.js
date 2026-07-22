// ======================================================================
// Changelog — the source of truth for both the "What's new" overlay shown
// after sign-in and the full changelog page.
//
// HOUSEKEEPING: whenever a tool is added or changed, add a NEW release
// object here for that build, in the same commit as the code, and bump
// APP_BUILD.build in version.js to match.
//
// One release object per build, holding ONLY what changed in that build.
// Do not bump an existing release's number to cover new work — the overlay
// shows every release newer than the build the person last acknowledged, so
// reusing an entry re-shows unrelated older items to people who already
// read them.
//
// kind:  "new"      — a whole tool or capability that did not exist
//        "improved" — an existing tool got better
//        "fixed"    — something was wrong and now is not
// Newest release first.
// ======================================================================
const CHANGELOG = [
  {
    build: 174, date: "2026-07-22", title: "Named locations: tighter cards and a table view",
    items: [
      { kind: "improved", tool: "Named locations", text: "Cards are smaller and now tile in a grid — at least two side by side, more on a wide screen — with the Edit and Delete buttons on their own row and the policy list capped so one location used by thirty policies cannot stretch its card past the rest." },
      { kind: "new", tool: "Named locations", text: "A Table view next to Cards: name, type, definition, which policies use it (named or via “All trusted”) and the actions, one line per location. On a tenant with dozens of locations this is the view you actually want." },
    ],
  },
  {
    build: 173, date: "2026-07-22", title: "CA validator: open the policy from the report",
    items: [
      { kind: "improved", tool: "CA validator", text: "Click a policy name in the validation report — compact or detailed view — and its full policy card opens, so you can check the actual assignment behind a simulated result without leaving the tool. In the detailed view the rest of the header still collapses the table." },
      { kind: "improved", tool: "CA validator", text: "Out of BETA: it now carries the NEW badge, like What-If and Change audit." },
    ],
  },
  {
    build: 172, date: "2026-07-22", title: "Change audit leaves BETA",
    items: [
      { kind: "improved", tool: "Change audit", text: "Out of BETA — it has proven itself on a large tenant (thousands of entries, summary roll-up, snapshot compare), so it now carries the same NEW badge as What-If. Nothing about how it works changed." },
    ],
  },
  {
    build: 171, date: "2026-07-22", title: "CA Doc is now ENCA — new name, new address",
    items: [
      { kind: "improved", tool: "All tools", text: "The toolset is renamed ENCA (Entra Conditional Access) and now lives at enca.limon-it.nl. cadoc.limon-it.nl redirects, so old bookmarks and the footer on documents you generated earlier keep working. Nothing about your tenant changes: the app registration keeps the same application ID, so no one has to consent again." },
      { kind: "fixed", tool: "Change audit", text: "Audit snapshots exported under the old name (schema cadoc-audit/1) still load for comparison — the rename does not orphan the history you already collected." },
      { kind: "fixed", tool: "All tools", text: "Arriving for the first time no longer opens the whole changelog at once, just the newest release. This matters right now because the new address is a new origin, so every browser looks like a first visit." },
    ],
  },
  {
    build: 170, date: "2026-07-22", title: "Workload ID licence check and post-import housekeeping",
    items: [
      { kind: "improved", tool: "Import", text: "Conditional Access for workload identities needs the separately purchased Microsoft Entra Workload ID licence, which is not part of Entra ID P1 or P2. The importer now reads the tenant's subscriptions first: without that licence the CA900-range policies are marked 🔒 and left out entirely instead of being attempted and rejected by Graph with a bare 400. The change report says which ones were held back and how to get the licence." },
      { kind: "new", tool: "List Policies", text: "🧹 Housekeeping — a match & replace import leaves the version it supersedes in place, switched Off, as your rollback, and nothing ever cleaned those up. The button appears when such policies exist, lists each one next to the policy that replaced it, and hands the ones you tick to the normal delete flow with its JSON backup and typed confirmation." },
    ],
  },
  {
    build: 169, date: "2026-07-21", title: "Imports that were failing with a bare 400",
    items: [
      { kind: "fixed", tool: "Import", text: "Policies that exclude Microsoft first-party apps — Defender for Endpoint, Defender for Mobile TVM, Device Registration Service — failed with an unexplained 400 on tenants that had never used those apps, because a policy can only name an application that has a service principal here. The importer now checks every referenced app up front and creates the missing service principals before importing." },
      { kind: "fixed", tool: "Import", text: "Workload-identity policies no longer have a persona deploy group forced onto them. Graph rejects a policy that carries both a service-principal scope and a user scope, which is why the WorkloadIDs policies failed; their assignment is now kept as-is, like E-Admins." },
      { kind: "improved", tool: "Import", text: "A 400 from Graph now names the likely cause — app references needing a service principal, a workload-identity scope conflict, insider risk, or a terms of use that must exist first — instead of just the raw error." },
    ],
  },
  {
    build: 168, date: "2026-07-21", title: "A clearer home button",
    items: [
      { kind: "improved", tool: "All tools", text: "Both home controls — the icon in the tab bar and the Tools button in the header — now use a drawn house icon instead of a glyph, bigger and easier to hit, and the tab-bar one highlights when you are on the tools page." },
    ],
  },
  {
    build: 166, date: "2026-07-21", title: "The selection bar sits where it should",
    items: [
      { kind: "fixed", tool: "List Policies", text: "The green selection bar overlapped the toolbar whenever the toolbar wrapped to a second row — searching, or a narrower window, was enough to trigger it. Its position is now measured from the toolbar's real height, and it wraps rather than clipping its own buttons." },
    ],
  },
  {
    build: 165, date: "2026-07-21", title: "Audit snapshots you can compare against",
    items: [
      { kind: "new", tool: "Change audit", text: "Export the current read as JSON, then load that snapshot on a later run to see what has happened since. Entra only keeps about 30 days of audit log and nothing is stored server-side, so exporting is how you build real history: new entries are badged and filterable, and anything the snapshot holds that Entra has since dropped is listed separately — at that point your export is the only copy." },
    ],
  },
  {
    build: 164, date: "2026-07-21", title: "A readable change audit on busy tenants",
    items: [
      { kind: "improved", tool: "Change audit", text: "Opens on a Summary view that rolls the log up per resource — one row per policy or group with how many adds, removes and updates it saw, how many distinct people moved, and who did it. On a large tenant that turns thousands of near-identical entitlement-management events into a handful of readable rows; click one for the individual changes, or switch to Timeline for the raw feed." },
    ],
  },
  {
    build: 163, date: "2026-07-21", title: "Change audit defaults and a read that holds",
    items: [
      { kind: "improved", tool: "Change audit", text: "Defaults to the last 7 days." },
      { kind: "fixed", tool: "Change audit", text: "A read in progress now survives switching tabs — come back and it is still running, or already finished, instead of showing the Run button again and starting a second read." },
    ],
  },
  {
    build: 162, date: "2026-07-21", title: "Auditing exclusion group membership",
    items: [
      { kind: "new", tool: "Change audit", text: "Also watches membership of the groups your policies include or exclude. Adding someone to an exclusion group widens a bypass without any policy being edited, so it never appears as a policy change — those additions and removals are now listed alongside, showing who was moved, to which group, by whom, and which policies that group exempts them from." },
    ],
  },
  {
    build: 161, date: "2026-07-21", title: "What's new, and a changelog page",
    items: [
      { kind: "new", tool: "What's new", text: "A “What's new” overlay after sign-in showing only what has landed since your last visit, and a full changelog page listing every release — reachable from its own tile, the tab bar, or by clicking the build number in the footer." },
    ],
  },
  {
    build: 160, date: "2026-07-21", title: "Setup script covers the audit permission",
    items: [
      { kind: "fixed", tool: "Setup", text: "The app-registration script now registers and consents AuditLog.Read.All, so Change audit works after a fresh setup. Re-run it against your existing app to add the permission." },
    ],
  },
  {
    build: 159, date: "2026-07-21", title: "Session-only policies are simulated",
    items: [
      { kind: "improved", tool: "CA validator", text: "Policies with only session controls are simulated instead of skipped — sign-in frequency, persistent browser, token protection, app-enforced restrictions, MDA app control and CAE now appear as expected controls carrying their configured value. Only a policy with no controls at all is skipped." },
      { kind: "improved", tool: "CA validator", text: "Both views group policies by persona." },
    ],
  },
  {
    build: 158, date: "2026-07-21", title: "Change audit, and sections on the home page",
    items: [
      { kind: "new", tool: "Change audit", text: "New tool. Reads the Entra directory audit log and shows who changed which Conditional Access resource, when, and exactly what changed — a field-level diff (state: report-only → enabled, one group added to an exclusion) rather than a wall of JSON. Covers policies, named locations, authentication strengths and contexts, and terms of use, with the actor and their source IP. Needs the AuditLog.Read.All permission, requested when you run it." },
      { kind: "improved", tool: "All tools", text: "The tools home page is grouped into sections — explore and document, analyse and simulate, compare against a baseline, manage the tenant — now that the tool count has grown." },
    ],
  },
  {
    build: 157, date: "2026-07-21", title: "Exclusion risk review",
    items: [
      { kind: "new", tool: "Exclusion analyzer", text: "New Risk review: every policy with exclusions scored for governance — privileged roles or all guests excluded, direct user exclusions, oversized exclusion lists, stale disabled accounts (including ones sitting inside an excluded group) and report-only exclusions — worst first, with the reasoning. Flag patterns follow Tiago S. Carvalho's CA exclusions audit." },
    ],
  },
  {
    build: 156, date: "2026-07-21", title: "Leaner group lookups",
    items: [
      { kind: "improved", tool: "Conditional Access groups", text: "A scope selector, defaulting to only the groups your policies actually reference, so a big tenant no longer looks up every template and baseline group. The member scan is now a picker — read the groups you care about instead of all of them, since each one costs a Graph call." },
    ],
  },
  {
    build: 155, date: "2026-07-21", title: "Named location usage fixed",
    items: [
      { kind: "fixed", tool: "Named locations", text: "Locations consumed through “All trusted locations” were reported as unused — nearly every trusted location in a real tenant. That implicit coverage is now resolved and labelled separately from a direct reference." },
      { kind: "improved", tool: "Named locations", text: "Global Secure Access compliant-network locations are recognised as their own type instead of being shown as IP ranges, and marked service-managed." },
    ],
  },
  {
    build: 154, date: "2026-07-21", title: "The exclusion matrix keeps its headers",
    items: [
      { kind: "fixed", tool: "Exclusion analyzer", text: "The policy column headers and the exclusion column stay pinned while you scroll the matrix, so you can always tell which policy a mark belongs to." },
    ],
  },
  {
    build: 152, date: "2026-07-21", title: "Named locations",
    items: [
      { kind: "new", tool: "Named locations", text: "New tool. View, create, edit and delete the IP-range and country named locations your policies target, and see which policies use each one. Validates CIDR (IPv4 and IPv6) and ISO country codes, warns when changing the trusted flag would move policies that use “All trusted locations”, and requires a typed confirmation before deleting a location a policy still references." },
    ],
  },
  {
    build: 151, date: "2026-07-21", title: "Group members, and a cleaner Gap analyse",
    items: [
      { kind: "improved", tool: "Exclusion analyzer", text: "A group's member count is now a link that opens the member list with UPNs, plus a CSV export." },
      { kind: "fixed", tool: "Gap analyse", text: "The policy list's green action bar no longer sits on top of the analysis output, and the policy-only search and filters are hidden in that view." },
    ],
  },
  {
    build: 148, date: "2026-07-21", title: "What-If",
    items: [
      { kind: "new", tool: "What-If", text: "New tool. Describe a sign-in — user, target resource, platform, client app, IP or country, device state and risk — and every enabled or report-only policy is evaluated against it: which apply, with the grant and session controls to satisfy, and which do not, each with the first condition that wasn't met. Mirrors the Entra What If tool." },
    ],
  },
  {
    build: 147, date: "2026-07-21", title: "Validator scoping made complete",
    items: [
      { kind: "fixed", tool: "CA validator", text: "Running against a persona group now shows the catch-all policies that reach it alongside its own, honours exclusions on a group it is nested inside, and lists the policies that do not reach it with the reason rather than dropping them silently." },
    ],
  },
  {
    build: 146, date: "2026-07-21", title: "Baseline diffs and target autocomplete",
    items: [
      { kind: "improved", tool: "Baseline Policies", text: "A Changes column shows what a newer baseline version actually changes against the deployed policy — added and removed assignments, and grant or session control differences." },
      { kind: "improved", tool: "CA validator", text: "The “Run against” box suggests matching groups and users as you type." },
    ],
  },
  {
    build: 145, date: "2026-07-21", title: "A compact validator view",
    items: [
      { kind: "improved", tool: "CA validator", text: "Opens on a Compact view — one summary card per policy showing what it enforces, on which apps, clients and conditions, and who it does not apply to — instead of every simulation as its own row. Detailed keeps the full grid." },
    ],
  },
  {
    build: 144, date: "2026-07-21", title: "Results that stick around",
    items: [
      { kind: "improved", tool: "All tools", text: "The Exclusion analyzer, Best-practice checks and CA validator no longer re-scan every time you come back to their tab — the result is cached, with a Run button to start and Rescan to refresh." },
      { kind: "improved", tool: "All tools", text: "A close-all-tabs button in the tab bar, and Help moved to the end of the tool list." },
      { kind: "fixed", tool: "All tools", text: "Mobile: filter chips and the validator's target row wrap properly, and wide report tables scroll inside their own container instead of pushing the page off-screen." },
    ],
  },
  {
    build: 143, date: "2026-07-21", title: "Run the validator against one persona",
    items: [
      { kind: "new", tool: "CA validator", text: "A “Run against” box scopes the whole report to a single persona group or user — only the policies that actually apply to that principal, with their group and role membership taken into account." },
    ],
  },
  {
    build: 142, date: "2026-07-21", title: "CA validator",
    items: [
      { kind: "new", tool: "CA validator", text: "New tool. For each policy, the sign-in simulations it implies and the control each one should — or should not — enforce, with the excluded side inverted to prove the policy does not fire there. Ported from Jasper Baes' Conditional Access Validator." },
    ],
  },
  {
    build: 140, date: "2026-07-21", title: "Help as a proper tool",
    items: [
      { kind: "new", tool: "Help", text: "Help is a full tool with its own page and tab, documenting every tool, each option and what to expect from it, with a sticky table of contents that follows you as you scroll." },
    ],
  },
  {
    build: 137, date: "2026-07-21", title: "Smarter imports",
    items: [
      { kind: "new", tool: "Import", text: "Choose an assignment mode: deploy new policies onto the persona deploy groups, or match & replace — a policy already in the tenant keeps its current assignment and state, gains any new exclusion groups the update adds, and the superseded version is switched Off." },
    ],
  },
  {
    build: 132, date: "2026-07-21", title: "Click to filter the exclusion matrix",
    items: [
      { kind: "improved", tool: "Exclusion analyzer", text: "Click a user or group row, or a policy column, to filter the matrix down to what is actually in scope and drop the empty cells." },
    ],
  },
  {
    build: 131, date: "2026-07-21", title: "Baseline groups and the R26.6 catalog",
    items: [
      { kind: "improved", tool: "Conditional Access groups", text: "One-click create for a missing baseline group, including TeamsSharedDevices as a dynamic group with the Teams Rooms membership rule, and a recreate path for a group that should be role-assignable but isn't." },
      { kind: "improved", tool: "Baseline Policies", text: "Catalog updated to the 2026-07-21 R26.6 export, including the new TeamsSharedDevices exclusion on the global session and risk policies." },
    ],
  },
];

// The newest build that has changelog copy — what the overlay compares against.
const CHANGELOG_LATEST = CHANGELOG.length ? CHANGELOG[0].build : 0;
