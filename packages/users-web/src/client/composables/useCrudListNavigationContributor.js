import { onScopeDispose, unref } from "vue";
import { useJskitNavigation } from "@jskit-ai/kernel/client/navigation";

function normalizeText(value) {
  return String(value ?? "").trim();
}

function findElementByAttribute(root, attributeName, value) {
  const normalizedValue = normalizeText(value);
  if (!root || !normalizedValue || typeof root.querySelectorAll !== "function") {
    return null;
  }
  return [...root.querySelectorAll(`[${attributeName}]`)]
    .find((element) => normalizeText(element.getAttribute?.(attributeName)) === normalizedValue) || null;
}

function findContributorRoot(documentObject, contributorId) {
  return findElementByAttribute(documentObject, "data-jskit-navigation-contributor-root", contributorId);
}

function hasVisibleRectangle(rectangle) {
  return Boolean(rectangle && rectangle.width > 0 && rectangle.height > 0);
}

function captureCrudListNavigationState({ documentObject = globalThis.document, contributorId = "" } = {}) {
  const root = findContributorRoot(documentObject, contributorId);
  if (!root) {
    return Object.freeze({});
  }
  const viewportHeight = Number(documentObject?.defaultView?.innerHeight) || Number(globalThis.innerHeight) || 0;
  const items = [...root.querySelectorAll?.("[data-jskit-list-item-key]") || []]
    .map((element) => ({
      element,
      itemKey: normalizeText(element.getAttribute?.("data-jskit-list-item-key")),
      rectangle: element.getBoundingClientRect?.()
    }))
    .filter(({ itemKey, rectangle }) =>
      itemKey &&
      hasVisibleRectangle(rectangle) &&
      rectangle.bottom > 0 &&
      (!viewportHeight || rectangle.top < viewportHeight)
    )
    .sort((left, right) => left.rectangle.top - right.rectangle.top);
  const anchor = items[0] || null;
  const activeElement = documentObject?.activeElement;
  const focusKey = root.contains?.(activeElement)
    ? normalizeText(activeElement?.getAttribute?.("data-jskit-focus-key"))
    : "";
  return Object.freeze({
    ...(anchor ? {
      anchor: Object.freeze({
        itemKey: anchor.itemKey,
        offsetY: Math.round(anchor.rectangle.top)
      })
    } : {}),
    ...(focusKey ? { focusKey } : {})
  });
}

function useCrudListNavigationContributor({
  id,
  records,
  documentObject = globalThis.document,
  windowObject = globalThis.window
} = {}) {
  const contributorId = normalizeText(id);
  if (!contributorId) {
    throw new TypeError("useCrudListNavigationContributor requires a stable id.");
  }
  const navigation = useJskitNavigation();
  const unregister = navigation.registerContributor({
    id: contributorId,
    version: 1,
    capture: () => captureCrudListNavigationState({ documentObject, contributorId }),
    isDataReady: () => !unref(records?.isFetching) && !unref(records?.showListSkeleton),
    resolveScrollTarget: (snapshot = {}) => {
      const itemKey = normalizeText(snapshot?.anchor?.itemKey);
      const offsetY = Number(snapshot?.anchor?.offsetY);
      if (!itemKey || !Number.isFinite(offsetY)) {
        return undefined;
      }
      const root = findContributorRoot(documentObject, contributorId);
      const currentItem = findElementByAttribute(root, "data-jskit-list-item-key", itemKey);
      if (!hasVisibleRectangle(currentItem?.getBoundingClientRect?.())) {
        return undefined;
      }
      return {
        itemKey,
        offsetY,
        scroll: ({ itemKey: targetItemKey, offsetY: targetOffsetY }, context) => {
          if (context.signal.aborted) {
            return;
          }
          const root = findContributorRoot(documentObject, contributorId);
          const item = findElementByAttribute(root, "data-jskit-list-item-key", targetItemKey);
          const rectangle = item?.getBoundingClientRect?.();
          if (!hasVisibleRectangle(rectangle)) {
            throw new Error("The saved list anchor is no longer available.");
          }
          const nextY = Math.max(0, Number(windowObject?.scrollY || 0) + rectangle.top - Number(targetOffsetY || 0));
          windowObject?.scrollTo?.({ left: Number(windowObject?.scrollX || 0), top: nextY, behavior: "auto" });
        }
      };
    },
    resolveFocusTarget: (snapshot = {}) => {
      const focusKey = normalizeText(snapshot.focusKey);
      if (!focusKey) {
        return undefined;
      }
      return {
        focusKey,
        focus: (context) => {
          if (context.signal.aborted) {
            return false;
          }
          const root = findContributorRoot(documentObject, contributorId);
          const target = findElementByAttribute(root, "data-jskit-focus-key", focusKey);
          if (!hasVisibleRectangle(target?.getBoundingClientRect?.()) || typeof target.focus !== "function") {
            return false;
          }
          target.focus({ preventScroll: true });
          return documentObject?.activeElement === target;
        }
      };
    }
  });
  onScopeDispose(unregister);
  return Object.freeze({ id: contributorId, unregister });
}

const __testables = Object.freeze({
  captureCrudListNavigationState,
  findElementByAttribute
});

export { __testables, useCrudListNavigationContributor };
