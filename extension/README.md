# Browser extension

The toolbar saves directly. The page in `popup/` is the extension's options
page, opened from the browser's extension management UI; no action popup is
registered. Both builds use the same TypeScript source and the same save API.

## Build and check

From the repository root, after the existing root dependencies are installed:

```powershell
npm run typecheck --prefix extension
npm run lint --prefix extension
npm test --prefix extension
npm run build --prefix extension
```

No additional dependencies or credentials are needed. The package uses the
TypeScript, ESLint and Vitest already installed in the parent repository. Its
build emits only browser code and static assets into `extension/dist/chrome`
and `extension/dist/firefox`; `server/`, `web/`, and tests are excluded.
The root web build does not import this browser entry point. The source
`manifest.json` is a template; load a **built** directory, not `extension/`.
The product name comes from `lib/constants.ts` at build time.

Chrome 121+ uses an ES module service worker; Firefox 140+ uses an ES module
event page. These are the browsers' respective Manifest V3 background
implementations. [Mozilla's background documentation](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background)
describes the difference.

## Load in Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode**, click **Load unpacked**, and select
   `C:\Users\LOQ\kuch bada\extension\dist\chrome`.
3. Open Chrome's puzzle-piece extensions menu and pin **Marrow**.
4. Right-click its toolbar icon → **Options** (or open its **Details** page
   in `chrome://extensions` → **Extension options**).
5. Follow **web app settings**, sign in normally, and generate a token on
   `/settings/extension`. Paste that token into the extension's **Extension
   token** field and click **Store token**. Close the options tab.
6. For a different shortcut, open `chrome://extensions/shortcuts`, find
   **Marrow → Save the current tab**, and assign a free shortcut.

After rebuilding, use the extension card's **Reload** button. Loading unpacked
extensions and pinning them follow [Chrome's official instructions](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked).

## Load in Firefox

1. Open `about:debugging` → **This Firefox** → **Load Temporary Add-on**.
2. Select `C:\Users\LOQ\kuch bada\extension\dist\firefox\manifest.json`.
3. Open the puzzle-piece extensions menu, find **Marrow**, and pin it to the
   toolbar using its menu. In `about:addons` → **Extensions** → **Marrow**,
   open **Preferences** (or its menu → **Preferences**) for the token form.
4. Follow **web app settings**, generate a token on `/settings/extension`,
   paste it into **Extension token**, and click **Store token**.
5. In the extension's **Permissions** tab, make sure access to
   `https://marrow-bice.vercel.app` is enabled if Firefox has withheld it.
6. To rebind, open `about:addons`, click the cogwheel menu, choose **Manage
   Extension Shortcuts**, and set **Save the current tab**.

Use **Reload** on `about:debugging` after rebuilding. Temporary add-ons are
removed on browser restart; load the same manifest again. A signed package is
needed for permanent installation. See [temporary installation](https://extensionworkshop.com/documentation/develop/temporary-installation-in-firefox/)
and [shortcut management](https://support.mozilla.org/en-US/kb/manage-extension-shortcuts-firefox).

## Verify the checklist in each browser

The backend migration and the Slice 6 API/settings deployment must be applied
first. A token is save-only; ordinary web-app sign-in remains separate.

1. **MV3 and permissions:** load the build as above and check the extension
   card for load errors. Inspect its generated `manifest.json`: version 3,
   only the four permissions listed below, and exactly one API host. Chrome
   uses `background.service_worker`; Firefox uses `background.scripts`.
2. **One-click save and visible success:** visit a public article that is not
   saved yet. Click the pinned toolbar icon once. No popup opens; the badge
   changes from `…` to green **OK**. Hover for **Saved to your inbox.** Refresh
   the web app's inbox and verify one row. “Fetching the article” is expected:
   extraction is on the existing daily cron and the list does not auto-refresh.
3. **Visible failure:** open `chrome://settings` or `about:config` and click
   the icon. It displays red **!** with an explanation on hover; no item is
   added. A server refusal also displays **!** without opening options.
4. **Context menu:** on any normal page, right-click an HTTP(S) link → **Save
   link to Marrow**. Verify that the link's destination is saved, not the
   containing page. Hover the badge to see the result.
5. **Shortcut:** on another article press **Alt+Shift+S**, or the shortcut
   you assigned. Verify the badge and inbox. Rebind it in the browser controls
   above, then use the new binding on an article.
6. **Token and local storage:** close and reopen extension options: it says
   **Connected** and the password field remains empty. Save with the web app
   signed out; it still works. Browser cookies are neither read nor sent.
   In the extension's developer tools, inspect **Extension Storage → local**
   (Chrome: **Application → Extension storage**) and confirm the `saveState`
   entry is there. Do not copy or share the stored credential. No
   `localStorage` is used.
7. **Re-save semantics, including the Slice 1 gotcha:** pick a ready article,
   add a favourite, tag and highlight, and note its reading position. Archive
   it. Open the source URL with a tracking parameter such as `utm_source=check`
   and click the extension. It displays green **HAVE**; the tooltip starts
   **Already saved**. Refresh the inbox: the same item is back, without a
   second row; the favourite, tags, highlight and reading position survive.
   Repeat after soft-deleting that item. A ready article stays ready; a pending
   or failed article is queued by the same server implementation as the web
   save path. No new client-side dedupe or upsert logic exists.
8. **Offline and restart recovery:** keep a public article open, turn off
   the computer's network, and click the icon. It changes to amber **Q**.
   Open options and check **1 pending saves**. Reload the extension using
   Chrome's card **Reload** or Firefox's `about:debugging` **Reload**. Restore
   the network and leave the browser open: retries happen automatically,
   initially after one minute, then with backoff up to fifteen minutes for
   repeated network failures; browser alarm delivery may be later. **OK** or
   **HAVE** replaces **Q**, and the inbox contains one item. Reload the options
   page to confirm zero pending saves. The queue holds up to 100 URLs and
   refuses further saves visibly instead of dropping them.
9. **Shared rate limit and CORS:** using a ready article avoids extraction.
   Save it repeatedly across both web and extension until the shared sixty
   accepted saves per rolling hour is reached (earlier saves in that hour
   count too). Both paths reject with HTTP 429 and `Retry-After`; the extension
   displays **Q**, preserves the save, and waits. In extension background
   developer tools' Network tab, inspect `POST /api/save`: bearer header,
   no cookie header, and response status 200 for re-save or 201 for new save.
   If the browser sends a preflight, it must succeed with the permitted origin
   and only POST/Authorization/Content-Type; extension-origin requests can
   bypass normal page preflights through the host permission. The automated
   route tests cover accepted and rejected CORS origins and save-only scope.
10. **Revocation and account safety:** revoke this token in web app settings.
    Click the extension on a public page: red **AUTH**, no save. Its local
    credential and pending saves are discarded. Create a new token, paste it
    in options and save successfully. Also queue a URL offline, then replace
    or remove the local token in options: pending count becomes zero. This
    prevents old queued browsing activity from being saved into another
    account. A request already sent before replacement may finish first.
11. **Independent build:** run the four extension scripts above and the root
    checks. Inspect `dist`: it contains only `manifest.json`, the five browser
    modules, generated product-name module and options HTML/CSS. Neither
    server code nor a server credential is packaged.

The browser and deployed checks above require a human's normal signed-in
session. Unit tests use injected fetch and time with no network. A passing
unit suite does not claim these live checks have been performed.

## Permission descriptions for store review

| Permission     | Why it is required                                                          |
| -------------- | --------------------------------------------------------------------------- |
| `activeTab`    | Read the current tab's URL only when the user invokes Save.                 |
| API origin     | Send the chosen URL and save-only token to the user's own save API.         |
| `storage`      | Keep the pasted token and pending offline saves in extension local storage. |
| `contextMenus` | Add the requested Save link command when the user right-clicks a link.      |
| `alarms`       | Wake a suspended background worker to retry durable offline saves.          |

There is no `<all_urls>`, `tabs`, `scripting`, `cookies`, `webRequest`,
notifications, content script or remote code permission. `chrome.storage.local`
is limited to trusted extension contexts where Chrome supports that control;
Firefox uses its equivalent `browser.storage.local` API. Data stays local until
the user saves: only the requested URL and token go to the fixed API origin.
The Firefox manifest declares authentication and browsing-activity transmission
as required by [Mozilla's manifest policy](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/browser_specific_settings).
There is no analytics or background browsing-history collection.
