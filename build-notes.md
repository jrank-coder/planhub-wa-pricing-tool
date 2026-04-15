# WA Pricing Tool — Build Notes
_Last updated: 2026-04-15_

## Status: Fully Live

Tool is deployed and fully operational. All blockers resolved as of 2026-04-15.

**Live URL:** https://jrank-coder.github.io/planhub-wa-pricing-tool/
**Admin panel:** https://jrank-coder.github.io/planhub-wa-pricing-tool/admin.html
**Repo:** https://github.com/jrank-coder/planhub-wa-pricing-tool (branch: `master`)

---

## What's Built & Deployed

| File | Purpose | Status |
|---|---|---|
| `index.html` | Main tool — dual-mode search, map, results, pricing | ✅ Live |
| `app.js` | All logic — CSV fetch, ZIP radius, pricing, map, auth | ✅ Live |
| `admin.html` | Pricing tier editor | ✅ Live |
| `admin.js` | Tier CRUD + password gate + live preview | ✅ Live |
| `styles.css` | PlanHub brand guidelines (mint/dark blue, Inter, rounded cards) | ✅ Live |
| `assets/logo-wordmark.png` | PlanHub wordmark — login screen | ✅ Live |
| `assets/brandmark.png` | PlanHub hexagon brandmark — header | ✅ Live |
| `data/usa-zipcodes.json` | WA + OR + ID + MT ZIP lat/lng (1,921 records) | ✅ Live |
| `scripts/prepare-zipcodes.js` | One-time ZIP dataset generator (already run) | ✅ Done |

---

## Architecture

| Layer | Implementation |
|---|---|
| Hosting | GitHub Pages (branch: `master`) |
| Auth | Firebase Auth — Google sign-in, @planhub.com domain enforced |
| Project data | Google Sheets CSV export — no API key. Sheet ID: `1QqPlXC7CTTYT7Umf2oBKK0MHCd8spLZshO8L6E43pXo`, tab: `Project data`. Sheet shared as "Anyone with the link — Viewer". |
| Pricing tiers | Firestore `wa_pricing_tool/pricing_tiers` — editable via admin panel |
| Map | Leaflet.js + OpenStreetMap (no API key) |
| ZIP radius | Client-side haversine on `data/usa-zipcodes.json` |
| Firebase project | `planhub-sales-internal-tools` (shared) |

---

## Resolved

| # | Item | Resolved |
|---|---|---|
| ✓ | `Bid Due Date` column added to Coefficient Sheet | 2026-04-15 |
| ✓ | Column headers confirmed and mapped | 2026-04-15 |
| ✓ | Pricing tiers saved to Firestore | 2026-04-15 |
| ✓ | Admin password set | 2026-04-15 |
| ✓ | Firestore rules updated for anonymous admin writes | 2026-04-15 |

---

## Pricing Tiers (set in code, pending Firestore save)

| Tier | Projects | Flat Price | $/Project |
|---|---|---|---|
| Tier 1 | 1–10 | $599 | $60 |
| Tier 2 | 11–25 | $1,000 | $40 |
| Tier 3 | 26–50 | $1,600 | $32 |
| Tier 4 | 51–80 | $2,200 | $27 |
| Tier 5 | 81–120 | $2,800 | $23 |
| Unlimited | 121+ | $3,500 | — |

Pricing model: flat tier fee (not per-project multiplication). $/Project is display-only for AE reference.

---

## Trade List (configured in `CONFIG.trades`, `app.js`)

25 trades: Demolition and Site Construction · Electrical and Low Voltage · Painting and Wallcovering · HVAC · Concrete Construction · Interior Walls, Ceilings and Insulation · Plumbing · Doors, Glass and Windows · Flooring · Wood, Carpentry and Plaster · Metal and Steel Construction · Roofing, Thermal and Moisture Protection · Specialties · Fire Protection · Kitchens and Baths · Cleaning and Construction · Equipment and Supplies · Exterior Improvements and Landscaping · Masonry Construction · Exterior Siding and Masonry · Preconstruction Planning and Supervision · Special Construction · Decor and Furnishings · Conveying Systems · Other

⚠️ To confirm: "Conveying Systems" — verify this matches exact spelling in Tableau/Coefficient data.

---

## Config TODOs in `app.js`

```javascript
CONFIG.columns = {
  projectId:  'project_id',    // TODO: confirm exact header
  zip:        'zip_code',       // TODO: confirm exact header
  bidDueDate: 'bid_due_date',   // TODO: confirm exact header — REQUIRED
  trades:     'trades',          // TODO: confirm exact header
  city:       'city',            // TODO: confirm exact header (optional — falls back to ZIP dataset)
}
```

---

## Fallback Behavior (while bid_due_date is missing)

- Tool shows ALL projects regardless of bid date
- Orange warning banner displayed on every search: *"Bid due date column not yet in the Sheet — showing all projects regardless of status."*
- Automatically switches to active-only filtering the moment `bid_due_date` column is present and non-empty

---

## Session Log

### 2026-04-13 — Initial build + deploy
- Full app built from scratch: dual-mode search (by radius + by project count), Leaflet map with radius circle, trade multi-select, pricing card, ZIP table, CSV export
- Data pipeline: Tableau → Coefficient → Google Sheet → CSV fetch (no API key)
- ZIP dataset generated: WA/OR/ID/MT only (1,921 records via GeoNames)
- Pricing model: flat tier fees (6 tiers), editable via admin panel → Firestore
- PlanHub brand guidelines applied (mint/dark-blue, Inter, rounded cards, real logo assets)
- Admin link added to header (⚙ Pricing Admin button)
- Deployed to GitHub Pages: https://jrank-coder.github.io/planhub-wa-pricing-tool/
- Pending at close: Sheet column names, bid_due_date column, Firestore tier save, admin password change

---

## Firestore Namespace

| Collection | Document | Purpose |
|---|---|---|
| `wa_pricing_tool` | `pricing_tiers` | 6 pricing tier definitions (editable via admin panel) |

---

## Command Center Tier
Tier 2 (on-demand link). Panel-friendly at 330px sidebar width.

## Hub Migration Risk
Low. Pricing tiers in Firestore (clean interface). Business logic self-contained. No hardcoded metric definitions.
