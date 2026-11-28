// Material 3's icon button: the width of an item, or of the overflow button, that the bar has not drawn yet.
const ICON_BUTTON_WIDTH = 48;
// The least room an expanded or large top app bar leaves its page title before a page action folds, or the whole
// title when that is narrower: about fourteen characters of the title's type (title-large, 22px). The title truncates
// down to it.
const WIDE_BAR_TITLE_FLOOR = 200;

/**
 * The title's whole width: its text, or what its slot draws, to the next pixel when it fits, else the text it clips,
 * a pixel more, since scrollWidth is a whole number and a rounding must never make a clipped title fit.
 * @param {HTMLElement} title
 */
function wholeTitleWidth(title) {
  if (title.scrollWidth > title.clientWidth) {
    return title.scrollWidth + 1;
  }
  const range = document.createRange();
  range.selectNodeContents(title);
  return Math.ceil(range.getBoundingClientRect().width);
}

/**
 * An element's width in its row: its box and its inline margins.
 * @param {Element} element
 */
function widthInRow(element) {
  const style = window.getComputedStyle(element);
  return element.getBoundingClientRect().width +
    Number.parseFloat(style.marginInlineStart) +
    Number.parseFloat(style.marginInlineEnd);
}

/**
 * The width inside an element's padding.
 * @param {HTMLElement} element
 */
function contentWidth(element) {
  const style = window.getComputedStyle(element);
  return element.clientWidth - Number.parseFloat(style.paddingInlineStart) - Number.parseFloat(style.paddingInlineEnd);
}

export { ICON_BUTTON_WIDTH, WIDE_BAR_TITLE_FLOOR, contentWidth, wholeTitleWidth, widthInRow };
