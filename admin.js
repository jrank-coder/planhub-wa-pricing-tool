/* ================================================================
   WA Pricing Tool — admin.js
   Pricing tier editor. Password-gated (separate from Google Auth).
   ================================================================ */

'use strict';

// ════════════════════════════════════════════════════════════════
// ADMIN PASSWORD
// SHA-256 hash of the admin password.
//
// To generate a new hash, run this in your browser console:
//   const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('your-password'));
//   console.log(Array.from(new Uint8Array(h)).map(b=>b.toString(16).padStart(2,'0')).join(''));
//
// TODO: Replace DEFAULT_HASH with your actual password hash before deploying.
// Default password is: planhub-admin (change this!)
// ════════════════════════════════════════════════════════════════

// Hash of 'planhub-admin' — CHANGE THIS before deploying
const ADMIN_HASH = '007270560d6459eb00a5c03eaf1abea53a10b4363201623fbac014d3e615f985';

// ════════════════════════════════════════════════════════════════
// FIREBASE CONFIG
// ════════════════════════════════════════════════════════════════

const firebaseConfig = {
  apiKey:            "AIzaSyCVfTp-GDRHtdp0Tb6VGiTws9I0OB9RM_k",
  authDomain:        "planhub-sales-internal-tools.firebaseapp.com",
  projectId:         "planhub-sales-internal-tools",
  storageBucket:     "planhub-sales-internal-tools.firebasestorage.app",
  messagingSenderId: "95602436947",
  appId:             "1:95602436947:web:575946d6535e7387e8cfa6",
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db   = firebase.firestore();

const TIERS_COLLECTION = 'wa_pricing_tool';
const TIERS_DOC        = 'pricing_tiers';

// ════════════════════════════════════════════════════════════════
// STATE
// ════════════════════════════════════════════════════════════════

let tiers = [];

// ════════════════════════════════════════════════════════════════
// PASSWORD GATE
// ════════════════════════════════════════════════════════════════

async function hashInput(str) {
  const buf  = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

document.getElementById('btn-pw-submit').addEventListener('click', checkPassword);
document.getElementById('pw-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') checkPassword();
});

async function checkPassword() {
  const val  = document.getElementById('pw-input').value;
  const hash = await hashInput(val);

  // NOTE: Until ADMIN_HASH is properly set, skip hash check and use a direct compare fallback.
  // Remove the fallback once you generate and set the real hash above.
  const fallbackMatch = val === 'planhub-admin';
  const hashMatch     = hash === ADMIN_HASH;

  if (hashMatch || fallbackMatch) {
    // Anonymous sign-in satisfies Firestore auth requirement for pricing tiers write
    if (!auth.currentUser) await auth.signInAnonymously();
    document.getElementById('pw-card').style.display    = 'none';
    document.getElementById('tiers-editor').style.display = 'block';
    await loadTiers();
  } else {
    const errEl = document.getElementById('pw-error');
    errEl.style.display = 'block';
    document.getElementById('pw-input').value = '';
    document.getElementById('pw-input').focus();
  }
}

// ════════════════════════════════════════════════════════════════
// TIERS CRUD
// ════════════════════════════════════════════════════════════════

async function loadTiers() {
  try {
    const snap = await db.collection(TIERS_COLLECTION).doc(TIERS_DOC).get();
    tiers = snap.exists && snap.data().tiers ? snap.data().tiers : getDefaultTiers();
  } catch (err) {
    console.error('Load tiers failed:', err);
    tiers = getDefaultTiers();
  }
  renderTiersTable();
  renderPreview();
}

function getDefaultTiers() {
  return [
    { id: 1, label: 'Tier 1',    min: 1,   max: 10,  priceFlat: 599,  pricePerProject: 60   },
    { id: 2, label: 'Tier 2',    min: 11,  max: 25,  priceFlat: 1000, pricePerProject: 40   },
    { id: 3, label: 'Tier 3',    min: 26,  max: 50,  priceFlat: 1600, pricePerProject: 32   },
    { id: 4, label: 'Tier 4',    min: 51,  max: 80,  priceFlat: 2200, pricePerProject: 27   },
    { id: 5, label: 'Tier 5',    min: 81,  max: 120, priceFlat: 2800, pricePerProject: 23   },
    { id: 6, label: 'Unlimited', min: 121, max: null, priceFlat: 3500, pricePerProject: null },
  ];
}

function renderTiersTable() {
  const tbody = document.getElementById('tiers-tbody');
  tbody.innerHTML = tiers.map((tier, i) => `
    <tr class="tier-row" data-index="${i}">
      <td style="font-weight:600;text-align:center;">${tier.id}</td>
      <td>
        <input type="text" value="${escHtml(tier.label)}" data-field="label"
               placeholder="e.g. Tier 1" />
      </td>
      <td>
        <input type="number" value="${tier.min}" data-field="min"
               min="0" step="1" placeholder="1" />
      </td>
      <td>
        ${i === tiers.length - 1
          ? '<span style="color:var(--text-muted);font-size:12px;display:flex;align-items:center;height:32px;">Unlimited</span>'
          : `<input type="number" value="${tier.max !== null ? tier.max : ''}" data-field="max"
                    min="0" step="1" placeholder="25" />`
        }
      </td>
      <td>
        <input type="number" value="${tier.priceFlat || ''}" data-field="priceFlat"
               min="0" step="1" placeholder="e.g. 1600" />
      </td>
      <td>
        ${i === tiers.length - 1
          ? '<span style="color:var(--text-muted);font-size:12px;display:flex;align-items:center;height:32px;">N/A</span>'
          : `<input type="number" value="${tier.pricePerProject != null ? tier.pricePerProject : ''}" data-field="pricePerProject"
                    min="0" step="0.01" placeholder="e.g. 32" />`
        }
      </td>
    </tr>
  `).join('');

  // Listen for changes to update preview live
  tbody.querySelectorAll('input').forEach(input => {
    input.addEventListener('input', () => {
      syncTiersFromDOM();
      renderPreview();
    });
  });
}

function syncTiersFromDOM() {
  document.querySelectorAll('#tiers-tbody .tier-row').forEach((row, i) => {
    const get = field => row.querySelector(`[data-field="${field}"]`);
    tiers[i] = {
      id:              tiers[i].id,
      label:           get('label')           ? get('label').value.trim()                                          : tiers[i].label,
      min:             get('min')             ? parseInt(get('min').value, 10) || 0                                 : tiers[i].min,
      max:             get('max')             ? (get('max').value === '' ? null : parseInt(get('max').value, 10))   : null,
      priceFlat:       get('priceFlat')       ? parseInt(get('priceFlat').value, 10) || 0                           : tiers[i].priceFlat,
      pricePerProject: get('pricePerProject') ? (get('pricePerProject').value === '' ? null : parseFloat(get('pricePerProject').value)) : tiers[i].pricePerProject,
    };
  });
}

function renderPreview() {
  const previewCounts = [5, 15, 25, 35, 50, 75, 100, 125, 150, 200];
  const baseTier  = tiers[0];
  const baseRate  = baseTier ? baseTier.pricePerProject : null; // $60
  const tbody     = document.getElementById('preview-tbody');

  tbody.innerHTML = previewCounts.map(count => {
    const tier = matchTier(count);
    if (!tier) return `<tr><td colspan="5" style="text-align:center;color:var(--text-muted)">—</td></tr>`;

    const effectiveRate = tier.pricePerProject != null
      ? tier.pricePerProject
      : (tier.priceFlat / count);
    const savings = baseRate ? Math.max(0, (baseRate - effectiveRate) * count) : 0;
    const rateLabel = tier.pricePerProject != null ? `$${tier.pricePerProject}` : 'N/A';

    return `
      <tr>
        <td><strong>${count}</strong></td>
        <td>${escHtml(tier.label)}</td>
        <td>${rateLabel}</td>
        <td>${tier.priceFlat ? fmtDollar(tier.priceFlat) : '—'}</td>
        <td style="color:var(--ph-green)">${savings > 0 ? fmtDollar(savings) : '—'}</td>
      </tr>
    `;
  }).join('');
}

function matchTier(count) {
  for (const tier of tiers) {
    const underMax = tier.max === null || count <= tier.max;
    if (count >= tier.min && underMax) return tier;
  }
  return tiers[tiers.length - 1] || null;
}

// ════════════════════════════════════════════════════════════════
// SAVE
// ════════════════════════════════════════════════════════════════

document.getElementById('btn-save-tiers').addEventListener('click', saveTiers);

async function saveTiers() {
  syncTiersFromDOM();
  const btn = document.getElementById('btn-save-tiers');
  btn.disabled   = true;
  btn.textContent = 'Saving…';

  try {
    await db.collection(TIERS_COLLECTION).doc(TIERS_DOC).set({ tiers });
    showSaveStatus('✓ Saved');
  } catch (err) {
    console.error('Save failed:', err);
    showSaveStatus('✗ Save failed — check console');
  }

  btn.disabled    = false;
  btn.textContent = 'Save Tiers';
}

function showSaveStatus(msg) {
  const el = document.getElementById('save-status');
  el.textContent = msg;
  el.classList.add('visible');
  setTimeout(() => el.classList.remove('visible'), 3000);
}

// ════════════════════════════════════════════════════════════════
// RESET
// ════════════════════════════════════════════════════════════════

document.getElementById('btn-reset-tiers').addEventListener('click', () => {
  if (!confirm('Reset all tiers to defaults (all $0)? This will overwrite current values.')) return;
  tiers = getDefaultTiers();
  renderTiersTable();
  renderPreview();
});

// ════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════

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
