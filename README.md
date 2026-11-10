# Erik's Wish List

A shareable wish list, titled **Erik's Christmas List** on the page, at **https://erikfol.github.io/erik-wish-list/** (once GitHub Pages is on, see Setup).

Each wish has a picture, a link to the product, the price, the store, how much Erik wants it (Top pick, Would love, Nice to have), a category (or none) and details like size or color. Friends and family tap **🎁 I'll get this** on what they're buying, so nobody doubles up.

- **The family link opens the list.** It looks like `https://erikfol.github.io/erik-wish-list/?k=7f3a9c21b4e0`: the `?k=…` part is a random key the Google script makes and checks. Nobody signs in. Anyone who opens the plain address without the key sees only a message asking for the family link, and the script won't hand over the list without the key, so the wishes can't be read by digging into the page or this repo either. Once a device has opened the family link it remembers the key.
- **Claiming a gift:** tap **🎁 I'll get this**, type your name and tap **Mark it as mine**. The page remembers the name on that device for next time. Names are up to 30 characters, and "mom" and "Mom" count as the same person. Anyone can tap **Undo** on a claim; if it's under someone else's name, the page asks first.
- **Fill in from link**: paste a product link and the page tries to fill in the name, picture and price from the store's page. Amazon turns away Google's servers, so for Amazon links (share links like `a.co/d/…` and `amzn.to/…` too) the picture comes from the product's ID and the page asks [microlink.io](https://microlink.io), a free link-preview service, for the name, price and a bigger picture. It allows about 5 lookups a day per internet connection; past that, the name is guessed from the link and the price is left for you. Other stores that block it, you fill in by hand. For the picture, right-click (or press and hold) the product's photo, choose "Copy image address", and paste it into the Picture box.
- **Category filter**: next to Sort and Show, pick a category (or No category) to see only those wishes. Each shows how many wishes are in it.
- **No-spoiler mode** (link at the bottom of the page) hides what people are getting, on that device only. It's meant for Erik.
- **Only Admin adds, changes and deletes wishes.** Tap **🔒 Admin** at the top and type the admin passcode, and **＋ Add a wish**, **✎ Edit** on each wish, and a **⚙ Admin** button appear (see below). Family members don't see them, and the Google script turns those changes away from anyone else.

## Admin

Tap **🔒 Admin** and type the admin passcode (`ADMIN_PASSCODE`). If no admin passcode has been set yet, the old family passcode (`PASSCODE`) works instead. Set one from the Admin panel, since the family knows the old one. Signed in as Admin you can add wishes (＋ Add a wish), change or delete them (✎ Edit), and use **Fill in from link**. **Sign out** at the top signs out of Admin only, and the list stays open on that device. The ⚙ Admin panel has:

- **📊 Open Google Sheets**: opens Google Sheets in a new tab (`SHEET_URL` in `docs/js/config.js`; put your sheet's own address there to open it directly).
- **Family link**: the link to send the family, with **Copy link**. **Make a new link** replaces the key if the link ends up somewhere it shouldn't. The old link stops working right away (anyone using it sees "That link doesn't work anymore"), so send the new one to everyone.
- **Admin passcode**: set it (or change it) so only you can sign in as Admin. After that, the old family passcode no longer works.
- **Categories**: add, rename and delete the categories wishes can go in. They start as Car, Tech and Tool, and live in the `Categories` tab of the sheet. Renaming one renames it on its wishes too; deleting one leaves its wishes with no category. Only Admin can change them.
- **Recently deleted**: every deleted wish goes here (the `Deleted` tab of the sheet). **Restore** puts it back on the list exactly as it was, including who's getting it.
- **After the occasion**: clears the wishes people got off the list in one go. They go to Recently deleted.
- **Recent activity**: who added, changed, deleted, restored or claimed what, and when (the `Log` tab, the newest 500). With no-spoiler mode on, claims are left out.

If you're ever locked out, open the sheet's Apps Script → Project Settings → Script Properties: `ADMIN_PASSCODE` is the admin passcode and `LINK_KEY` the family link's key (the part after `?k=`). `PASSCODE`, the old family passcode, only matters while there's no `ADMIN_PASSCODE`; once there is, you can delete it.

## How it works

`docs/` is a static page (HTML, CSS and JavaScript, no build step) served by GitHub Pages, the same way as erik-life-app. The list itself is kept in a Google Sheet. `apps-script/Code.gs` runs in that sheet as a small web app: it hands over the list, or records a claim, only when the request comes with the family link's key, and makes other changes only with the admin passcode. Both are kept in the script's settings in your Google account and are never in this repo.

Until `SCRIPT_URL` in `docs/js/config.js` is filled in, the page runs as a **demo**: a yellow banner says so, the list opens without a link, any passcode works for Admin, and changes are saved only in that browser.

## Setup (one time, about 10 minutes)

1. **Make the sheet.** Go to https://sheets.new and name it "Erik's Wish List".
2. **Add the script.** In the sheet, choose **Extensions → Apps Script**. Delete what's in the editor, paste all of `apps-script/Code.gs`, and click **Save**.
3. **Set the admin passcode.** In Apps Script, click **Project Settings** (the gear) → **Script Properties** → **Add script property**. Property: `ADMIN_PASSCODE`. Value: a passcode only you know. Three random words work well, e.g. `purple taco moose`. Capital letters and spaces at the ends don't matter when you type it. Click **Save script properties**.
4. **Publish the script.** Click **Deploy → New deployment**, click the gear next to "Select type" and choose **Web app**, then set:
   - Execute as: **Me**
   - Who has access: **Anyone**

   Click **Deploy** and **Authorize access**. Google will warn that it "hasn't verified this app". That's expected for a script you wrote yourself: click **Advanced → Go to … (unsafe)** → **Allow**.
5. **Connect the page.** Copy the **Web app URL** (it ends in `/exec`) and paste it into `docs/js/config.js`:
   ```js
   export const SCRIPT_URL = 'https://script.google.com/macros/s/…/exec';
   ```
   The `Items` tab in the sheet is created the first time the list is opened.
6. **Turn on GitHub Pages.** Commit and push, then on GitHub open the repo's **Settings → Pages** and set Source to **Deploy from a branch**, Branch **main**, folder **/docs**. The site appears at https://erikfol.github.io/erik-wish-list/ a minute or two later.
7. **Share it.** Open the page, tap **🔒 Admin**, sign in with the admin passcode, then open **⚙ Admin → Family link → Copy link** and send that link to family and friends. The script makes the link's key the first time you sign in as Admin.

## Day to day

- **Replace the family link** (for example, if it got passed around too far): sign in as Admin and use ⚙ Admin → Family link → Make a new link. The old link stops working right away.
- **Edit in the sheet:** the `Items` tab is the list, and the page shows any changes made there. `priority` is 3 (Top pick), 2 (Would love) or 1 (Nice to have), and `category` is one of the names in the `Categories` tab (blank for none). Keep the header row; the columns can be in any order.
- **After changing `Code.gs`:** paste it into Apps Script again, then **Deploy → Manage deployments → ✎ (Edit) → Version: New version → Deploy**. This keeps the same URL.
- **Good to know:** everyone with the family link sees the whole list, including who's getting what (unless they turn on no-spoiler mode), and can claim or undo a claim under any name. The Recent activity log shows who did what.

## Try it on this computer

```
python -m http.server 8000 -d docs
```

Then open http://localhost:8000.
