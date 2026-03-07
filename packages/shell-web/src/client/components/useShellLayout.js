import { computed, ref } from "vue";

const DEFAULT_ACTION_FALLBACK = Object.freeze({
  label: "",
  to: "",
  variant: "text",
  color: "secondary"
});

const DEFAULT_MENU_FALLBACK = Object.freeze({
  label: "",
  to: "/app",
  icon: "$menu"
});

function normalizeObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value;
}

function normalizeAction(action, fallback) {
  const source = normalizeObject(action);
  const fallbackSource = normalizeObject(fallback);
  const label = String(source.label || fallbackSource.label || "").trim();
  if (!label) {
    return null;
  }

  return {
    label,
    to: String(source.to || fallbackSource.to || "").trim(),
    variant: String(source.variant || fallbackSource.variant || "text").trim(),
    color: String(source.color || fallbackSource.color || "secondary").trim()
  };
}

function normalizeMenuItem(item, fallback) {
  const source = normalizeObject(item);
  const fallbackSource = normalizeObject(fallback);
  const label = String(source.label || fallbackSource.label || "").trim();
  if (!label) {
    return null;
  }

  return {
    label,
    to: String(source.to || fallbackSource.to || "").trim() || "/app",
    icon: String(source.icon || fallbackSource.icon || "$menu").trim() || "$menu"
  };
}

function normalizeActionList(actions) {
  const source = Array.isArray(actions) ? actions : [];
  return source
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
