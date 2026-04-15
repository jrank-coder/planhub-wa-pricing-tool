/* ================================================================
   WA Pricing Tool — app.js
   PlanHub Washington Pricing Test
   ================================================================ */

'use strict';

// ════════════════════════════════════════════════════════════════
// CONFIG — Edit these before deploying
// ════════════════════════════════════════════════════════════════

const CONFIG = {
  sheets: {
    // No API key needed — Sheet must be shared as "Anyone with the link can view"
    sheetId: '1QqPlXC7CTTYT7Umf2oBKK0MHCd8spLZshO8L6E43pXo',
    tab:     'Project data',
  },
  columns: {
    projectId:  'Project ID',
    zip:        'Project Zip Code',
    bidDueDate: 'Bid Due Date',
    trades:     'Trade Names CSV',
    city:       'Project City',
    state:      'Project State',
  },
  // Each trade must match values in the 'trades' column of the Coefficient Sheet exactly
  trades: [
    'Demolition and Site Construction',
    'Electrical and Low Voltage',
    'Painting and Wallcovering',
    'HVAC',
    'Concrete Construction',
    'Interior Walls, Ceilings and Insulation',
    'Plumbing',
    'Doors, Glass and Windows',
    'Flooring',
    'Wood, Carpentry and Plaster',
    'Metal and Steel Construction',
    'Roofing, Thermal and Moisture Protection',
    'Specialties',
    'Fire Protection',
    'Kitchens and Baths',
    'Cleaning and Construction',
    'Equipment and Supplies',
    'Exterior Improvements and Landscaping',
    'Masonry Construction',
    'Exterior Siding and Masonry',
    'Preconstruction Planning and Supervision',
    'Special Construction',
    'Decor and Furnishings',
    'Conveying Systems',
    'Other',
  ],
  // Radius steps used in binary search (Mode 2 — find radius for target project count)
  radiusSteps: [5, 10, 15, 20, 25, 30, 40, 50, 60, 75, 100, 125, 150, 175, 200],
  maxRadius: 200,
};

// ════════════════════════════════════════════════════════════════
// FIREBASE CONFIG — Shared planhub-sales-internal-tools project
// ════════════════════════════════════════════════════════════════

const firebaseConfig = {
  apiKey:            "AIzaSyCVfTp-GDRHtdp0Tb6VGiTws9I0OB9RM_k",
  authDomain:        "planhub-sales-internal-tools.firebaseapp.com",
  databaseURL:       "https://planhub-sales-internal-tools-default-rtdb.firebaseio.com",
  projectId:         "planhub-sales-internal-tools",
  storageBucket:     "planhub-sales-internal-tools.firebasestorage.app",
  messagingSenderId: "95602436947",
  appId:             "1:95602436947:web:575946d6535e7387e8cfa6",
};

// ════════════════════════════════════════════════════════════════
// APP STATE
// ════════════════════════════════════════════════════════════════

const state = {
  mode:         'radius',   // 'radius' | 'count'
  radius:       50,
  targetCount:  null,
  zip:          '',
  zipData:      null,       // Loaded from data/usa-zipcodes.json: { "98101": {city,state,lat,lng}, ... }
  projectData:  [],         // All rows from Coefficient Sheet
  pricingTiers: [],         // Loaded from Firestore wa_pricing_tool/tiers
  dataLoaded:   false,
  lastDataFetch: null,
  sortCol:      'active',
  sortAsc:      false,
  results:      null,       // Last search results
};

// ════════════════════════════════════════════════════════════════
// FIREBASE INIT
// ════════════════════════════════════════════════════════════════

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db   = firebase.firestore();

// ════════════════════════════════════════════════════════════════
// AUTH
// ════════════════════════════════════════════════════════════════

const provider = new firebase.auth.GoogleAuthProvider();
provider.setCustomParameters({ hd: 'planhub.com' }); // Restrict to @planhub.com

document.getElementById('btn-google-signin').addEventListener('click', async () => {
  try {
    await auth.signInWithPopup(provider);
  } catch (err) {
    const errEl = document.getElementById('auth-error');
    errEl.style.display = 'block';
    errEl.textContent = err.code === 'auth/popup-closed-by-user'
      ? 'Sign-in cancelled.'
      : `Sign-in failed: ${err.message}`;
  }
});

document.getElementById('btn-signout').addEventListener('click', () => auth.signOut());

auth.onAuthStateChanged(user => {
  if (user) {
    // Enforce @planhub.com domain server-side check
    if (!user.email.endsWith('@planhub.com')) {
      showAuthError('Access restricted to @planhub.com accounts.');
      auth.signOut();
      return;
    }
    document.getElementById('auth-screen').style.display = 'none';
    const appEl = document.getElementById('app-screen');
    appEl.style.display = 'flex';
    appEl.classList.add('visible');
    document.getElementById('user-email').textContent = user.email;
    onAppReady();
  } else {
    document.getElementById('auth-screen').style.display = 'flex';
    const appEl = document.getElementById('app-screen');
    appEl.style.display = 'none';
    appEl.classList.remove('visible');
  }
});

function showAuthError(msg) {
  const errEl = document.getElementById('auth-error');
  errEl.style.display = 'block';
  errEl.textContent = msg;
}

// ════════════════════════════════════════════════════════════════
// APP INIT — Runs after successful auth
// ════════════════════════════════════════════════════════════════

async function onAppReady() {
  initMap();
  buildTradeList();
  bindUIEvents();
  await Promise.all([
    loadZipData(),
    loadPricingTiers(),
    fetchProjectData(),
  ]);
  updateFindButton();
}

// ════════════════════════════════════════════════════════════════
// MAP
// ════════════════════════════════════════════════════════════════

let map, circleLayer, zipMarkers = [];

function initMap() {
  map = L.map('map', { zoomControl: true }).setView([47.5, -120.5], 7);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 18,
  }).addTo(map);
}

function updateMap(centerLat, centerLng, radiusMiles, zipRows) {
  // Clear previous
  if (circleLayer) map.removeLayer(circleLayer);
  zipMarkers.forEach(m => map.removeLayer(m));
  zipMarkers = [];

  const radiusMeters = radiusMiles * 1609.34;

  // Draw circle
  circleLayer = L.circle([centerLat, centerLng], {
    radius:      radiusMeters,
    color:       '#0052CC',
    fillColor:   '#0052CC',
    fillOpacity: 0.08,
    weight:      2,
  }).addTo(map);

  // Center pin
  const centerPin = L.circleMarker([centerLat, centerLng], {
    radius: 6, color: '#0052CC', fillColor: '#0052CC', fillOpacity: 1, weight: 2,
  }).addTo(map);
  centerPin.bindTooltip('Search center', { permanent: false });
  zipMarkers.push(centerPin);

  // ZIP markers
  zipRows.forEach(row => {
    if (!row.lat || !row.lng || row.active === 0) return;
    const m = L.circleMarker([row.lat, row.lng], {
      radius:      Math.min(3 + row.active, 12),
      color:       '#36B37E',
      fillColor:   '#36B37E',
      fillOpacity: 0.7,
      weight:      1,
    }).addTo(map);
    m.bindPopup(`<strong>${row.zip}</strong> — ${row.city}${row.state ? ', ' + row.state : ''}<br/>${row.active} active project${row.active !== 1 ? 's' : ''}`);
    zipMarkers.push(m);
  });

  // Fit to circle bounds
  map.fitBounds(circleLayer.getBounds(), { padding: [20, 20] });
}

// ════════════════════════════════════════════════════════════════
// ZIP DATA — Load bundled USA ZIP lat/lng dataset
// ════════════════════════════════════════════════════════════════

async function loadZipData() {
  try {
    const res = await fetch('data/usa-zipcodes.json');
    if (!res.ok) throw new Error('ZIP dataset not found');
    state.zipData = await res.json();
    // Expected format: { "98101": { city, state, lat, lng }, ... }
  } catch (err) {
    console.error('ZIP data load failed:', err);
    showDataStatus('error', 'ZIP dataset missing — run scripts/prepare-zipcodes.js');
  }
}

// ════════════════════════════════════════════════════════════════
// PROJECT DATA — Fetch from Google Sheets (Coefficient export)
// ════════════════════════════════════════════════════════════════

async function fetchProjectData(silent = false) {
  if (!silent) showDataStatus('loading', 'Loading project data…');

  const { sheetId, tab } = CONFIG.sheets;
  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tab)}`;

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} — check that the Sheet is shared as "Anyone with the link can view"`);

    const csv  = await res.text();
    const rows = parseCSV(csv);
    // Row 1 is a Tableau import metadata row; row 2 contains the actual column headers
    const [_tableauRow, headers, ...dataRows] = rows;

    if (!headers || headers.length === 0) throw new Error('Sheet appears empty or tab not found.');

    const COL = CONFIG.columns;
    state.projectData = dataRows
      .filter(row => row.length > 0)
      .map(row => {
        const obj = {};
        headers.forEach((h, i) => { obj[h] = (row[i] || '').trim(); });
        const zip      = (obj[COL.zip]   || '').replace(/\D/g, '').padStart(5, '0');
        const zipInfo  = state.zipData ? state.zipData[zip] : null;
        const sheetState = (obj[COL.state] || '').trim();
        return {
          projectId:  obj[COL.projectId]  || '',
          zip,
          bidDueDate: obj[COL.bidDueDate]  || '',
          trades:     obj[COL.trades]      || '',
          city:       obj[COL.city]        || (zipInfo ? zipInfo.city  : ''),
          state:      sheetState           || (zipInfo ? zipInfo.state : ''),
        };
      })
      .filter(p => p.zip.length === 5);

    // Deduplicate by projectId
    const seen = new Set();
    state.projectData = state.projectData.filter(p => {
      if (p.projectId && seen.has(p.projectId)) return false;
      if (p.projectId) seen.add(p.projectId);
      return true;
    });

    state.dataLoaded   = true;
    state.lastDataFetch = new Date();
    showDataStatus('ok', `${state.projectData.length.toLocaleString()} projects loaded · ${formatTime(state.lastDataFetch)}`);
  } catch (err) {
    console.error('Sheet fetch failed:', err);
    state.dataLoaded = false;
    showDataStatus('error', `Data load failed: ${err.message}`);
  }

  updateFindButton();
}

// Parses a CSV string into an array of arrays, handling quoted fields and commas.
function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i], next = text[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') { field += '"'; i++; }
      else if (ch === '"')            { inQuotes = false; }
      else                            { field += ch; }
    } else {
      if      (ch === '"')              { inQuotes = true; }
      else if (ch === ',')              { row.push(field.trim()); field = ''; }
      else if (ch === '\n' || (ch === '\r' && next === '\n')) {
        row.push(field.trim()); rows.push(row);
        row = []; field = '';
        if (ch === '\r') i++;
      } else { field += ch; }
    }
  }
  if (field || row.length) { row.push(field.trim()); rows.push(row); }
  return rows.filter(r => r.some(c => c !== ''));
}

function formatTime(d) {
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

// ════════════════════════════════════════════════════════════════
// PRICING TIERS — Load from Firestore
// ════════════════════════════════════════════════════════════════

const TIERS_COLLECTION = 'wa_pricing_tool';
const TIERS_DOC        = 'pricing_tiers';

async function loadPricingTiers() {
  try {
    const snap = await db.collection(TIERS_COLLECTION).doc(TIERS_DOC).get();
    if (snap.exists && snap.data().tiers) {
      state.pricingTiers = snap.data().tiers;
    } else {
      // No tiers in Firestore yet — use empty placeholders
      // AE will see pricing as "—" until admin sets tiers
      state.pricingTiers = getDefaultTiers();
      // Write defaults to Firestore for admin to edit
      await db.collection(TIERS_COLLECTION).doc(TIERS_DOC).set({ tiers: state.pricingTiers });
    }
  } catch (err) {
    console.warn('Could not load pricing tiers:', err);
    state.pricingTiers = getDefaultTiers();
  }
}

function getDefaultTiers() {
  // Pricing uses flat tier fees. pricePerProject is display-only (for AE reference),
  // not a multiplier. Tier 6 is unlimited — no max, no per-project rate.
  return [
    { id: 1, label: 'Tier 1',    min: 1,   max: 10,  priceFlat: 599,  pricePerProject: 60 },
    { id: 2, label: 'Tier 2',    min: 11,  max: 25,  priceFlat: 1000, pricePerProject: 40 },
    { id: 3, label: 'Tier 3',    min: 26,  max: 50,  priceFlat: 1600, pricePerProject: 32 },
    { id: 4, label: 'Tier 4',    min: 51,  max: 80,  priceFlat: 2200, pricePerProject: 27 },
    { id: 5, label: 'Tier 5',    min: 81,  max: 120, priceFlat: 2800, pricePerProject: 23 },
    { id: 6, label: 'Unlimited', min: 121, max: null, priceFlat: 3500, pricePerProject: null },
  ];
}

function matchTier(projectCount) {
  for (const tier of state.pricingTiers) {
    const underMax = tier.max === null || projectCount <= tier.max;
    if (projectCount >= tier.min && underMax) return tier;
  }
  return state.pricingTiers[state.pricingTiers.length - 1] || null;
}

// ════════════════════════════════════════════════════════════════
// TRADE LIST — Build multi-select checkboxes
// ════════════════════════════════════════════════════════════════

function buildTradeList() {
  const container = document.getElementById('trade-list');
  container.innerHTML = CONFIG.trades.map(trade => `
    <label class="trade-item">
      <input type="checkbox" class="trade-cb" value="${escHtml(trade)}" checked />
      <span>${escHtml(trade)}</span>
    </label>
  `).join('');
  updateTradeCount();

  container.addEventListener('change', updateTradeCount);

  document.getElementById('btn-select-all-trades').addEventListener('click', () => {
    container.querySelectorAll('.trade-cb').forEach(cb => { cb.checked = true; });
    updateTradeCount();
  });
  document.getElementById('btn-clear-trades').addEventListener('click', () => {
    container.querySelectorAll('.trade-cb').forEach(cb => { cb.checked = false; });
    updateTradeCount();
  });

}

function getSelectedTrades() {
  const cbs = document.querySelectorAll('.trade-cb:checked');
  const all  = document.querySelectorAll('.trade-cb');
  // If all selected, treat as "no filter" for performance
  if (cbs.length === all.length) return [];
  return [...cbs].map(cb => cb.value);
}

function updateTradeCount() {
  const checked = document.querySelectorAll('.trade-cb:checked').length;
  const total   = document.querySelectorAll('.trade-cb').length;
  document.getElementById('trade-count').textContent =
    checked === total ? 'All trades selected' : `${checked} of ${total} trades selected`;
}

// ════════════════════════════════════════════════════════════════
// RADIUS & HAVERSINE
// ════════════════════════════════════════════════════════════════

function haversine(lat1, lng1, lat2, lng2) {
  const R    = 3958.8; // miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a    = Math.sin(dLat / 2) ** 2
             + Math.cos(lat1 * Math.PI / 180)
             * Math.cos(lat2 * Math.PI / 180)
             * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

function getZipsInRadius(centerZip, radiusMiles) {
  const center = state.zipData[centerZip];
  if (!center) return [];
  const results = [];
  for (const [zip, info] of Object.entries(state.zipData)) {
    const dist = haversine(center.lat, center.lng, info.lat, info.lng);
    if (dist <= radiusMiles) {
      results.push({ zip, ...info, distance: dist });
    }
  }
  return results;
}

// ════════════════════════════════════════════════════════════════
// PROJECT FILTERING
// ════════════════════════════════════════════════════════════════

// Returns true if bid_due_date column is missing from the Sheet (all values empty)
function isBidDateMissing() {
  if (!state.projectData.length) return false;
  return state.projectData.every(p => !p.bidDueDate);
}

function getActiveProjects(zipCodes, selectedTrades) {
  const todayStr    = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const zipSet      = new Set(zipCodes);
  const datesMissing = isBidDateMissing();

  return state.projectData.filter(p => {
    if (!zipSet.has(p.zip)) return false;
    // If bid_due_date column not yet in Sheet, include all projects and show warning
    if (!datesMissing && p.bidDueDate && p.bidDueDate < todayStr) return false;

    if (selectedTrades.length > 0) {
      const projectTrades = p.trades.split(',').map(t => t.trim()).filter(Boolean);
      return selectedTrades.some(t => projectTrades.includes(t));
    }
    return true;
  });
}

// ════════════════════════════════════════════════════════════════
// SEARCH EXECUTION
// ════════════════════════════════════════════════════════════════

async function runSearch() {
  const zip = document.getElementById('zip-input').value.trim();
  clearResults();

  // Validate ZIP
  if (!state.zipData) {
    showSearchError('ZIP dataset is not loaded. Please refresh.');
    return;
  }
  if (!/^\d{5}$/.test(zip) || !state.zipData[zip]) {
    showSearchError('ZIP code not recognized. Please enter a valid US ZIP code.');
    return;
  }
  if (state.zipData[zip].state !== 'WA') {
    showSearchError('Search center must be a Washington state ZIP code.');
    return;
  }
  if (!state.dataLoaded) {
    showSearchError('Project data is not loaded yet. Please wait or refresh.');
    return;
  }

  const selectedTrades = getSelectedTrades();
  setBtnLoading(true);

  try {
    let finalRadius, zipsInRadius, activeProjects, alert = null;

    if (state.mode === 'radius') {
      // ── Mode 1: ZIP + radius → project count ──
      finalRadius    = state.radius;
      zipsInRadius   = getZipsInRadius(zip, finalRadius);
      activeProjects = getActiveProjects(zipsInRadius.map(z => z.zip), selectedTrades);

      if (isBidDateMissing()) {
        alert = {
          type: 'warning',
          msg:  '⚠ Bid due date column not yet in the Sheet — showing all projects regardless of status. Results will filter to active only once that column is added.',
        };
      } else if (activeProjects.length === 0) {
        alert = {
          type: 'warning',
          msg:  `No active projects found within ${finalRadius} miles for the selected trades. Try expanding your radius or selecting additional trades.`,
        };
      }

    } else {
      // ── Mode 2: target count → find radius ──
      const target = parseInt(document.getElementById('project-count-input').value, 10);
      if (!target || target < 1) {
        showSearchError('Please enter a valid desired project count.');
        setBtnLoading(false);
        return;
      }

      let found = false;
      for (const r of CONFIG.radiusSteps) {
        const zips  = getZipsInRadius(zip, r);
        const projs = getActiveProjects(zips.map(z => z.zip), selectedTrades);
        if (projs.length >= target) {
          finalRadius    = r;
          zipsInRadius   = zips;
          activeProjects = projs;
          found          = true;
          break;
        }
      }

      if (isBidDateMissing()) {
        alert = {
          type: 'warning',
          msg:  '⚠ Bid due date column not yet in the Sheet — showing all projects regardless of status. Results will filter to active only once that column is added.',
        };
      } else if (!found) {
        // Max radius reached
        finalRadius    = CONFIG.maxRadius;
        zipsInRadius   = getZipsInRadius(zip, finalRadius);
        activeProjects = getActiveProjects(zipsInRadius.map(z => z.zip), selectedTrades);
        alert = {
          type: 'warning',
          msg:  `Only ${activeProjects.length} active project${activeProjects.length !== 1 ? 's' : ''} found within ${CONFIG.maxRadius} miles. Adjust your trade selection or consider a broader territory.`,
        };
      }
    }

    // ── Build ZIP breakdown rows ──
    const zipMap = {};
    for (const z of zipsInRadius) {
      zipMap[z.zip] = { ...z, active: 0 };
    }
    for (const p of activeProjects) {
      if (zipMap[p.zip]) zipMap[p.zip].active++;
    }

    const zipRows = Object.values(zipMap)
      .filter(z => z.active > 0)
      .sort((a, b) => b.active - a.active || a.distance - b.distance);

    // Cache results for export
    state.results = { zip, finalRadius, activeProjects, zipRows, zipsInRadius };

    // ── Render ──
    renderResults({ zip, finalRadius, activeProjects, zipRows, alert });

  } catch (err) {
    console.error(err);
    showSearchError(`Search failed: ${err.message}`);
  }

  setBtnLoading(false);
}

// ════════════════════════════════════════════════════════════════
// RENDER RESULTS
// ════════════════════════════════════════════════════════════════

function renderResults({ zip, finalRadius, activeProjects, zipRows, alert }) {
  // Hide empty state
  document.getElementById('empty-state').style.display = 'none';

  // Alert
  const alertEl = document.getElementById('results-alert');
  if (alert) {
    alertEl.style.display  = 'block';
    alertEl.className      = `alert alert-${alert.type}`;
    alertEl.textContent    = alert.msg;
  } else {
    alertEl.style.display  = 'none';
  }

  // Summary cards
  const center        = state.zipData[zip];
  const zipsWithData  = zipRows.length;
  document.getElementById('card-active-projects').textContent = activeProjects.length.toLocaleString();
  document.getElementById('card-active-sub').textContent      = 'bid due today or later';
  document.getElementById('card-radius').textContent          = finalRadius;
  document.getElementById('card-zips').textContent            = zipsWithData;

  const cardRadiusLabel = document.getElementById('card-radius-label');
  cardRadiusLabel.textContent = state.mode === 'count' ? 'Recommended Radius' : 'Radius Used';

  document.getElementById('summary-cards').style.display = 'grid';

  // Pricing
  const count = activeProjects.length;
  const tier  = matchTier(count);
  renderPricingCard(count, tier);

  // ZIP table
  renderZipTable(zipRows);

  // Map
  updateMap(center.lat, center.lng, finalRadius, zipRows);
}

function renderPricingCard(count, tier) {
  const card = document.getElementById('pricing-card');
  if (!tier || !tier.priceFlat) {
    card.style.display = 'none';
    return;
  }

  card.style.display = 'block';

  const baseTier = state.pricingTiers[0];
  const baseRate = baseTier ? baseTier.pricePerProject : null; // $60 base

  // Effective per-project rate at this count (for AE reference)
  const effectiveRate = tier.pricePerProject != null
    ? tier.pricePerProject
    : (tier.priceFlat / count);

  // Savings vs. paying Tier 1 rate ($60) per project
  const savings = baseRate ? Math.max(0, (baseRate - effectiveRate) * count) : 0;

  document.getElementById('pc-tier-badge').textContent = tier.label;
  document.getElementById('pc-total').textContent      = fmtDollar(tier.priceFlat);
  document.getElementById('pc-rate').textContent       = tier.pricePerProject != null
    ? `$${tier.pricePerProject}/project`
    : `${fmtDollar(tier.priceFlat)} flat`;
  document.getElementById('pc-savings').textContent    = savings > 0 ? fmtDollar(savings) : '—';

  const rateStr = tier.pricePerProject != null
    ? `$${tier.pricePerProject}/project`
    : `${fmtDollar(tier.priceFlat)} flat fee`;

  document.getElementById('pc-savings-note').textContent = tier.id === 1
    ? `Base rate tier. ${count} project${count !== 1 ? 's' : ''} at $${tier.pricePerProject}/project.`
    : savings > 0 && baseRate
    ? `At ${count} projects your rate is ${rateStr} — ${fmtDollar(savings)} less than paying the base rate of $${baseRate}/project.`
    : `${count} project${count !== 1 ? 's' : ''} at ${rateStr}.`;
}

function renderZipTable(zipRows) {
  const tbody = document.getElementById('zip-tbody');
  tbody.innerHTML = zipRows.map(row => `
    <tr>
      <td><strong>${row.zip}</strong></td>
      <td>${escHtml(row.city)}</td>
      <td>${escHtml(row.state)}</td>
      <td>${row.distance.toFixed(1)}</td>
      <td class="${row.active > 0 ? 'badge-active' : 'badge-zero'}">${row.active}</td>
    </tr>
  `).join('') || '<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:20px;">No ZIP codes with active projects found</td></tr>';

  document.getElementById('zip-table-title').textContent = `ZIP Code Breakdown (${zipRows.length} with active projects)`;
  document.getElementById('zip-table-wrap').style.display = 'block';
}

// ════════════════════════════════════════════════════════════════
// CSV EXPORT
// ════════════════════════════════════════════════════════════════

document.getElementById('btn-export-csv').addEventListener('click', () => {
  if (!state.results) return;
  const { zip, finalRadius, activeProjects, zipRows } = state.results;
  const today = new Date().toLocaleDateString();
  const tier  = matchTier(activeProjects.length);

  const rows = [
    ['ZIP', 'City', 'State', 'Distance (mi)', 'Active Projects'],
    ...zipRows.map(r => [r.zip, r.city, r.state, r.distance.toFixed(1), r.active]),
    [],
    ['Summary'],
    ['Search ZIP', zip],
    ['Radius (mi)', finalRadius],
    ['Active Projects', activeProjects.length],
    ['Tier', tier ? tier.label : '—'],
    ['Price / Project', tier && tier.pricePerProject != null ? `$${tier.pricePerProject}` : '—'],
    ['Total Investment', tier ? fmtDollar(tier.priceFlat) : '—'],
    ['Exported', today],
  ];

  const csv  = rows.map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `wa-projects-${zip}-${finalRadius}mi-${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
});

// ════════════════════════════════════════════════════════════════
// UI EVENT BINDING
// ════════════════════════════════════════════════════════════════

function bindUIEvents() {
  // Mode toggle
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.mode = btn.dataset.mode;
      document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('mode-radius-inputs').style.display = state.mode === 'radius' ? '' : 'none';
      document.getElementById('mode-count-inputs').style.display  = state.mode === 'count'  ? '' : 'none';
    });
  });

  // Radius slider
  const slider = document.getElementById('radius-slider');
  slider.addEventListener('input', () => {
    state.radius = parseInt(slider.value, 10);
    document.getElementById('radius-display').textContent = `${state.radius} miles`;
    // Sync preset buttons
    document.querySelectorAll('.preset-btn').forEach(btn => {
      btn.classList.toggle('active', parseInt(btn.dataset.miles, 10) === state.radius);
    });
  });

  // Preset radius chips
  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const miles = parseInt(btn.dataset.miles, 10);
      state.radius = miles;
      slider.value = miles;
      document.getElementById('radius-display').textContent = `${miles} miles`;
      document.querySelectorAll('.preset-btn').forEach(b => b.classList.toggle('active', b === btn));
    });
  });

  // ZIP input — validate on change
  document.getElementById('zip-input').addEventListener('input', () => {
    updateFindButton();
  });

  // Find button
  document.getElementById('btn-find').addEventListener('click', runSearch);

  // Refresh
  document.getElementById('btn-refresh').addEventListener('click', () => fetchProjectData());

  // Table sort
  document.querySelectorAll('th[data-col]').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      if (state.sortCol === col) {
        state.sortAsc = !state.sortAsc;
      } else {
        state.sortCol = col;
        state.sortAsc = col === 'zip' || col === 'city';
      }
      if (state.results) {
        const sorted = [...state.results.zipRows].sort((a, b) => {
          let av = a[col], bv = b[col];
          if (typeof av === 'string') av = av.toLowerCase();
          if (typeof bv === 'string') bv = bv.toLowerCase();
          return state.sortAsc ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1);
        });
        renderZipTable(sorted);
      }
    });
  });
}

// ════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════

function updateFindButton() {
  const zip = document.getElementById('zip-input').value.trim();
  const valid = /^\d{5}$/.test(zip) && state.dataLoaded && state.zipData;
  document.getElementById('btn-find').disabled = !valid;
}

function setBtnLoading(loading) {
  const btn = document.getElementById('btn-find');
  btn.disabled    = loading;
  btn.innerHTML   = loading
    ? '<span class="spinner"></span> Searching…'
    : 'Find Projects';
}

function showDataStatus(state, text) {
  const dot  = document.getElementById('data-dot');
  const span = document.getElementById('data-status-text');
  dot.className  = `dot ${state}`;
  span.textContent = text;
}

function showSearchError(msg) {
  setBtnLoading(false);
  const el = document.getElementById('search-error');
  el.style.display  = 'block';
  el.className      = 'alert alert-error';
  el.textContent    = msg;
}

function clearResults() {
  document.getElementById('search-error').style.display   = 'none';
  document.getElementById('results-alert').style.display  = 'none';
  document.getElementById('summary-cards').style.display  = 'none';
  document.getElementById('pricing-card').style.display   = 'none';
  document.getElementById('zip-table-wrap').style.display = 'none';
  document.getElementById('empty-state').style.display    = 'flex';
}

function fmtDollar(n) {
  return '$' + Math.round(n).toLocaleString('en-US');
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
