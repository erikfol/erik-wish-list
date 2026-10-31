// Erik's Wish List. The list lives in a Google Sheet behind apps-script/Code.gs: anyone can
// read it, and every change needs the family passcode. With no SCRIPT_URL it's a demo kept in this browser.
import { SCRIPT_URL } from './config.js';

const OWNER = 'Erik';
const PRIORITY = { 3: 'Top pick', 2: 'Would love', 1: 'Nice to have' };
const DEMO = !SCRIPT_URL;

const $ = id => document.getElementById(id);

// localStorage can be blocked (private windows); the page still works without it.
const saved = {
    get(key) { try { return localStorage.getItem(key); } catch { return null; } },
    set(key, value) { try { localStorage.setItem(key, value); } catch { /* not kept */ } },
    remove(key) { try { localStorage.removeItem(key); } catch { /* nothing kept */ } },
};

let items = [];
let loadedAt = 0;
let session = { passcode: saved.get('wish-passcode') || '', name: saved.get('wish-name') || '' };
let noSpoilers = saved.get('wish-no-spoilers') === '1';
let editing = null;      // the wish open in the edit dialog ({} for a new one)
let afterSignIn = null;  // what to do once signed in (claiming a wish starts there)

class ApiError extends Error {
    constructor(code, extra = {}) {
        super(extra.message || code);
        this.code = code;
        this.claimedBy = extra.claimedBy;
    }
}

// ---- Talking to the sheet ----

async function fetchItems() {
    if (DEMO) return demo.items();
    const res = await fetch(SCRIPT_URL);
    if (!res.ok) throw new ApiError('network');
    return (await res.json()).items || [];
}

// Sends a change along with the passcode. After a change the answer carries the whole list.
async function send(action, data = {}) {
    const body = { action, passcode: session.passcode, who: session.name, ...data };
    const out = DEMO ? demo.send(body) : await post(body);
    if (out.items) setItems(out.items);
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
    items = list.map(i => ({ ...i, priority: PRIORITY[i.priority] ? Number(i.priority) : 2 }));
    loadedAt = Date.now();
}

// ---- Demo mode: the same answers as Code.gs, kept in this browser ----

const SAMPLES = [
    { id: 's1', name: 'Wool hiking socks (3-pack)', url: '', image: '', price: '24.99', store: 'REI', priority: 3,
      details: 'Size L. Gray or green.', addedBy: 'Erik', added: '2026-10-30T12:00:00Z', claimedBy: '', claimed: '' },
    { id: 's2', name: '12" cast iron skillet', url: '', image: '', price: '39.90', store: 'Amazon', priority: 2,
      details: '', addedBy: 'Erik', added: '2026-10-29T12:00:00Z', claimedBy: 'Mom', claimed: '2026-10-30T15:00:00Z' },
    { id: 's3', name: 'A good book (surprise me!)', url: '', image: '', price: '', store: '', priority: 1,
      details: 'Mysteries or history.', addedBy: 'Erik', added: '2026-10-28T12:00:00Z', claimedBy: '', claimed: '' },
];

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
            case 'check': return { ok: true };
            case 'preview': return { preview: {} };
            case 'save': {
                const { name, url, image, price, store, priority, details } = req.item;
                const values = { name, url, image, price, store, priority, details };
                if (item) Object.assign(item, values);
                else if (req.item.id) return { error: 'failed', message: 'That wish was removed' };
                else list.push({ ...values, id: String(Date.now()), addedBy: req.who, added: now, claimedBy: '', claimed: '' });
                break;
            }
            case 'delete': if (item) list.splice(list.indexOf(item), 1); break;
            case 'claim':
                if (!item) return { error: 'failed', message: 'That wish was removed' };
                if (item.claimedBy && item.claimedBy !== req.who) return { error: 'already-claimed', claimedBy: item.claimedBy, items: list };
                Object.assign(item, { claimedBy: req.who || 'Someone', claimed: now });
                break;
            case 'unclaim': if (item) Object.assign(item, { claimedBy: '', claimed: '' }); break;
        }
        saved.set('wish-demo-items', JSON.stringify(list));
        return { ok: true, items: list };
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
    if (err.code === 'wrong-passcode') {
        signOut();
        openSignIn(null, `That passcode didn't work. It may have changed, so ask ${OWNER} for the new one.`);
    } else if (err.code === 'already-claimed') {
        toast(`${err.claimedBy} is already getting that one.`);
    } else if (err.code === 'no-passcode-set') {
        toast('The sheet has no PASSCODE set up yet (README → Setup).');
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
        priority: (a, b) => b.priority - a.priority || newer(a, b),
        low: (a, b) => price(a, 1e12) - price(b, 1e12) || newer(a, b),
        high: (a, b) => price(b, -1) - price(a, -1) || newer(a, b),
        new: newer,
    }[$('sort').value];
    return items
        .filter(i => show === 'all' || (show === 'open') === !i.claimedBy)
        // What's still available comes first, unless that would give away what's taken.
        .sort((a, b) => (noSpoilers ? 0 : !!a.claimedBy - !!b.claimedBy) || order(a, b));
}

function render() {
    const signedIn = !!session.passcode;
    $('signin').textContent = signedIn ? 'Sign out' : '🔒 Family sign-in';
    $('who').hidden = !signedIn;
    $('who').textContent = `Hi, ${session.name}`;
    $('add').hidden = !signedIn;
    $('show-wrap').hidden = noSpoilers;

    const open = items.filter(i => !i.claimedBy).length;
    $('summary').textContent = !items.length ? '' :
        noSpoilers ? plural(items.length, 'wish') : `${plural(items.length, 'wish')} · ${open} still available`;
    $('how').textContent = noSpoilers
        ? "No-spoiler mode is on, so this device doesn't show what people are getting."
        : signedIn
            ? "Getting something? Tap “I'll get this” on it so nobody else buys it too."
            : `Found something you'd like to get ${OWNER}? Tap “I'll get this” and sign in with the family passcode, so nobody doubles up.`;

    $('spoiler-text').textContent = noSpoilers ? '🙈 No-spoiler mode is on for this device. ' : `${OWNER}? `;
    $('spoilers').textContent = noSpoilers ? 'Show what people are getting' : "Turn on no-spoiler mode so you can't see what people are getting";

    const list = visibleItems();
    $('list').replaceChildren(...(list.length ? list.map(card) : [emptyState()]));
}

function emptyState() {
    if (!loadedAt) return h('div', { hidden: true });
    if (items.length) return h('div', { class: 'empty' }, 'Nothing to show with this filter.');
    return h('div', { class: 'empty' },
        h('div', { class: 'big' }, '🎁'),
        h('p', {}, 'No wishes on the list yet.'),
        h('p', {}, session.passcode ? 'Tap “＋ Add a wish” to start it.' : 'Check back soon!'));
}

function noPic() {
    return h('div', { class: 'no-pic' }, '🎁');
}

function card(item) {
    const signedIn = !!session.passcode;
    const taken = !noSpoilers && !!item.claimedBy;
    const url = safeLink(item.url);
    const image = safeLink(item.image);

    const pic = image
        ? h('img', { src: image, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer', onerror: e => e.target.replaceWith(noPic()) })
        : noPic();
    const picBox = url
        ? h('a', { class: 'pic', href: url, target: '_blank', rel: 'noopener noreferrer', tabindex: '-1' }, pic)
        : h('div', { class: 'pic' }, pic);
    picBox.append(h('span', { class: `badge p${item.priority}` }, PRIORITY[item.priority]));

    const meta = [item.price && h('span', { class: 'price' }, priceText(item.price)), item.store]
        .filter(Boolean)
        .flatMap((part, i) => (i ? [' · ', part] : [part]));

    let note = null;
    if (taken) {
        const who = !signedIn ? 'Someone is' : item.claimedBy === session.name ? "You're" : `${item.claimedBy} is`;
        note = h('div', { class: 'taken-note' }, `🎁 ${who} getting this`);
    }

    let claimButton = null;
    if (!noSpoilers) {
        claimButton = item.claimedBy
            ? signedIn && h('button', { class: 'btn', type: 'button', onclick: e => unclaim(item, e.currentTarget) }, 'Undo')
            : h('button', { class: 'btn claim', type: 'button', onclick: e => claim(item, e.currentTarget) }, "🎁 I'll get this");
    }

    return h('article', { class: taken ? 'card taken' : 'card' },
        picBox,
        h('div', { class: 'card-body' },
            h('h3', {}, url ? h('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, item.name) : item.name),
            meta.length > 0 && h('div', { class: 'meta' }, meta),
            item.details && h('p', { class: 'details' }, item.details),
            note,
            dateText(item.added) && h('div', { class: 'added' }, `Added ${dateText(item.added)}`),
            h('div', { class: 'actions' },
                url && h('a', { class: 'btn', href: url, target: '_blank', rel: 'noopener noreferrer' }, 'View it ↗'),
                claimButton,
                signedIn && h('button', { class: 'btn', type: 'button', title: 'Change or delete this wish', onclick: () => openItem(item) }, '✎ Edit'))));
}

// ---- Claiming ----

async function claim(item, button) {
    if (!session.passcode) return openSignIn(() => claim(item, button));
    try {
        await working(button, 'Saving…', () => send('claim', { id: item.id }));
        render();
        toast(`Thanks, ${session.name}! It's marked as yours.`);
    } catch (err) {
        handleError(err);
    }
}

async function unclaim(item, button) {
    if (item.claimedBy !== session.name &&
        !await confirmBox(`${item.claimedBy} said they're getting “${item.name}”. Mark it as available again?`, 'Mark available')) return;
    try {
        await working(button, 'Saving…', () => send('unclaim', { id: item.id }));
        render();
        toast('Marked as available again.');
    } catch (err) {
        handleError(err);
    }
}

// ---- Signing in ----

function openSignIn(then, message) {
    afterSignIn = then || null;
    $('passcode').value = '';
    $('name').value = session.name;
    showError('signin-error', message);
    $('signin-dialog').showModal();
    (session.name ? $('passcode') : $('name')).focus();
}

function signOut() {
    session = { passcode: '', name: session.name };
    saved.remove('wish-passcode');
    render();
}

$('signin-form').addEventListener('submit', async e => {
    e.preventDefault();
    const next = { passcode: $('passcode').value.trim(), name: $('name').value.trim() };
    const before = session;
    session = next;
    try {
        await working(e.submitter || $('signin-form').querySelector('[type=submit]'), 'Checking…', () => send('check'));
    } catch (err) {
        session = before;
        showError('signin-error',
            err.code === 'wrong-passcode' ? `That passcode isn't right. Ask ${OWNER} for it.`
            : err.code === 'no-passcode-set' ? 'The sheet has no PASSCODE set up yet (README → Setup).'
            : "Couldn't reach the list. Check your connection and try again.");
        return;
    }
    saved.set('wish-passcode', next.passcode);
    saved.set('wish-name', next.name);
    $('signin-dialog').close();
    render();
    toast(`Signed in. Hi, ${next.name}!`);
    const then = afterSignIn;
    afterSignIn = null;
    if (then) then();
});

$('signin').addEventListener('click', () => {
    if (session.passcode) {
        signOut();
        toast('Signed out on this device.');
    } else {
        openSignIn();
    }
});

// ---- Adding and changing wishes ----

const FIELDS = { name: 'f-name', url: 'f-url', image: 'f-image', price: 'f-price', store: 'f-store', priority: 'f-priority', details: 'f-details' };

function openItem(item) {
    editing = item || {};
    $('item-title').textContent = item ? 'Change this wish' : 'Add a wish';
    for (const [field, id] of Object.entries(FIELDS)) $(id).value = editing[field] ?? '';
    $('f-priority').value = String(editing.priority || 2);
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
        const { preview = {} } = await working($('fill'), 'Looking…', () => send('preview', { url }));
        if ($('f-url').value.trim() !== url) return; // the link changed while we looked
        const found = ['name', 'image', 'price', 'store'].filter(f => preview[f]);
        const filled = found.filter(f => !$(FIELDS[f]).value.trim());
        filled.forEach(f => { $(FIELDS[f]).value = preview[f]; });
        showPicture();
        $('fill-status').textContent =
            filled.length ? `Filled in the ${filled.join(', ')} from the store page. Check it over.`
            : found.length ? 'Nothing new to fill in (only empty boxes get filled).'
            : "That store didn't share its details, so fill them in by hand.";
    } catch (err) {
        if (err.code === 'wrong-passcode') {
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
    item.priority = Number(item.priority);
    for (const [field, label] of [['url', 'link'], ['image', 'picture address']]) {
        if (item[field] && !safeLink(item[field])) return showError('item-error', `The ${label} needs to start with https://`);
    }
    try {
        await working(e.submitter || $('item-form').querySelector('[type=submit]'), 'Saving…', () => send('save', { item }));
    } catch (err) {
        if (err.code === 'wrong-passcode') {
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
        if (err.code === 'wrong-passcode') {
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

// ---- Everything else ----

document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => b.closest('dialog').close()));

$('sort').addEventListener('change', () => { saved.set('wish-sort', $('sort').value); render(); });
$('show').addEventListener('change', render);

$('spoilers').addEventListener('click', () => {
    noSpoilers = !noSpoilers;
    if (noSpoilers) saved.set('wish-no-spoilers', '1'); else saved.remove('wish-no-spoilers');
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
});

$('share').addEventListener('click', async () => {
    const url = location.href.split('#')[0];
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

async function load() {
    if (!items.length) $('status').textContent = 'Loading the list…';
    try {
        setItems(await fetchItems());
        $('status').textContent = '';
    } catch {
        $('status').replaceChildren("Couldn't load the list. ", h('button', { class: 'link-btn', type: 'button', onclick: load }, 'Try again'));
    }
    render();
}

// Someone else may have claimed something while this tab sat in the background.
document.addEventListener('visibilitychange', () => {
    if (!document.hidden && Date.now() - loadedAt > 60000) load();
});

if (['priority', 'low', 'high', 'new'].includes(saved.get('wish-sort'))) $('sort').value = saved.get('wish-sort');
$('demo-banner').hidden = !DEMO;
render();
load();
