// Erik's Wish List: the Google Sheet "server" for docs/ (see README.md, "Setup").
// Paste this whole file into the sheet's Extensions → Apps Script, set the PASSCODE
// script property, and deploy it as a web app (Execute as: Me, Who has access: Anyone).
//
// Anyone can read the list (GET). Every change (POST) needs the family passcode, which
// lives only in this script's properties, never in the web page. With it, family members
// mark what they're getting. Adding, changing and deleting wishes, and the Admin tools, are
// for the name Admin only: Admin uses ADMIN_PASSCODE once one is set, and the family
// passcode until then.

const COLUMNS = ['id', 'name', 'url', 'image', 'price', 'store', 'priority', 'details',
                 'addedBy', 'added', 'claimedBy', 'claimed'];
// The tabs of the sheet and their columns. Each is made the first time it's needed.
const SHEETS = {
  Items: COLUMNS,
  Deleted: COLUMNS.concat(['deletedBy', 'deleted']),
  Log: ['when', 'who', 'action', 'wish'],
};
const KEEP = { Deleted: 200, Log: 500 }; // the oldest rows past these are dropped
// Longest text each field may hold.
const LIMITS = { name: 200, url: 2000, image: 2000, price: 40, store: 80, details: 1000, who: 60, passcode: 100 };
const ADMIN_NAME = 'admin';
// What only Admin may do. The Admin panel's own actions also answer with what the panel shows.
const PANEL_ACTIONS = ['admin-info', 'set-passcode', 'set-admin-passcode', 'restore', 'remove-taken'];
const ADMIN_ACTIONS = ['save', 'delete', 'preview'].concat(PANEL_ACTIONS);

function doGet() {
  return json({ items: readItems() });
}

function doPost(e) {
  let req;
  try {
    req = JSON.parse(e.postData.contents);
  } catch (err) {
    return json({ error: 'bad-request' });
  }
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('PASSCODE')) return json({ error: 'no-passcode-set' });
  const role = roleOf(req, props);
  if (!role) {
    Utilities.sleep(1500); // makes guessing slow
    return json({ error: 'wrong-passcode' });
  }
  if (req.action === 'check') return json({ ok: true, isAdmin: role === 'admin' });
  if (ADMIN_ACTIONS.indexOf(req.action) >= 0 && role !== 'admin') return json({ error: 'not-admin' });
  if (req.action === 'preview') return json({ preview: previewLink(req.url) });
  if (req.action === 'admin-info') return json({ ok: true, adminInfo: adminInfo(props) });

  const who = clean(req.who, LIMITS.who) || 'Someone';
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    switch (req.action) {
      case 'save': {
        const saved = saveItem(req.item || {}, who);
        log(who, saved.added ? 'added' : 'changed', saved.name);
        break;
      }
      case 'delete': {
        const name = deleteItem(req.id, who);
        if (name) log(who, 'deleted', name);
        break;
      }
      case 'claim': {
        const claimed = claimItem(req.id, who);
        if (claimed.takenBy) return json({ error: 'already-claimed', claimedBy: claimed.takenBy, items: readItems() });
        log(who, 'claimed', claimed.name);
        break;
      }
      case 'unclaim': {
        const name = unclaimItem(req.id);
        if (name) log(who, 'unclaimed', name);
        break;
      }
      case 'restore': {
        const name = restoreItem(req.id);
        if (name) log(who, 'restored', name);
        break;
      }
      case 'remove-taken': log(who, 'removed-taken', String(removeTaken(who))); break;
      case 'set-passcode':
        setPasscode(props, 'PASSCODE', req.newPasscode, props.getProperty('ADMIN_PASSCODE'));
        log(who, 'family-passcode', '');
        break;
      case 'set-admin-passcode':
        setPasscode(props, 'ADMIN_PASSCODE', req.newPasscode, props.getProperty('PASSCODE'));
        log(who, 'admin-passcode', '');
        break;
      default: return json({ error: 'bad-request' });
    }
    const out = { ok: true, items: readItems() };
    if (PANEL_ACTIONS.indexOf(req.action) >= 0) out.adminInfo = adminInfo(props);
    return json(out);
  } catch (err) {
    return json({ error: 'failed', message: String(err.message || err) });
  } finally {
    lock.releaseLock();
  }
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ---- Who's asking ----

// Spaces around a passcode and capital letters don't matter, so it's easy to type on a phone.
function norm(s) {
  return String(s == null ? '' : s).trim().toLowerCase();
}

// 'admin' for the name Admin with the admin passcode (the family passcode until an admin
// passcode is set), 'family' for anyone else with the family passcode, or '' for neither.
function roleOf(req, props) {
  const family = props.getProperty('PASSCODE');
  const admin = props.getProperty('ADMIN_PASSCODE');
  const given = norm(req.passcode);
  if (norm(req.who) === ADMIN_NAME) return given === norm(admin || family) ? 'admin' : '';
  return given === norm(family) ? 'family' : '';
}

function setPasscode(props, key, value, other) {
  const passcode = String(value == null ? '' : value).trim();
  if (passcode.length < 6) throw new Error('Use at least 6 characters. Three short words work well.');
  if (passcode.length > LIMITS.passcode) throw new Error('That passcode is too long.');
  if (other && norm(passcode) === norm(other)) throw new Error('The family and admin passcodes need to be different.');
  props.setProperty(key, passcode);
}

// What the Admin tools show: the newest activity and deleted wishes first.
function adminInfo(props) {
  return {
    familyPasscode: props.getProperty('PASSCODE'),
    hasAdminPasscode: !!props.getProperty('ADMIN_PASSCODE'),
    deleted: records(table('Deleted')).reverse().slice(0, 50).map(strip),
    log: records(table('Log')).reverse().slice(0, 150).map(strip),
  };
}

function strip(record) {
  delete record.row;
  return record;
}

// ---- The sheet ----

// One tab of the sheet and where its columns are. Columns are found by their header, so
// they can be moved around in the sheet.
function table(name) {
  const columns = SHEETS[name];
  const book = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = book.getSheetByName(name);
  if (!sheet) {
    sheet = book.insertSheet(name);
    sheet.getRange(1, 1, 1, columns.length).setValues([columns]).setFontWeight('bold');
    sheet.setFrozenRows(1);
    // Plain text, so prices and dates stay exactly as written.
    sheet.getRange(1, 1, sheet.getMaxRows(), columns.length).setNumberFormat('@');
  }
  const header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  const index = {};
  columns.forEach(c => {
    const i = header.indexOf(c);
    if (i < 0) throw new Error('The ' + name + ' sheet is missing the "' + c + '" column');
    index[c] = i;
  });
  return { name: name, sheet: sheet, index: index, columns: columns };
}

// Every row below the header as { row: its row number, column: text, ... }.
function records(t) {
  const last = t.sheet.getLastRow();
  if (last < 2) return [];
  return t.sheet.getRange(2, 1, last - 1, t.sheet.getLastColumn()).getValues().map((values, i) => {
    const record = { row: i + 2 };
    t.columns.forEach(c => {
      const v = values[t.index[c]];
      record[c] = v instanceof Date ? v.toISOString() : String(v);
    });
    return record;
  });
}

function findRecord(t, id) {
  if (!id) return null;
  return records(t).filter(r => r.id === String(id))[0] || null;
}

// Never let a value become a formula.
function safe(value) {
  const s = value == null ? '' : String(value);
  return s.charAt(0) === '=' ? "'" + s : s;
}

function writeCells(t, rowNumber, values) {
  Object.keys(values).forEach(c => t.sheet.getRange(rowNumber, t.index[c] + 1).setValue(safe(values[c])));
}

function appendRecord(t, values) {
  const row = new Array(t.sheet.getLastColumn()).fill('');
  t.columns.forEach(c => { row[t.index[c]] = safe(values[c]); });
  t.sheet.appendRow(row);
  const extra = t.sheet.getLastRow() - 1 - (KEEP[t.name] || Infinity);
  if (extra > 0) t.sheet.deleteRows(2, extra);
}

function log(who, action, wish) {
  appendRecord(table('Log'), { when: new Date().toISOString(), who: who, action: action, wish: wish });
}

function readItems() {
  const t = table('Items');
  return records(t)
    .filter(r => r.name !== '')
    .map(r => {
      // A wish typed straight into the sheet gets an id the first time it's read.
      if (!r.id) {
        r.id = Utilities.getUuid();
        writeCells(t, r.row, { id: r.id });
      }
      return strip(r);
    });
}

// ---- Changes ----

function clean(value, limit) {
  return String(value == null ? '' : value).trim().slice(0, limit);
}

function cleanLink(value) {
  const s = String(value == null ? '' : value).trim();
  return /^https?:\/\//i.test(s) ? s.slice(0, LIMITS.url) : '';
}

// Returns { name, added: true for a new wish }.
function saveItem(item, who) {
  const name = clean(item.name, LIMITS.name);
  if (!name) throw new Error('A wish needs a name');
  const values = {
    name: name,
    url: cleanLink(item.url),
    image: cleanLink(item.image),
    price: clean(item.price, LIMITS.price),
    store: clean(item.store, LIMITS.store),
    priority: ['1', '2', '3'].indexOf(String(item.priority)) >= 0 ? String(item.priority) : '2',
    details: clean(item.details, LIMITS.details),
  };
  const t = table('Items');
  const found = findRecord(t, item.id);
  if (found) {
    writeCells(t, found.row, values); // leaves who claimed it alone
    return { name: name, added: false };
  }
  if (item.id) throw new Error('That wish was removed');
  values.id = Utilities.getUuid();
  values.addedBy = who;
  values.added = new Date().toISOString();
  appendRecord(t, values);
  return { name: name, added: true };
}

// Moves wishes to the Deleted tab, where Admin can bring them back.
function moveToDeleted(t, found, who) {
  const deleted = table('Deleted');
  const now = new Date().toISOString();
  found.forEach(r => appendRecord(deleted, Object.assign({}, r, { deletedBy: who, deleted: now })));
  found.map(r => r.row).sort((a, b) => b - a).forEach(row => t.sheet.deleteRow(row));
}

// Returns the deleted wish's name, or '' if it was already gone.
function deleteItem(id, who) {
  const t = table('Items');
  const found = findRecord(t, id);
  if (!found) return '';
  moveToDeleted(t, [found], who);
  return found.name;
}

// Returns how many wishes it removed.
function removeTaken(who) {
  const t = table('Items');
  const taken = records(t).filter(r => r.name !== '' && r.claimedBy !== '');
  moveToDeleted(t, taken, who);
  return taken.length;
}

// Returns the wish's name, or '' if it isn't in Deleted.
function restoreItem(id) {
  const deleted = table('Deleted');
  const found = findRecord(deleted, id);
  if (!found) return '';
  const items = table('Items');
  if (!findRecord(items, id)) appendRecord(items, found);
  deleted.sheet.deleteRow(found.row);
  return found.name;
}

// Returns { name } once claimed, or { takenBy } if someone else claimed it first.
function claimItem(id, who) {
  const t = table('Items');
  const found = findRecord(t, id);
  if (!found) throw new Error('That wish was removed');
  if (found.claimedBy && found.claimedBy !== who) return { takenBy: found.claimedBy };
  writeCells(t, found.row, { claimedBy: who, claimed: new Date().toISOString() });
  return { name: found.name };
}

// Returns the wish's name, or '' if it's gone.
function unclaimItem(id) {
  const t = table('Items');
  const found = findRecord(t, id);
  if (!found) return '';
  writeCells(t, found.row, { claimedBy: '', claimed: '' });
  return found.name;
}

// ---- Fill in from a link ----

// Best effort: reads the product page's title, picture and price. Some stores turn away
// requests from Google's servers, so any of these can come back blank. Amazon usually does:
// for an Amazon link the picture comes from the product's id and the name is guessed from the
// link (nameGuessed), and the page (docs/js/app.js) asks a link-preview service for the rest.
function previewLink(url) {
  url = cleanLink(url);
  if (!url) return {};
  url = followShortLink(url);
  const out = { store: storeName(url) };
  const asin = amazonId(url);
  if (asin) {
    out.amazon = true;
    out.link = url.match(/^https?:\/\/[^/]+/i)[0] + '/dp/' + asin; // the product's page without the tracking bits
  }
  const html = fetchPage(out.link || url);
  if (html) Object.assign(out, parseProductPage(html, url));
  if (asin) {
    if (!out.image) out.image = amazonPicture(asin);
    if (!out.name) {
      out.name = nameFromLink(url);
      if (out.name) out.nameGuessed = true;
    }
  }
  Object.keys(out).forEach(k => { if (out[k] === '') delete out[k]; });
  return out;
}

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

// The page's HTML, or '' if it couldn't be read or the store showed a robot check instead.
function fetchPage(url) {
  try {
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true, headers: BROWSER_HEADERS });
    if (res.getResponseCode() >= 400) return '';
    const html = res.getContentText().slice(0, 1500000);
    return /validateCaptcha|api-services-support@amazon\.com|Type the characters you see/i.test(html) ? '' : html;
  } catch (err) {
    return '';
  }
}

// Amazon's share links (a.co/d/…, amzn.to/…) redirect to the product's real link.
function followShortLink(url) {
  for (let hop = 0; hop < 5 && /^https?:\/\/(a\.co|amzn\.[a-z]+)\//i.test(url); hop++) {
    try {
      const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: false, headers: BROWSER_HEADERS });
      const headers = res.getHeaders();
      const next = headers.Location || headers.location;
      if (!next) break;
      url = absolute(String(next), url);
    } catch (err) {
      break;
    }
  }
  return url;
}

// The 10-character product id in an Amazon link (…/dp/B00006JSUA), or ''.
function amazonId(url) {
  if (!/^https?:\/\/([^/]+\.)?amazon\.[a-z.]+\//i.test(url)) return '';
  const m = url.match(/\/(?:dp|gp\/product|gp\/aw\/d|exec\/obidos\/asin|o\/asin)\/([A-Z0-9]{10})(?=[/?#&]|$)/i);
  return m ? m[1].toUpperCase() : '';
}

// Amazon serves a product's main picture by its id. One it doesn't have comes back as a tiny blank image.
function amazonPicture(asin) {
  const link = 'https://m.media-amazon.com/images/P/' + asin + '.01._SCLZZZZZZZ_.jpg';
  try {
    const res = UrlFetchApp.fetch(link, { muteHttpExceptions: true });
    return res.getResponseCode() === 200 && res.getContent().length > 1000 ? link : '';
  } catch (err) {
    return '';
  }
}

// amazon.com/Lodge-Cast-Iron-Skillet/dp/… → "Lodge Cast Iron Skillet"
function nameFromLink(url) {
  const m = url.match(/^https?:\/\/[^/]+\/([^/?#]+)\/(?:dp|gp\/product)\//i);
  if (!m) return '';
  let words = m[1];
  try {
    words = decodeURIComponent(words);
  } catch (err) { /* keep it as it is */ }
  words = words.replace(/[-_+]+/g, ' ').replace(/\s+/g, ' ').trim();
  return /[a-z]/i.test(words) ? words.slice(0, LIMITS.name) : '';
}

function parseProductPage(html, url) {
  const meta = {};
  (html.match(/<meta\b[^>]*>/gi) || []).forEach(tag => {
    const key = attr(tag, 'property') || attr(tag, 'name') || attr(tag, 'itemprop');
    const content = attr(tag, 'content');
    if (key && content && !(key.toLowerCase() in meta)) meta[key.toLowerCase()] = content;
  });
  const product = jsonLdProduct(html);
  const out = {};

  const amazonTitle = html.match(/id="productTitle"[^>]*>([\s\S]*?)<\/span>/i);
  let name = (amazonTitle && amazonTitle[1]) || meta['og:title'] || meta['twitter:title'] || (product && product.name);
  if (!name) {
    const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (t) name = t[1];
  }
  if (name) name = decodeEntities(name).replace(/\s+/g, ' ').trim().replace(/^Amazon\.[a-z.]+\s*:\s*/i, '');
  if (name && !/^amazon(\.[a-z.]+)?$/i.test(name)) out.name = name.slice(0, LIMITS.name);

  let image = meta['og:image'] || meta['og:image:secure_url'] || meta['twitter:image'] || meta['image'];
  if (!image && product && product.image) {
    const img = Array.isArray(product.image) ? product.image[0] : product.image;
    image = typeof img === 'string' ? img : img && img.url;
  }
  if (!image) {
    const m = html.match(/data-old-hires="([^"]+)"/) || html.match(/"hiRes":"(https:[^"]+)"/) ||
              html.match(/id="landingImage"[^>]*src="([^"]+)"/);
    if (m) image = m[1];
  }
  if (image) out.image = absolute(decodeEntities(image), url);

  let price = meta['product:price:amount'] || meta['og:price:amount'] || meta['price'];
  if (!price && product && product.offers) {
    const offer = Array.isArray(product.offers) ? product.offers[0] : product.offers;
    price = offer && (offer.price || offer.lowPrice);
  }
  if (!price) {
    // Amazon: the buy box's price, else the first price shown.
    const m = html.match(/id="corePrice(?:Display_desktop)?_feature_div"[\s\S]{0,4000}?class="a-offscreen">\s*[^\d<]*([\d,]+\.\d\d)/) ||
              html.match(/"priceAmount":\s*([\d.]+)/) ||
              html.match(/class="a-offscreen">\s*[^\d<]*([\d,]+\.\d\d)/) ||
              html.match(/itemprop="price"[^>]*content="([\d.,]+)"/);
    if (m) price = m[1];
  }
  if (price) {
    const n = parseFloat(String(price).replace(/[^\d.]/g, ''));
    if (n > 0) out.price = n.toFixed(2);
  }
  return out;
}

function attr(tag, name) {
  const m = tag.match(new RegExp('\\b' + name + '\\s*=\\s*("([^"]*)"|\'([^\']*)\')', 'i'));
  return m ? (m[2] != null ? m[2] : m[3]) : '';
}

// The first schema.org Product in the page's JSON-LD blocks, if any.
function jsonLdProduct(html) {
  const blocks = html.match(/<script[^>]*application\/ld\+json[^>]*>[\s\S]*?<\/script>/gi) || [];
  for (const block of blocks) {
    let data;
    try {
      data = JSON.parse(block.replace(/^<script[^>]*>/i, '').replace(/<\/script>$/i, ''));
    } catch (err) {
      continue;
    }
    const queue = [].concat(data);
    while (queue.length) {
      const node = queue.shift();
      if (!node || typeof node !== 'object') continue;
      const type = [].concat(node['@type'] || []);
      if (type.indexOf('Product') >= 0) return node;
      if (node['@graph']) queue.push.apply(queue, [].concat(node['@graph']));
    }
  }
  return null;
}

function decodeEntities(s) {
  return String(s)
    .replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (m, d) => String.fromCharCode(parseInt(d, 10)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
}

function absolute(link, base) {
  if (/^https?:\/\//i.test(link)) return link;
  if (link.indexOf('//') === 0) return 'https:' + link;
  const origin = base.match(/^https?:\/\/[^/]+/i)[0];
  return link.charAt(0) === '/' ? origin + link : origin + '/' + link;
}

function storeName(url) {
  const host = (url.match(/^https?:\/\/([^/:?#]+)/i) || [])[1] || '';
  const parts = host.toLowerCase().replace(/^(www|smile|m|shop)\./, '').split('.');
  const known = { amazon: 'Amazon', amzn: 'Amazon', target: 'Target', walmart: 'Walmart', bestbuy: 'Best Buy',
                  etsy: 'Etsy', ebay: 'eBay', homedepot: 'Home Depot', lowes: "Lowe's", costco: 'Costco',
                  rei: 'REI', kohls: "Kohl's", apple: 'Apple', lego: 'LEGO', nike: 'Nike' };
  if (host === 'a.co') return 'Amazon';
  const hit = parts.filter(p => known[p])[0];
  if (hit) return known[hit];
  // example.com → Example, example.co.uk → Example
  let word = parts.length > 1 ? parts[parts.length - 2] : parts[0] || '';
  if ((word === 'co' || word === 'com') && parts.length > 2) word = parts[parts.length - 3];
  return word ? word.charAt(0).toUpperCase() + word.slice(1) : '';
}
