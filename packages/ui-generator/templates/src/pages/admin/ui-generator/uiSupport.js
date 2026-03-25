import { computed } from "vue";
import { useRoute } from "vue-router";
import { usePaths } from "@jskit-ai/users-web/client/composables/usePaths";

const UI_GENERATOR_SURFACE_ID = "${option:surface|lower}";
const UI_GENERATOR_API_PATH = "${option:api-path|trim}";
const UI_GENERATOR_ROUTE_PATH = "${option:directory-prefix|pathprefix}${option:route-path|path}";
const UI_GENERATOR_ID_PARAM = "${option:id-param|trim}";

function normalizeRelativePath(value = "") {
  return String(value || "")
    .replace(/\\/g, "/")
    .replace(/\/{2,}/g, "/")
    .split("/")
    .map((segment) => String(segment || "").trim())
    .filter(Boolean)
    .join("/");
}

function toRelativePathWithLeadingSlash(value = "") {
  const normalized = normalizeRelativePath(value);
  return normalized ? `/${normalized}` : "";
}

function appendRelativeSegment(basePath = "", segment = "") {
  const normalizedBasePath = normalizeRelativePath(basePath);
  const normalizedSegment = String(segment || "").trim();
  if (!normalizedSegment) {
    return normalizedBasePath;
  }

  const encodedSegment = encodeURIComponent(normalizedSegment);
  return normalizedBasePath ? `${normalizedBasePath}/${encodedSegment}` : encodedSegment;
}

function normalizeDateString(value = "") {
  const candidate = String(value || "").trim();
  if (!candidate) {
    return "";
  }

  const parsed = new Date(candidate);
  if (Number.isNaN(parsed.getTime())) {
    return candidate;
  }

  return parsed.toLocaleString();
}

function toRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value;
}

function formatFieldValue(value, type = "", format = "") {
  if (value == null || value === "") {
    return "—";
  }

  const normalizedType = String(type || "").trim().toLowerCase();
  const normalizedFormat = String(format || "").trim().toLowerCase();
  if (normalizedType === "boolean") {
    return value ? "Yes" : "No";
  }

  if (normalizedType === "string" && (normalizedFormat === "date" || normalizedFormat === "date-time" || normalizedFormat === "time")) {
    return normalizeDateString(value);
  }

  if (Array.isArray(value)) {
    return value.length > 0 ? JSON.stringify(value) : "[]";
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }

  return String(value);
}

function useUiGeneratorListRuntime() {
  const paths = usePaths();
  const apiSuffix = toRelativePathWithLeadingSlash(UI_GENERATOR_API_PATH);
  const listPageSuffix = toRelativePathWithLeadingSlash(UI_GENERATOR_ROUTE_PATH);

  const apiPath = computed(() =>
    apiSuffix ? paths.api(apiSuffix, { surface: UI_GENERATOR_SURFACE_ID }) : ""
  );
  const listPath = computed(() =>
    listPageSuffix ? paths.page(listPageSuffix, { surface: UI_GENERATOR_SURFACE_ID }) : ""
  );
  const queryKey = computed(() => [
    "ui-generator",
    UI_GENERATOR_SURFACE_ID,
    UI_GENERATOR_API_PATH,
    "list"
  ]);

  function resolveViewPath(recordId = "") {
    const normalizedRecordId = String(recordId || "").trim();
    if (!normalizedRecordId) {
      return "";
    }

    const viewPath = appendRelativeSegment(UI_GENERATOR_ROUTE_PATH, normalizedRecordId);
    const pageSuffix = toRelativePathWithLeadingSlash(viewPath);
    return pageSuffix ? paths.page(pageSuffix, { surface: UI_GENERATOR_SURFACE_ID }) : "";
  }

  return Object.freeze({
    apiPath,
    listPath,
    queryKey,
    resolveViewPath,
    formatFieldValue
  });
}

function useUiGeneratorViewRuntime() {
  const route = useRoute();
  const paths = usePaths();
  const listPageSuffix = toRelativePathWithLeadingSlash(UI_GENERATOR_ROUTE_PATH);

  const recordId = computed(() => {
    const routeParams = route?.params && typeof route.params === "object" ? route.params : {};
    return String(routeParams[UI_GENERATOR_ID_PARAM] || "").trim();
  });

  const listPath = computed(() =>
    listPageSuffix ? paths.page(listPageSuffix, { surface: UI_GENERATOR_SURFACE_ID }) : ""
  );
  const apiPath = computed(() => {
    if (!recordId.value) {
      return "";
    }

    const pathWithRecord = appendRelativeSegment(UI_GENERATOR_API_PATH, recordId.value);
    const apiSuffix = toRelativePathWithLeadingSlash(pathWithRecord);
    return apiSuffix ? paths.api(apiSuffix, { surface: UI_GENERATOR_SURFACE_ID }) : "";
  });
  const queryKey = computed(() => [
    "ui-generator",
    UI_GENERATOR_SURFACE_ID,
    UI_GENERATOR_API_PATH,
    "view",
    recordId.value
  ]);

  return Object.freeze({
    recordId,
    listPath,
    apiPath,
    queryKey,
    formatFieldValue
  });
}

export {
  toRecord,
  formatFieldValue,
  useUiGeneratorListRuntime,
  useUiGeneratorViewRuntime
};
