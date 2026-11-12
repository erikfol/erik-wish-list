// Erik's Wish List. The list lives in a Google Sheet behind apps-script/Code.gs: the family
// link (?k=…) opens it, and only Admin, with the admin passcode, changes the wishes.
// With no SCRIPT_URL it's a demo kept in this browser.
import { SCRIPT_URL, SHEET_URL } from './config.js';

const OWNER = 'Erik';
const DEMO = !SCRIPT_URL;

const $ = id => document.getElementById(id);

// localStorage can be blocked (private windows); the page still works without it.
const saved = {
    get(key) { try { return localStorage.getItem(key); } catch { return null; } },
    set(key, value) { try { localStorage.setItem(key, value); } catch { /* not kept */ } },
    remove(key) { try { localStorage.removeItem(key); } catch { /* nothing kept */ } },
};

let items = [];
let categories = []; // names, A to Z, from the sheet's Categories tab
let loadedAt = 0;
// The family link's key: from the address (?k=…) when there is one, else the one this device kept.
const keyInAddress = (new URLSearchParams(location.search).get('k') || '').trim();
if (keyInAddress) saved.set('wish-key', keyInAddress);
saved.remove('wish-passcode'); // from when everyone signed in with the family passcode
saved.remove('wish-admin');
const savedName = saved.get('wish-name') || '';
let session = {
    key: keyInAddress || saved.get('wish-key') || '',
    name: savedName.toLowerCase() === 'admin' ? '' : savedName, // the name typed when claiming
    adminPasscode: saved.get('wish-admin-pass') || '',
};
let linkFailed = false;  // the script turned this device's family link away
let noSpoilers = saved.get('wish-no-spoilers') === '1';
let categoryFilter = saved.get('wish-category') ?? '*'; // '*' everything, '' no category
let editing = null;      // the wish open in the edit dialog ({} for a new one)
let claiming = null;     // the wish open in the claim dialog

const isAdmin = () => !!session.adminPasscode;
// Without the family link (and not Admin) there's nothing to show.
const locked = () => !DEMO && !session.key && !isAdmin();
const sameName = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

function familyLink() {
    return location.origin + location.pathname + '?k=' + encodeURIComponent(session.key);
}

class ApiError extends Error {
    constructor(code, extra = {}) {
        super(extra.message || code);
        this.code = code;
        this.claimedBy = extra.claimedBy;
    }
}

// ---- Talking to the sheet ----

// Sends a change along with the family link's key (and the admin passcode for Admin).
// After a change the answer carries the whole list.
async function send(action, data = {}) {
    const body = { action, key: session.key, adminPasscode: session.adminPasscode, who: session.name, ...data };
    const out = DEMO ? demo.send(body) : await post(body);
    if (out.items) setItems(out.items);
    if (out.categories) categories = out.categories;
    if (out.error) throw new ApiError(out.error, out);
    return out;
}

async function post(body) {
    let res;
    try {
        // A plain-text body keeps this a "simple" request, which Apps Script accepts from other sites.
        res = await fetch(SCRIPT_URL, { method: 'POST', body: JSON.stringify(body) });
    } catch {
        throw new ApiError('network');
    }
    if (!res.ok) throw new ApiError('network');
    return res.json();
}

function setItems(list) {
    items = list.map(i => ({ ...i, category: i.category || '' }));
    loadedAt = Date.now();
}

// ---- Demo mode: the same answers as Code.gs, kept in this browser ----

const SAMPLES = [
    { id: 's1', name: 'Wool hiking socks (3-pack)', url: '', image: '', price: '24.99', store: 'REI',
      details: 'Size L. Gray or green.', addedBy: 'Erik', added: '2026-10-30T12:00:00Z', claimedBy: '', claimed: '' },
    { id: 's2', name: '12" cast iron skillet', url: '', image: '', price: '39.90', store: 'Amazon',
      details: '', addedBy: 'Erik', added: '2026-10-29T12:00:00Z', claimedBy: 'Mom', claimed: '2026-10-30T15:00:00Z' },
    { id: 's3', name: 'A good book (surprise me!)', url: '', image: '', price: '', store: '',
      details: 'Mysteries or history.', addedBy: 'Erik', added: '2026-10-28T12:00:00Z', claimedBy: '', claimed: '' },
];

const DEMO_CATEGORIES = ['Car', 'Tech', 'Tool'];

const demo = {
    items() {
        try {
            const kept = JSON.parse(saved.get('wish-demo-items'));
            if (Array.isArray(kept)) return kept;
        } catch { /* start over */ }
        return structuredClone(SAMPLES);
    },
    send(req) {
        const list = demo.items();
        const item = list.find(i => i.id === (req.id || req.item?.id));
        const now = new Date().toISOString();
        switch (req.action) {
            case 'check': return { ok: true, isAdmin: !!String(req.adminPasscode || '').trim(), items: list, categories: DEMO_CATEGORIES };
            case 'list': return { ok: true, items: list, categories: DEMO_CATEGORIES };
            case 'preview': return { preview: {} };
            case 'save': {
                const { name, url, image, price, store, category, details } = req.item;
                const values = { name, url, image, price, store, category, details };
                if (item) Object.assign(item, values);
                else if (req.item.id) return { error: 'failed', message: 'That wish was removed' };
                else list.push({ ...values, id: String(Date.now()), addedBy: req.who, added: now, claimedBy: '', claimed: '' });
                break;
            }
            case 'delete': if (item) list.splice(list.indexOf(item), 1); break;
            case 'claim':
                if (!item) return { error: 'failed', message: 'That wish was removed' };
                if (!String(req.who || '').trim()) return { error: 'failed', message: 'Type your name first.' };
                if (item.claimedBy && !sameName(item.claimedBy, req.who)) return { error: 'already-claimed', claimedBy: item.claimedBy, items: list };
                Object.assign(item, { claimedBy: req.who, claimed: now });
                break;
            case 'unclaim': if (item) Object.assign(item, { claimedBy: '', claimed: '' }); break;
        }
        saved.set('wish-demo-items', JSON.stringify(list));
        return { ok: true, items: list, categories: DEMO_CATEGORIES };
    },
};

// ---- Helpers ----

function h(tag, props = {}, ...children) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
        if (value == null || value === false) continue;
        if (key === 'class') el.className = value;
        else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
        else el.setAttribute(key, value);
    }
    for (const child of children.flat()) if (child != null && child !== false && child !== '') el.append(child);
    return el;
}

const safeLink = url => /^https?:\/\/\S+$/i.test(String(url || '').trim()) ? String(url).trim() : null;

// "amazon.com/…" → "https://amazon.com/…", so pasting a link without the start still works.
function fixLink(input) {
    const v = input.value.trim();
    if (v && !/^https?:\/\//i.test(v) && /^[\w-]+(\.[\w-]+)+([/?#]|$)/.test(v)) input.value = 'https://' + v;
}

function priceNumber(price) {
    const m = String(price || '').replace(/,/g, '').match(/\d+(\.\d+)?/);
    return m ? parseFloat(m[0]) : null;
}

// 24.9 → $24.90; anything that isn't just a number ("about $30") is shown as written.
function priceText(price) {
    const p = String(price || '').trim();
    if (!/^\$?\s*[\d,]*\.?\d+$/.test(p)) return p;
    return priceNumber(p).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function dateText(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return '';
    const opts = { month: 'short', day: 'numeric' };
    if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
    return d.toLocaleDateString('en-US', opts);
}

function dateTimeText(iso) {
    const d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 'es'}`;

let toastTimer;
function toast(text) {
    const t = $('toast');
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 3500);
}

// Shows "Saving…" on a button while a change goes through.
async function working(button, label, task) {
    const before = button.textContent;
    button.disabled = true;
    button.textContent = label;
    try {
        return await task();
    } finally {
        button.disabled = false;
        button.textContent = before;
    }
}

function showError(id, text) {
    $(id).textContent = text || '';
    $(id).hidden = !text;
}

function handleError(err) {
    if (err.code === 'needs-link') {
        // A link that was replaced with a new one (or was never right): show the locked message.
        session.key = '';
        saved.remove('wish-key');
        linkFailed = true;
        items = [];
        loadedAt = 0;
    } else if (err.code === 'wrong-passcode') {
        signOut();
        openSignIn('That admin passcode no longer works. Sign in again.');
    } else if (err.code === 'not-admin') {
        toast('Only Admin can do that.');
    } else if (err.code === 'already-claimed') {
        toast(`${err.claimedBy} is already getting that one.`);
    } else if (err.code === 'no-passcode-set') {
        toast('The sheet has no ADMIN_PASSCODE set up yet (README → Setup).');
    } else if (err.code === 'network') {
        toast("Couldn't reach the list. Check your connection and try again.");
    } else {
        toast(err.message || 'Something went wrong. Try again.');
    }
    render();
}

function confirmBox(text, okLabel) {
    return new Promise(resolve => {
        const d = $('confirm-dialog');
        $('confirm-text').textContent = text;
        $('confirm-ok').textContent = okLabel;
        $('confirm-ok').onclick = () => { resolve(true); d.close(); };
        d.onclose = () => resolve(false);
        d.showModal();
    });
}

// ---- The page ----

function visibleItems() {
    const show = noSpoilers ? 'all' : $('show').value;
    const newer = (a, b) => String(b.added).localeCompare(String(a.added));
    const price = (i, missing) => priceNumber(i.price) ?? missing;
    const order = {
        low: (a, b) => price(a, 1e12) - price(b, 1e12) || newer(a, b),
        high: (a, b) => price(b, -1) - price(a, -1) || newer(a, b),
        new: newer,
    }[$('sort').value];
    return items
        .filter(i => show === 'all' || (show === 'open') === !i.claimedBy)
        .filter(i => categoryFilter === '*' || i.category === categoryFilter)
        // What's still available comes first, unless that would give away what's taken.
        .sort((a, b) => (noSpoilers ? 0 : !!a.claimedBy - !!b.claimedBy) || order(a, b));
}

function render() {
    const showing = !locked();
    const admin = isAdmin();
    $('signin').textContent = admin ? 'Sign out' : '🔒 Admin';
    $('add').hidden = !admin;
    $('admin-btn').hidden = !admin;
    $('share').hidden = !showing;
    $('show-wrap').hidden = noSpoilers;
    // Without the family link: only the message asking for it.
    $('locked').hidden = showing;
    $('locked-text').textContent = linkFailed
        ? `That link doesn't work anymore. Ask ${OWNER} for the new one.`
        : `This list opens with the family link. Ask ${OWNER} for it.`;
    $('toolbar').hidden = !showing;
    document.querySelector('.footer').hidden = !showing;
    if (!showing) $('status').textContent = '';

    const open = items.filter(i => !i.claimedBy).length;
    $('summary').textContent = !showing || !items.length ? '' :
        noSpoilers ? plural(items.length, 'wish') : `${plural(items.length, 'wish')} · ${open} still available`;
    $('how').textContent = !showing ? ''
        : noSpoilers ? "No-spoiler mode is on, so this device doesn't show what people are getting."
        : "Getting something? Tap “I'll get this” on it so nobody else buys it too.";

    $('spoiler-text').textContent = noSpoilers ? '🙈 No-spoiler mode is on for this device. ' : `${OWNER}? `;
    $('spoilers').textContent = noSpoilers ? 'Show what people are getting' : "Turn on no-spoiler mode so you can't see what people are getting";

    fillCategoryChoices();
    const list = showing ? visibleItems() : [];
    $('list').replaceChildren(...(list.length ? list.map(card) : showing && loadedAt ? [emptyState()] : []));
}

// The Category filter: everything, each category, and no category, with how many wishes each has.
function fillCategoryChoices() {
    const count = name => items.filter(i => i.category === name).length;
    const choices = [['*', 'All categories'], ...categories.map(c => [c, `${c} (${count(c)})`]), ['', `No category (${count('')})`]];
    if (loadedAt && !choices.some(([value]) => value === categoryFilter)) categoryFilter = '*'; // that category was deleted
    $('category').replaceChildren(...choices.map(([value, label]) => h('option', { value }, label)));
    $('category').value = categoryFilter;
}

// The add/edit form's choices; a wish's category typed into the sheet by hand is kept as a choice.
function fillItemCategories(current) {
    const names = current && !categories.includes(current) ? [...categories, current] : categories;
    $('f-category').replaceChildren(h('option', { value: '' }, 'No category'), ...names.map(c => h('option', { value: c }, c)));
    $('f-category').value = current || '';
}

function emptyState() {
    if (items.length) return h('div', { class: 'empty' }, 'Nothing to show with this filter.');
    return h('div', { class: 'empty' },
        h('div', { class: 'big' }, '🎄'),
        h('p', {}, 'No wishes on the list yet.'),
        h('p', {}, isAdmin() ? 'Tap “＋ Add a wish” to start it.' : 'Check back soon!'));
}

function noPic() {
    return h('div', { class: 'no-pic' }, '🎁');
}

function card(item) {
    const taken = !noSpoilers && !!item.claimedBy;
    const url = safeLink(item.url);
    const image = safeLink(item.image);

    const pic = image
        ? h('img', { src: image, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer', onerror: e => e.target.replaceWith(noPic()) })
        : noPic();
    const picBox = url
        ? h('a', { class: 'pic', href: url, target: '_blank', rel: 'noopener noreferrer', tabindex: '-1' }, pic)
        : h('div', { class: 'pic' }, pic);

    const added = dateText(item.added);
    const meta = [item.store, added && `Added ${added}`].filter(Boolean).join(' · ');

    let note = null;
    if (taken) {
        const who = session.name && sameName(item.claimedBy, session.name) ? "You're" : `${item.claimedBy} is`;
        note = h('div', { class: 'taken-note' }, `🎁 ${who} getting this`);
    }

    let claimButton = null;
    if (!noSpoilers) {
        claimButton = item.claimedBy
            ? h('button', { class: 'btn', type: 'button', onclick: e => unclaim(item, e.currentTarget) }, 'Undo')
            : h('button', { class: 'btn claim', type: 'button', onclick: () => claim(item) }, "🎁 I'll get this");
    }

    return h('article', { class: taken ? 'card taken' : 'card' },
        picBox,
        h('div', { class: 'card-body' },
            h('h3', {}, url ? h('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, item.name) : item.name),
            h('div', { class: 'meta' },
                item.category && h('span', { class: 'cat' }, item.category),
                meta),
            item.details && h('p', { class: 'details' }, item.details),
            note),
        h('div', { class: 'side' },
            item.price && h('div', { class: 'price' }, priceText(item.price)),
            h('div', { class: 'actions' },
                url && h('a', { class: 'btn', href: url, target: '_blank', rel: 'noopener noreferrer' }, 'View it ↗'),
                claimButton,
                isAdmin() && h('button', { class: 'btn', type: 'button', title: 'Change or delete this wish', onclick: () => openItem(item) }, '✎ Edit'))));
}

// ---- Claiming ----

// Asks for the claimer's name every time, which also catches a tap by mistake.
function claim(item) {
    claiming = item;
    $('claim-what').textContent = item.name;
    $('claim-name').value = session.name;
    showError('claim-error', '');
    $('claim-dialog').showModal();
    $('claim-name').focus();
    $('claim-name').select();
}

$('claim-form').addEventListener('submit', async e => {
    e.preventDefault();
    const name = $('claim-name').value.replace(/\s+/g, ' ').trim();
    if (!name) return showError('claim-error', 'Type your name first.');
    try {
        await working(e.submitter || $('claim-form').querySelector('[type=submit]'), 'Saving…',
            () => send('claim', { id: claiming.id, who: name }));
    } catch (err) {
        if (err.code === 'network' || err.code === 'failed') {
            return showError('claim-error', err.code === 'network' ? "Couldn't reach the list. Check your connection and try again." : err.message);
        }
        $('claim-dialog').close();
        return handleError(err);
    }
    session.name = name;
    saved.set('wish-name', name);
    $('claim-dialog').close();
    render();
    toast(`Thanks, ${name}! It's marked as yours.`);
});

async function unclaim(item, button) {
    if (!sameName(item.claimedBy, session.name) &&
        !await confirmBox(`${item.claimedBy} said they're getting “${item.name}”. Mark it as available again?`, 'Mark available')) return;
    try {
        await working(button, 'Saving…', () => send('unclaim', { id: item.id }));
        render();
        toast('Marked as available again.');
    } catch (err) {
        handleError(err);
    }
}

// ---- Admin sign-in ----

function openSignIn(message) {
    $('passcode').value = '';
    showError('signin-error', message);
    $('signin-dialog').showModal();
    $('passcode').focus();
}

// Signs out of Admin; the family link still shows the list on this device.
function signOut() {
    session.adminPasscode = '';
    saved.remove('wish-admin-pass');
    if (locked()) {
        items = [];
        loadedAt = 0;
    }
    render();
}

function keepLinkKey(key) {
    if (!key || key === session.key) return;
    session.key = key;
    saved.set('wish-key', key);
    linkFailed = false;
    if (new URLSearchParams(location.search).has('k')) history.replaceState(null, '', familyLink());
}

$('signin-form').addEventListener('submit', async e => {
    e.preventDefault();
    const passcode = $('passcode').value.trim();
    if (!passcode) return showError('signin-error', 'Type the admin passcode.');
    session.adminPasscode = passcode;
    try {
        const out = await working(e.submitter || $('signin-form').querySelector('[type=submit]'), 'Checking…', () => send('check'));
        if (!out.isAdmin) throw new ApiError('wrong-passcode');
        keepLinkKey(out.linkKey);
    } catch (err) {
        session.adminPasscode = '';
        showError('signin-error',
            err.code === 'wrong-passcode' ? "That isn't the admin passcode."
            : err.code === 'no-passcode-set' ? 'The sheet has no ADMIN_PASSCODE set up yet (README → Setup).'
            : "Couldn't reach the list. Check your connection and try again.");
        return;
    }
    saved.set('wish-admin-pass', passcode);
    $('signin-dialog').close();
    render();
    toast('Signed in as Admin. The Admin tools are under ⚙ Admin at the top.');
});

$('signin').addEventListener('click', () => {
    if (isAdmin()) {
        signOut();
        toast('Signed out of Admin on this device.');
    } else {
        openSignIn();
    }
});

// ---- Adding and changing wishes ----

const FIELDS = { name: 'f-name', url: 'f-url', image: 'f-image', price: 'f-price', store: 'f-store', category: 'f-category', details: 'f-details' };

function openItem(item) {
    editing = item || {};
    $('item-title').textContent = item ? 'Change this wish' : 'Add a wish';
    fillItemCategories(editing.category);
    for (const [field, id] of Object.entries(FIELDS)) $(id).value = editing[field] ?? '';
    $('delete').hidden = !item;
    $('fill-status').textContent = '';
    showError('item-error', '');
    showPicture();
    $('item-dialog').showModal();
    $(item ? 'f-name' : 'f-url').focus();
}

function showPicture() {
    const image = safeLink($('f-image').value);
    const img = $('f-preview');
    img.hidden = !image;
    if (image && img.getAttribute('src') !== image) img.src = image;
}

const AMAZON_LINK = /^https?:\/\/(a\.co|amzn\.[a-z]+|([^/]+\.)?amazon\.[a-z.]+)\//i;

// Asks microlink.io (a free link-preview service, a few lookups a day per internet connection)
// for an Amazon product's name, price and picture. Answers {} when it can't.
async function previewService(url) {
    const query = new URLSearchParams({
        url,
        'data.price.selector': '#corePrice_feature_div .a-offscreen', 'data.price.type': 'text',
        'data.price2.selector': '.a-price .a-offscreen', 'data.price2.type': 'text',
        'data.picture.selector': '#landingImage', 'data.picture.attr': 'data-old-hires',
        'data.picture2.selector': '#landingImage', 'data.picture2.attr': 'src',
    });
    try {
        const { status, data = {} } = await (await fetch('https://api.microlink.io/?' + query)).json();
        if (status !== 'success') return {};
        const found = {};
        const name = String(data.title || '').trim();
        if (name && !/^amazon(\.[a-z.]+)?$/i.test(name)) found.name = name;
        const price = priceNumber(data.price || data.price2);
        if (price) found.price = price.toFixed(2);
        const picture = safeLink(data.picture) || safeLink(data.picture2);
        if (picture) found.image = picture;
        return found;
    } catch {
        return {};
    }
}

async function fillFromLink(auto) {
    fixLink($('f-url'));
    const url = safeLink($('f-url').value);
    if (!url) {
        if (!auto) $('fill-status').textContent = 'Paste the product link first.';
        return;
    }
    if (DEMO) {
        $('fill-status').textContent = 'Fill in from link works once the page is connected to its Google Sheet.';
        return;
    }
    $('fill-status').textContent = 'Looking at the store page…';
    try {
        const preview = await working($('fill'), 'Looking…', async () => {
            const { preview: fromSheet = {} } = await send('preview', { url });
            // Amazon turns the sheet's script away, so ask a link-preview service for what it couldn't get.
            const amazon = fromSheet.amazon || AMAZON_LINK.test(url);
            if (!amazon || (fromSheet.name && !fromSheet.nameGuessed && fromSheet.price)) return fromSheet;
            const fromService = await previewService(fromSheet.link || url);
            return { ...fromSheet, ...fromService, nameGuessed: fromSheet.nameGuessed && !fromService.name };
        });
        if ($('f-url').value.trim() !== url) return; // the link changed while we looked
        const found = ['name', 'image', 'price', 'store'].filter(f => preview[f]);
        const filled = found.filter(f => !$(FIELDS[f]).value.trim());
        filled.forEach(f => { $(FIELDS[f]).value = preview[f]; });
        showPicture();
        $('fill-status').textContent =
            filled.length ? `Filled in the ${filled.map(f => (f === 'image' ? 'picture' : f)).join(', ')} from the store page. Check it over.` +
                (filled.includes('name') && preview.nameGuessed ? " The store didn't share the name, so it's a guess from the link." : '')
            : found.length ? 'Nothing new to fill in (only empty boxes get filled).'
            : "That store didn't share its details, so fill them in by hand.";
    } catch (err) {
        if (err.code === 'wrong-passcode' || err.code === 'not-admin') {
            $('item-dialog').close();
            return handleError(err);
        }
        $('fill-status').textContent = "Couldn't read that link, so fill the details in by hand.";
    }
}

$('fill').addEventListener('click', () => fillFromLink(false));
$('f-url').addEventListener('change', () => { if (!$('f-name').value.trim()) fillFromLink(true); });
$('f-url').addEventListener('blur', () => fixLink($('f-url')));
$('f-image').addEventListener('blur', () => fixLink($('f-image')));
$('f-image').addEventListener('input', showPicture);
$('f-preview').addEventListener('error', () => { $('f-preview').hidden = true; });

$('item-form').addEventListener('submit', async e => {
    e.preventDefault();
    fixLink($('f-url'));
    fixLink($('f-image'));
    const item = { id: editing.id || '' };
    for (const [field, id] of Object.entries(FIELDS)) item[field] = $(id).value.trim();
    for (const [field, label] of [['url', 'link'], ['image', 'picture address']]) {
        if (item[field] && !safeLink(item[field])) return showError('item-error', `The ${label} needs to start with https://`);
    }
    try {
        await working(e.submitter || $('item-form').querySelector('[type=submit]'), 'Saving…', () => send('save', { item }));
    } catch (err) {
        if (err.code === 'wrong-passcode' || err.code === 'not-admin') {
            $('item-dialog').close();
            return handleError(err);
        }
        return showError('item-error', err.code === 'network' ? "Couldn't reach the list. Check your connection and try again." : err.message);
    }
    $('item-dialog').close();
    render();
    toast(editing.id ? 'Saved.' : 'Added to the list.');
});

$('delete').addEventListener('click', async () => {
    if (!await confirmBox(`Delete “${editing.name}” from the list?`, 'Delete')) return;
    try {
        await working($('delete'), 'Deleting…', () => send('delete', { id: editing.id }));
    } catch (err) {
        if (err.code === 'wrong-passcode' || err.code === 'not-admin') {
            $('item-dialog').close();
            return handleError(err);
        }
        return showError('item-error', err.code === 'network' ? "Couldn't reach the list. Try again." : err.message);
    }
    $('item-dialog').close();
    render();
    toast('Deleted.');
});

$('add').addEventListener('click', () => openItem(null));

// ---- Admin (sign in with the admin passcode) ----

let adminInfo = null; // from the sheet: linkKey, hasAdminPasscode, deleted, log

function takeAdminInfo(info) {
    adminInfo = info;
    if (info) keepLinkKey(info.linkKey);
}

const ACTIVITY = {
    added: w => `added “${w}”`,
    changed: w => `changed “${w}”`,
    deleted: w => `deleted “${w}”`,
    claimed: w => `is getting “${w}”`,
    unclaimed: w => `marked “${w}” as available again`,
    restored: w => `brought back “${w}”`,
    'removed-taken': n => `cleared ${plural(Number(n), 'wish')} people got`,
    'family-passcode': () => 'changed the family passcode',
    'new-link': () => 'made a new family link',
    'admin-passcode': () => 'set the admin passcode',
    'category-added': c => `added the category “${c}”`,
    'category-renamed': c => `renamed the category “${c.split(' → ')[0]}” to “${c.split(' → ').slice(1).join(' → ')}”`,
    'category-deleted': c => `deleted the category “${c}”`,
};
const SPOILERS = ['claimed', 'unclaimed'];

function renderAdmin() {
    const info = adminInfo;
    $('admin-loading').hidden = !!info;
    document.querySelectorAll('#admin-dialog .admin-section').forEach(s => { s.hidden = !info; });
    if (!info) return;

    $('family-link').textContent = familyLink();

    $('admin-pass-status').textContent = info.hasAdminPasscode
        ? 'Keep this one to yourself. Type a new one here to change it.'
        : 'There is no admin passcode yet, so Admin signs in with the old family passcode, which the family knows. Set one that only you know.';
    $('set-admin-pass').textContent = info.hasAdminPasscode ? 'Change' : 'Set';

    renderCategoryAdmin();

    $('deleted-list').replaceChildren(...(info.deleted.length ? info.deleted.map(d => h('div', { class: 'admin-row' },
        h('div', { class: 'what' }, d.name, h('div', { class: 'when' }, `Deleted ${dateTimeText(d.deleted)} by ${d.deletedBy || 'someone'}`)),
        h('button', { class: 'btn', type: 'button', onclick: e => adminDo(e.currentTarget, 'Restoring…', 'restore', { id: d.id },
            () => toast(`“${d.name}” is back on the list.`)) }, 'Restore')))
        : [h('div', { class: 'none' }, 'Nothing has been deleted lately.')]));

    const taken = items.filter(i => i.claimedBy).length;
    $('remove-taken').textContent = noSpoilers ? 'Clear the wishes people got' : `Clear the ${plural(taken, 'wish')} people got`;
    $('remove-taken').disabled = !noSpoilers && !taken;

    const log = info.log.filter(l => !noSpoilers || !SPOILERS.includes(l.action));
    $('log-note').textContent = noSpoilers ? "No-spoiler mode is on, so who's getting what is left out." : '';
    $('log-list').replaceChildren(...(log.length ? log.map(l => h('div', { class: 'admin-row' },
        h('div', { class: 'what' }, `${l.who} ${(ACTIVITY[l.action] || (() => l.action))(l.wish)}`),
        h('div', { class: 'when' }, dateTimeText(l.when))))
        : [h('div', { class: 'none' }, 'Nothing yet.')]));
}

let renaming = null; // the category being renamed in the Admin panel

function renderCategoryAdmin() {
    const count = name => items.filter(i => i.category === name).length;
    const row = name => renaming === name
        ? h('div', { class: 'admin-row' },
            h('input', { type: 'text', class: 'rename', value: name, maxlength: '40', 'aria-label': `New name for ${name}`,
                onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); e.target.parentNode.querySelector('.primary').click(); } } }),
            h('button', { class: 'btn primary', type: 'button', onclick: e => {
                const to = e.currentTarget.parentNode.querySelector('input').value.trim();
                if (to === name) { renaming = null; return renderAdmin(); }
                adminDo(e.currentTarget, 'Saving…', 'rename-category', { from: name, to }, () => {
                    renaming = null;
                    renderAdmin();
                    toast(`Renamed to “${to}”.`);
                });
            } }, 'Save'),
            h('button', { class: 'btn', type: 'button', onclick: () => { renaming = null; renderAdmin(); } }, 'Cancel'))
        : h('div', { class: 'admin-row' },
            h('div', { class: 'what' }, name, h('div', { class: 'when' }, plural(count(name), 'wish'))),
            h('button', { class: 'btn', type: 'button', onclick: () => {
                renaming = name;
                renderAdmin();
                document.querySelector('#category-list .rename').select();
            } }, 'Rename'),
            h('button', { class: 'btn danger', type: 'button', onclick: e => deleteCategory(name, e.currentTarget) }, 'Delete'));
    $('category-list').replaceChildren(...(categories.length ? categories.map(row) : [h('div', { class: 'none' }, 'No categories yet.')]));
}

async function deleteCategory(name, button) {
    const n = items.filter(i => i.category === name).length;
    const question = `Delete the category “${name}”?` + (n ? ` Its ${plural(n, 'wish')} will have no category.` : '');
    if (!await confirmBox(question, 'Delete')) return;
    adminDo(button, 'Deleting…', 'delete-category', { name }, () => toast(`Deleted the category “${name}”.`));
}

$('add-category').addEventListener('click', e => {
    const name = $('new-category').value.trim();
    if (!name) return showError('admin-error', 'Type the new category first.');
    adminDo(e.currentTarget, 'Adding…', 'add-category', { name }, () => {
        $('new-category').value = '';
        toast(`Added the category “${name}”.`);
    });
});
$('new-category').addEventListener('keydown', e => {
    if (e.key === 'Enter') {
        e.preventDefault();
        $('add-category').click();
    }
});

// A wrong passcode (or not being Admin) goes back to signing in; anything else shows in the panel.
function adminFailed(err) {
    if (err.code === 'wrong-passcode' || err.code === 'not-admin') {
        $('admin-dialog').close();
        handleError(err);
        return;
    }
    const message = err.code === 'network' ? "Couldn't reach the list. Check your connection and try again." : err.message;
    showError('admin-error', message);
    toast(message); // the panel's error box can be scrolled out of sight
}

async function openAdmin() {
    adminInfo = null;
    renaming = null;
    renderAdmin();
    $('new-admin-pass').value = '';
    showError('admin-error', '');
    $('admin-dialog').showModal();
    try {
        takeAdminInfo((await send('admin-info')).adminInfo);
        renderAdmin();
    } catch (err) {
        adminFailed(err);
    }
}

async function adminDo(button, label, action, data, done) {
    showError('admin-error', '');
    try {
        const out = await working(button, label, () => send(action, data));
        takeAdminInfo(out.adminInfo);
        render();
        renderAdmin();
        done();
    } catch (err) {
        adminFailed(err);
    }
}

$('admin-btn').addEventListener('click', openAdmin);
$('admin-form').addEventListener('submit', e => e.preventDefault());

$('copy-link').addEventListener('click', async () => {
    try {
        await navigator.clipboard.writeText(familyLink());
        toast('Link copied. Send it to the family.');
    } catch {
        toast(familyLink());
    }
});

$('new-link').addEventListener('click', async e => {
    const button = e.currentTarget;
    if (!await confirmBox('Make a new family link? The old link stops working right away, so send the new one to everyone.', 'Make a new link')) return;
    adminDo(button, 'Making…', 'new-link', {}, () => toast('New link made. Copy it and send it to the family.'));
});

$('set-admin-pass').addEventListener('click', e => {
    const newPasscode = $('new-admin-pass').value.trim();
    if (!newPasscode) return showError('admin-error', 'Type the admin passcode first.');
    adminDo(e.currentTarget, 'Saving…', 'set-admin-passcode', { newPasscode }, () => {
        session.adminPasscode = newPasscode;
        saved.set('wish-admin-pass', newPasscode);
        $('new-admin-pass').value = '';
        toast('Admin passcode set. Use it to sign in as Admin from now on.');
    });
});

$('remove-taken').addEventListener('click', async e => {
    const button = e.currentTarget;
    const taken = items.filter(i => i.claimedBy).length;
    const question = noSpoilers ? 'Clear every wish someone is getting off the list?' : `Clear the ${plural(taken, 'wish')} people got off the list?`;
    if (!await confirmBox(`${question} You can bring any of them back from Recently deleted.`, 'Clear them')) return;
    adminDo(button, 'Clearing…', 'remove-taken', {}, () => toast("Cleared. They're in Recently deleted."));
});

// ---- Everything else ----

document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => b.closest('dialog').close()));

$('sort').addEventListener('change', () => { saved.set('wish-sort', $('sort').value); render(); });
$('show').addEventListener('change', render);
$('category').addEventListener('change', () => {
    categoryFilter = $('category').value;
    saved.set('wish-category', categoryFilter);
    render();
});

$('spoilers').addEventListener('click', () => {
    noSpoilers = !noSpoilers;
    if (noSpoilers) saved.set('wish-no-spoilers', '1'); else saved.remove('wish-no-spoilers');
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
});

$('share').addEventListener('click', async () => {
    const url = session.key ? familyLink() : location.href.split('#')[0];
    if (navigator.share) {
        try { await navigator.share({ title: document.title, url }); } catch { /* closed the share sheet */ }
        return;
    }
    try {
        await navigator.clipboard.writeText(url);
        toast('Link copied. Paste it anywhere to share the list.');
    } catch {
        toast(url);
    }
});

// Only the family link (or Admin) gets the list.
async function load() {
    if (locked()) return render();
    if (!items.length) $('status').textContent = 'Loading the list…';
    try {
        await send('list'); // send() keeps the list it answers with
        $('status').textContent = '';
    } catch (err) {
        $('status').textContent = '';
        if (err.code !== 'network') return handleError(err); // e.g. a new family link was made
        $('status').replaceChildren("Couldn't load the list. ", h('button', { class: 'link-btn', type: 'button', onclick: load }, 'Try again'));
    }
    render();
}

// Someone else may have claimed something while this tab sat in the background.
document.addEventListener('visibilitychange', () => {
    if (!document.hidden && Date.now() - loadedAt > 60000) load();
});

if (['low', 'high', 'new'].includes(saved.get('wish-sort'))) $('sort').value = saved.get('wish-sort');
$('sheet-link').href = SHEET_URL;
$('demo-banner').hidden = !DEMO;
render();
load();
