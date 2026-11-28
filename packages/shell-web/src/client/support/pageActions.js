import { computed, ref, shallowRef } from "vue";

/**
 * The page actions of the top app bar that owns them (useShellAppBar()), for its overflow menu. A compact bar keeps
 * one trailing item so the title has the room: the page's primary action (a form's Save), or else the bar's own item
 * nearest the corner (the account avatar); every other action and item is in the overflow menu. A wider bar keeps the
 * actions that fit beside the whole title and folds the rest, the last first (ShellPageActionsTarget measures them).
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
 * @property {boolean} pending Its action is running (`pending` or `loading`).
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
 * @property {import("vue").ComputedRef<ShellPageActionEntry[]>} foldable The actions a bar folds when it has no room
 *   for them, in bar order: every one but the primary and the `overflow` ones.
 * @property {(count: number) => void} fold How many foldable actions, from the last, the bar has no room for.
 * @property {Map<string, number>} widths Each foldable action's width with its margins, by id, as the bar last drew it,
 *   kept while it is folded (useShellPageActionsFold measures them).
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
  foldable: computed(() => []),
  fold() {},
  widths: new Map(),
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

/** @param {ShellPageActionEntry} entry */
function isFoldable(entry) {
  return !entry.state.value.primary && !entry.state.value.overflow;
}

/**
 * The actions in the overflow menu, in bar order: those marked `overflow`, on compact windows every action but the
 * primary one, and on wider ones the last `folded` of the others, which the bar has no room for.
 * @param {readonly ShellPageActionEntry[]} entries In bar order.
 * @param {boolean} compact
 * @param {number} [folded]
 */
function overflowEntries(entries, compact, folded = 0) {
  const foldable = entries.filter(isFoldable);
  const foldedEntries = new Set(folded > 0 ? foldable.slice(-folded) : []);
  return entries.filter((entry) =>
    entry.state.value.overflow || (compact ? !entry.state.value.primary : foldedEntries.has(entry))
  );
}

/**
 * The top app bar's page actions: each ShellPageAction registers while it lives, and the bar's overflow menu shows
 * the ones that go there.
 * @param {{ isCompact: import("vue").Ref<boolean> }} options
 * @returns {ShellPageActionsRegistry}
 */
function createShellPageActionsRegistry({ isCompact }) {
  const entries = shallowRef(/** @type {ShellPageActionEntry[]} */ ([]));
  const folded = ref(0);
  const ordered = computed(() => [...entries.value].sort(documentOrder));
  const foldable = computed(() => ordered.value.filter(isFoldable));
  const menuEntries = computed(() => overflowEntries(ordered.value, isCompact.value, folded.value));
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

  /** @param {number} count */
  function fold(count) {
    folded.value = count;
  }

  return {
    menuEntries,
    hasPrimary,
    foldable,
    fold,
    widths: new Map(),
    register,
    inMenu
  };
}

/**
 * How many of a medium, expanded or large top app bar's foldable page actions (in bar order) go into its overflow
 * menu: the fewest, the last first, that leave the rest, the bar's other actions and the overflow button within the
 * room the title leaves them (useShellPageActionsFold: a medium bar's whole title, a wider bar's up to its floor); all
 * of them when even that is too wide, and the title is clipped beside what stays.
 * @param {object} options
 * @param {number} options.room The width the actions and the overflow button share beside the title.
 * @param {number} options.fixed The width of the actions that stay in the bar whatever room is left (the primary).
 * @param {readonly number[]} options.actions Each foldable action's width with its margins, in bar order.
 * @param {number} options.menuButton The overflow button's width.
 * @param {boolean} options.menuShown Whether the bar shows the overflow button anyway, for the menu's own actions or
 *   the bar's own items.
 * @returns {number} How many actions, from the last, are in the menu.
 */
function resolveFoldedPageActions({ room, fixed, actions, menuButton, menuShown }) {
  let inBar = actions.reduce((total, width) => total + width, fixed);
  for (let folded = 0; folded < actions.length; folded += 1) {
    if (inBar + (menuShown || folded > 0 ? menuButton : 0) <= room) {
      return folded;
    }
    inBar -= actions[actions.length - 1 - folded];
  }
  return actions.length;
}

export {
  NO_SHELL_PAGE_ACTIONS_REGISTRY,
  SHELL_PAGE_ACTIONS_REGISTRY_KEY,
  createShellPageActionsRegistry,
  overflowEntries,
  resolveFoldedPageActions
};
