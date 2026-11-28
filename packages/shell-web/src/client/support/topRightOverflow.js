/**
 * How many of a compact top app bar's own items (its top-right placements, in bar order) go into its overflow menu:
 * the fewest, farthest from the corner first, that leave the page title its whole width beside the rest, so a short
 * title keeps every item that fits. The item nearest the corner (the account avatar) stays unless the page's primary
 * action holds the bar's trailing place, so a title too long for the bar is clipped beside it.
 * @param {object} options
 * @param {number} options.room The width the title, the items in the bar and the overflow button share.
 * @param {number} options.title The title's whole width.
 * @param {readonly number[]} options.items Each item's width, in bar order.
 * @param {number} options.menuButton The overflow button's width.
 * @param {boolean} options.menuShown Whether the bar shows the overflow button anyway, for page actions in its menu.
 * @param {boolean} options.keepLast Whether the item nearest the corner stays in the bar whatever room is left.
 * @returns {number} How many items, from the first, are in the menu.
 */
function resolveTopRightItemsInMenu({ room, title, items, menuButton, menuShown, keepLast }) {
  const most = Math.max(items.length - (keepLast ? 1 : 0), 0);
  let inBar = items.reduce((total, width) => total + width, 0);
  for (let inMenu = 0; inMenu < most; inMenu += 1) {
    const button = menuShown || inMenu > 0 ? menuButton : 0;
    if (title + inBar + button <= room) {
      return inMenu;
    }
    inBar -= items[inMenu];
  }
  return most;
}

/**
 * What a medium, expanded or large top app bar does with its own items (its top-right placements, in bar order):
 * whether they show their labels (an account's name beside its avatar), and how many go into its overflow menu. The
 * labels show only when the title (`title`: a medium bar's whole title, a wider bar's up to its floor), every page
 * action and every labelled item fit together, so a label gives way before an action folds. Without labels, items move
 * into the menu, farthest from the corner first, only when the title, the primary action and the overflow button still
 * leave too little room for them once every other action has folded (resolveTopRightItemsInMenu); the actions that fit
 * beside what stays are useShellPageActionsFold's.
 * @param {object} options
 * @param {number} options.room The width the title, the page actions, the overflow button and the items share.
 * @param {number} options.title The width the title needs.
 * @param {number} options.primary The width of the actions that stay in the bar whatever room is left (the primary).
 * @param {number} options.actions The width of the actions the bar folds when it has no room for them.
 * @param {readonly { labelled: number, bare: number }[]} options.items Each item's width with its label and without.
 * @param {number} options.menuButton The overflow button's width.
 * @param {boolean} options.menuShown Whether the bar shows the overflow button anyway, for actions marked `overflow`.
 * @param {boolean} options.keepLast Whether the item nearest the corner stays in the bar whatever room is left.
 * @returns {{ labels: boolean, inMenu: number }} Whether the items show their labels; how many, from the first, are in
 *   the menu.
 */
function resolveWideBarItems({ room, title, primary, actions, items, menuButton, menuShown, keepLast }) {
  const labelled = items.reduce((total, item) => total + item.labelled, 0);
  if (title + primary + actions + labelled + (menuShown ? menuButton : 0) <= room) {
    return { labels: true, inMenu: 0 };
  }
  const inMenu = resolveTopRightItemsInMenu({
    room: room - primary,
    title,
    items: items.map((item) => item.bare),
    menuButton,
    menuShown: menuShown || actions > 0,
    keepLast
  });
  return { labels: false, inMenu };
}

// Where ShellLayout says whether its top-right items show their labels (useShellTopRightLabels): null while it does
// not lay them out, as outside its bar, where the window's size class decides.
const SHELL_TOP_RIGHT_LABELS_KEY = "jskit.shell-web.layout.top-right-labels";
/** @type {{ readonly value: boolean | null }} */
const NO_SHELL_TOP_RIGHT_LABELS = Object.freeze({ value: null });

export { NO_SHELL_TOP_RIGHT_LABELS, SHELL_TOP_RIGHT_LABELS_KEY, resolveTopRightItemsInMenu, resolveWideBarItems };
