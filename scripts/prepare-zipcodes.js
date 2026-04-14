/**
 * prepare-zipcodes.js
 * Downloads GeoNames US postal code data and outputs a filtered ZIP dataset
 * containing only WA, OR, ID, and MT (Washington + neighboring states).
 *
 * Run once before pushing to GitHub:
 *   node scripts/prepare-zipcodes.js
 *
 * Output: data/usa-zipcodes.json
 * Format: { "98101": { "city": "Seattle", "state": "WA", "lat": 47.6062, "lng": -122.3321 }, ... }
 *
 * Source: GeoNames postal code data (CC Attribution 4.0)
 */

const https    = require('https');
const fs       = require('fs');
const path     = require('path');
const os       = require('os');
const { execSync } = require('child_process');

// Only include WA (search centers) + neighboring states (radius awareness)
const KEEP_STATES = new Set(['WA', 'OR', 'ID', 'MT']);

const ZIP_URL  = 'https://download.geonames.org/export/zip/US.zip';
const OUT_DIR  = path.join(__dirname, '..', 'data');
const OUT_FILE = path.join(OUT_DIR, 'usa-zipcodes.json');
const TEMP_ZIP = path.join(os.tmpdir(), 'geonames-us.zip');
const TEMP_DIR = path.join(os.tmpdir(), 'geonames-us-extract');

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

console.log('Downloading GeoNames US postal code data…');

const file = fs.createWriteStream(TEMP_ZIP);

https.get(ZIP_URL, res => {
  if (res.statusCode !== 200) {
    console.error(`Download failed: HTTP ${res.statusCode}`);
    process.exit(1);
  }

  res.pipe(file);

  file.on('finish', () => {
    file.close(() => {
      const sizeMB = (fs.statSync(TEMP_ZIP).size / 1024 / 1024).toFixed(1);
      console.log(`Downloaded ${sizeMB} MB → extracting…`);
      extractAndProcess();
    });
  });
}).on('error', err => {
  fs.unlinkSync(TEMP_ZIP);
  console.error('Download error:', err.message);
  process.exit(1);
});

function extractAndProcess() {
  // Extract using PowerShell Expand-Archive (built into Windows, no npm needed)
  if (fs.existsSync(TEMP_DIR)) fs.rmSync(TEMP_DIR, { recursive: true });
  fs.mkdirSync(TEMP_DIR);

  try {
    execSync(
      `powershell -Command "Expand-Archive -Path '${TEMP_ZIP}' -DestinationPath '${TEMP_DIR}' -Force"`,
      { stdio: 'inherit' }
    );
  } catch (err) {
    console.error('Extraction failed:', err.message);
    process.exit(1);
  }

  const txtFile = path.join(TEMP_DIR, 'US.txt');
  if (!fs.existsSync(txtFile)) {
    console.error('US.txt not found in extracted archive.');
    process.exit(1);
  }

  console.log('Parsing and filtering to WA, OR, ID, MT…');
  const content = fs.readFileSync(txtFile, 'utf8');
  const result  = parseTsv(content);

  fs.writeFileSync(OUT_FILE, JSON.stringify(result));

  // Cleanup temp files
  fs.unlinkSync(TEMP_ZIP);
  fs.rmSync(TEMP_DIR, { recursive: true });

  const count   = Object.keys(result).length;
  const sizeMB  = (fs.statSync(OUT_FILE).size / 1024 / 1024).toFixed(2);
  console.log(`\n✓ ${count.toLocaleString()} ZIP codes written to data/usa-zipcodes.json (${sizeMB} MB)`);

  // Breakdown by state
  const byState = {};
  for (const v of Object.values(result)) byState[v.state] = (byState[v.state] || 0) + 1;
  Object.entries(byState).sort().forEach(([s, n]) => console.log(`  ${s}: ${n}`));
}

/**
 * GeoNames US.txt columns (tab-separated):
 * 0  country_code  1  postal_code  2  place_name
 * 3  admin_name1   4  admin_code1 (state abbr)
 * 9  latitude      10 longitude
 */
function parseTsv(content) {
  const out   = {};
  const lines = content.split('\n');

  for (const line of lines) {
    if (!line.trim()) continue;
    const cols  = line.split('\t');
    if (cols.length < 11) continue;

    const zip   = (cols[1] || '').trim();
    const city  = (cols[2] || '').trim();
    const state = (cols[4] || '').trim();
    const lat   = parseFloat(cols[9]);
    const lng   = parseFloat(cols[10]);

    if (!/^\d{5}$/.test(zip))      continue;
    if (!KEEP_STATES.has(state))   continue;
    if (isNaN(lat) || isNaN(lng))  continue;

    out[zip] = {
      city,
      state,
      lat: Math.round(lat * 10000) / 10000,
      lng: Math.round(lng * 10000) / 10000,
    };
  }

  return out;
}
