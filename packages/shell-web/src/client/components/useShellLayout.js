import { computed, ref } from "vue";
import { normalizeObject } from "@jskit-ai/kernel/shared/support/normalize";

const DEFAULT_ACTION_FALLBACK = Object.freeze({
  label: "",
  to: "",
  variant: "text",
  color: "secondary"
});

const DEFAULT_MENU_FALLBACK = Object.freeze({
  label: "",
  to: "/",
  icon: "$menu"
});

function normalizeLabeledItem(item, fallback, buildItem) {
  const source = normalizeObject(item);
  const fallbackSource = normalizeObject(fallback);
  const label = String(source.label || fallbackSource.label || "").trim();
  if (!label) {
    return null;
  }

  if (typeof buildItem !== "function") {
    return null;
  }

  return buildItem({
    source,
    fallbackSource,
    label
  });
}

function normalizeAction(action, fallback) {
  return normalizeLabeledItem(action, fallback, ({ source, fallbackSource, label }) => {
    return {
      label,
      to: String(source.to || fallbackSource.to || "").trim(),
      variant: String(source.variant || fallbackSource.variant || "text").trim(),
      color: String(source.color || fallbackSource.color || "secondary").trim()
    };
  });
}

function normalizeMenuItem(item, fallback) {
  return normalizeLabeledItem(item, fallback, ({ source, fallbackSource, label }) => {
    return {
      label,
      to: String(source.to || fallbackSource.to || "").trim() || "/",
      icon: String(source.icon || fallbackSource.icon || "$menu").trim() || "$menu"
    };
  });
}

function normalizeActionList(actions) {
  const sourceActions = Array.isArray(actions) ? actions : [];
  return sourceActions
    .map((item) => normalizeAction(item, DEFAULT_ACTION_FALLBACK))
    .filter(Boolean);
}

function normalizeMenuList(items) {
  const source = Array.isArray(items) ? items : [];
  return source
    .map((item) => normalizeMenuItem(item, DEFAULT_MENU_FALLBACK))
    .filter(Boolean);
}

function useShellLayout({ topLeftActions, topRightActions, menuItems } = {}) {
  const drawerOpen = ref(true);

  const resolvedTopLeftActions = computed(() => {
    const source = topLeftActions?.value;
    return normalizeActionList(source);
  });

  const resolvedTopRightActions = computed(() => {
    const source = topRightActions?.value;
    return normalizeActionList(source);
  });

  const resolvedMenuItems = computed(() => {
    const source = menuItems?.value;
    return normalizeMenuList(source);
  });

  function toggleDrawer() {
    drawerOpen.value = !drawerOpen.value;
  }

  return {
    drawerOpen,
    resolvedTopLeftActions,
    resolvedTopRightActions,
    resolvedMenuItems,
    toggleDrawer
  };
}

export { useShellLayout };
