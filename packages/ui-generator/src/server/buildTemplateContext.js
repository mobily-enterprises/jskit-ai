import {
  resolvePageLinkTargetDetails,
  resolvePageTargetDetails
} from "@jskit-ai/kernel/server/support";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

const DEFAULT_GENERATED_LINK_ICON = "mdi-view-list-outline";
const NAVIGATION_ROLE_VALUES = Object.freeze(["primary", "secondary", "utility", "detail", "workflow", "none"]);
const NAVIGATION_ROLE_LINK_PLACEMENTS = Object.freeze({
  secondary: "shell.secondary-nav",
  utility: "shell.global-actions"
});
const NO_LINK_NAVIGATION_ROLES = new Set(["detail", "workflow", "none"]);

function resolveLinkToPropLine(linkTo = "") {
  if (!linkTo) {
    return "";
  }
  return `      to: ${JSON.stringify(linkTo)},\n`;
}

function resolveOwnerLine(owner = "") {
  if (!owner) {
    return "";
  }
  return `    owner: ${JSON.stringify(owner)},\n`;
}

function normalizeNavigationRole(value = "") {
  const normalizedRole = normalizeText(value).toLowerCase();
  if (!normalizedRole) {
    return "primary";
  }
  if (!NAVIGATION_ROLE_VALUES.includes(normalizedRole)) {
    throw new Error(`navigation-role must be one of: ${NAVIGATION_ROLE_VALUES.join(", ")}.`);
  }
  return normalizedRole;
}

function shouldCreateNavigationLink(options = {}) {
  const role = normalizeNavigationRole(options?.["navigation-role"]);
  const linkPlacement = String(options?.["link-placement"] || "").trim();
  const linkTo = String(options?.["link-to"] || "").trim();
  if (NO_LINK_NAVIGATION_ROLES.has(role)) {
    if (linkPlacement || linkTo) {
      throw new Error(`navigation-role "${role}" cannot be combined with --link-placement or --link-to.`);
    }
    return false;
  }
  return true;
}

function resolveNavigationRoleLinkPlacement(options = {}) {
  const explicitPlacement = String(options?.["link-placement"] || "").trim();
  if (explicitPlacement) {
    return explicitPlacement;
  }
  const role = normalizeNavigationRole(options?.["navigation-role"]);
  return NAVIGATION_ROLE_LINK_PLACEMENTS[role] || "";
}

async function buildUiPageTemplateContext({
  appRoot,
  targetFile = "",
  options = {}
} = {}) {
  const pageTarget = await resolvePageTargetDetails({
    appRoot,
    targetFile,
    context: "ui-generator page"
  });
  const linkTarget = await resolvePageLinkTargetDetails({
    appRoot: pageTarget.appRoot,
    pageTarget,
    targetFile,
    context: "ui-generator page",
    placement: resolveNavigationRoleLinkPlacement(options),
    linkTo: options?.["link-to"]
  });

  return {
    __JSKIT_UI_LINK_PLACEMENT_ID__: pageTarget.placementId,
    __JSKIT_UI_LINK_PLACEMENT_TARGET__: String(linkTarget.placementTarget?.id || ""),
    __JSKIT_UI_LINK_OWNER_LINE__: resolveOwnerLine(linkTarget.placementTarget?.owner || ""),
    __JSKIT_UI_LINK_COMPONENT_TOKEN__: String(linkTarget.componentToken || ""),
    __JSKIT_UI_LINK_ICON__: DEFAULT_GENERATED_LINK_ICON,
    __JSKIT_UI_LINK_WORKSPACE_SUFFIX__: pageTarget.routeUrlSuffix,
    __JSKIT_UI_LINK_NON_WORKSPACE_SUFFIX__: pageTarget.routeUrlSuffix,
    __JSKIT_UI_LINK_WHEN_LINE__: String(linkTarget.whenLine || ""),
    __JSKIT_UI_LINK_TO_PROP_LINE__: resolveLinkToPropLine(linkTarget.linkTo)
  };
}

export {
  buildUiPageTemplateContext,
  normalizeNavigationRole,
  resolveNavigationRoleLinkPlacement,
  shouldCreateNavigationLink
};
