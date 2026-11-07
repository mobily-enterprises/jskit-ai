import { computed, shallowRef } from "vue";

/**
 * The page actions of the top app bar that owns them (useShellAppBar()), for its overflow menu. A compact bar keeps
 * one trailing item so the title has the room: the page's primary action (a form's Save), or else the bar's own item
 * nearest the corner (the account avatar); every other action and item is in the overflow menu.
 */
const SHELL_PAGE_ACTIONS_REGISTRY_KEY = "jskit.shell-web.layout.page-actions-registry";
// Node.DOCUMENT_POSITION_PRECEDING and DOCUMENT_POSITION_FOLLOWING, without the browser's Node.
const PRECEDING = 2;
const FOLLOWING = 4;

/**
 * @typedef {object} ShellPageActionState
 * @property {string} label The resolved label, also the menu item's title.
 * @property {string} icon
 * @property {unknown} to
 * @property {string | undefined} href
 * @property {boolean} replace
 * @property {string | undefined} download
 * @property {string | undefined} color
 * @property {boolean} primary
 * @property {boolean} overflow
 * @property {boolean} disabled
 * @property {boolean} loading
 */

/**
 * @typedef {object} ShellPageActionEntry
 * @property {string} id
 * @property {import("vue").ComputedRef<ShellPageActionState>} state
 * @property {Record<string, unknown>} attrs The action's own attributes (data-testid, target, ...).
 * @property {(event: Event) => void} activate What choosing the action does.
 * @property {Element | Comment | null} anchor Where the action sits in the bar, for its order.
 */

/**
 * @typedef {object} ShellPageActionsRegistry
 * @property {import("vue").ComputedRef<ShellPageActionEntry[]>} menuEntries The overflow menu's actions, in bar order.
 * @property {import("vue").ComputedRef<boolean>} hasPrimary Whether the bar shows a primary action.
 * @property {(entry: ShellPageActionEntry) => { placed: () => void, release: () => void }} register
 * @property {(entry: ShellPageActionEntry) => boolean} inMenu
 */

/**
 * Actions outside a bar that owns them (no ShellLayout, no useShellAppBar()) render where they are written, with no
 * overflow menu.
 * @type {ShellPageActionsRegistry}
 */
const NO_SHELL_PAGE_ACTIONS_REGISTRY = {
  menuEntries: computed(() => []),
  hasPrimary: computed(() => false),
  register: () => ({ placed() {}, release() {} }),
  inMenu: () => false
};

function documentOrder(left, right) {
  if (!left.anchor || !right.anchor || left.anchor === right.anchor) {
    return 0;
  }
  const position = left.anchor.compareDocumentPosition(right.anchor);
  if (position & FOLLOWING) {
    return -1;
  }
  return position & PRECEDING ? 1 : 0;
}

/**
 * The actions in the overflow menu, in bar order: those marked `overflow`, and on compact windows every action but
 * the primary one.
 * @param {readonly ShellPageActionEntry[]} entries In bar order.
 * @param {boolean} compact
 */
function overflowEntries(entries, compact) {
  return entries.filter((entry) => entry.state.value.overflow || (compact && !entry.state.value.primary));
}

/**
 * The top app bar's page actions: each ShellPageAction registers while it lives, and the bar's overflow menu shows
 * the ones that go there.
 * @param {{ isCompact: import("vue").Ref<boolean> }} options
 * @returns {ShellPageActionsRegistry}
 */
function createShellPageActionsRegistry({ isCompact }) {
  const entries = shallowRef(/** @type {ShellPageActionEntry[]} */ ([]));
  const ordered = computed(() => [...entries.value].sort(documentOrder));
  const menuEntries = computed(() => overflowEntries(ordered.value, isCompact.value));
  const hasPrimary = computed(() =>
    ordered.value.some((entry) => entry.state.value.primary && !entry.state.value.overflow)
  );

  /**
   * @param {ShellPageActionEntry} entry
   * @returns {{ placed: () => void, release: () => void }} `placed()` once its anchor is in the bar; `release()`.
   */
  function register(entry) {
    entries.value = [...entries.value, entry];
    return {
      placed() {
        entries.value = [...entries.value];
      },
      release() {
        entries.value = entries.value.filter((candidate) => candidate !== entry);
      }
    };
  }

  /** @param {ShellPageActionEntry} entry */
  function inMenu(entry) {
    return menuEntries.value.includes(entry);
  }

  return {
    menuEntries,
    hasPrimary,
    register,
    inMenu
  };
}

export {
  NO_SHELL_PAGE_ACTIONS_REGISTRY,
  SHELL_PAGE_ACTIONS_REGISTRY_KEY,
  createShellPageActionsRegistry,
  overflowEntries
};
