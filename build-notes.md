# WA Pricing Tool — Build Notes
_Last updated: 2026-04-13_

## Status: Ready for Config & Deploy

Core app is built. Requires 5 config items before going live (see below).

---

## What's Built

| File | Purpose | Status |
|---|---|---|
| `index.html` | Main tool — dual-mode search, map, results, pricing | ✅ Complete |
| `app.js` | All tool logic — auth, Sheets, ZIP radius, pricing, map | ✅ Complete |
| `admin.html` | Pricing tier editor | ✅ Complete |
| `admin.js` | Tier CRUD + password gate + live preview | ✅ Complete |
| `styles.css` | PlanHub-branded responsive styles | ✅ Complete |
| `scripts/prepare-zipcodes.js` | One-time script to generate ZIP dataset | ✅ Complete |
| `data/usa-zipcodes.json` | All US ZIP lat/lng (~40K records) | ⏳ Must generate (see setup step 3) |

---

## Pre-Deploy Checklist

### 1. Create GitHub repo
- Repo name suggestion: `planhub-wa-pricing-tool`
- Enable GitHub Pages: Settings → Pages → Deploy from `main` / root
- Note the Pages URL: `https://jrank-coder.github.io/planhub-wa-pricing-tool/`

### 2. Add GitHub Pages URL as Firebase authorized domain
- Firebase Console → `planhub-sales-internal-tools` → Authentication → Settings → Authorized Domains
- Add: `jrank-coder.github.io` (already done if ROE AE Tool is live — skip if so)

### 3. Generate ZIP dataset
```
cd Apps/WA-Pricing-Tool
node scripts/prepare-zipcodes.js
```
This creates `data/usa-zipcodes.json` (~3–5 MB). Commit it to the repo.

### 4. Share your Coefficient Google Sheet
- Open the Coefficient Sheet containing WA project data
- Click Share → General access → **Anyone with the link → Viewer**
- No API key needed — the tool fetches via the public CSV export URL
- Sheet ID and tab name are already set in `app.js`
- Update `CONFIG.columns.*` once exact column header names are confirmed

### 6. Update trade list
- Edit `CONFIG.trades` in `app.js` to match the actual trade values
  used in your Coefficient Sheet's `trades` column

### 7. Set admin password
- Open browser DevTools console on `admin.html`
- Run: `const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('your-password')); console.log(Array.from(new Uint8Array(h)).map(b=>b.toString(16).padStart(2,'0')).join(''));`
- Copy the hash into `admin.js` → `ADMIN_HASH`
- Also update the fallback string: change `'planhub-admin'` to your password

### 8. Set pricing tiers
- Deploy the app
- Go to `admin.html`
- Enter the admin password
- Fill in all 6 tier rows (label, min, max, price/project)
- Click Save — tiers write to Firestore immediately

### 9. Push to GitHub and verify
```
git init
git add .
git commit -m "Initial deploy — WA Pricing Tool"
git remote add origin https://github.com/jrank-coder/planhub-wa-pricing-tool.git
git push -u origin main
```
- Open `https://jrank-coder.github.io/planhub-wa-pricing-tool/`
- Sign in with Google (@planhub.com account)
- Run a test search: ZIP 98101, 50 miles

---

## Firestore Namespace

| Collection | Document | Purpose |
|---|---|---|
| `wa_pricing_tool` | `pricing_tiers` | 6 pricing tier definitions |

---

## Config TODOs in Code

All marked with `// TODO:` in `app.js` and `admin.js`:

| File | Line area | Item |
|---|---|---|
| `app.js` | `CONFIG.columns.*` | Column header names — confirm once bid due date + project ID fields are added to Sheet |
| `app.js` | `CONFIG.trades` | Replace with actual trade list |
| `admin.js` | `ADMIN_HASH` | Replace with SHA-256 hash of your password |

---

## Architecture

- **Hosting:** GitHub Pages
- **Auth:** Firebase Auth (Google sign-in, @planhub.com domain)
- **Data:** Google Sheets API v4 (Coefficient Sheet, read-only API key)
- **Pricing tiers:** Firestore `wa_pricing_tool/pricing_tiers`
- **Map:** Leaflet.js + OpenStreetMap (no API key)
- **ZIP radius:** Client-side haversine on bundled `usa-zipcodes.json`

---

## Command Center Tier
Tier 2 (on-demand link) — not an always-visible panel. Panel-friendly width: 320px sidebar.

## Hub Migration Risk
Low. Pricing tiers stored in Firestore (already a clean interface). Business logic (tier matching, haversine) is self-contained in `app.js`. No hardcoded metric definitions.
