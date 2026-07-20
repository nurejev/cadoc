# CA Doc — Conditional Access Baseline Tools

A browser-based toolset for a Microsoft Entra Conditional Access baseline: **document it, analyse it, check it against best practice, back it up and redeploy it** — from one page, with an interactive Entra sign-in and nothing to install.

It started as a web successor to the idPowerToys CA documenter and grew into twelve tools. Everything runs **100% in the browser** as a static site: no backend, no database, no telemetry, and no policy data ever leaves the user's session. All Microsoft Graph calls go straight from the browser to `graph.microsoft.com` with a delegated token.

**Live:** https://cadoc.limon-it.nl · **Demo without sign-in:** https://cadoc.limon-it.nl/?demo=1

## What's in it

| Tool | What it does | Writes? |
|---|---|---|
| 🗂 **List Policies** | Every policy as cards, a list, or a settings matrix — grouped by persona from the CA number (CA000–099 Global, CA100–199 Admins, … CA1100–1199 E-Admins). Expand a policy to inspect its dependencies (auth strengths, named locations, groups with their first members, terms of use). Select policies to act on them without leaving the screen: documentation, backup, gap analyse, assign groups, policy state, or **delete** (typed confirmation, JSON backup offered first — Conditional Access has no recycle bin). | only if you delete or change state/groups |
| 📄 **Create documentation** | Select policies (or take all) and generate shareable documentation: **Word**, **PDF**, **PNG**, or a **PNG bundle**. Exports are neutral — they carry the connected tenant's branding, not Limon-IT's. | no |
| 🔍 **Gap analyse** | Users × policies impact matrix: which policies apply to whom, who bypasses one through an exclusion (and why), whether that bypass is covered elsewhere, and who gets no MFA at all. Filter by group or user type, then export the filtered set as a standalone HTML report. | no |
| 🛡 **Best-practice & bypass checks** | The baseline against known CA bypasses and the Swiss-cheese layered-defense model: MFA coverage, FOCI token sharing, resource-exclusion scope leaks, CA-immune resources, device-registration bypass, grant-operator weaknesses, legacy auth, known bypass apps, guest auth strength, break-glass coverage — plus a persona × control coverage matrix. Exports to Markdown. | no |
| 🚪 **Exclusion analyzer** | Every exclusion in every policy — users, groups (expanded to their members), directory roles, guest/external types, applications, named locations, device platforms — grouped by exclusion set, with an exclusion × policy matrix and an effective-user × policy matrix. Exports to CSV and Markdown. | no |
| 🧬 **Baseline Policies** (two catalogs) | Matches the tenant against the bundled Limon-IT baseline catalog (**R26.6 / v3.x**, 99 policies) on the CA number — the stable identity in the naming convention — and compares versions segment by segment. Every policy lands in one bucket: up to date, outdated (with the upgrade path, e.g. `v1.0 → v1.0.1`), newer than baseline, missing, a **number clash** (the CA number matches but the persona or the name contradicts it — common when comparing against a *different* baseline, where numbering diverges), or not in the baseline. A second catalog holds the community **Conditional Access Baseline by Joey Verlinden** (2026.6.1, 36 policies, verified against the repository at commit `38469a4`) with his own personas, switchable from the toolbar; each card links to the policy JSON in his repo. Exports a Markdown gap report and hands off to Import. | no |
| 📘 **MS Learn checks** | Policies against exclusions, limitations and upcoming behaviour changes documented on learn.microsoft.com: missing break-glass exclusions, token-protection limits, Teams Rooms / Surface Hub impact, required app exclusions, control retirements. Each finding links to its source page. Mechanically fixable findings carry a **Fix** button that builds a *new* policy from the affected one with the documented adjustment applied — version bumped, state Off — collected in a **Suggested fixes** tab and downloadable as JSON or one zip. Nothing is written to the tenant — except in a recognised **baseline tenant**, where an **Apply in tenant** action can create the replacements (Off) and delete the originals, behind an explicit confirmation, creating first the service principals for any Microsoft app a fixed policy references but the tenant has never instantiated, and writes a Markdown change report of everything it did. | no* |
| 🗄 **Backup (JSON)** | Raw Graph JSON of the selected policies in one timestamped zip — including their **dependencies** (auth strengths, named locations, terms of use with the actual PDF, and the groups they assign). | no |
| 👥 **Conditional Access groups** | Everything about the groups a CA baseline depends on, in four steps.<br>**① Check** — the expected set (bundled group templates + every group named by a baseline catalog you actually deploy) against the directory. Also flags **dangling references**: an object ID a policy still points at but the directory no longer has, so the policy targets nobody through it, and **drift** such as a group that should be role-assignable but is not (immutable — it has to be recreated).<br>**② Create** — two ways, both here and both separate from Assign. **Batch-create the missing baseline groups** from the bundled templates (assigned templates come out role-assignable, templates with a rule come out dynamic), or **build one group by hand**: display name, description, assigned vs **dynamic** (with an Entra membership rule), and an explicit **role-assignable** toggle. `isAssignableToRole` is immutable, so it is chosen at creation; it is forced off for a dynamic group because Entra forbids the combination. Existing names are reused, never duplicated.<br>**③ Members** — transitive membership as a members × groups matrix, run on demand (one Graph call per group) with progress and a stop button. Empty groups are called out: a policy scoped to an empty include group applies to nobody.<br>**④ Assign** — set, add or **remove** include/exclude groups on the selected policies or on **every policy in the tenant**. Any group can be targeted: search by name prefix or paste an object ID. A **final confirmation** recaps in plain language exactly what will be written before it happens. Removal (and add) only rewrites the policies that actually reference the group — the rest come back *unchanged*. Tenant-wide runs of the *replacing* actions need a typed `ALL`; add and remove are scoped to the named groups, so they do not. Every run produces a **Markdown change report** (updated / unchanged / failed per policy, with each failure's Graph error); a tenant-wide run or any run with failures shows it automatically. | **yes** (steps ② and ④) |
| 🎚 **Set Policy state** | Switch selected policies between On, Report-only and Off. | **yes** |
| 📥 **Import** | Restore a backup (zip or folder): dependencies first, policies always imported **Off**, matched on CA number + version so existing policies are updated rather than duplicated, and include-assignments remapped onto the target tenant's persona groups. Produces a Markdown change report. | **yes** |

The writing actions are always behind an explicit review step and request their write scopes on demand (incremental consent) — signing in never grants them.

## Design notes

- **Graph beta endpoint**, so the newest policy properties are covered — the ones the old documenter misses: authentication flows (device code / auth transfer), insider risk, agent ID risk, token protection / secure sign-in session, Global Secure Access filtering profiles, authentication contexts and workload identities.
- **Persona-aware throughout.** Policies, the coverage matrix and the checks all group by the same CA-number ranges, so a baseline built on the persona convention reads as one picture instead of a flat list.
- **Baseline tenants.** In a staging tenant where the baseline sits Off, the checks treat a deployed-but-disabled policy as *"deployed but Off"* (`○`) rather than a missing control, and skip non-persona policies.
- **No PowerShell.** Everything that used to be a script — the impact matrix, group assignment, group creation, state changes, import — is a Graph call from the browser.
- **Light and dark.** Follows the device by default; the header button cycles Auto → Light → Dark. Exports are always captured in light theme.
- **No build step.** Vanilla JS, self-hosted libraries, GitHub Pages serves the repo as-is.
- **Build stamp.** `js/version.js` holds the app version, build number and date, plus a **per-tool version** shown in the corner of each tile (hover for what that version covers) — so it is clear which tool moved, not just that something did; the sign-in screen and the footer show it, and the console logs it. The build number matches the `?v=` cache-busting suffix on every asset in `index.html` — bump both together, so a stale deploy or a cached tab is obvious at a glance.

---

## Setup — steps for you

### 1. Create the Entra app registration (one-time)

**Option A — script (recommended):**

```powershell
Install-Module Microsoft.Graph.Applications -Scope CurrentUser -RequiredVersion 2.25.0   # once, pinned
./New-CaDocAppRegistration.ps1
```

Re-runs: pass `-AppObjectId <object-id>` (shown in the summary output) to target the exact registration instead of matching by display name.

Reuses your current Graph session if connected (otherwise signs in interactively), creates/updates the multi-tenant SPA registration with both redirect URIs and the delegated permissions, grants admin consent in your tenant, and writes the client ID into `js/authConfig.js` automatically.

**Option B — portal:**

1. [Entra admin center](https://entra.microsoft.com) → **Identity → Applications → App registrations → New registration**
2. Name: `CA Doc (Limon-IT)`
3. Supported account types: **Accounts in any organizational directory (multi-tenant)**
4. Redirect URI: platform **Single-page application (SPA)** → `https://cadoc.limon-it.nl`
5. After creation, under **Authentication → Single-page application**, also add `http://localhost:8080` (local development)
6. **API permissions → Add a permission → Microsoft Graph → Delegated:**
   - `Policy.Read.All`
   - `Directory.Read.All`
   Then click **Grant admin consent** for your own tenant.
7. Copy the **Application (client) ID** and paste it into [`js/authConfig.js`](js/authConfig.js) (`clientId`).

No client secret needed — it's a public SPA using PKCE.

### 2. Create the GitHub repo and push

```bash
cd cadoc
git init -b main
git add .
git commit -m "CA Doc v1"
git remote add origin https://github.com/<your-account>/cadoc.git
git push -u origin main
```

### 3. Enable GitHub Pages

Repo → **Settings → Pages** → Source: **Deploy from a branch** → branch `main`, folder `/ (root)` → Save.
The `CNAME` file (`cadoc.limon-it.nl`) is already in the repo, so the custom domain is picked up automatically.

### 4. DNS record at your registrar

Add a CNAME record for `limon-it.nl`:

| Type  | Name    | Value                       |
|-------|---------|-----------------------------|
| CNAME | `cadoc` | `<your-account>.github.io.` |

Back in repo → Settings → Pages: confirm the custom domain shows `cadoc.limon-it.nl`, wait for the certificate, then tick **Enforce HTTPS**.

### 5. Test

- Local: `cd cadoc && python3 -m http.server 8080` → http://localhost:8080 (sign-in works because of the localhost redirect URI). Or open `?demo=1` for sample data without any setup.
- Production: https://cadoc.limon-it.nl

### 6. Customer tenants (multi-tenant consent)

An admin of each customer tenant must consent once. Send them this URL (replace `CLIENT_ID`):

```
https://login.microsoftonline.com/organizations/adminconsent?client_id=CLIENT_ID&redirect_uri=https://cadoc.limon-it.nl
```

After consent, anyone in that tenant with permission to read CA policies (e.g. Security Reader/Global Reader) can sign in and document their policies.

---

## Project structure

Every JS file is an IIFE assigned to one global — no modules, no bundler, no build step. Load order is the order of the `<script>` tags in `index.html`.

```
index.html            app shell: login, tools home, every tool screen, modals
css/app.css           Limon-IT theme + light/dark palettes
js/authConfig.js      clientId + scopes  ← the only file you must edit
js/labels.js          friendly names for Graph enums / well-known IDs
js/graph.js           MSAL sign-in, policy fetch (Graph beta), GUID→name resolver
js/model.js           raw policy → view model (incl. the newest CA settings)
js/render.js          card / list / settings-matrix rendering + persona grouping
js/analyze.js         users x policies impact engine  (Gap analyse)
js/gapcheck.js        best-practice & bypass checks + persona x control matrix
js/exclusions.js      exclusion collection, group expansion, matrices, CSV/MD
js/baselineData.js    the Limon-IT baseline catalog (R26.6 / v3.x)
js/baselineJoeyData.js the Joey Verlinden baseline catalog (2026.6.1)
js/baseline.js        tenant vs baseline matching, versioning and gap report
js/mslearn.js         MS Learn documented exclusion & limitation checks
js/assign.js          persona group assignment (writes)
js/cagroups.js        CA groups: baseline check, creation, member matrix
js/groupTemplates.js  persona group definitions used when creating groups
js/import.js          backup import: dependencies first, persona remapping (writes)
js/export.js          Word / PDF / PNG / PNG-bundle export + JSON backup zip
js/app.js             wiring: screens, toolbars, theme, permissions, tool state
js/demo.js            sample policies for ?demo=1
vendor/               msal-browser, html-to-image, jsPDF, JSZip (self-hosted)
CNAME                 cadoc.limon-it.nl (GitHub Pages custom domain)
```

## Permissions

Base scopes, consented once per tenant, both **read-only delegated**:

| Scope | Why |
|---|---|
| `Policy.Read.All` | Read CA policies, named locations, authentication strengths and contexts |
| `Directory.Read.All` | Resolve user / group / role / service-principal GUIDs to display names and expand group memberships — without it every export shows raw IDs |

Requested **on demand** (incremental consent) only when a tool needs them:

| Scope | Tool |
|---|---|
| `Agreement.Read.All` | Backup — terms-of-use agreements and their PDFs |
| `Policy.ReadWrite.ConditionalAccess` | Assign groups, Set Policy state, Import, MS Learn *Apply in tenant* |
| `Application.Read.All` | Import — required by Graph to create policies with app conditions |
| `Application.ReadWrite.All` | MS Learn *Apply in tenant* — create service principals for Microsoft apps a fixed policy must reference |
| `Policy.ReadWrite.AuthenticationMethod` | Import — create authentication strengths |
| `Group.ReadWrite.All` | Assign groups — create missing persona groups |
| `RoleManagement.ReadWrite.Directory` | Assign groups — create those groups as role-assignable |

The signed-in user needs a reader role (Security Reader / Global Reader) for the read-only tools, and a role that can edit Conditional Access for the three writing tools. The permission overview on the tools home page shows the live status of each scope in the current session.

## Security

- **No backend.** A static site on GitHub Pages. Policy data is never stored, proxied or logged — it exists only in the browser tab.
- **Sign-in** uses MSAL with the authorization code flow and PKCE, no client secret. Tokens live in `sessionStorage` and are gone when the tab closes.
- **Tokens are only ever attached to `graph.microsoft.com`** — the hostname is validated before every request.
- **A meta Content-Security-Policy** restricts scripts to same-origin and network calls to `graph.microsoft.com` / `login.microsoftonline.com`. (GitHub Pages cannot send CSP headers, and `frame-ancestors` is not enforceable from a meta tag.)
- **All JavaScript libraries are self-hosted** in `vendor/` — nothing loads from a third-party CDN at runtime.
- **Exports are generated locally** and carry the connected tenant's branding, not Limon-IT's.

## Popups and consent

Every write action asks for its Graph scopes **on the click that starts it**, before doing any work. That is not politeness — it is the only way the sign-in window opens reliably.

Browsers only allow `window.open` while a user gesture is still "active". Chrome is lenient; **Edge and Safari withdraw the gesture as soon as the call stack awaits anything**. A consent popup raised in the middle of an import — after reading the zip, resolving dependencies and several Graph round-trips — is therefore blocked, and the run dies half-way with permissions it never got.

Pulling consent to the front of the handler means the popup opens while the click is still fresh, and the rest of the run is pure Graph calls against a token already in hand. If a popup is blocked anyway, the app says so and offers a **Continue** button — clicking it is a new gesture, so that window is allowed.

## Protected actions and step-up authentication

If a tenant protects Conditional Access administration with an authentication context ([protected actions](https://learn.microsoft.com/entra/identity/role-based-access-control/protected-actions-overview)), a write is refused until the caller presents a token carrying the required claims. More permission does not fix this — the token itself has to be re-minted.

The app declares the **`cp1` client capability**, which is what tells Entra it can handle a claims challenge. Graph then answers a protected write with `401` plus a `WWW-Authenticate` claims challenge instead of a flat `403`, and the app steps up interactively (a sign-in popup) and retries the request once.

If a write still fails with *"Operation requires conditional access and client does not support it"*:

- your session may not satisfy the auth context (for example it requires phishing-resistant MFA) — sign out and back in with a method that does;
- some operations cannot be step-up'd at all. Creating a **terms of use** page or a **custom control** registers an object with Conditional Access, so it is itself subject to the CA create/update/delete protected action. Microsoft's documented workaround is to temporarily remove the policy requirement from those actions.

## Notes

- Uses the Graph **beta** endpoint so the newest policy properties (insiderRiskLevels, agentIdRiskLevels, authenticationFlows, secureSignInSession / token protection, globalSecureAccessFilteringProfile) are included.
- Unknown or newly added policy properties are surfaced rather than silently dropped, so a new CA feature shows up in the documentation before the tool explicitly supports it.
- GUIDs that can't be resolved (e.g. deleted objects) are shown as raw IDs rather than hidden.

## Credits & thanks

Four community projects shaped CA Doc, and all four deserve the credit:

- **[idPowerToys](https://github.com/merill/idPowerToys)** — by **Merill Fernando**. The Conditional Access documenter that started all of this: the idea that a CA baseline should be readable as a document rather than clicked through in the portal. CA Doc is the web successor to that documenter, extended to the newest CA settings.
- **[Conditional Access Impact Matrix](https://github.com/jasperbaes/Conditional-Access-Impact-Matrix)** — by **Jasper Baes**. The users × policies impact model behind the **Gap analyse** tool: working out which policies actually apply to a given user, who bypasses a policy through an exclusion, and whether that bypass is covered somewhere else.
- **[Conditional Access Baseline](https://github.com/j0eyv/ConditionalAccessBaseline)** — by **Joey Verlinden**. A deliberately minimised community baseline built on the Microsoft Conditional Access framework, bundled here as a second catalog so a tenant can be measured against it exactly like the Limon-IT one. The policy set, personas and naming convention are his; CA Doc only reads and compares.
- **[CA Policy Analyzer](https://github.com/Jhope188/ca-policy-analyzer)** — by **jhope188**. The inspiration for the **Best-practice & bypass checks** and **MS Learn checks** tools: best-practice and known-bypass checks laid out against the Swiss-cheese layered-defense model.

All are independently reimplemented here in browser-side JavaScript against Microsoft Graph — no code was copied.

Thanks also to the Conditional Access community whose baselines CA Doc is designed to compare against: **Kenneth van Surksum**, **Joey Verlinden**, and **Claus Jespersen** for the Zero Trust persona framework.

## License & attribution

MIT — see [LICENSE](LICENSE). The Limon-IT name and logo (`assets/`) are trademarks of Limon-IT and are excluded from the license; forks must use their own branding.

Inspired by the Conditional Access documenter in [idPowerToys](https://github.com/merill/idPowerToys) by Merill Fernando (MIT). CA Doc is an independent from-scratch implementation.

The **MS Learn checks** tool (`js/mslearn.js`) is an independent vanilla-JS implementation of the documented-exclusion check set from [ca-policy-analyzer](https://github.com/Jhope188/ca-policy-analyzer); the checks themselves encode guidance published on learn.microsoft.com (each finding links to its source page).

The **Best-practice & bypass checks** tool (`js/gapcheck.js`) is likewise an independent reimplementation of that project's analyzer check set. The underlying data and research: Conditional Access bypasses by Fabian Bader & Dirk-jan Mollema ([cloudbrothers.info](https://cloudbrothers.info/en/conditional-access-bypasses/), [entrascopes.com](https://entrascopes.com)), the FOCI family research by Secureworks, and the Zero Trust persona framework by Claus Jespersen (Microsoft).
