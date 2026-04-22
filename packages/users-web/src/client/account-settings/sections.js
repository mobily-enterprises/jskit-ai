import {
  computed,
  inject,
  onBeforeUnmount,
  onMounted,
  ref
} from "vue";
import { useWebPlacementContext } from "@jskit-ai/shell-web/client/placement";

const ACCOUNT_SETTINGS_SECTION_TARGET = "account-settings:sections";
const EMPTY_ACCOUNT_SETTINGS_SECTIONS = Object.freeze([]);
const RESERVED_ACCOUNT_SETTINGS_SECTION_VALUES = Object.freeze([
  "profile",
  "preferences",
  "notifications"
]);
const WEB_PLACEMENT_RUNTIME_INJECTION_KEY = "jskit.shell-web.runtime.web-placement.client";

function normalizeAccountSettingsSectionEntry(entry = null) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return null;
  }

  const props = entry?.props && typeof entry.props === "object" && !Array.isArray(entry.props)
    ? entry.props
    : {};
  const value = String(props.value || entry.value || "").trim().toLowerCase();
  const title = String(props.title || entry.title || "").trim();
  const component = entry.component;
  if (!value || !title || !component) {
    return null;
  }

  return Object.freeze({
    value,
    title,
    component,
    order: Number.isFinite(Number(entry.order)) ? Number(entry.order) : 500,
    usesSharedRuntime: props.usesSharedRuntime === true || entry.usesSharedRuntime === true
  });
}

function sortAccountSettingsSections(entries = []) {
  return Object.freeze(
    [...entries].sort((left, right) => {
      const orderDelta = left.order - right.order;
      if (orderDelta !== 0) {
        return orderDelta;
      }
      return left.value.localeCompare(right.value);
    })
  );
}

function resolveAccountSettingsSections(entries = []) {
  const seen = new Set(RESERVED_ACCOUNT_SETTINGS_SECTION_VALUES);
  const normalized = [];

  for (const entry of Array.isArray(entries) ? entries : []) {
    const resolved = normalizeAccountSettingsSectionEntry(entry);
    if (!resolved || seen.has(resolved.value)) {
      continue;
    }

    seen.add(resolved.value);
    normalized.push(resolved);
  }

  return sortAccountSettingsSections(normalized);
}

function useAccountSettingsSections() {
  const placementRuntime = inject(WEB_PLACEMENT_RUNTIME_INJECTION_KEY, null);
  const { context: placementContext } = useWebPlacementContext();
  const revision = ref(
    placementRuntime && typeof placementRuntime.getRevision === "function"
      ? placementRuntime.getRevision()
      : 0
  );
  let unsubscribe = null;

  onMounted(() => {
    if (!placementRuntime || typeof placementRuntime.subscribe !== "function") {
      return;
    }
    unsubscribe = placementRuntime.subscribe((event = {}) => {
      const nextRevision = Number(event.revision);
      revision.value = Number.isInteger(nextRevision) ? nextRevision : revision.value + 1;
    });
  });

  onBeforeUnmount(() => {
    if (typeof unsubscribe === "function") {
      unsubscribe();
      unsubscribe = null;
    }
  });

  return computed(() => {
    void revision.value;
    if (!placementRuntime || typeof placementRuntime.getPlacements !== "function") {
      return EMPTY_ACCOUNT_SETTINGS_SECTIONS;
    }

    const placements = placementRuntime.getPlacements({
      surface: "account",
      target: ACCOUNT_SETTINGS_SECTION_TARGET,
      context: placementContext.value
    });
    return resolveAccountSettingsSections(placements);
  });
}

export {
  ACCOUNT_SETTINGS_SECTION_TARGET,
  EMPTY_ACCOUNT_SETTINGS_SECTIONS,
  RESERVED_ACCOUNT_SETTINGS_SECTION_VALUES,
  normalizeAccountSettingsSectionEntry,
  resolveAccountSettingsSections,
  sortAccountSettingsSections,
  useAccountSettingsSections
};
