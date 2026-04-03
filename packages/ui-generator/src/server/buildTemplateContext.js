import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { resolveShellOutletPlacementTargetFromApp } from "@jskit-ai/kernel/server/support";

const DEFAULT_MENU_COMPONENT_TOKEN = "users.web.shell.surface-aware-menu-link-item";
const NESTED_CHILDREN_GROUPS = new Set(["nestedchildren", "nested-children"]);

function splitTextIntoWords(value = "") {
  const normalized = String(value || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim();
  if (!normalized) {
    return [];
  }
  return normalized
    .split(/\s+/)
    .map((entry) => entry.toLowerCase())
    .filter(Boolean);
}

function wordsToKebab(words = []) {
  return (Array.isArray(words) ? words : [])
    .map((entry) => String(entry || "").toLowerCase())
    .filter(Boolean)
    .join("-");
}

function normalizePathValue(value = "") {
  return String(value || "")
    .replaceAll("\\", "/")
    .split("/")
    .map((segment) => {
      const normalizedSegment = normalizeText(segment);
      if (!normalizedSegment) {
        return "";
      }
      if (/^\[[^\]]+\]$/.test(normalizedSegment)) {
        return normalizedSegment;
      }
      const routeGroupMatch = /^\(([^()]+)\)$/.exec(normalizedSegment);
      if (routeGroupMatch) {
        const routeGroupName = wordsToKebab(splitTextIntoWords(routeGroupMatch[1]));
        return routeGroupName ? `(${routeGroupName})` : "";
      }
      return wordsToKebab(splitTextIntoWords(normalizedSegment));
    })
    .filter(Boolean)
    .join("/");
}

function splitPathSegments(value = "") {
  return normalizePathValue(value)
    .split("/")
    .map((entry) => normalizeText(entry))
    .filter(Boolean);
}

function isRouteGroupSegment(value = "") {
  const source = normalizeText(value);
  return source.startsWith("(") && source.endsWith(")");
}

function isNestedChildrenRouteGroupSegment(value = "") {
  const source = normalizeText(value);
  if (!isRouteGroupSegment(source)) {
    return false;
  }
  const groupName = source.slice(1, -1).trim().toLowerCase();
  return NESTED_CHILDREN_GROUPS.has(groupName);
}

function resolvePlacementUrlSuffix(options = {}) {
  const routeSegments = [
    ...splitPathSegments(options?.["directory-prefix"]),
    ...splitPathSegments(options?.name)
  ].filter((segment) => !isRouteGroupSegment(segment));
  if (routeSegments.length < 1) {
    return "/";
  }
  return `/${routeSegments.join("/")}`;
}

function resolveMenuComponentToken(options = {}) {
  const explicitToken = normalizeText(options?.["placement-component-token"]);
  if (explicitToken) {
    return explicitToken;
  }
  return DEFAULT_MENU_COMPONENT_TOKEN;
}

function resolveAutoRelativePlacementTo(options = {}) {
  const explicitPlacementTo = normalizeText(options?.["placement-to"]);
  if (explicitPlacementTo) {
    return explicitPlacementTo;
  }
  const directorySegments = splitPathSegments(options?.["directory-prefix"]);
  const hasNestedChildrenGroup = directorySegments.some((segment) => isNestedChildrenRouteGroupSegment(segment));
  if (!hasNestedChildrenGroup) {
    return "";
  }
  const pagePath = normalizePathValue(options?.name);
  if (!pagePath) {
    return "";
  }
  return `./${pagePath}`;
}

function resolveMenuToPropLine(options = {}) {
  const placementTo = resolveAutoRelativePlacementTo(options);
  if (!placementTo) {
    return "";
  }
  return `      to: ${JSON.stringify(placementTo)},\n`;
}

async function buildUiPageTemplateContext({ appRoot, options } = {}) {
  const placementTarget = await resolveShellOutletPlacementTargetFromApp({
    appRoot,
    context: "ui-generator",
    placement: options?.placement
  });

  return {
    __JSKIT_UI_MENU_PLACEMENT_HOST__: normalizeText(placementTarget?.host),
    __JSKIT_UI_MENU_PLACEMENT_POSITION__: normalizeText(placementTarget?.position),
    __JSKIT_UI_MENU_COMPONENT_TOKEN__: resolveMenuComponentToken(options),
    __JSKIT_UI_MENU_WORKSPACE_SUFFIX__: resolvePlacementUrlSuffix(options),
    __JSKIT_UI_MENU_NON_WORKSPACE_SUFFIX__: resolvePlacementUrlSuffix(options),
    __JSKIT_UI_MENU_TO_PROP_LINE__: resolveMenuToPropLine(options)
  };
}

export { buildUiPageTemplateContext };
