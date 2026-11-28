# Shell Web

The existing client exports provide the JSKIT web shell, navigation and outlet
placements.

## Architecture inspection

The static Vue architecture inspector lives in
`@jskit-ai/architecture-inspector`; see its README for the command contract.
`@jskit-ai/shell-web/architecture` and `src/architecture/cli.js` re-export it
unchanged for existing consumers.

## Top app bar and snackbar placement

On compact windows the top app bar shows the page's single `primary` action and
puts its other actions in the "More actions" menu. The bar's own top-right items
(tools, a notification bell, the account avatar) stay while they fit beside the
whole page title; those that don't follow the actions into the menu, farthest
from the corner first, and the item nearest the corner stays unless the
`primary` action takes its place. An item keeps running while it is in the
menu, closed or open, so its live count, its panel or a floating button it shows
elsewhere on the page stay. Medium and wider bars fold their page actions first
(beside the whole title on medium bars, beside 200px of it on wider ones) and
move items the same way only when that leaves the title too little room. On
expanded and large windows an item shows its label, such as the account's name
(`useShellTopRightLabels()`), only when the title, every page action and every
labelled item fit; otherwise, before any action folds, it is its round icon
button. Compact and medium windows never show the labels.

`ShellErrorHost` centres its snackbar above the navigation bar on compact
windows and starts it at the content's start edge, at most half the content's
width, on wider ones, so it never covers the FAB or the actions it reports on.
Its banners never cover the content either: below a top app bar they are a top
layout item of their own height, so `v-main` starts the content below them,
and on a surface without an app bar they join the page flow above it.

Request recovery reports a network failure of a `GET` or `HEAD` query as a
banner with Retry, for reads whose screen does not show the failure itself.
`useList()`, `useView()` and `useAddEdit()` from `@jskit-ai/http-web` show
theirs where the read failed (`loadError`, with Retry), so their queries are
left out unless the caller passes `requestRecovery`. A hand-written query
whose component shows its own load error with Retry sets
`meta: { jskit: { requestRecovery: false } }`, so the failure shows once.

## The page behind a dialog

While a `v-dialog` or `v-bottom-sheet` is open, `ShellLayout` makes its page
inert under it: the app bar, the rail, the drawer, main (with the page's FAB),
the navigation bar and the side sheet, each marked `data-shell-page`. A
keyboard, assistive technology and axe then skip the page, as the scrim already
makes the pointer skip it, so an app runs its axe checks on the whole document
with a dialog open instead of narrowing them to the dialog. Vuetify's overlay
layer stays live: a menu or select opened in the dialog, a second dialog over
it (the first is inert under it until it closes) and a snackbar, which is still
announced. When the dialog closes, or unmounts, the page is live again and
focus returns to the element that opened it unless focus already went
somewhere; a dialog that closes by leaving its page leaves focus to the next
page. A dialog attached or contained inside the page stays local and leaves the
page alone.

Only the parts the dialog made inert are made live again. A part already inert
of its own, as Vuetify keeps a closed modal drawer or side sheet, stays inert
after the dialog, and a drawer that closes behind the dialog (the window
narrows, or a link in the dialog leaves the page) is inert once the dialog
closes; one that opens behind it is inert until the dialog closes and live
after. A layout of an app's own that binds `inert` on a part it marks
`data-shell-page` keeps the value it binds in the same way.
