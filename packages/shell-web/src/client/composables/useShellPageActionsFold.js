import { nextTick, onBeforeUnmount, onMounted, watch } from "vue";
import { PAGE_TITLE_ID } from "../navigation/shellNavigationRuntime.js";
import {
  ICON_BUTTON_WIDTH,
  WIDE_BAR_TITLE_FLOOR,
  contentWidth,
  wholeTitleWidth,
  widthInRow,
  widthOfChildren
} from "../support/appBarWidths.js";
import { resolveFoldedPageActions } from "../support/pageActions.js";

/**
 * The width a top app bar's row leaves its page actions and overflow button beside the title: the row's width less each
 * of its other items, where an item that grows (the title's box, a spacer) needs only the title, or nothing when it is
 * empty. The title needs its whole width when `wholeTitle`, else that up to WIDE_BAR_TITLE_FLOOR, past which it
 * truncates.
 * @param {HTMLElement} row
 * @param {HTMLElement} target The actions' box.
 * @param {Element | null} menuButton
 * @param {boolean} wholeTitle
 */
function actionsRoom(row, target, menuButton, wholeTitle) {
  const title = document.getElementById(PAGE_TITLE_ID);
  let room = contentWidth(row);
  for (const child of row.children) {
    if (child === target || (menuButton && child.contains(menuButton))) {
      continue;
    }
    room -= widthInRow(child);
    if (Number.parseFloat(window.getComputedStyle(child).flexGrow) > 0) {
      if (title && child.contains(title)) {
        const whole = wholeTitleWidth(title);
        room += contentWidth(child) - (wholeTitle ? whole : Math.min(whole, WIDE_BAR_TITLE_FLOOR));
      } else if (child.childElementCount === 0 && !child.textContent.trim()) {
        room += child.getBoundingClientRect().width;
      }
    }
  }
  return room;
}

/**
 * Folds a medium, expanded or large top app bar's page actions that don't fit beside its title into its overflow
 * menu, the last first (resolveFoldedPageActions), never the primary one nor the page's way out (`close`), measured on
 * the bar as drawn, so the overflow button and the bar's own items after the actions always stay on screen. A medium
 * bar keeps its whole title (`wholeTitle`); a wider one has room for its actions, so its title truncates first, down to
 * WIDE_BAR_TITLE_FLOOR. It measures again when the bar's
 * content changes (a new title, an action's label, a page's actions), when the bar is resized and when fonts load. A
 * folded action keeps the width it had in the bar (the registry's `widths`); a compact bar folds by its own rule
 * (`enabled`).
 * @param {object} options
 * @param {import("vue").Ref<boolean>} options.enabled
 * @param {import("vue").Ref<boolean>} options.wholeTitle Whether the actions fold to leave the title whole.
 * @param {import("../support/pageActions.js").ShellPageActionsRegistry} options.registry The bar's page actions.
 * @param {import("vue").Ref<HTMLElement | null>} options.target The actions' box, an item of the bar's row.
 * @param {() => boolean} options.ownMenu Whether the overflow menu holds the bar's own items now.
 */
function useShellPageActionsFold({ enabled, wholeTitle, registry, target, ownMenu }) {
  const widths = registry.widths;
  let menuButtonWidth = ICON_BUTTON_WIDTH;
  let row = null;
  let resizeObserver = null;
  let mutationObserver = null;

  function fit() {
    const targetElement = target.value;
    const foldable = registry.foldable.value;
    if (!enabled.value || !row || !targetElement || foldable.length === 0) {
      registry.fold(0);
      return;
    }
    // What the bar draws now: an action in the bar has its button in its slot.
    let inBar = 0;
    for (const entry of foldable) {
      if (entry.anchor?.childElementCount > 0) {
        const width = widthOfChildren(entry.anchor);
        widths.set(entry.id, width);
        inBar += width;
      }
    }
    for (const id of widths.keys()) {
      if (!foldable.some((entry) => entry.id === id)) {
        widths.delete(id);
      }
    }
    // An action that has never been in the bar has no width yet: every action shows once to be measured.
    if (foldable.some((entry) => !widths.has(entry.id))) {
      registry.fold(0);
      return;
    }
    const menuButton = row.querySelector(".shell-page-actions-overflow");
    if (menuButton) {
      menuButtonWidth = widthInRow(menuButton);
    }
    registry.fold(resolveFoldedPageActions({
      room: actionsRoom(row, targetElement, menuButton, wholeTitle.value),
      fixed: widthOfChildren(targetElement) - inBar,
      actions: foldable.map((entry) => widths.get(entry.id)),
      menuButton: menuButtonWidth,
      menuShown: ownMenu() || registry.menuEntries.value.some((entry) => !foldable.includes(entry))
    }));
  }

  watch([enabled, wholeTitle, () => registry.foldable.value.map((entry) => entry.id).join("\n")], fit, { flush: "post" });

  onMounted(() => {
    row = target.value.parentElement;
    // The row is as wide as the bar whatever its items do, so a fit in its callback never resizes what it observes.
    resizeObserver = new ResizeObserver(fit);
    resizeObserver.observe(row);
    // A change inside the bar (the title, an action's label, a page's actions, an action folding) can change what fits.
    mutationObserver = new MutationObserver(fit);
    mutationObserver.observe(row, { childList: true, subtree: true, characterData: true });
    document.fonts.addEventListener("loadingdone", fit);
    void nextTick().then(fit);
  });

  onBeforeUnmount(() => {
    resizeObserver.disconnect();
    mutationObserver.disconnect();
    document.fonts.removeEventListener("loadingdone", fit);
  });
}

export { useShellPageActionsFold };
