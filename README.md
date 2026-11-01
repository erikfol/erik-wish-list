# Erik's Wish List

A shareable wish list, titled **Erik's Christmas List** on the page, at **https://erikfol.github.io/erik-wish-list/** (once GitHub Pages is on, see Setup).

Each wish has a picture, a link to the product, the price, the store, how much Erik wants it (Top pick, Would love, Nice to have), a category (or none) and details like size or color. Friends and family tap **🎁 I'll get this** on what they're buying, so nobody doubles up.

- **Only people who are signed in can see the list.** Anyone else who opens the link sees only a message asking them to sign in. The Google script won't hand over the list without the passcode, so the wishes can't be read by digging into the page either.
- **Signing in needs the family passcode.** Family members can then see the list and mark what they're getting. The passcode is checked by Google, not by the web page, so it can't be found by looking at the page's code. Each person signs in once per device: they pick their name from the list and type the passcode. The names are in `NAMES` in `docs/js/config.js`; add or remove names there. Everyone choosing **Guest** shares that one name, so one Guest can undo another Guest's "I'll get this" without being asked.
- **Fill in from link**: paste a product link and the page tries to fill in the name, picture and price from the store's page. Amazon turns away Google's servers, so for Amazon links (share links like `a.co/d/…` and `amzn.to/…` too) the picture comes from the product's ID and the page asks [microlink.io](https://microlink.io), a free link-preview service, for the name, price and a bigger picture. It allows about 5 lookups a day per internet connection; past that, the name is guessed from the link and the price is left for you. Other stores that block it, you fill in by hand. For the picture, right-click (or press and hold) the product's photo, choose "Copy image address", and paste it into the Picture box.
- **Category filter**: next to Sort and Show, pick a category (or No category) to see only those wishes. Each shows how many wishes are in it.
- **No-spoiler mode** (link at the bottom of the page) hides what people are getting, on that device only. It's meant for Erik.
- **Only Admin adds, changes and deletes wishes.** Sign in as **Admin** (it's in the name list) and **＋ Add a wish**, **✎ Edit** on each wish, and a **⚙ Admin** button appear (see below). Family members don't see them, and the Google script turns those changes away from anyone else.

## Admin

Sign in as `Admin` (pick it from the name list). Until you set an admin passcode, Admin uses the family passcode, which means anyone who knows the family passcode can sign in as Admin. Setting an admin passcode fixes that. Signed in as Admin you can add wishes (＋ Add a wish), change or delete them (✎ Edit), and use **Fill in from link**. The ⚙ Admin panel has:

- **📊 Open Google Sheets**: opens Google Sheets in a new tab (`SHEET_URL` in `docs/js/config.js`; put your sheet's own address there to open it directly).
- **Family passcode**: see the current one, or change it. Anyone using the old one is asked for the new one the next time they try to change something.
- **Admin passcode**: set it (or change it) so only you can sign in as Admin. After that, the family passcode no longer works for the name Admin.
- **Categories**: add, rename and delete the categories wishes can go in. They start as Car, Tech and Tool, and live in the `Categories` tab of the sheet. Renaming one renames it on its wishes too; deleting one leaves its wishes with no category. Only Admin can change them.
- **Recently deleted**: every deleted wish goes here (the `Deleted` tab of the sheet). **Restore** puts it back on the list exactly as it was, including who's getting it.
- **After the occasion**: clears the wishes people got off the list in one go. They go to Recently deleted.
- **Recent activity**: who added, changed, deleted, restored or claimed what, and when (the `Log` tab, the newest 500). With no-spoiler mode on, claims are left out.

If you're ever locked out, open the sheet's Apps Script → Project Settings → Script Properties: `PASSCODE` is the family passcode and `ADMIN_PASSCODE` the admin one. Delete `ADMIN_PASSCODE` to go back to signing in as Admin with the family passcode.

## How it works

`docs/` is a static page (HTML, CSS and JavaScript, no build step) served by GitHub Pages, the same way as erik-life-app. The list itself is kept in a Google Sheet. `apps-script/Code.gs` runs in that sheet as a small web app: it hands over the list, or makes a change, only when the request comes with the right passcode. The passcode is kept in the script's settings in your Google account and is never in this repo.

Until `SCRIPT_URL` in `docs/js/config.js` is filled in, the page runs as a **demo**: a yellow banner says so, any passcode works, and changes are saved only in that browser.

## Setup (one time, about 10 minutes)

1. **Make the sheet.** Go to https://sheets.new and name it "Erik's Wish List".
2. **Add the script.** In the sheet, choose **Extensions → Apps Script**. Delete what's in the editor, paste all of `apps-script/Code.gs`, and click **Save**.
3. **Set the family passcode.** In Apps Script, click **Project Settings** (the gear) → **Script Properties** → **Add script property**. Property: `PASSCODE`. Value: your passcode. Three random words work well, e.g. `purple taco moose`. Capital letters and spaces at the ends don't matter when people type it. Click **Save script properties**.
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
7. **Share it.** Send the link to anyone. Send the passcode only to family and friends you want to be able to make changes.

## Day to day

- **Change the passcode** (for example, if it got passed around too far): sign in as Admin and use ⚙ Admin → Family passcode. It takes effect right away.
- **Edit in the sheet:** the `Items` tab is the list, and the page shows any changes made there. `priority` is 3 (Top pick), 2 (Would love) or 1 (Nice to have), and `category` is one of the names in the `Categories` tab (blank for none). Keep the header row; the columns can be in any order.
- **After changing `Code.gs`:** paste it into Apps Script again, then **Deploy → Manage deployments → ✎ (Edit) → Version: New version → Deploy**. This keeps the same URL.
- **Good to know:** everyone with the family passcode sees the whole list, including who's getting what (unless they turn on no-spoiler mode).

## Try it on this computer

```
python -m http.server 8000 -d docs
```

Then open http://localhost:8000.
