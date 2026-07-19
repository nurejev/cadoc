# CA Doc — Conditional Access Documenter

Web-based successor to the idPowerToys CA documenter, in Limon-IT branding.
Sign in with an Entra account, view all Conditional Access policies as cards or a settings matrix, and export to PNG (single policy) or a combined branded PDF (multiple policies).

Runs 100% in the browser (static site) — no backend, no policy data leaves the user's session. Covers the newest CA settings the old tool misses: authentication flows (device code / auth transfer), insider risk, token protection, Global Secure Access profiles, auth contexts, and workload identities.

**Live:** https://cadoc.limon-it.nl · **Demo without sign-in:** https://cadoc.limon-it.nl/?demo=1

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

```
index.html          app shell (login, list, cards, matrix, export modal)
css/app.css         Limon-IT theme
js/authConfig.js    clientId + scopes  ← the only file you must edit
js/labels.js        friendly names for Graph enums / well-known IDs
js/graph.js         MSAL sign-in, policy fetch (Graph beta), GUID→name resolver
js/model.js         raw policy → view model (incl. new CA settings)
js/render.js        list / card / matrix rendering
js/mslearn.js       MS Learn documented exclusion checks (read-only findings)
js/export.js        PNG (html-to-image) and PDF (jsPDF, cover + cards + matrix)
js/demo.js          sample policies for ?demo=1
CNAME               cadoc.limon-it.nl (GitHub Pages custom domain)
```

## Security

- All JavaScript libraries are self-hosted in `vendor/` (no CDN at runtime); a meta Content-Security-Policy restricts scripts to same-origin and network calls to graph.microsoft.com / login.microsoftonline.com. GitHub Pages cannot send CSP headers, and `frame-ancestors` cannot be enforced from a meta tag.
- Access tokens are only ever attached to `graph.microsoft.com` (hostname validated).
- Permission justification: `Policy.Read.All` reads the CA policies; `Directory.Read.All` is required to resolve user/group/role/service-principal GUIDs to display names — without it the documentation would show raw IDs. Both are read-only delegated permissions; nothing is written to the tenant.

## Notes

- Uses the Graph **beta** endpoint so the newest policy properties (insiderRiskLevels, authenticationFlows, secureSignInSession/token protection, globalSecureAccessFilteringProfile) are included.
- GUIDs that can't be resolved (e.g. deleted objects) are shown as raw IDs rather than hidden.
- Everything is CDN + vanilla JS — no build step, GitHub Pages serves the repo as-is.

## License & attribution

MIT — see [LICENSE](LICENSE). The Limon-IT name and logo (`assets/`) are trademarks of Limon-IT and are excluded from the license; forks must use their own branding.

Inspired by the Conditional Access documenter in [idPowerToys](https://github.com/merill/idPowerToys) by Merill Fernando (MIT). CA Doc is an independent from-scratch implementation.

The **MS Learn checks** tool (`js/mslearn.js`) is an independent vanilla-JS implementation of the documented-exclusion check set from [ca-policy-analyzer](https://github.com/Jhope188/ca-policy-analyzer); the checks themselves encode guidance published on learn.microsoft.com (each finding links to its source page).
