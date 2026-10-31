// Erik's Wish List: the Google Sheet "server" for docs/ (see README.md, "Setup").
// Paste this whole file into the sheet's Extensions → Apps Script, set the PASSCODE
// script property, and deploy it as a web app (Execute as: Me, Who has access: Anyone).
//
// Anyone can read the list (GET). Every change (POST) needs the family passcode, which
// lives only in this script's properties, never in the web page.

const SHEET_NAME = 'Items';
const COLUMNS = ['id', 'name', 'url', 'image', 'price', 'store', 'priority', 'details',
                 'addedBy', 'added', 'claimedBy', 'claimed'];
// Longest text each field may hold.
const LIMITS = { name: 200, url: 2000, image: 2000, price: 40, store: 80, details: 1000, who: 60 };

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
  const passcode = PropertiesService.getScriptProperties().getProperty('PASSCODE');
  if (!passcode) return json({ error: 'no-passcode-set' });
  // Spaces around it and capital letters don't matter, so it's easy to type on a phone.
  if (String(req.passcode || '').trim().toLowerCase() !== passcode.trim().toLowerCase()) {
    Utilities.sleep(1500); // makes guessing slow
    return json({ error: 'wrong-passcode' });
  }
  if (req.action === 'check') return json({ ok: true });
  if (req.action === 'preview') return json({ preview: previewLink(req.url) });

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    switch (req.action) {
      case 'save': saveItem(req.item || {}, req.who); break;
      case 'delete': deleteItem(req.id); break;
      case 'claim': {
        const taken = claimItem(req.id, req.who);
        if (taken) return json({ error: 'already-claimed', claimedBy: taken, items: readItems() });
        break;
      }
      case 'unclaim': unclaimItem(req.id); break;
      default: return json({ error: 'bad-request' });
    }
    return json({ ok: true, items: readItems() });
  } catch (err) {
    return json({ error: 'failed', message: String(err.message || err) });
  } finally {
    lock.releaseLock();
  }
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ---- The sheet ----

function getSheet() {
  const book = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = book.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = book.insertSheet(SHEET_NAME);
    sheet.getRange(1, 1, 1, COLUMNS.length).setValues([COLUMNS]).setFontWeight('bold');
    sheet.setFrozenRows(1);
    // Plain text, so prices and dates stay exactly as written.
    sheet.getRange(1, 1, sheet.getMaxRows(), COLUMNS.length).setNumberFormat('@');
  }
  return sheet;
}

// Column positions by header name, so columns can be moved around in the sheet.
function headerIndex(sheet) {
  const header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  const index = {};
  COLUMNS.forEach(c => {
    const i = header.indexOf(c);
    if (i < 0) throw new Error('The sheet is missing the "' + c + '" column');
    index[c] = i;
  });
  return index;
}

function readRows(sheet) {
  const last = sheet.getLastRow();
  if (last < 2) return [];
  return sheet.getRange(2, 1, last - 1, sheet.getLastColumn()).getValues();
}

function readItems() {
  const sheet = getSheet();
  const index = headerIndex(sheet);
  const rows = readRows(sheet);
  // A wish typed straight into the sheet gets an id the first time it's read.
  rows.forEach((row, i) => {
    if (row[index.id] === '' && row[index.name] !== '') {
      row[index.id] = Utilities.getUuid();
      sheet.getRange(i + 2, index.id + 1).setValue(row[index.id]);
    }
  });
  return rows
    .filter(row => row[index.name] !== '')
    .map(row => {
      const item = {};
      COLUMNS.forEach(c => {
        const v = row[index[c]];
        item[c] = v instanceof Date ? v.toISOString() : String(v);
      });
      return item;
    });
}

// The sheet row number (2 and up) of an item, or 0.
function findRow(sheet, index, id) {
  if (!id) return 0;
  const rows = readRows(sheet);
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][index.id]) === String(id)) return i + 2;
  }
  return 0;
}

function writeCells(sheet, index, rowNumber, values) {
  Object.keys(values).forEach(c => sheet.getRange(rowNumber, index[c] + 1).setValue(values[c]));
}

// ---- Changes ----

function clean(value, limit) {
  const s = String(value == null ? '' : value).trim().slice(0, limit);
  return /^[=+\-@]/.test(s) ? "'" + s : s; // never let a value become a formula
}

function cleanLink(value) {
  const s = String(value == null ? '' : value).trim();
  return /^https?:\/\//i.test(s) ? s.slice(0, LIMITS.url) : '';
}

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
  const sheet = getSheet();
  const index = headerIndex(sheet);
  const rowNumber = findRow(sheet, index, item.id);
  if (rowNumber) {
    writeCells(sheet, index, rowNumber, values); // leaves who claimed it alone
    return;
  }
  if (item.id) throw new Error('That wish was removed');
  values.id = Utilities.getUuid();
  values.addedBy = clean(who, LIMITS.who);
  values.added = new Date().toISOString();
  values.claimedBy = '';
  values.claimed = '';
  const row = new Array(sheet.getLastColumn()).fill('');
  COLUMNS.forEach(c => { row[index[c]] = values[c]; });
  sheet.appendRow(row);
}

function deleteItem(id) {
  const sheet = getSheet();
  const rowNumber = findRow(sheet, headerIndex(sheet), id);
  if (rowNumber) sheet.deleteRow(rowNumber);
}

// Returns who already has it if someone else claimed it first, else claims it.
function claimItem(id, who) {
  const name = clean(who, LIMITS.who) || 'Someone';
  const sheet = getSheet();
  const index = headerIndex(sheet);
  const rowNumber = findRow(sheet, index, id);
  if (!rowNumber) throw new Error('That wish was removed');
  const current = String(sheet.getRange(rowNumber, index.claimedBy + 1).getValue());
  if (current && current !== name) return current;
  writeCells(sheet, index, rowNumber, { claimedBy: name, claimed: new Date().toISOString() });
  return '';
}

function unclaimItem(id) {
  const sheet = getSheet();
  const index = headerIndex(sheet);
  const rowNumber = findRow(sheet, index, id);
  if (rowNumber) writeCells(sheet, index, rowNumber, { claimedBy: '', claimed: '' });
}

// ---- Fill in from a link ----

// Best effort: reads the product page's title, picture and price. Some stores (Amazon
// often) turn away requests from Google's servers, so any of these can come back blank.
function previewLink(url) {
  url = cleanLink(url);
  if (!url) return {};
  const out = { store: storeName(url) };
  let html;
  try {
    const res = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true,
      followRedirects: true,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    if (res.getResponseCode() >= 400) return out;
    html = res.getContentText().slice(0, 1500000);
  } catch (err) {
    return out;
  }
  return Object.assign(out, parseProductPage(html, url));
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

  let name = meta['og:title'] || meta['twitter:title'] || (product && product.name);
  if (!name) {
    const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (t) name = t[1];
  }
  if (name) out.name = decodeEntities(name).replace(/\s+/g, ' ').trim().replace(/^Amazon\.com\s*:\s*/i, '').slice(0, LIMITS.name);

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
    const m = html.match(/class="a-offscreen">\s*\$([\d,]+\.\d\d)/) || html.match(/itemprop="price"[^>]*content="([\d.,]+)"/);
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
