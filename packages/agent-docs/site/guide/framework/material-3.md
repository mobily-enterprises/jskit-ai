---
title: Material 3
description: JSKIT's exact Material 3 rules for Vue and Vuetify, with navigation and Up first.
---

# Material 3

Read completely before any JSKIT Vue/Vuetify UI task. For a UI pass over a
task's changes, a section or the whole app, also read [UI pass](./ui-pass.md).

## Authority

Material 3 (m3.material.io) is the UI contract, and it is exact: "close to
Material 3" is a failure. A new JSKIT app is exact Material 3 in light and dark,
on phone, tablet and desktop, with no app CSS. An app chooses a seed colour and
writes its own screens. If an app has to fight JSKIT to look right, that is a
JSKIT defect: report the exact JSKIT change, never patch it with app CSS,
`!important` or a copied package file.

JSKIT uses Vue and the installed Vuetify 4 release with its `md3` blueprint.
Use the installed public APIs rather than adding `@material/web`, another UI
framework, or a parallel theme/component system. The request and Blueprint own
brand, content, routes, and behavior; Material 3 never authorizes a behavior
change. An established JSKIT prop or component wins over generic Material advice.

## Navigation and Up

**MUST, in every JSKIT app (#241). The shell owns the Up arrow and the trail.
An app declares each inner page's parent, links through JSKIT navigation, and
writes no back logic of any kind. Plain `jskit check` fails on every rule in
this section, and nothing excuses one. Never improvise a Back.**

### The model

**Back** is chronological and can leave the app; the browser provides it (its
button, gestures, Alt+Left), and the app never draws or imitates it. **Up** is
the app's own arrow, the leading icon of the top app bar; it moves within the
app and never leaves it.

- **Words:** a *top-level destination* is a main-navigation item (bar, rail or
  drawer): Contacts, Suppliers, Settings. An *inner page* is any other page: a
  record, sub-page, new or edit form, or a wizard step with its own URL. Its
  *parent* is the page it belongs under (supplier → Suppliers, edit supplier →
  that supplier). The *trail* is the in-app path taken in this browser tab.
- **What the person sees:** one Up arrow on every inner page, also when opened
  directly: icon only (`$arrowBack`), accessible name "Back" (localized), a
  tooltip on pointer devices. None on top-level destinations, and no other
  back control anywhere; the bar title says where the person is. A new or edit
  form shows a close (X) in the arrow's place, which cancels. A list-detail
  layout showing the parent beside the page needs no arrow for that step;
  collapsed to one pane, the record pane gets it back.
- **Where Up goes:** to the previous trail entry while it is valid, so inside
  the app Up works like Back (drill-down, sideways, chains unwinding one step
  at a time); otherwise to the declared parent (shared link, bookmark, new
  tab). An entry whose record was deleted, whose permission was lost, or whose
  surface, workspace or route is gone sends Up to the parent, never an error
  page. Up never leaves the app or opens sign-in.
- **The trail:** one per tab; a refresh keeps it, a new tab or shared link
  starts empty. Navigating to another page pushes an entry; Save and Cancel on
  a form, redirects, and same-page changes (filters, search, sort, paging, an
  in-page tab, a dialog) replace it. A top-level destination starts a fresh
  trail. Going back restores filters, sort, page, scroll and focus. The
  browser's Back and Forward stay in sync with it; external links never enter.

### What an app declares

Exactly this, and nothing more:

1. **Each inner page declares its parent once,** as route meta `jskit.parent`:
   a static path on the page's own surface, resolved like `usePaths().page()`,
   whose `:param` segments take the current route's values. Another surface's
   page is an object, `{ surface: "home", path: "/" }`. No functions, no route
   names.

   ```vue
   <script setup>
   definePage({ meta: { jskit: { parent: "/suppliers/:supplierId" } } });
   </script>
   ```

   The same key works in a `<route lang="json">` block. Tabs under a layout
   (`settings.vue` rendering `<RouterView>` for `settings/`) declare nothing:
   they inherit the nearest layout's declaration, and moving between them keeps
   the trail and the scroll. A folder without a layout (`bookings/` with no
   `bookings.vue`) only groups routes: its pages are different pages, each
   opening at the top. The parent is read from the page up to its surface root, the
   record that declares `jskit.surface`, and stops there. So the surface goes
   only on the surface's layout page (`account.vue`: `ShellLayout` around
   `<RouterView />`) and the parent on the page it renders
   (`account/index.vue`). A package route declares its parent in its
   `package.json` `meta`; under no layout, its component draws `ShellLayout`.
2. **Each top-level destination is a main-navigation item** (a `kind: "link"`
   placement with `target: "shell.primary-nav"` or `"shell.secondary-nav"`) and
   declares no parent; nor do its tabs. A shell page with no parent is
   top-level: no arrow, a fresh trail. Placements are literal declarative data,
   one `addPlacement({ ... })` per destination with plain string `surface`,
   `scopedSuffix` and `unscopedSuffix`, never built by a helper, a spread or a
   template, so a reader and `jskit check` can map every destination.
3. **Every in-app link and navigation goes through JSKIT navigation:**
   `:to="paths.page('/suppliers')"` and `router.push(paths.page(...))` with
   `usePaths()`, the CRUD runtime's `resolveViewUrl()`, `resolveEditUrl()` and
   `resolveParams()`, and link placements (`surface` with `scopedSuffix` and
   `unscopedSuffix`; `to` only for a global route). A global route
   (`scope: "global"`, on no surface) is
   `paths.page("/auth/login", { scope: "global" })`; `explicitTo` only passes
   through a finished target that arrives as data, never a hand-written path.
   The trail follows the router, so there is no special link component.
4. **A custom new or edit page finishes through the shell:**
   `useShellNavigation()` (`@jskit-ai/shell-web/client/navigation/useShellNavigation`)
   gives `finish(target)` for Save (the target replaces the form in the trail)
   and `finish()` for Cancel (back to where the form was opened, else its
   parent); `useShellPageClose({ label, close })`
   (`@jskit-ai/shell-web/client/composables/useShellPageClose`) makes the
   arrow its Cancel, never an X beside it. A page whose
   record turns out deleted or forbidden calls `pageUnavailable()`. JSKIT's
   CRUD screens already do all three.
5. **A full page load goes through the shell too:** `reloadAppPage(path)`
   (after sign-in or a user switch, to rebuild client state) and
   `leaveApp(url)` (an external site in the same tab, such as a payment page),
   from `@jskit-ai/shell-web/client/navigation/documentNavigation`. `leaveApp`
   opens the site with a push, so Back returns to the page; a hand-off page
   that only forwards (to an OAuth consent screen) uses
   `leaveApp(url, { replace: true })`, so Back from the site doesn't rerun it.

### Forbidden in app code

| Rule | Forbidden |
|---|---|
| `nav/history` | `history.back()`, `history.go()`, `history.pushState()`/`replaceState()`, `router.back()`, `router.go()` |
| `nav/window-location` | `window.location` assignments, `.href =`, `location.assign()`, `location.replace()` |
| `nav/raw-link` | a hand-built in-app path in `to`, `href`, `router.push()`, `router.replace()` or a `to:`/`href:` object key outside a placement |
| `nav/back-control` | any back control but the shell's Up that navigates the app: "Back to X", "← Suppliers", back arrows and navigating chevrons, breadcrumbs, a custom app-bar back button, a back component (`<ContextBackButton />` or `<page-back-link>`, and its import), a `goBack()`-style handler |
| `nav/missing-parent` | an inner page of a shell surface without a declared parent, when it always renders under the shell's top app bar (a layout that also renders its pages without `ShellLayout`, such as a shop device's sign-in in a `v-if`, leaves its pages unjudged) |
| `nav/top-level-parent` | a main-navigation destination that declares a parent |
| `nav/placement-data` | a main-navigation placement that isn't literal data (no page is judged for a missing parent until it is) |
| `nav/missing-shell-layout` | a page that declares a parent with no shell layout rendering it, so its title, Up and actions never show |
| `nav/surface-parent` | a parent declared beside `jskit.surface`, which the shell never reads |
| `nav/allow` | any `m3-check: allow nav/...` comment: nothing excuses a navigation rule |

### Each rule, right and wrong

- **Up follows the trail.** Right: contact → (link) supplier → Up shows **the
  contact**; contact → supplier → product → Up = supplier, Up = contact, Up =
  Contacts. Wrong: the supplier's Up opens the Suppliers list after the person
  came from a contact.
- **Direct entry goes to the parent.** Right: a supplier opened from a pasted
  link → Up = Suppliers list. Wrong: no arrow, a dead arrow, or an arrow that
  leaves the app.
- **One arrow, on inner pages only.** Right: the Suppliers list (a drawer item)
  has no arrow; a supplier has one, in the bar. Wrong: an arrow on the
  Suppliers list, a second arrow in a card, or a "Back to suppliers" button.
- **Declare the parent.** Right: `definePage({ meta: { jskit: { parent:
  "/suppliers" } } })` on the supplier. Wrong: no declaration, a parent on
  Suppliers itself, or a page that computes its own "previous page".
- **Full loads through the shell.** Right: `reloadAppPage(returnTo)` after
  sign-in; `leaveApp(checkoutUrl)` for the payment page. Wrong:
  `window.location.replace(returnTo)` or `location.assign(checkoutUrl)`.
- **No history.** Right: the page declares its parent and nothing else.
  Wrong: `@click="router.back()"`, `history.go(-1)`, or a `goBack()` helper.
- **Links through JSKIT.** Right: `<v-btn :to="records.resolveViewUrl(record)">`
  or `:to="paths.page('/suppliers')"`. Wrong: `to="/home/suppliers"`,
  `` :to="`/home/suppliers/${id}`" ``, `router.push("/home/suppliers")` or
  `window.location.href = url`.
- **Forms replace themselves.** Right: record → Edit → Save calls
  `finish(recordUrl)`; the record shows, and Up goes where the record's Up went
  before. Wrong: `router.push(recordUrl)` after Save, so Up or Back reopens the
  form.
- **Steps and drill-downs inside a page are named actions.** A wizard step or
  a panel the page opens in place is not a page, so it has no Up. Right:
  "Previous step", or the destination's name ("Dashboard"), with no back
  arrow. Wrong: "Back" or a back arrow. `nav/back-control` flags only controls
  that navigate the app: a link into it, or a handler that reaches the router,
  JSKIT paths, `up()`, `finish()` or the browser's history or location. Prose
  ("back from version 2"), a variable named `back` and an embedded frame's own
  Back and Forward (`frame.contentWindow.history.back()`, as in a preview
  browser) are not back controls.

## Foundation

- **Theme from one seed:** the app's only theme file is `src/theme/index.js`,
  `export const theme = { seed: "#6750A4", icons: {} }`, and `src/main.js` runs
  `createVuetify(createMaterialVuetifyOptions(theme))` with
  `createMaterialVuetifyOptions` from `@jskit-ai/material-web/client`, importing
  `@jskit-ai/material-web/client/material.css`. JSKIT generates the light and
  dark schemes from the seed at startup (Material Color Utilities
  `SchemeTonalSpot`, every role in kebab-case such as `surface-container-low`,
  plus success, warning and info with their containers), with
  `defaultTheme: "system"` so the person's light, dark or system preference
  applies. The `md3` blueprint and JSKIT's Material 3 Vuetify defaults live in
  material-web; an app keeps no defaults file and never hand-picks a colour. The
  seed is the only hex value.
- **Type:** Vuetify 4 Material 3 roles (`text-headline-small`,
  `text-title-large`, `text-body-medium`, `text-label-large`). Never the
  Material 2 scale (`text-h5`, `text-body-2`) or a page-local type system.
  Material 3 has two typefaces, both Roboto Flex unless the app names its own
  in `src/theme/index.js`:
  `typography: { brand: '"Fraunces", serif', plain: '"Inter", sans-serif' }`.
  `brand` sets display, headline and title-large, `plain` the rest (title-medium
  and -small, body, label); each is a CSS font-family value, and the app loads
  the font. Never set `font-family` or `--v-font-body` in app CSS.
- **Icons:** Material Symbols Rounded through Vuetify `$` aliases: Vuetify's
  standard ones (`$close`, `$menu`, `$delete`, `$prev`, `$next`) and JSKIT's
  camelCase names (`$add`, `$edit`, `$search`, `$moreVert`, `$filterList`,
  `$arrowBack`); `$homeFilled`-style `Filled` variants mark active navigation.
  An app adds an icon under `theme.icons` in `src/theme/index.js` as
  `{ name: "<24x24 path data>" }` from Material Symbols Rounded, then uses
  `$name`. No `mdi-*` strings and no `@mdi/js` imports in app code. Material
  Symbols has no brand marks (Google, GitHub, a payment network): a brand's
  logo is the brand's own artwork, a content image or SVG used as its owner
  publishes it, not an icon alias.

## Exact sizes

JSKIT ships these exact sizes; an app never re-implements or overrides them:

- 40dp buttons with a 48dp touch target, icon buttons included; a smaller
  button is `size="small"` or `size="x-small"`, which keeps its smaller look
  and the 48dp target. No icon button is under 32dp, and a target stops at
  the edge of a button beside it, so each of a row's touching icon buttons
  answers its own press;
- one-line button labels, ending in an ellipsis: keep labels short, and give
  one that can run long, such as a name, its full label as `title`;
- 12dp cards: flat (the default) and tonal at level 0, `variant="elevated"`
  at level 1; flat expansion panels;
- 28dp dialogs and bottom-sheet top corners, square full-screen dialogs;
- 8dp chips, and FABs of 56dp (small 40dp, large 96dp; extended 56dp tall)
  with 16dp corners;
- emphasized easing, with reduced motion honoured.

So never set `height` or `min-height` on a button, or a radius on a card,
dialog, chip or FAB.

## The top app bar carries the page

- **Title:** route meta `jskit.title` (plain text), or
  `useShellPageTitle(title)` (`@jskit-ai/shell-web/client/composables/useShellPageTitle`)
  for a runtime title such as the record's name. The shell renders it as the
  app bar's only `h1`; pages add no `h1`, page header, title block or
  standalone heading. Route pages own the title: a section or a nested
  component uses a title role (a component's claim gives the title back when
  it goes). A page with no top app bar (a hero front page, an intro, an invite
  or hand-off page) has its own one `h1`.
- **Up** leads the bar on every inner page; on phones it replaces the menu
  icon.
- **A layout that draws its own top app bar** (a workspace bar with the
  app's own controls, instead of `ShellLayout`) builds it from `ShellLayout`'s
  own pieces, from `@jskit-ai/shell-web/client`. It calls `useShellAppBar()`
  once, so its pages enter the trail and their `ShellPageActions` show in its
  bar, and renders `ShellUpButton` first, then `ShellPageTitle` (the page's one
  `h1`) and `ShellPageActionsTarget`. A title that is also a switcher, such as a
  project menu, goes in `ShellPageTitle`'s default slot (given `{ title }`) as
  the menu's activator, so it stays the one `h1`. `jskit check` counts it as a
  shell layout, so its inner pages need parents.
- **Actions:** a screen's actions go in the bar inside `ShellPageActions`
  (`@jskit-ai/shell-web/client/components/ShellPageActions`), each a
  `ShellPageAction` with `icon`, `label` (also its accessible name and compact
  tooltip), and `primary`, `to`, `replace`, `href` (with `download` for a
  file, such as a CSV export), `disabled`, `loading` or `color` (`error` for a
  destructive one); attributes such as `target` reach its button. On compact
  widths the bar shows the single `primary` action (a form's Save) and puts
  every other action in its "More actions" menu, where `overflow` actions
  always are. The bar's own items (top-right placements such as tools, a
  notification bell and the account avatar) stay while they fit beside the
  whole title; those that don't follow the actions into the menu, farthest
  from the corner first, and the item nearest the corner stays unless the
  `primary` action takes its place. An item keeps running while it is in the
  menu, closed or open, so its live count, its panel or a floating button it
  shows elsewhere on the page stay. Medium and wider bars show them all.
- **Window size classes:** compact under 600 (navigation bar), medium 600–839
  (navigation rail), expanded 840–1199 and large from 1200 (drawer), read from
  `useShellWindowSizeClass()`
  (`@jskit-ai/shell-web/client/composables/useShellWindowSizeClass`), never from
  copied breakpoint numbers. A surface with fewer than two navigation
  destinations (none, as on an account surface, or Home alone) draws no
  navigation bar, rail or drawer; its pages keep the app bar.
- **Section tabs:** a page's own sections (`page.section-nav`) are Material 3
  primary tabs: the topology names `ShellSectionTabLinkItem`'s token (the
  starter registers it as `local.main.ui.section-tab-link-item`), and the page
  draws one tab row, `display: flex; overflow-x: auto` over a 1dp
  `outline-variant` bottom border. `ShellTabLinkItem` is the navigation bar's
  destination; placed in a page it draws a section tab.

## Colour

- Use semantic roles through Vuetify props, classes and
  `rgb(var(--v-theme-<role>))`; never a raw colour value in a component.
- Status chips use `color="success"` (or `warning`, `info`, `error`) or the
  container roles (`success-container` with `on-success-container`), and each
  status meaning has its own hue. Never communicate status, selection, validation, or permission through
  color alone.
- Surfaces are separated by tone (`surface-container-lowest` to
  `-highest`), not borders: no `variant="outlined"` cards and no `border` on
  cards or sheets. A VCard default `color` becomes the text colour on outlined
  and tonal cards.
- Keep WCAG AA contrast in both schemes. Use elevation `0` through `5` and
  component variants instead of arbitrary shadows.

## Lists, records and forms

- **List:** an M3 search bar, then one row of filter chips, each opening its own
  control; never a permanent panel of outlined fields. A card opens its record
  when tapped (a stretched title link); a table row opens on click. Row actions
  are trailing icon buttons (edit, a `$moreVert` overflow menu, a chevron to
  open), never "View" or "Edit" text buttons on every row. "New" is
  `ShellPrimaryAction` (`label`, and `to` or a click handler): an extended FAB
  on compact and medium widths, a filled bar button on expanded. On/off filters
  are `aria-pressed` chips, or chips in a `v-chip-group`; JSKIT draws them as
  filter chips. Empty and error states carry an icon.
- **A list never scrolls sideways, at any width.** The list's own width (a
  container query, not the window) chooses cards or table. Cards flow into a
  grid; tables use a fixed layout with an ellipsis on long values, and fold
  low-priority columns into a stronger column's second line. Lists show figures
  ("120 kg", tabular and right-aligned) and names, never ids.
- **Record:** a header (avatar, title, status chips) and value-first detail
  lists, never a grid of label/value text. Edit sits in the bar, its secondary
  actions in the bar's overflow menu, never in the content; the record's
  next workflow step is the one filled button, shown in context rather than a
  row of mostly disabled actions.
- **Form:** the bar's close (X) cancels and Save is its filled action. Fields
  use `hideDetails: "auto"`. Nothing moves under a finger: a multi-select chip
  field keeps its input width when it loses focus. A pick-one-of-N choice is a
  segmented button (`v-btn-toggle`, drawn by JSKIT, with 12dp segment sides as
  in any `v-btn-group`) with `role="radiogroup"` and
  `role="radio"`/`aria-checked` buttons.
- **Dialogs:** plain `v-dialog` and `v-bottom-sheet`; JSKIT gives them their
  Material 3 shapes. A full-screen dialog (compact and medium) puts close, title
  and its confirm action in a top bar, never at the bottom where a snackbar
  covers them.
- **Menus and badges:** a menu's list has `role="menu"` and its items
  `role="menuitem"`, with `aria-disabled` on unavailable ones; a badge has a
  `label` such as "3 batches". JSKIT draws a menu's list and a dialog's card;
  an app sets no `VMenu` or `VDialog` defaults, under which
  Vuetify 4.2.1 to 4.3.2 loses a `v-select`'s typeahead match, or a dialog's
  virtual list, when an ancestor re-renders.

## Components, state, and feedback

- Choose standard components by purpose over custom imitations.
- Give one primary action emphasis. Distinguish destructive, secondary, and
  icon-only actions without relying on color; give icon controls accessible
  names and fields meaningful labels, errors, and autocomplete behavior.
- Preserve visible focus, logical tab order, keyboard operation, and at least
  48 CSS-pixel interactive targets.
- Represent loading, empty, error, retry, disabled, selected, hover, focus,
  pressed, and success states through shared JSKIT behavior. All user-visible
  loading uses Material skeletons that reserve the final content geometry;
  never use a generic spinner or circular progress indicator, and never let
  content jump when data arrives. An action without a loading content region
  uses a stable disabled/pending label and shared feedback, not a spinner.
- Keep failures at their semantic owner. A resource that cannot render uses a
  stable in-page error and retry state; field validation stays beside the
  field. A user-triggered command uses JSKIT's shared action
  feedback/snackbar path. Never insert a transient command-error alert above
  page content where it shifts the working layout.
- A snackbar never covers the FAB or the actions it reports on. `ShellErrorHost`
  centres it above the navigation bar on compact windows and starts it at the
  content's start edge, at most half its width, on wider ones. A FAB takes
  layout room (`<v-fab app layout>`, as `ShellPrimaryAction`'s does), so the
  snackbar shows above it.

## Adaptive layout

Start compact, then check medium and expanded. Let navigation, tables, filters,
supporting content, and action groups change presentation; do not merely shrink
an expanded screen. Prevent overflow, clipped labels, overlapping actions,
duplicate navigation, and unreachable dialogs. Persist screen context such as
filters, tab and page in the route when it must survive navigation.

## The conformance check

Two commands read application source (no server, no browser) and print each
finding with its file, line, rule and the section of this page:

```bash
npx jskit check                          # in every app's verify: fails on any nav/* rule
npx jskit check m3                       # the whole app: src/ and packages/
npx jskit check m3 src/pages/home/books  # a section
npx jskit check m3 $(git diff --name-only --diff-filter=d main)  # changed files
```

Plain `jskit check` fails on the [navigation rules](#forbidden-in-app-code).
`jskit check m3` lists those and the visual rules below. The visual rules are a
report until every JSKIT app has been converted to them; the JSKIT release after
that makes plain `jskit check`, and so every app's verify, fail on them too:

| Rule | Finds |
|---|---|
| `m3/duplicate-h1` | a second `h1` that can show beside the first (one per `v-if` branch is one), or an in-page `h1` under a layout that always shows the shell's page title |
| `m3/raw-hex` | a hex colour, or one written as channels (`rgba(0, 0, 0, 0.15)`, as in a hand-made shadow), outside `src/theme/` (`palettes.js` holds content colours); `rgba(var(--v-theme-shadow), 0.2)` reads a role and passes |
| `m3/dark-scheme` | no dark scheme, or the theme pinned to light |
| `m3/outlined-card` | `variant="outlined"` or `border` on a card or sheet |
| `m3/mdi-icon` | `mdi-*` icon strings and `@mdi/js` imports |
| `m3/fixed-button-height` | `height`/`min-height` on buttons, in props, styles or CSS |

Tests, fixtures, server code and migrations are not checked. A clean check is
necessary, not sufficient: it cannot see layout, spacing or contrast. A
[UI pass](./ui-pass.md) is the guard for those, because it looks at every
affected screen at three widths in light and dark; an editor that runs one
automatically after each plan keeps that guard on every change.

### Exceptions

Take the approved route first; none needs an exception:

- **Brand or partner colours** are theme custom colours, used by name:
  `colors: { partner: "#0A7D3E" }` in `src/theme/index.js`, then
  `<v-chip color="partner">`. A hex string is harmonized toward the seed; a
  colour that must keep its hue is `{ value: "#F5C518", blend: false }`
  (Material Theme Builder's Blend switched off), with the same four roles.
- **Content colours**, colours that are content rather than UI, keep one
  value in both schemes: an identity palette a person picks and the server
  stores, avatar and illustration artwork, brand marks (a language's
  file-type tint), fixed chart series, QR codes, colours written into
  exported files. They are named exports of plain hex values in
  `src/theme/palettes.js`, used as they are, never for UI chrome (a theme
  colour is toned per scheme, so it can't keep an identity the same).
  Components read them through bindings:

  ```vue
  <script setup>
  // src/theme/palettes.js: export const botColours = ["#6750A4", "#B3261E"];
  import { botColours } from "@/theme/palettes.js";
  const props = defineProps({ bot: Object });
  const ring = botColours[props.bot.colour];
  </script>
  <template>
    <v-avatar :style="{ backgroundColor: ring }"><svg><path :fill="ring" /></svg></v-avatar>
  </template>
  <style scoped>.v-avatar { outline: 2px solid v-bind(ring); }</style>
  ```
- **Chart and data colours** that follow the scheme come from the theme:
  `const theme = useTheme()`, then
  `["primary", "tertiary"].map((role) => theme.current.value.colors[role])`.
- **A third-party widget** lives in one wrapper component, such as
  `src/components/RouteMap.vue`, that hands it theme colours; pages use only
  the wrapper.

What is left, such as a colour inside static SVG markup that can't import,
may be excused one line at a time, on its line or the line before: `<!-- m3-check: allow m3/raw-hex - the partner's contractual logo colour -->`
(`// m3-check: ...` in scripts, `/* ... */` in CSS). **Never add one on your
own:** ask the person first, naming the rule and the reason. A comment with no
reason (`m3/allow-reason`) or an unknown rule (`m3/allow-rule`) is itself a
finding, as any `nav/allow` is; nothing turns the check off for a file, a
folder or the app. `jskit check m3` lists every
exception with its file, line and reason, and their total.

## Material 3 audit

Run this behavior-preserving audit over every affected screen:

1. Identify the owning JSKIT surface, shared screen, shell, placement, theme,
   and Vuetify components before judging local markup.
2. Check navigation and Up first, as must-fix: plain `jskit check` passes and
   every rule in Navigation and Up holds.
3. Find parallel components, duplicated state chrome, page-local themes, raw
   visual constants, CSS against Vuetify internals, nested generic cards,
   borders instead of tones, Material 2 typography, and desktop-only layout;
   check states, focus, labels, targets, contrast and reduced motion against
   the rules above.
4. Correct issues at the narrowest established owner. Consolidate only truly
   repeated policy; avoid pass-through wrappers and speculative abstractions.
5. Run `jskit check` and `jskit check m3` on the affected files, then focused
   tests and Playwright at compact, medium, and expanded widths in light and
   dark (`shellBackButton(page)` and `pressShellBack(page)` from
   `@jskit-ai/shell-web/test/shellNavigation` drive Up).

Do not declare Material 3 compliance from visual resemblance alone. Report any
unverified responsive, theme, accessibility, interaction, or browser behavior.
