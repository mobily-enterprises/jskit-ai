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
elsewhere on the page stay. Medium and wider bars show them all.

`ShellErrorHost` centres its snackbar above the navigation bar on compact
windows and starts it at the content's start edge, at most half the content's
width, on wider ones, so it never covers the FAB or the actions it reports on.
