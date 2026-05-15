var STRIPE_PAYMENT_LINK = 'https://buy.stripe.com/cNicN455Q0g86LKgJwdEs04';
var FREE_LEADS_LIMIT = 10;
var ACTIVATE_API = 'https://flowengine.cloud/api/mapleads/activate';
var VERIFY_API = 'https://flowengine.cloud/api/mapleads/verify';
var SCROLL_DELAY_MS = 800;
var MAX_SCROLLS = 30;

var selectedFormat = 'csv';
var isPro = false;

// ── Boot ──
(async function boot() {
  var stored = await chrome.storage.local.get(['isPro', 'sessionId']);

  if (stored.isPro && stored.sessionId) {
    // Re-verify on every open - prevents storage tampering
    try {
      var res = await fetch(VERIFY_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: stored.sessionId }),
      });
      var data = await res.json();
      if (data.valid) {
        isPro = true;
      } else {
        // Invalid session - clear PRO status
        await chrome.storage.local.remove(['isPro', 'sessionId']);
        isPro = false;
      }
    } catch (e) {
      // Network error - trust stored status to avoid locking out offline users
      isPro = stored.isPro || false;
    }
  } else {
    // No session_id stored = not a real activation (storage was manually tampered)
    isPro = false;
    if (stored.isPro) await chrome.storage.local.remove(['isPro']);
  }

  renderUI();

  // Format toggle
  document.querySelectorAll('.format-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      document.querySelectorAll('.format-btn').forEach(function(b) { b.classList.remove('active'); });
      btn.classList.add('active');
      selectedFormat = btn.dataset.format;
    });
  });

  // Hours checkbox paywall
  document.getElementById('cb-hours').addEventListener('change', function() {
    if (!isPro && this.checked) {
      this.checked = false;
      document.getElementById('paywall-notice').style.display = 'block';
    }
  });

  document.getElementById('upgradeBtn').addEventListener('click', function() {
    chrome.tabs.create({ url: STRIPE_PAYMENT_LINK });
  });

  // Activate PRO toggle
  document.getElementById('activateToggle').addEventListener('click', function() {
    document.getElementById('keyInputRow').classList.toggle('visible');
  });

  // Activate PRO button
  document.getElementById('activateBtn').addEventListener('click', async function() {
    var input = document.getElementById('licenseKeyInput').value.trim();
    var keyStatus = document.getElementById('keyStatus');
    var activateBtn = document.getElementById('activateBtn');

    if (!input) {
      keyStatus.className = 'error';
      keyStatus.textContent = 'Paste your activation code.';
      return;
    }

    activateBtn.disabled = true;
    activateBtn.textContent = '...';
    keyStatus.className = '';
    keyStatus.textContent = '';

    try {
      var res = await fetch(ACTIVATE_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: input }),
      });
      var data = await res.json();

      if (data.activated) {
        isPro = true;
        await chrome.storage.local.set({ isPro: true, sessionId: input });
        keyStatus.className = 'success';
        keyStatus.textContent = 'PRO activated!';
        document.getElementById('keyInputRow').classList.remove('visible');
        document.getElementById('activateSection').style.display = 'none';
        renderUI();
      } else {
        keyStatus.className = 'error';
        keyStatus.textContent = data.error || 'Activation failed.';
      }
    } catch (e) {
      keyStatus.className = 'error';
      keyStatus.textContent = 'Network error. Try again.';
    }

    activateBtn.disabled = false;
    activateBtn.textContent = 'Activate';
  });

  // Scrape button
  document.getElementById('scrapeBtn').addEventListener('click', handleScrape);
})();

// ── UI ──
function renderUI() {
  var badge = document.getElementById('proBadge');
  var usageEl = document.getElementById('usageInfo');
  var hoursProBadge = document.getElementById('hoursProBadge');
  var hoursCb = document.getElementById('cb-hours');
  var activateSection = document.getElementById('activateSection');
  var paywall = document.getElementById('paywall-notice');

  if (isPro) {
    badge.style.display = 'inline';
    hoursProBadge.style.display = 'none';
    hoursCb.checked = true;
    usageEl.textContent = 'PRO - unlimited leads';
    usageEl.style.color = '#059669';
    paywall.style.display = 'none';
    activateSection.style.display = 'none';
  } else {
    badge.style.display = 'none';
    usageEl.textContent = 'Free plan - first ' + FREE_LEADS_LIMIT + ' leads per scrape';
    usageEl.style.color = '#888';
    paywall.style.display = 'block';
  }
}

// ── Scrape handler ──
async function handleScrape() {
  var status = document.getElementById('status');
  var btn = document.getElementById('scrapeBtn');
  var autoScroll = document.getElementById('autoScroll').checked;
  var fields = {
    name:    document.getElementById('cb-name').checked,
    category: document.getElementById('cb-category').checked,
    address: document.getElementById('cb-address').checked,
    phone:   document.getElementById('cb-phone').checked,
    website: document.getElementById('cb-website').checked,
    rating:  document.getElementById('cb-rating').checked,
    hours:   document.getElementById('cb-hours').checked,
    mapsurl: document.getElementById('cb-mapsurl').checked,
  };

  status.className = '';
  status.textContent = 'Extracting leads...';
  btn.disabled = true;
  document.getElementById('leadCount').style.display = 'none';
  document.getElementById('paywall-notice').style.display = 'none';

  try {
    var allTabs = await chrome.tabs.query({});
    var tab = allTabs.find(function(t) {
      return t.url && (t.url.includes('google.com/maps') || t.url.includes('maps.google.com'));
    });

    if (!tab) {
      status.className = 'error';
      status.textContent = 'Open Google Maps and search for businesses first.';
      btn.disabled = false;
      return;
    }
    status.textContent = 'Extracting leads...';

    var results;
    try {
      results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: scrapeMapLeads,
        args: [autoScroll, SCROLL_DELAY_MS, MAX_SCROLLS],
      });
    } catch (e) {
      status.className = 'error';
      status.textContent = 'Cannot inject into page: ' + e.message;
      btn.disabled = false;
      return;
    }

    if (!results || !results[0] || !results[0].result) {
      status.className = 'error';
      status.textContent = 'No response from page. Refresh Maps and retry.';
      btn.disabled = false;
      return;
    }

    var data = results[0].result;

    if (data.error) {
      status.className = 'error';
      status.textContent = data.error;
      btn.disabled = false;
      return;
    }

    var leads = data.leads;
    var query = data.query;

    if (!leads || leads.length === 0) {
      status.className = 'error';
      status.textContent = 'No leads found. Search for businesses on Maps first.';
      btn.disabled = false;
      return;
    }

    var totalFound = leads.length;
    var truncated = !isPro && totalFound > FREE_LEADS_LIMIT;

    if (truncated) {
      leads = leads.slice(0, FREE_LEADS_LIMIT);
    }

    var leadCountEl = document.getElementById('leadCount');
    leadCountEl.style.display = 'block';
    if (truncated) {
      leadCountEl.textContent = totalFound + ' leads found - exporting first ' + FREE_LEADS_LIMIT;
    } else {
      leadCountEl.textContent = totalFound + ' leads found';
    }

    // Build export rows - only checked fields
    var exportData = leads.map(function(l) {
      var row = {};
      if (fields.name)     row.name = l.name;
      if (fields.category) row.category = l.category;
      if (fields.address)  row.address = l.address;
      if (fields.phone)    row.phone = l.phone;
      if (fields.website)  row.website = l.website;
      if (fields.rating)   { row.rating = l.rating; row.reviews = l.reviews; }
      if (fields.hours)    row.hours = l.hours;
      if (fields.mapsurl)  row.google_maps_url = l.mapsUrl;
      return row;
    });

    var safeName = (query || 'leads').replace(/[^a-zA-Z0-9]+/g, '_').substring(0, 40);

    if (selectedFormat === 'json') {
      downloadJSON(exportData, safeName);
    } else {
      downloadCSV(exportData, safeName);
    }

    if (truncated) {
      document.getElementById('paywall-notice').style.display = 'block';
      status.className = 'success';
      status.textContent = 'Exported ' + FREE_LEADS_LIMIT + ' of ' + totalFound + ' leads. Upgrade for all.';
    } else {
      status.className = 'success';
      status.textContent = 'Exported ' + totalFound + ' leads as ' + selectedFormat.toUpperCase();
    }
  } catch (err) {
    status.className = 'error';
    status.textContent = 'Error: ' + err.message;
  }

  btn.disabled = false;
}

// ── Scraper (injected into Google Maps page) ──
async function scrapeMapLeads(autoScroll, scrollDelay, maxScrolls) {
  try {
    var sleep = function(ms) { return new Promise(function(r) { setTimeout(r, ms); }); };

    var query = '';
    var searchInput = document.querySelector('#searchboxinput');
    if (searchInput) query = searchInput.value || '';

    var scrollContainer = document.querySelector('[role="feed"]')
      || document.querySelector('.m6QErb[aria-label]')
      || document.querySelector('.m6QErb.DxyBCb');

    if (!scrollContainer) {
      return { error: 'No results panel found. Search for businesses on Google Maps first.' };
    }

    if (autoScroll) {
      var lastHeight = 0;
      var sameCount = 0;

      for (var i = 0; i < maxScrolls; i++) {
        scrollContainer.scrollTo(0, scrollContainer.scrollHeight);
        await sleep(scrollDelay);

        var newHeight = scrollContainer.scrollHeight;
        if (newHeight === lastHeight) {
          sameCount++;
          if (sameCount >= 3) break;
        } else {
          sameCount = 0;
        }
        lastHeight = newHeight;
      }
    }

    var leads = [];
    var seen = {};
    var resultLinks = document.querySelectorAll('a.hfpxzc');

    for (var ri = 0; ri < resultLinks.length; ri++) {
      var link = resultLinks[ri];
      var container = link.closest('.Nv2PK') || link.parentElement;
      if (!container) continue;

      var name = link.getAttribute('aria-label') || '';
      if (!name) continue;
      var dedupeKey = link.href || name;
      if (seen[dedupeKey]) continue;
      seen[dedupeKey] = true;

      var text = container.textContent || '';

      // Rating
      var rating = '';
      var reviews = '';
      var ratingEl = container.querySelector('.MW4etd');
      if (ratingEl) rating = ratingEl.textContent.trim();
      var reviewEl = container.querySelector('.UY7F9');
      if (reviewEl) {
        var rm = reviewEl.textContent.match(/([\d,]+)/);
        if (rm) reviews = rm[1].replace(/,/g, '');
      }

      // Category
      var category = '';
      var spans = container.querySelectorAll('.W4Efsd span');
      for (var si = 0; si < spans.length; si++) {
        var st = spans[si].textContent.trim();
        if (st && st.length > 2 && st.length < 50
            && !/^\$/.test(st) && !/^\(/.test(st) && !/^[0-9]/.test(st)
            && !/Open|Closed|hr|mi|·/.test(st)) {
          category = st;
          break;
        }
      }

      // Address - extract only the matched street string, stop at · separator
      var address = '';
      var addrEls = container.querySelectorAll('.W4Efsd');
      for (var ai = 0; ai < addrEls.length; ai++) {
        var at = addrEls[ai].textContent.trim();
        var addrMatch = at.match(/(\d+[^·\n]*?(?:St|Ave|Blvd|Rd|Dr|Ln|Way|Ct|Pl|Hwy|Suite|Ste|Floor|#)\w*)/i);
        if (addrMatch) {
          address = addrMatch[1].trim();
          break;
        }
      }

      // Phone
      var phone = '';
      var phoneMatch = text.match(/(\+?1?\s?\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4})/);
      if (phoneMatch) phone = phoneMatch[1].trim();

      // Website
      var website = '';
      var webEl = container.querySelector('a[data-value="Website"]');
      if (webEl) website = webEl.href || '';

      // Hours
      var hours = '';
      var hoursMatch = text.match(/(Open|Closed)\s*(·\s*)?((?:until|at)\s*\d+(?::\d+)?\s*(?:AM|PM)?)?/i);
      if (hoursMatch) hours = hoursMatch[0].trim();

      leads.push({
        name: name,
        category: category,
        address: address,
        phone: phone,
        website: website,
        rating: rating,
        reviews: reviews,
        hours: hours,
        mapsUrl: link.href || '',
      });
    }

    // Fallback if primary selector yields nothing
    if (leads.length === 0) {
      var feedItems = scrollContainer.querySelectorAll(':scope > div');
      for (var fi = 0; fi < feedItems.length; fi++) {
        var item = feedItems[fi];
        var nameEl = item.querySelector('.fontHeadlineSmall, .qBF1Pd, .NrDZNb');
        if (!nameEl) continue;

        var itemName = nameEl.textContent.trim();
        if (!itemName || seen[itemName]) continue;
        seen[itemName] = true;

        var itemText = item.textContent || '';
        var itemPhone = '';
        var pm = itemText.match(/(\+?1?\s?\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4})/);
        if (pm) itemPhone = pm[1].trim();

        leads.push({
          name: itemName,
          category: '',
          address: '',
          phone: itemPhone,
          website: '',
          rating: '',
          reviews: '',
          hours: '',
          mapsUrl: '',
        });
      }
    }

    return { leads: leads, query: query };
  } catch (err) {
    return { error: err.message };
  }
}

// ── Downloads ──
function escapeCSV(val) {
  var str = String(val || '');
  if (str.indexOf(',') !== -1 || str.indexOf('"') !== -1 || str.indexOf('\n') !== -1) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function downloadCSV(data, name) {
  if (!data.length) return;
  var keys = Object.keys(data[0]);
  var header = keys.map(escapeCSV).join(',');
  var rows = data.map(function(row) {
    return keys.map(function(k) { return escapeCSV(row[k]); }).join(',');
  });
  var bom = '\uFEFF';
  triggerDownload(bom + header + '\n' + rows.join('\n'), 'mapleads_' + name + '.csv', 'text/csv;charset=utf-8');
}

function downloadJSON(data, name) {
  triggerDownload(JSON.stringify(data, null, 2), 'mapleads_' + name + '.json', 'application/json');
}

function triggerDownload(content, filename, mimeType) {
  var blob = new Blob([content], { type: mimeType });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
