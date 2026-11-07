# Changelog

## Unreleased

- The shell's client provider starts loading the app's `src/placementTopology.js`, `src/placement.js` and `src/error.js` together instead of each after the one before; it still reads, checks and applies them in the same order, and each is still optional. Measured on the accounts starter with 60 ms of latency per request: the three arrived by 851 ms instead of 935 ms (721-790, 799-865 and 869-935 ms before, 718-851 ms together after), and the bootstrap request that follows them started 82 ms sooner.
- After Up or the browser's Back, the shell's attempts to focus the element that opened the page left (every 100 ms for up to 1.5 s, until the page draws it) stop at the next navigation and when focus has moved since they started. Before, they outlived both: a Back then a Forward within 1.5 s could focus a matching link or tab on the next page and take the caret from a field someone was typing in. Focus that only fell back to the page body, as when the left page's element goes away, still gets the opener.
- `ShellErrorHost`'s snackbar no longer covers the actions it reports on: it showed at the bottom end for 5 seconds over Save and the FAB, so a second Save waited it out. It is centred at the bottom on compact windows and starts at the content's start edge on wider ones, at most half the content's width, clear of end-aligned FABs and form actions; Vuetify keeps it above the navigation bar and a FAB that takes layout room (`<v-fab app layout>`). On a phone a form's Save is the app bar's primary action (`ShellPageAction primary`), which it never covers.
- `ShellSectionTabLinkItem` (new, `@jskit-ai/shell-web/client/components/ShellSectionTabLinkItem`) is a page's section tab (`page.section-nav`): a Material 3 primary tab, 48dp (64dp with the placement's icon above the label), its label in title-small, the active one's label `primary` over a 3dp indicator under its content with rounded top corners, `aria-current="page"`. The starter registers it as `local.main.ui.section-tab-link-item`, and the page-and-placement pattern's Reports tabs use it in a row of their own over an `outline-variant` divider. `ShellTabLinkItem` styles itself as a navigation bar destination (its 64x32 indicator, full height, no padding, 5.5rem label) only inside `ShellLayout`'s navigation bar, which now gives its outlet the "bar" presentation; placed anywhere else, as in a page's section tabs, it draws a `ShellSectionTabLinkItem`, instead of squashed 64dp pills with clipped labels.
- Navigation needs two destinations: with one (Home alone) `ShellLayout` draws no navigation bar, rail, drawer or menu control, as a surface with none already had none. The destinations are counted across the bar and the drawer, so a phone's one drawer destination beside the bar's (Settings beside Home) keeps its drawer; the layout's own `menu` slot keeps one too, and the surface identity (a workspace switcher) keeps the drawer beside any navigation. `shellLayoutHasNavigationBar()` joins `shellLayoutHasDrawer()`.
- The standard drawer's header holds its menu control alone, with a tooltip naming what it does ("Collapse navigation drawer"), instead of the surface's label beside it, which read as the control's label ("Home", right above the Home destination). The surface label stays the app bar's title for a page that declares none.
- `usePaths().page(path, { scope: "global" })` gives a global route's path (a route with `scope: "global"`, such as `/auth/login`, on no surface), its params filled from the route and `params`, instead of the current surface's. `explicitTo` stays for a finished target that arrives as data.
- `runAdaptiveShellSmokeCase` passes a phone shell whose destinations are all in the navigation bar (the standard topology, with compact main navigation in `shell-layout:primary-bottom-nav`): it reads the compact layout from the navigation bar when the shell draws no drawer, and checks there is no menu control, instead of waiting for a drawer that never renders.
- Exact Material 3 out of the box, in light and dark, with `@jskit-ai/material-web`: the top app bar carries the page's title (`meta.jskit.title`, or `useShellPageTitle()`), its Up arrow and its actions (`ShellPageActions` and `ShellPageAction`, one of them `primary`; `href` makes an action a link that leaves the app); window size classes (`useShellWindowSizeClass()`: compact, medium, expanded, large) pick the navigation bar, the navigation rail with a modal drawer, or the standard drawer; the active destination has a filled icon in its indicator; snackbars are inverse-surface, their actions 40dp text buttons without a fixed 48px height, and banners use their severity's container colours.
- Up navigation per the Material 3 navigation spec: a page declares the page it belongs to as `meta.jskit.parent` (a path on its surface, or `{ surface, path }`), and the shell's arrow returns to the page the person came from (with its scroll position, state and focus) or else to that parent; main destinations reset the trail and show no arrow, and a list-detail page shows none beside its list. `useShellNavigation()` gives `{ canGoUp, upTarget, up, finish, pageUnavailable }`: `finish(target)` leaves a finished form by replacing its history entry, and `pageUnavailable()` sends a page Up returned to and whose record is gone to its parent. `@jskit-ai/shell-web/test/shellNavigation` has the browser checks.
- The application-shell pattern's not-found view renders in the shell, so the top app bar carries its title and the navigation leads back into the app; the shell foundation has it too.
- `ShellListDetail` lays out list-detail pages such as settings: the list beside the open detail on expanded windows (with the landing child as the empty detail), one pane at a time on narrower ones. The foundation and shell patterns' settings pages use it instead of redirecting their landing page to the first section.
- The drawer is 360dp wide by default; `drawerWidth="content"` fits it to its labels. A modal drawer (compact and medium windows) opens over the app bar and closes from its scrim or Escape. The drawer's divider shows only between primary and secondary destinations. The `--shell-chrome-*` custom properties, the rail and drawer item tooltips and `@mdi/js` are gone.
- A surface draws only the navigation it has: no navigation bar without bar destinations, and no rail, drawer or menu control without menu destinations, as on an account surface whose shell exists for the app bar's title, Up and actions. The surface identity (a workspace switcher) keeps the drawer only beside other navigation, as on a phone whose destinations are all in the navigation bar; a phone surface with neither identity nor secondary destinations loses its empty drawer and menu control.
- `usePaths().page()`, and every shell link, fills a path's `:name` segments from the current route's params (or the `params` given), so a declared parent such as `/books/:bookId` takes the id on a direct visit to `/books/7/edit` and Up goes to `/books/7`; a missing param throws as a missing surface param does, and Up then goes to the surface's root.
- `leaveApp(url, { replace: true })` leaves in place of the current history entry, for a hand-off page that only forwards (to an OAuth provider's consent screen), so Back from the site doesn't rerun it; `leaveApp(url)` still pushes.
- `ShellPageTitle`'s default slot, given `{ title }`, replaces the text inside the h1, so a title that is also a switcher (a project menu) can be the menu's activator and stay the page's one h1, with its id and focus.
- A layout that draws its own top app bar builds it from the pieces of `ShellLayout`'s bar: `ShellUpButton` (the Up arrow, shown only on inner pages), `ShellPageTitle` (the page's one `h1`) and `ShellPageActionsTarget`, with `useShellAppBar()` once in the layout so its pages enter the trail and their `ShellPageActions` show in its bar. `ShellLayout` is built from the same pieces and looks and behaves as before.
- `ShellPrimaryAction` is a screen's adaptive primary action, such as a list's "New": an extended FAB above the navigation bar or beside the rail on compact and medium windows, the app bar's filled primary action on expanded and large ones. It takes `to`, or a click handler for a "New" that opens a dialog, so any list uses it instead of wiring `v-fab`, `ShellPageAction` and `useShellWindowSizeClass()` by hand; http-web's CRUD list uses it.
- `ShellPageAction` takes `color` (a colour role, such as `error` for a destructive action), `download` (with `href`, a file to save, such as a CSV export) and `replace` (with `to`). Its attributes (`data-testid`, `target`, `type`, `form`, `aria-*`) land on the button in every form; on compact windows they used to land on the tooltip and were lost.
- The top app bar has Material 3's overflow menu: `<ShellPageAction overflow>` is an item of the bar's trailing "More actions" menu (a record's secondary actions), and on compact windows every action but the primary one joins it (see the one-trailing-item rule below). The menu is `role="menu"` with `menuitem`s that keep each action's link, download, colour, attributes and click handler. New message key: `jskit.shell.actions.more` ("More actions").
- `useShellPageTitle()` claims stack: releasing a claim shows the previous claim's title again instead of none, so a component that claims the title for a while gives the page its own title back. Route pages own the title; a nested component uses a section heading.
- `finish(target)` from `useShellNavigation()` returns to the trail's entry with its query (filters, search, sort, page) and scroll when the target is the page the form was opened from and carries no query or hash of its own; it used to drop the list's query.
- `useShellPageClose({ label, close })` makes a page a task that closes, as Material 3 draws a full-screen form: while it lives, the top app bar's Up arrow is a close (X) labelled `label` that runs `close` (the form's Cancel), so the bar never shows an X beside the arrow. The leading button keeps `data-testid="jskit-shell-back"` and carries `data-action="up"` or `"close"`; its accessible name is the close's label. http-web's new and edit pages use it.
- On compact windows the top app bar keeps one trailing item, so the title keeps its room: the page's primary action when it has one (a form's Save), otherwise the top-right item nearest the corner (the account avatar). Every other page action and top-right item (tools, a notification bell, and the avatar on a form) goes into the bar's one overflow menu, the actions first. Medium and wider windows are unchanged. `ShellPageActionsTarget` takes a `#menu` slot for those items, `ShellOutlet` takes `start` and `end` to render part of an outlet, and `useShellAppBar()` returns `{ pageActions }`, whose `hasPrimary` tells a layout with its own bar whether the primary action took the place.
- `ShellTabLinkItem`'s navigation bar destination is a text button in on-surface-variant of its own, as the section tab it draws outside the bar already is, so it never takes an app's filled, primary button defaults (a dark primary pill with a hard-to-read label) wherever its bar is drawn. The shell's navigation bar looks as before.
- Pages in one route folder are different pages for the trail, as for the kernel's scroll behaviour: two records of one page type in a folder (`/w/bookings/7`, then `/w/bookings/8`) put the first on the trail, so Up returns to it with its scroll. Tabs of a layout stay one page and keep the trail.
- Navigation rail labels wrap to a second line instead of ending in an ellipsis, as Material 3's do; only a label that needs a third line is cut.
- Upgrading: see the guide's [Move an app to the Material 3 defaults](https://mobily-enterprises.github.io/jskit-ai/guide/app-setup/material-3-migration).

## 0.2.0 - 2026-10-29

- Translation ready: every user-visible text is a message key with its English in `locales/en.json`, so an app translates it by supplying translation files only. With no translations, texts and behaviour are unchanged. See the guide "Translating a JSKIT app".
- The error host, menus, navigation and not-found/loading screens are translated; placement `label`/`title` may be a key, `{ key, fallback, params }` or plain text.

### New message keys (31)

All keys in `locales/en.json` (exported as `./locales/en.json`) are new in this version.

<details><summary>Key list</summary>

- `jskit.shell.actions.close`
- `jskit.shell.actions.dismiss`
- `jskit.shell.actions.reload`
- `jskit.shell.actions.retry`
- `jskit.shell.error.actionFailed`
- `jskit.shell.error.attentionRequired`
- `jskit.shell.error.navigationFailed`
- `jskit.shell.error.requestFailed`
- `jskit.shell.error.unexpectedUi`
- `jskit.shell.layout.closeNavigationMenu`
- `jskit.shell.layout.collapseNavigationDrawer`
- `jskit.shell.layout.details`
- `jskit.shell.layout.expandNavigationDrawer`
- `jskit.shell.layout.openNavigationMenu`
- `jskit.shell.layout.surface`
- `jskit.shell.layout.tab`
- `jskit.shell.layout.tools`
- `jskit.shell.pullToRefresh.pull`
- `jskit.shell.pullToRefresh.refreshing`
- `jskit.shell.pullToRefresh.release`
- `jskit.shell.recovery.appDataLabel`
- `jskit.shell.recovery.appLabel`
- `jskit.shell.recovery.appModuleLabel`
- `jskit.shell.recovery.appUnreachable`
- `jskit.shell.recovery.errorConfigLabel`
- `jskit.shell.recovery.moduleFailed`
- `jskit.shell.recovery.placementConfigLabel`
- `jskit.shell.recovery.placementTopologyLabel`
- `jskit.shell.recovery.refreshFailed`
- `jskit.shell.recovery.reloadFailed`
- `jskit.shell.recovery.unreachable`

</details>

## 0.1.152 - 2026-08-13

- Remove the redundant uppercase surface subheader from the expanded drawer; the top app bar remains the single shell-owned surface label.
- Align expanded drawer icons to the collapsed rail centreline so toggling navigation reveals or hides labels without shifting the icons horizontally.
- Preserve the Material 3 80px default rail and the public `railWidth` and `navigationItemSpacing` density controls.

## 0.1.151 - 2026-08-13

- Replace Vuetify's oversized default drawer icon spacer with one public `navigationItemSpacing` value, defaulting to 12px for both icon-to-label and widest-label-to-edge spacing.
- Keep the Material 3 80px default rail while documenting `railWidth` as the supported product-density override.

## 0.1.150 - 2026-08-13

- Give shell navigation tooltips one opaque, theme-owned Material color pair on hover and keyboard focus.
- Centre complete 48px navigation targets and their selected-state indicators in the collapsed desktop rail.
- Size the open drawer from its widest visible label with an approximately 10px end gap, while exposing `drawerWidth` and `railWidth` overrides.
- Dismiss compact navigation with the scrim or Escape and restore focus to the navigation toggle.
- Make the exported adaptive-shell Playwright helper follow rendered breakpoints and wait for stable drawer transitions and geometry.
