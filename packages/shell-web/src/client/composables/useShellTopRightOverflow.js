import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { PAGE_TITLE_ID } from "../navigation/shellNavigationRuntime.js";
import { resolveTopRightItemsInMenu } from "../support/topRightOverflow.js";

// Material 3's icon button: the width of an item, or of the overflow button, that the bar has not drawn yet.
const ICON_BUTTON_WIDTH = 48;

/**
 * The title's whole width: its box when the text fits (ShellLayout sizes the h1 to its text), else the text it clips,
 * a pixel more, since scrollWidth is a whole number and a rounding must never make a clipped title fit.
 * @param {HTMLElement} title
 */
function wholeTitleWidth(title) {
  return title.scrollWidth > title.clientWidth ? title.scrollWidth + 1 : title.getBoundingClientRect().width;
}

/**
 * How many of a compact top app bar's top-right items (from the first, the farthest from the corner) ShellLayout
 * moves into the bar's overflow menu: as few as leave the page title whole beside the rest
 * (resolveTopRightItemsInMenu), measured on the bar as drawn. It measures again when the bar's content changes (a new
 * title, an item's count, a page action), when the bar is resized and when fonts load. An item in the menu keeps the
 * width it had in the bar. Medium and wider bars, and a layout's own top-right slot, keep every item (`enabled`).
 * @param {object} options
 * @param {import("vue").Ref<boolean>} options.enabled
 * @param {import("vue").Ref<readonly { id: string }[]>} options.placements The top-right placements, in bar order.
 * @param {import("../support/pageActions.js").ShellPageActionsRegistry} options.pageActions The bar's page actions.
 * @param {import("vue").Ref<HTMLElement | null>} options.row The bar's row, whose width is the bar's.
 * @param {import("vue").Ref<HTMLElement | null>} options.headline The title's box.
 * @param {import("vue").Ref<HTMLElement | null>} options.items The box of the top-right items in the bar, each a child
 *   with `data-placement-id`.
 * @param {string} options.menuId The id of the element in the overflow menu that the items move into.
 * @returns {{ inMenu: import("vue").ComputedRef<number> }}
 */
function useShellTopRightOverflow({ enabled, placements, pageActions, row, headline, items, menuId }) {
  const measured = ref(0);
  const widths = new Map();
  let menuButtonWidth = ICON_BUTTON_WIDTH;
  let resizeObserver = null;
  let mutationObserver = null;
  const keepLast = computed(() => !pageActions.hasPrimary.value);
  const inMenu = computed(() => {
    if (!enabled.value) {
      return 0;
    }
    return Math.min(measured.value, Math.max(placements.value.length - (keepLast.value ? 1 : 0), 0));
  });

  function fit() {
    const rowElement = row.value;
    const headlineElement = headline.value;
    const itemsElement = items.value;
    const title = headlineElement ? headlineElement.querySelector(`#${PAGE_TITLE_ID}`) : null;
    // The items move into the menu only once it is there to take them.
    if (!enabled.value || !rowElement || !itemsElement || !title || !document.getElementById(menuId)) {
      measured.value = 0;
      return;
    }
    let inBar = 0;
    for (const element of itemsElement.querySelectorAll(":scope > [data-placement-id]")) {
      const width = element.getBoundingClientRect().width;
      widths.set(element.dataset.placementId, width);
      inBar += width;
    }
    const menuButton = rowElement.querySelector(".shell-page-actions-overflow");
    if (menuButton) {
      menuButtonWidth = menuButton.getBoundingClientRect().width;
    }
    const style = window.getComputedStyle(headlineElement);
    const titleRoom = headlineElement.clientWidth -
      Number.parseFloat(style.paddingInlineStart) -
      Number.parseFloat(style.paddingInlineEnd);
    measured.value = resolveTopRightItemsInMenu({
      room: titleRoom + inBar + (menuButton ? menuButtonWidth : 0),
      title: wholeTitleWidth(title),
      items: placements.value.map((entry) => widths.get(entry.id) ?? ICON_BUTTON_WIDTH),
      menuButton: menuButtonWidth,
      menuShown: pageActions.menuEntries.value.length > 0,
      keepLast: keepLast.value
    });
  }

  watch(
    [enabled, () => placements.value.map((entry) => entry.id).join("\n"), keepLast, () => pageActions.menuEntries.value.length],
    fit,
    { flush: "post" }
  );

  onMounted(() => {
    // The row is as wide as the bar whatever its items do, so a fit in its callback never resizes what it observes.
    resizeObserver = new ResizeObserver(fit);
    resizeObserver.observe(row.value);
    // A change inside the bar (the title, an item's count, a page action, an item moving) can change what fits.
    mutationObserver = new MutationObserver(fit);
    mutationObserver.observe(row.value, { childList: true, subtree: true, characterData: true });
    document.fonts.addEventListener("loadingdone", fit);
    void nextTick().then(fit);
  });

  onBeforeUnmount(() => {
    resizeObserver.disconnect();
    mutationObserver.disconnect();
    document.fonts.removeEventListener("loadingdone", fit);
  });

  return { inMenu };
}

export { useShellTopRightOverflow };
