import { computed, shallowRef } from "vue";
import { NavigationFailureType, isNavigationFailure } from "vue-router";
import { staysOnSamePage } from "@jskit-ai/kernel/client";
import { isRecord } from "@jskit-ai/kernel/shared/support/normalize";
import { pageDocument, pageWindow } from "../browser.js";

const SHELL_NAVIGATION_RUNTIME_KEY = "jskit.shell-web.runtime.navigation.client";
// The tab's trail rides in each history entry's state: a refresh keeps it, a new tab or a pasted link starts empty,
// and the browser's Back and Forward bring back the trail each entry had.
const TRAIL_STATE_KEY = "jskitTrail";
const FOCUS_RETRY_MS = 100;
const FOCUS_ATTEMPTS = 15;
const PAGE_TITLE_ID = "jskit-shell-page-title";

/**
 * A page's declared parent: the nearest `meta.jskit.parent` from the page's own route record up through its layout
 * records, stopping below the surface root. A string is a path on the page's own surface (`:param` segments come from
 * the current route); `{ surface, path }` names another surface. Null on a top-level destination.
 * @param {readonly import("vue-router").RouteRecordNormalized[]} matched
 * @returns {{ record: import("vue-router").RouteRecordNormalized, surface: string, path: string } | null}
 */
function resolvePageParent(matched) {
  for (let index = matched.length - 1; index >= 0; index -= 1) {
    const record = matched[index];
    const jskitMeta = isRecord(record.meta?.jskit) ? record.meta.jskit : {};
    if (jskitMeta.surface) {
      return null;
    }
    const parent = jskitMeta.parent;
    if (typeof parent === "string" && parent.trim()) {
      return {
        record,
        surface: "",
        path: parent.trim()
      };
    }
    if (isRecord(parent) && String(parent.path || "").trim()) {
      return {
        record,
        surface: String(parent.surface || "").trim(),
        path: String(parent.path).trim()
      };
    }
  }
  return null;
}

/**
 * A page's declared app bar title: the nearest `meta.jskit.title`, a message key or plain text; "" when none.
 * @param {readonly import("vue-router").RouteRecordNormalized[]} matched
 */
function resolvePageTitle(matched) {
  for (let index = matched.length - 1; index >= 0; index -= 1) {
    const title = matched[index].meta?.jskit?.title;
    if (typeof title === "string" && title.trim()) {
      return title.trim();
    }
  }
  return "";
}

function normalizeTrail(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((step) => isRecord(step) && typeof step.path === "string" && step.path.startsWith("/"))
    .map((step) => ({
      path: step.path,
      scroll: {
        left: Number(step.scroll?.left) || 0,
        top: Number(step.scroll?.top) || 0
      }
    }));
}

function cssAttributeValue(value) {
  return String(value).replace(/["\\]/gu, "\\$&");
}

/**
 * @typedef {object} ShellPageClose
 * @property {() => string} label The close's label, a message key or plain text.
 * @property {() => unknown} close What choosing it does, such as a form's Cancel.
 */

/**
 * Claims of one kind, the latest on top: `top` is the latest claim's value, and releasing a claim shows the one below
 * it again.
 * @template T
 * @returns {{ top: import("vue").ComputedRef<T | null>, claim: (value: T) => () => void }}
 */
function createClaimStack() {
  const claims = shallowRef([]);
  return {
    top: computed(() => claims.value.at(-1)?.value ?? null),
    claim(value) {
      const entry = { value };
      claims.value = [...claims.value, entry];
      return () => {
        claims.value = claims.value.filter((candidate) => candidate !== entry);
      };
    }
  };
}

/**
 * The shell's Up navigation (Material's Up and Back model): one trail per browser tab, kept in history state.
 * In-app navigation to another inner page pushes the page left; same-page changes, replacements and top-level
 * destinations do not, and a top-level destination resets it. Up returns to the trail's last page when it still
 * opens, otherwise to the page's declared parent, never to sign-in or outside the app; it restores that page's scroll
 * and focuses the element that opened the page left, or the page title.
 * @param {object} options
 * @param {import("vue-router").Router} options.router
 */
function createShellNavigationRuntime({ router }) {
  const trail = shallowRef([]);
  const titleClaims = createClaimStack();
  const pageTitleSource = titleClaims.top;
  const closeClaims = createClaimStack();
  const pageClose = closeClaims.top;
  const visibleParentPanes = shallowRef(0);
  const removeHooks = [];
  let current = {
    id: "",
    trail: [],
    fallback: null,
    position: -1
  };
  let pending = null;
  let leavingScroll = null;
  let mountedShells = 0;
  let focusTimer = null;
  let sequence = 0;

  function nextEntryId() {
    sequence += 1;
    return `${Date.now().toString(36)}-${sequence}`;
  }

  function samePage(to, from) {
    if (to.path === from.path) {
      return true;
    }
    return staysOnSamePage(to, from) && resolvePageParent(to.matched)?.record === resolvePageParent(from.matched)?.record;
  }

  function opens(path) {
    const resolved = router.resolve(path);
    return resolved.matched.length > 0 && resolved.name !== "not-found";
  }

  function sameLocation(left, right) {
    return router.resolve(left).fullPath === router.resolve(right).fullPath;
  }

  function pushedTrail(to, from) {
    if (from.matched.length === 0 || mountedShells === 0) {
      return [];
    }
    if (samePage(to, from)) {
      return current.trail;
    }
    if (!resolvePageParent(to.matched)) {
      return [];
    }
    return [
      ...current.trail,
      {
        path: from.fullPath,
        scroll: leavingScroll || {
          left: 0,
          top: 0
        }
      }
    ];
  }

  function replacedTrail(steps, to) {
    if (!resolvePageParent(to.matched)) {
      return [];
    }
    const top = steps.at(-1);
    if (top && router.resolve(top.path).path === to.path) {
      return steps.slice(0, -1);
    }
    return steps;
  }

  function clearFocusTimer() {
    if (focusTimer !== null) {
      pageWindow()?.clearTimeout(focusTimer);
      focusTimer = null;
    }
  }

  function findOpener(documentRef, leftPath) {
    const resolved = router.resolve(leftPath);
    const hrefs = [...new Set([resolved.href, router.resolve(resolved.path).href])];
    for (const href of hrefs) {
      const value = cssAttributeValue(href);
      const candidates = documentRef.querySelectorAll(`[data-jskit-opens="${value}"], main a[href="${value}"]`);
      for (const candidate of candidates) {
        if (candidate.getClientRects().length > 0) {
          return candidate;
        }
      }
    }
    return null;
  }

  // After Up or Back, focus the element that opened the page left, or else the page title. The next navigation
  // cancels it (handleBeforeEach), and so does focus moved since it was scheduled: a person already typing in a field
  // keeps the caret there.
  function scheduleFocus(leftPath) {
    clearFocusTimer();
    const windowRef = pageWindow();
    if (!windowRef) {
      return;
    }
    const focusedWhenScheduled = pageDocument()?.activeElement || null;
    let attempts = 0;
    const tryFocus = () => {
      focusTimer = null;
      const documentRef = pageDocument();
      if (!documentRef) {
        return;
      }
      const focused = documentRef.activeElement;
      if (focused && focused !== documentRef.body && focused !== focusedWhenScheduled) {
        return;
      }
      const opener = findOpener(documentRef, leftPath);
      if (opener) {
        opener.focus({ preventScroll: true });
        return;
      }
      attempts += 1;
      if (attempts < FOCUS_ATTEMPTS) {
        focusTimer = windowRef.setTimeout(tryFocus, FOCUS_RETRY_MS);
        return;
      }
      documentRef.getElementById(PAGE_TITLE_ID)?.focus({ preventScroll: true });
    };
    focusTimer = windowRef.setTimeout(tryFocus, 0);
  }

  function handleBeforeEach(to, from) {
    clearFocusTimer();
    if (pending && !pending.redirected && pending.fallback && to.redirectedFrom && sameLocation(to.redirectedFrom.fullPath, pending.target)) {
      // The trail's page now redirects (no access, workspace left): go to the declared parent instead.
      pending = {
        ...pending,
        target: pending.fallback.path,
        trail: pending.fallback.trail,
        scroll: null,
        fallback: null,
        redirected: true
      };
      return pending.target;
    }
    const windowRef = pageWindow();
    if (windowRef && from.matched.length > 0) {
      leavingScroll = {
        left: windowRef.scrollX,
        top: windowRef.scrollY
      };
      const state = windowRef.history.state;
      if (isRecord(state) && state.restoreScroll) {
        // The position Up returned to has been used; a later replacement of this entry must not reuse it.
        const { restoreScroll: _used, ...rest } = state;
        windowRef.history.replaceState(rest, "");
      }
    }
    return true;
  }

  function handleAfterEach(to, from, failure) {
    const windowRef = pageWindow();
    if (!windowRef) {
      return;
    }
    if (failure) {
      const plan = pending;
      pending = null;
      if (plan?.fallback && !plan.redirected && isNavigationFailure(failure, NavigationFailureType.aborted)) {
        // The trail's page refused to open: go to the declared parent instead.
        navigate({
          target: plan.fallback.path,
          trail: plan.fallback.trail,
          scroll: null,
          focusPath: plan.focusPath,
          fallback: null,
          replace: plan.replace,
          redirected: true
        });
      }
      return;
    }

    const state = isRecord(windowRef.history.state) ? windowRef.history.state : {};
    const stored = isRecord(state[TRAIL_STATE_KEY]) ? state[TRAIL_STATE_KEY] : null;
    let entry;
    let fallback = null;
    let focusPath = "";
    if (pending) {
      entry = {
        id: nextEntryId(),
        trail: pending.trail
      };
      fallback = pending.fallback;
      focusPath = pending.focusPath;
      pending = null;
    } else if (stored && stored.id && stored.id !== current.id) {
      // A refresh, or the browser's Back or Forward: the entry keeps the trail it had.
      entry = {
        id: String(stored.id),
        trail: normalizeTrail(stored.trail)
      };
      if (Number(state.position) < current.position) {
        focusPath = from.fullPath;
      }
    } else if (stored && stored.id === current.id) {
      entry = {
        id: current.id,
        trail: replacedTrail(current.trail, to)
      };
    } else {
      entry = {
        id: nextEntryId(),
        trail: pushedTrail(to, from)
      };
    }

    windowRef.history.replaceState({
      ...state,
      [TRAIL_STATE_KEY]: entry
    }, "");
    current = {
      ...entry,
      fallback,
      position: Number(state.position)
    };
    trail.value = entry.trail;
    if (focusPath) {
      scheduleFocus(focusPath);
    }
  }

  function navigate(plan) {
    pending = plan;
    const location = router.resolve(plan.target);
    const destination = {
      path: location.path,
      query: location.query,
      hash: location.hash,
      state: plan.scroll ? { restoreScroll: plan.scroll } : {}
    };
    return plan.replace ? router.replace(destination) : router.push(destination);
  }

  function install() {
    removeHooks.push(router.beforeEach(handleBeforeEach), router.afterEach(handleAfterEach));
  }

  function dispose() {
    for (const remove of removeHooks.splice(0)) {
      remove();
    }
    clearFocusTimer();
  }

  /**
   * Up: the trail's last page when it still opens, otherwise the declared parent.
   * @param {string} parentTarget The page's declared parent, resolved to a path; "" when it has none.
   */
  function up(parentTarget) {
    const steps = current.trail;
    const top = steps.at(-1);
    const rest = steps.slice(0, -1);
    const focusPath = router.currentRoute.value.fullPath;
    const fallback = parentTarget && opens(parentTarget) ? { path: parentTarget, trail: rest } : null;
    if (top && opens(top.path)) {
      return navigate({
        target: top.path,
        trail: rest,
        scroll: top.scroll,
        focusPath,
        fallback,
        replace: false,
        redirected: false
      });
    }
    if (fallback) {
      return navigate({
        target: fallback.path,
        trail: rest,
        scroll: null,
        focusPath,
        fallback: null,
        replace: false,
        redirected: false
      });
    }
    return Promise.resolve();
  }

  /**
   * Leaves a finished page (Save or Cancel on a new or edit page) by replacing its entry, so neither Up nor Back
   * reopens it: to `target` when given, otherwise back to where it was opened from, or else its declared parent. A
   * target that is the page the form was opened from, given without a query or hash of its own, returns to that entry
   * as it was: its list query (filters, search, sort, page) and scroll.
   * @param {import("vue-router").RouteLocationRaw} target
   * @param {string} parentTarget
   */
  function finish(target, parentTarget) {
    const top = current.trail.at(-1);
    const destination = target || (top && opens(top.path) ? top.path : parentTarget);
    if (!destination) {
      return Promise.resolve();
    }
    const resolved = router.resolve(destination);
    const returning = Boolean(top && router.resolve(top.path).path === resolved.path);
    const bare = Object.keys(resolved.query).length === 0 && !resolved.hash;
    return navigate({
      target: returning && bare ? top.path : resolved.fullPath,
      trail: replacedTrail(current.trail, resolved),
      scroll: returning ? top.scroll : null,
      focusPath: returning ? router.currentRoute.value.fullPath : "",
      fallback: null,
      replace: true,
      redirected: false
    });
  }

  /**
   * A page Up returned to says its record is gone or forbidden: replace it with the parent of the page Up left.
   * Elsewhere the page shows its own not-found state.
   */
  function pageUnavailable() {
    const fallback = current.fallback;
    if (!fallback) {
      return false;
    }
    current = {
      ...current,
      fallback: null
    };
    void navigate({
      target: fallback.path,
      trail: fallback.trail,
      scroll: null,
      focusPath: "",
      fallback: null,
      replace: true,
      redirected: true
    });
    return true;
  }

  /**
   * Shows a title in the app bar while the caller lives, over earlier claims; returns its release, which shows the
   * previous claim's title again (the route's title once none is left).
   * @param {() => string} source
   */
  function setPageTitle(source) {
    return titleClaims.claim(source);
  }

  /**
   * Turns the app bar's Up arrow into a close (X) that runs `close.close`, labelled `close.label()`, while the caller
   * lives, over earlier claims; returns its release, which gives the arrow back once none is left.
   * @param {ShellPageClose} close
   */
  function setPageClose(close) {
    return closeClaims.claim(close);
  }

  /** Marks a parent pane as visible beside the page (list-detail), so the page shows no Up arrow; returns its release. */
  function showParentPane() {
    visibleParentPanes.value += 1;
    let released = false;
    return () => {
      if (!released) {
        released = true;
        visibleParentPanes.value -= 1;
      }
    };
  }

  /** Counts a mounted shell layout: only pages inside the shell enter the trail. Returns its release. */
  function attachShell() {
    mountedShells += 1;
    let released = false;
    return () => {
      if (!released) {
        released = true;
        mountedShells -= 1;
      }
    };
  }

  return {
    trail,
    pageTitleSource,
    pageClose,
    visibleParentPanes,
    install,
    dispose,
    up,
    finish,
    pageUnavailable,
    setPageTitle,
    setPageClose,
    showParentPane,
    attachShell
  };
}

export {
  PAGE_TITLE_ID,
  SHELL_NAVIGATION_RUNTIME_KEY,
  TRAIL_STATE_KEY,
  createShellNavigationRuntime,
  resolvePageParent,
  resolvePageTitle
};
