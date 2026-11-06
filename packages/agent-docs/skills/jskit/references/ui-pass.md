<!-- Generated from `packages/agent-docs/site/guide/framework/ui-pass.md`. -->

# UI pass

A UI pass makes JSKIT UI exact Material 3 at one of three scopes: **the
changes** a task made (the default), **a section** of the app, or **the whole
app**. Read the complete [Material 3 rules](material-3.md) first; navigation
and Up come first there.

## Every scope

- **The same rules:** the [Material 3 rules](material-3.md), their exact sizes,
  `jskit check`, `jskit check m3`, and screenshots at 390, 768 and 1280 wide, in
  light and dark.
- **Navigation is must-fix at every scope:** fix every `nav/*` error inside the
  scope (declare parents, resolve links through JSKIT, delete back controls and
  back logic); never only report one. Plain `jskit check` must not end with a
  new error. Errors outside the scope, in an app not yet converted, are
  reported as must-fix findings.
- **Behavior otherwise stays exactly as it is:** no feature, field, action,
  permission, validation or data change. A defect, missing behavior or test gap
  you notice is a finding for the report, not a fix.
- **Exceptions:** take the [approved routes](material-3.md#exceptions) first.
  Add an `m3-check: allow` exception only after the person agreed to it, and
  list every exception the changes add, with its file, line and reason, in the
  report.
- **JSKIT first:** if JSKIT itself blocks an exact result, report the exact JSKIT
  change (package, file, what is missing). Never compensate with app CSS,
  `!important` or a copied package file.
- **Screenshots** come from the managed browser or a temporary Playwright spec.
  Keep them out of the repository (`test-results/` is ignored) and delete the
  temporary spec afterwards. With `defaultTheme: "system"`, `emulateMedia`
  selects the scheme:

```js
import { test } from "@playwright/test";

for (const scheme of ["light", "dark"]) {
  for (const width of [390, 768, 1280]) {
    test(`suppliers ${width} ${scheme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/home/suppliers");
      await page.screenshot({ path: `test-results/ui-pass/after/suppliers-${width}-${scheme}.png`, fullPage: true });
    });
  }
}
```

- **Look at every screenshot** before reporting. They are the only proof of
  what the checks cannot see: layout, spacing, contrast, overflow, clipped
  labels, borders where tones belong, colour that only works in one scheme, an
  Up arrow where it should not be or missing where it should.
- **Prove Up** on the screens in scope, with `shellBackButton(page)` and
  `pressShellBack(page)` from `@jskit-ai/shell-web/test/shellNavigation`:
  contact → supplier → Up shows the contact; a supplier opened from a pasted
  link → Up shows the Suppliers list; no arrow on main-menu pages; no "Back to
  X" anywhere.

## 1. The changes

The default, and what an automatic UI pass after a plan runs.

- **In scope:** every screen, component and style the task created or edited,
  plus the screens that render them. Explicit commits replace "the task's own
  changes" when they are named.
- **Method:**
  1. List the changed UI files and the screens that render them.
  2. Check each against the Material 3 rules and fix what is off, inside the
     changes only.
  3. Run `jskit check m3` on the changed UI files until it reports nothing,
     and plain `jskit check` until it passes.
  4. Take after screenshots of each affected screen, and look at them.
  5. Run the focused tests of the affected screens.
- **Report:** what was fixed; anything outside the changes that looks wrong, as
  findings only (not fixed; navigation ones marked must-fix); the check
  results; the screenshots; what is unverified.

Example: a task added a Delete button and a "Back to suppliers" link to the
supplier page. The pass replaces the button's `color="#d32f2f"` and
`variant="outlined"` with the error colour role, removes the link, declares the
page's parent (`/suppliers`), checks `src/pages/home/suppliers/[supplierId].vue`
clean, and shows the supplier at the six sizes. It reports, unfixed, that the
Contacts list scrolls sideways at 390.

## 2. A section

On request ("UI pass the Suppliers section").

- **In scope:** a named area: a module, a route subtree, a set of screens or a
  shared component family. Every screen in it, touched or not, so the section is
  consistent.
- **Method:**
  1. Inventory the section's screens and the components they render.
  2. Take before screenshots of each screen, with its empty, error and dialog
     states where they exist.
  3. Map each screen pattern to its Material 3 canonical layout (list-detail,
     supporting pane, feed) and components, in a table.
  4. Convert, navigation first: declare each inner page's parent, route every
     inner link through JSKIT navigation, delete back handlers and "Back to X"
     controls.
  5. Take after screenshots beside the before ones.
  6. Run `jskit check m3` on the section until it reports nothing.
  7. Delete the app CSS that is no longer needed.
  8. Change browser tests only where markup changed; every behavior assertion
     stays.
- **Report:** a before/after gallery, the mapping, the non-blank CSS lines
  (`<style>` blocks and CSS files) before and after, the check results, the
  Up proof and the test results.

Example: the Suppliers section has a list, a record, a new and an edit page.
The mapping reads: list as a list with filter chips and a FAB, list-detail on
expanded widths; record as a header with status chips and value-first lists;
new and edit as a form with Cancel and Save in the bar. The pass removes a
bordered filter panel and 46 lines of CSS, declares the three inner pages'
parents, and the check reports nothing for `src/pages/home/suppliers`.

## 3. The whole app

On request ("UI pass the whole app"). Every screen, the shell and navigation
included.

1. **Inventory and before screenshots** of every screen type: sign-in, home,
   dashboard, every list, one record per module, every form type, settings, a
   dialog, an empty state and an error state.
2. **A short spec:** the foundation decisions (seed colour, scheme generation,
   type, shape, icons, Vuetify defaults) and a table mapping every screen
   pattern to its Material 3 layout and components.
3. **Foundation first:** the theme from one seed, type, shape, icons and Vuetify
   defaults, then the app shell and navigation (every inner page's parent, so
   plain `jskit check` passes).
4. **Screens in packages,** at most three at a time, never two on the same file.
5. **After screenshots** for each package.
6. **Delete as you go:** app CSS shrinks to almost nothing, with no hex colour
   outside `src/theme/`; `jskit check m3` reports nothing for the whole app.
7. **Tests:** browser tests change only where markup changed, every behavior
   assertion stays the same, and nothing regresses.
8. **An independent review:** a fresh agent, given only the screenshots and the
   spec, lists every departure from Material 3 as MUST or SHOULD. Fix every MUST
   and review again until there are none.

- **Report:** the gallery, the reviewer's final pass with no MUST items, the
  counts (screens, CSS lines before and after, check findings before and
  after), the Up proof and the test results.

Example: a twelve-screen app. The spec picks the existing brand orange as seed
and maps four lists, four records, three forms and settings. The foundation
package replaces a hand-picked palette and MDI icons; three screen packages
follow. App CSS goes from 640 lines to 38, the check from 212 findings to none,
and the second review has no MUST items.
