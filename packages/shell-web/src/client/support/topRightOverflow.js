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

export { resolveTopRightItemsInMenu };
