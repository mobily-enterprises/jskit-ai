import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { PAGE_TITLE_ID } from "../navigation/shellNavigationRuntime.js";
import {
  ICON_BUTTON_WIDTH,
  WIDE_BAR_TITLE_FLOOR,
  contentWidth,
  wholeTitleWidth,
  widthInRow,
  widthOfChildren
} from "../support/appBarWidths.js";
import { SHELL_PAGE_ACTIONS_ID } from "../support/navigationPresentation.js";
import { resolveTopRightItemsInMenu, resolveWideBarItems } from "../support/topRightOverflow.js";

/**
 * How ShellLayout's top app bar lays out its top-right items, measured on the bar as drawn. A compact bar moves the
 * items it has no room for beside the whole title into its overflow menu, from the first, the farthest from the corner
 * (resolveTopRightItemsInMenu), and never shows their labels. An expanded or large bar shows their labels (an
 * account's name) only when the title, every page action and every labelled item fit; it and a medium bar, which
 * keeps its whole title and shows no labels, then fold their page actions (useShellPageActionsFold), then move items
 * into the menu, the same way (resolveWideBarItems). It measures again
 * when the bar's content changes (a new title, an item's count, a page action), when the bar is resized and when fonts
 * load. An item keeps the widths it had in the bar with its label and without, so a choice never undoes itself; an
 * item never drawn with its label counts its width without, and draws it once to be measured. A layout's own top-right
 * slot keeps every item as it is (`enabled`).
 * @param {object} options
 * @param {import("vue").Ref<boolean>} options.enabled
 * @param {import("vue").Ref<boolean>} options.compact Whether the bar is a compact one.
 * @param {import("vue").Ref<boolean>} options.wholeTitle Whether the title needs its whole width (a medium bar, which
 *   shows no labels), or that up to WIDE_BAR_TITLE_FLOOR.
 * @param {import("vue").Ref<readonly { id: string }[]>} options.placements The top-right placements, in bar order.
 * @param {import("../support/pageActions.js").ShellPageActionsRegistry} options.pageActions The bar's page actions.
 * @param {import("vue").Ref<HTMLElement | null>} options.row The bar's row, whose width is the bar's.
 * @param {import("vue").Ref<HTMLElement | null>} options.headline The title's box.
 * @param {import("vue").Ref<HTMLElement | null>} options.items The box of the top-right items in the bar, each a child
 *   with `data-placement-id`.
 * @param {string} options.menuId The id of the element in the overflow menu that the items move into.
 * @returns {{ inMenu: import("vue").ComputedRef<number>, showsLabels: import("vue").ComputedRef<boolean | null> }}
 *   `showsLabels` is null while it does not lay the items out.
 */
function useShellTopRightOverflow({ enabled, compact, wholeTitle, placements, pageActions, row, headline, items, menuId }) {
  const measured = ref(0);
  // A wider bar's choice, null until it has measured one.
  const labels = ref(/** @type {boolean | null} */ (null));
  const bareWidths = new Map();
  const labelledWidths = new Map();
  // What the items in the bar were drawn with, set once they have redrawn.
  let drawnLabels = null;
  let menuButtonWidth = ICON_BUTTON_WIDTH;
  let resizeObserver = null;
  let mutationObserver = null;
  const keepLast = computed(() => !pageActions.hasPrimary.value);
  const showsLabels = computed(() => {
    if (!enabled.value) {
      return null;
    }
    return compact.value || wholeTitle.value ? false : (labels.value ?? true);
  });
  const inMenu = computed(() => {
    if (!enabled.value) {
      return 0;
    }
    return Math.min(measured.value, Math.max(placements.value.length - (keepLast.value ? 1 : 0), 0));
  });

  // The width the title, the page actions, the overflow button and the items share: the row's, less its other
  // children (the leading button) and the title box's padding.
  function sharedRoom(rowElement, headlineElement, actionsBox, menuButton) {
    let room = contentWidth(rowElement) - (widthInRow(headlineElement) - contentWidth(headlineElement));
    for (const child of rowElement.children) {
      const shared = child === headlineElement || child === actionsBox || child === items.value ||
        (menuButton && child.contains(menuButton));
      if (!shared) {
        room -= widthInRow(child);
      }
    }
    return room;
  }

  // The page actions' widths: those that stay (the primary), and every foldable one, a folded one as it last drew.
  function actionWidths(actionsBox) {
    let primary = actionsBox ? widthOfChildren(actionsBox) : 0;
    let foldable = 0;
    for (const entry of pageActions.foldable.value) {
      if (entry.anchor?.childElementCount > 0) {
        const width = widthOfChildren(entry.anchor);
        primary -= width;
        foldable += width;
      } else if (pageActions.widths.has(entry.id)) {
        foldable += pageActions.widths.get(entry.id);
      } else {
        // An action not measured yet: the bar draws every action once first.
        return null;
      }
    }
    return { primary, foldable };
  }

  function fitWide(rowElement, headlineElement, title, menuButton, menuReady) {
    const actionsBox = rowElement.querySelector(`#${SHELL_PAGE_ACTIONS_ID}`);
    const actions = actionWidths(actionsBox);
    if (!actions) {
      return;
    }
    const whole = wholeTitleWidth(title);
    const foldable = pageActions.foldable.value;
    const choice = resolveWideBarItems({
      room: sharedRoom(rowElement, headlineElement, actionsBox, menuButton),
      title: wholeTitle.value ? whole : Math.min(whole, WIDE_BAR_TITLE_FLOOR),
      primary: actions.primary,
      actions: actions.foldable,
      items: placements.value.map((entry) => {
        const bare = bareWidths.get(entry.id) ?? ICON_BUTTON_WIDTH;
        return { labelled: wholeTitle.value ? Number.POSITIVE_INFINITY : (labelledWidths.get(entry.id) ?? bare), bare };
      }),
      menuButton: menuButtonWidth,
      menuShown: pageActions.menuEntries.value.some((entry) => !foldable.includes(entry)),
      keepLast: keepLast.value
    });
    labels.value = choice.labels;
    if (choice.labels) {
      measured.value = 0;
    } else if (!drawnLabels) {
      // Only the items drawn without their labels tell how many fit; with them, the redraw measures again.
      measured.value = menuReady ? choice.inMenu : 0;
    }
  }

  function fit() {
    const rowElement = row.value;
    const headlineElement = headline.value;
    const itemsElement = items.value;
    const title = headlineElement ? headlineElement.querySelector(`#${PAGE_TITLE_ID}`) : null;
    if (!enabled.value || !rowElement || !itemsElement || !title) {
      measured.value = 0;
      return;
    }
    // A choice of labels the items have not redrawn with yet: the redraw measures them (the watcher below).
    if (drawnLabels !== showsLabels.value) {
      return;
    }
    const drawnWidths = drawnLabels ? labelledWidths : bareWidths;
    let inBar = 0;
    for (const element of itemsElement.querySelectorAll(":scope > [data-placement-id]")) {
      const width = element.getBoundingClientRect().width;
      drawnWidths.set(element.dataset.placementId, width);
      inBar += width;
    }
    const menuButton = rowElement.querySelector(".shell-page-actions-overflow");
    if (menuButton) {
      menuButtonWidth = menuButton.getBoundingClientRect().width;
    }
    // The items move into the menu only once it is there to take them.
    const menuReady = Boolean(document.getElementById(menuId));
    if (!compact.value) {
      fitWide(rowElement, headlineElement, title, menuButton, menuReady);
      return;
    }
    if (!menuReady) {
      measured.value = 0;
      return;
    }
    measured.value = resolveTopRightItemsInMenu({
      room: contentWidth(headlineElement) + inBar + (menuButton ? menuButtonWidth : 0),
      title: wholeTitleWidth(title),
      items: placements.value.map((entry) => bareWidths.get(entry.id) ?? ICON_BUTTON_WIDTH),
      menuButton: menuButtonWidth,
      menuShown: pageActions.menuEntries.value.length > 0,
      keepLast: keepLast.value
    });
  }

  watch(
    [
      enabled,
      compact,
      wholeTitle,
      () => placements.value.map((entry) => entry.id).join("\n"),
      keepLast,
      () => pageActions.menuEntries.value.length
    ],
    fit,
    { flush: "post" }
  );

  // The items have redrawn with a new choice of labels.
  watch(showsLabels, (value) => {
    drawnLabels = value;
    fit();
  }, { flush: "post" });

  onMounted(() => {
    drawnLabels = showsLabels.value;
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

  return { inMenu, showsLabels };
}

export { useShellTopRightOverflow };
