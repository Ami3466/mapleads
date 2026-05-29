// MapLeads Extension - Playwright E2E Test
// Tests the scraper logic directly in Google Maps page context
// Run: node test-extension.js

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const EXT_PATH = path.resolve(__dirname);
const MAPS_URL = 'https://www.google.com/maps/search/coffee+shops+new+york';
const DOWNLOAD_DIR = '/tmp/mapleads-downloads';

const sleep = ms => new Promise(r => setTimeout(r, ms));


function toCSV(rows) {
  if (!rows.length) return '';
  const keys = Object.keys(rows[0]);
  const escape = v => {
    const s = String(v || '');
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '\uFEFF' + [keys.join(','), ...rows.map(r => keys.map(k => escape(r[k])).join(','))].join('\n');
}

async function run() {
  fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

  console.log('Launching Chrome...');
  const context = await chromium.launchPersistentContext('/tmp/pw-mapleads-test', {
    headless: false,
    channel: 'chrome',
    args: [`--load-extension=${EXT_PATH}`, `--disable-extensions-except=${EXT_PATH}`],
  });

  // ── TEST 1: Load Maps ──
  console.log('\n[Test 1] Loading Google Maps...');
  const page = await context.newPage();
  await page.goto(MAPS_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  try {
    await page.waitForSelector('[role="feed"]', { timeout: 20000 });
    console.log('✅ Results feed loaded');
  } catch {
    console.log('⚠️  Feed selector not found');
  }
  await sleep(4000);

  // ── TEST 2: Inject scraper, get leads ──
  console.log('\n[Test 2] Injecting scraper...');
  const result = await page.evaluate(({ autoScroll, scrollDelay, maxScrolls }) => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const query = document.querySelector('#searchboxinput')?.value || '';
    const scrollContainer =
      document.querySelector('[role="feed"]') ||
      document.querySelector('.m6QErb[aria-label]') ||
      document.querySelector('.m6QErb.DxyBCb');

    if (!scrollContainer) return { error: 'No results panel found.' };

    const leads = [];
    const seen = {};
    const links = document.querySelectorAll('a.hfpxzc');

    for (const link of links) {
      const container = link.closest('.Nv2PK') || link.parentElement;
      if (!container) continue;
      const name = link.getAttribute('aria-label') || '';
      if (!name) continue;
      const key = link.href || name;
      if (seen[key]) continue;
      seen[key] = true;
      const text = container.textContent || '';
      const rating = container.querySelector('.MW4etd')?.textContent.trim() || '';
      const rm = container.querySelector('.UY7F9')?.textContent.match(/([\d,]+)/);
      const reviews = rm ? rm[1].replace(/,/g, '') : '';
      let category = '';
      for (const span of container.querySelectorAll('.W4Efsd span')) {
        const st = span.textContent.trim();
        if (st && st.length > 2 && st.length < 50
            && !/^\$/.test(st) && !/^\(/.test(st) && !/^[0-9]/.test(st)
            && !/Open|Closed|hr|mi|·/.test(st)) { category = st; break; }
      }
      let address = '';
      for (const el of container.querySelectorAll('.W4Efsd')) {
        const at = el.textContent.trim();
        if (/\d+\s+\w+.*(St|Ave|Blvd|Rd|Dr|Ln|Way|Ct|Pl|Hwy|Suite|Ste|Floor|#)/i.test(at)) {
          address = at.replace(/^[·\s]+/, '').trim(); break;
        }
      }
      const pm = text.match(/(\+?1?\s?\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4})/);
      const phone = pm ? pm[1].trim() : '';
      const website = container.querySelector('a[data-value="Website"]')?.href || '';
      const hm = text.match(/(Open|Closed)\s*(·\s*)?((?:until|at)\s*\d+(?::\d+)?\s*(?:AM|PM)?)?/i);
      const hours = hm ? hm[0].trim() : '';
      leads.push({ name, category, address, phone, website, rating, reviews, hours, mapsUrl: link.href || '' });
    }

    return { leads, query };
  }, { autoScroll: false, scrollDelay: 800, maxScrolls: 30 });

  if (result.error) {
    console.error('❌ Scraper error:', result.error);
  } else {
    const leads = result.leads;
    console.log(`✅ Scraper returned ${leads.length} leads`);
    if (leads.length > 0) {
      console.log('Sample lead:', JSON.stringify(leads[0], null, 2));
    }

    // ── TEST 3: CSV generation ──
    console.log('\n[Test 3] CSV generation...');
    const csv = toCSV(leads);
    const csvPath = path.join(DOWNLOAD_DIR, `mapleads_${result.query.replace(/\W+/g, '_') || 'test'}.csv`);
    fs.writeFileSync(csvPath, csv, 'utf8');
    const lines = csv.trim().split('\n');
    console.log('CSV header:', lines[0]);
    console.log('CSV rows:', lines.length - 1);
    console.log(`✅ Saved to ${csvPath}`);
  }

  // ── TEST 4: Manifest sanity check ──
  console.log('\n[Test 4] Checking files exist...');
  const popupHtml = path.join(EXT_PATH, 'popup.html');
  const manifestJson = path.join(EXT_PATH, 'manifest.json');
  console.log('popup.html:', fs.existsSync(popupHtml) ? '✅ exists' : '❌ missing');
  console.log('manifest.json:', fs.existsSync(manifestJson) ? '✅ exists' : '❌ missing');
  const manifest = JSON.parse(fs.readFileSync(manifestJson, 'utf8'));
  console.log('Permissions:', manifest.permissions.join(', '));
  console.log('activeTab present:', manifest.permissions.includes('activeTab') ? '✅' : '❌');
  console.log('tabs present:', manifest.permissions.includes('tabs') ? '✅' : '❌');

  console.log('\n──────────────────────────────');
  console.log('All tests complete. Closing in 3s...');
  await sleep(3000);
  await context.close();
}

run().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
