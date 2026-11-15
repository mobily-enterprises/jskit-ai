import { onBeforeUnmount, onMounted } from "vue";
import { useRoute } from "vue-router";

// An open modal dialog: a Vuetify overlay that declares itself modal, as every `v-dialog` and `v-bottom-sheet` does
// (a bottom sheet is a dialog), JSKIT's own and an app's, while it is active.
const OPEN_MODAL_DIALOG = ".v-overlay.v-overlay--active[aria-modal='true']";
// A part of the page, as `ShellLayout` marks each: the app bar, the rail, the drawer, main, the navigation bar and the
// side sheet.
const SHELL_PAGE = "[data-shell-page]";
// What can open, close or reorder a dialog, or add a part of the page: a Vuetify overlay and a page part.
const WATCHED = `.v-overlay, ${SHELL_PAGE}`;

/**
 * Vuetify stacks each overlay it opens 10 above the one opened before (its inline z-index); at one z-index the later
 * in the document is on top.
 * @param {HTMLElement} first
 * @param {HTMLElement} second
 */
function stackOrder(first, second) {
  const difference = (Number.parseInt(first.style.zIndex, 10) || 0) - (Number.parseInt(second.style.zIndex, 10) || 0);
  if (difference !== 0) {
    return difference;
  }
  return first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
}

/**
 * Whether a batch of mutations can have opened, closed or reordered a dialog, or replaced a part of the page: an
 * overlay's class changed (Vuetify marks an open one `v-overlay--active`), or an overlay or a page part came or went.
 * Every other change on the page, such as a ripple or a field's focus class, is left at that.
 * @param {MutationRecord[]} records
 */
function concernsDialogs(records) {
  for (const record of records) {
    if (record.type === "attributes") {
      if (/** @type {Element} */ (record.target).classList.contains("v-overlay")) {
        return true;
      }
      continue;
    }
    for (const nodes of [record.addedNodes, record.removedNodes]) {
      for (const node of nodes) {
        if (node instanceof Element && (node.matches(WATCHED) || node.querySelector(WATCHED))) {
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * Makes the page behind an open modal dialog inert, as the WAI-ARIA dialog pattern does and as the dialog's scrim
 * already does for the pointer: while a `v-dialog` or `v-bottom-sheet` is open, every part of the page `ShellLayout`
 * marks with `data-shell-page` (the app bar, the rail, the drawer, main with its FAB, the navigation bar and the side
 * sheet) is `inert`, so a keyboard, assistive technology and accessibility checks such as axe skip it. Vuetify's
 * overlay layer, where it teleports dialogs, menus, tooltips and snackbars, is never made inert, so a menu or select
 * opened in the dialog works and a snackbar is announced; of two dialogs open at once, the lower is inert under the
 * upper. A dialog attached inside a part of the page (`attach`, `contained`) stays local to it and leaves the page
 * alone.
 *
 * It watches the document for Vuetify's overlays, so it sees every dialog, whoever renders it, without a dialog
 * component of its own. The page is live again as soon as the render that closes or unmounts its dialog ends, before
 * code that waits for it (`await nextTick()`) gives focus back. Focus then returns to the element that opened the
 * dialog when it has nowhere else to be: Vuetify's overlay gives focus to its activator during that render, while the
 * page is still inert, and a dialog opened from `v-model`, with no activator, gets none. It does not when the dialog
 * closed by leaving its page, where the shell's navigation places focus.
 */
function useShellInertBehindDialog() {
  const route = useRoute();
  /** @type {Map<HTMLElement, { opener: HTMLElement | null, path: string }>} each open dialog, its opener and page */
  const open = new Map();
  /** @type {Set<HTMLElement>} the dialogs this made inert under the one on top */
  const inertDialogs = new Set();
  /** @type {EventTarget | null} */
  let focused = null;
  /** @type {EventTarget | null} */
  let focusedBefore = null;
  /** @type {MutationObserver | null} */
  let observer = null;

  /** @param {FocusEvent} event */
  function trackFocus(event) {
    if (event.target !== focused) {
      focusedBefore = focused;
      focused = event.target;
    }
  }

  /**
   * The element that opened `dialog`: the one with focus as it opens, or the one before when the dialog has already
   * taken focus (a field that focuses itself as it mounts). None when focus was nowhere.
   * @param {HTMLElement} dialog
   */
  function openerOf(dialog) {
    const active = document.activeElement;
    const element = active && dialog.contains(active) ? focusedBefore : active;
    if (!(element instanceof HTMLElement) || element === document.body || !element.isConnected || dialog.contains(element)) {
      return null;
    }
    return element;
  }

  /** @param {boolean} inert */
  function setPageInert(inert) {
    for (const part of document.querySelectorAll(SHELL_PAGE)) {
      if (part instanceof HTMLElement && part.inert !== inert) {
        part.inert = inert;
      }
    }
  }

  /**
   * After dialogs close, focus their opener (the top dialog's first) when focus is lost: on the page body, in a closed
   * dialog or in an inert part. An opener that is gone, inert, or on a page the dialogs left is passed over.
   * @param {HTMLElement[]} closed The dialogs that closed, the top one first.
   */
  function returnFocus(closed) {
    const active = document.activeElement;
    const lost = !active ||
      active === document.body ||
      Boolean(active.closest("[inert]")) ||
      closed.some((dialog) => dialog.contains(active));
    if (!lost) {
      return;
    }
    for (const { opener, path } of closed.map((dialog) => open.get(dialog))) {
      if (path !== route.path || !opener?.isConnected || opener.closest("[inert]")) {
        continue;
      }
      opener.focus({ preventScroll: true });
      if (document.activeElement === opener) {
        return;
      }
    }
  }

  function update() {
    const dialogs = [...document.querySelectorAll(OPEN_MODAL_DIALOG)]
      .filter((dialog) => dialog instanceof HTMLElement && !dialog.closest(SHELL_PAGE))
      .sort(stackOrder);
    // A dialog's opener is read before anything turns inert, which takes focus from it.
    for (const dialog of dialogs) {
      if (!open.has(dialog)) {
        open.set(dialog, { opener: openerOf(dialog), path: route.path });
      }
    }
    const top = dialogs.at(-1);
    const lower = new Set(dialogs.filter((dialog) => dialog !== top && !dialog.contains(top)));
    for (const dialog of inertDialogs) {
      if (!lower.has(dialog)) {
        dialog.inert = false;
        inertDialogs.delete(dialog);
      }
    }
    for (const dialog of lower) {
      if (!dialog.inert) {
        dialog.inert = true;
        inertDialogs.add(dialog);
      }
    }
    const closed = [...open.keys()].filter((dialog) => !dialogs.includes(dialog)).sort(stackOrder).reverse();
    setPageInert(dialogs.length > 0);
    if (closed.length > 0) {
      returnFocus(closed);
      for (const dialog of closed) {
        open.delete(dialog);
      }
    }
  }

  onMounted(() => {
    document.addEventListener("focusin", trackFocus, true);
    observer = new MutationObserver((records) => {
      if (concernsDialogs(records)) {
        update();
      }
    });
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["class"] });
    update();
  });

  onBeforeUnmount(() => {
    document.removeEventListener("focusin", trackFocus, true);
    observer?.disconnect();
    observer = null;
    for (const dialog of inertDialogs) {
      dialog.inert = false;
    }
    inertDialogs.clear();
    open.clear();
    setPageInert(false);
  });
}

export { useShellInertBehindDialog };
