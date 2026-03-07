import { computed, ref } from "vue";

const DEFAULT_TOP_LEFT_ACTIONS = Object.freeze([
  Object.freeze({ label: "Workspace", to: "/app", variant: "text", color: "primary" }),
  Object.freeze({ label: "Home", to: "/", variant: "text", color: "secondary" })
]);

const DEFAULT_TOP_RIGHT_ACTIONS = Object.freeze([
  Object.freeze({ label: "Alerts", to: "/console", variant: "text", color: "secondary" }),
  Object.freeze({ label: "Help", to: "/", variant: "text", color: "secondary" })
]);

const DEFAULT_MENU_ITEMS = Object.freeze([
  Object.freeze({ label: "App", to: "/app", icon: "$home" }),
  Object.freeze({ label: "Admin", to: "/admin", icon: "$settings" }),
  Object.freeze({ label: "Console", to: "/console", icon: "$console" })
]);

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

function normalizeActionList(actions, defaults) {
  const source = Array.isArray(actions) && actions.length > 0 ? actions : defaults;
  return source
    .map((item, index) => normalizeAction(item, defaults[index]))
    .filter(Boolean);
}

function normalizeMenuList(items, defaults) {
  const source = Array.isArray(items) && items.length > 0 ? items : defaults;
  return source
    .map((item, index) => normalizeMenuItem(item, defaults[index]))
    .filter(Boolean);
}

function useShellLayout({ topLeftActions, topRightActions, menuItems } = {}) {
  const drawerOpen = ref(true);

  const resolvedTopLeftActions = computed(() => {
    const source = topLeftActions?.value;
    return normalizeActionList(source, DEFAULT_TOP_LEFT_ACTIONS);
  });

  const resolvedTopRightActions = computed(() => {
    const source = topRightActions?.value;
    return normalizeActionList(source, DEFAULT_TOP_RIGHT_ACTIONS);
  });

  const resolvedMenuItems = computed(() => {
    const source = menuItems?.value;
    return normalizeMenuList(source, DEFAULT_MENU_ITEMS);
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
