import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { resolveShellOutletPlacementTargetFromApp } from "@jskit-ai/kernel/server/support";
import {
  TAB_LINK_COMPONENT_TOKEN,
  resolveNearestParentSubpagesHost,
  resolvePageTargetDetails
} from "./subcommands/pageSupport.js";

const DEFAULT_LINK_COMPONENT_TOKEN = "users.web.shell.surface-aware-menu-link-item";

function normalizePlacementTargetId(target = {}) {
  const host = normalizeText(target?.host);
  const position = normalizeText(target?.position);
  if (!host || !position) {
    return "";
  }
  return `${host}:${position}`;
}

function resolveRelativeLinkToFromParent(pageTarget = {}, parentHost = null) {
  const childSegments = Array.isArray(pageTarget?.visibleRouteSegments) ? pageTarget.visibleRouteSegments : [];
  const parentSegments = Array.isArray(parentHost?.visibleRouteSegments) ? parentHost.visibleRouteSegments : [];
  if (parentSegments.length < 1 || childSegments.length <= parentSegments.length) {
    return "";
  }

  const relativeSegments = childSegments.slice(parentSegments.length);
  if (relativeSegments.length < 1) {
    return "";
  }
  return `./${relativeSegments.join("/")}`;
}

function resolveLinkComponentToken(options = {}, { parentHost = null, placementTarget = null } = {}) {
  const explicitToken = normalizeText(options?.["link-component-token"]);
  if (explicitToken) {
    return explicitToken;
  }
  if (normalizePlacementTargetId(parentHost) && normalizePlacementTargetId(parentHost) === normalizePlacementTargetId(placementTarget)) {
    return TAB_LINK_COMPONENT_TOKEN;
  }
  return DEFAULT_LINK_COMPONENT_TOKEN;
}

function resolveAutoRelativeLinkTo(options = {}, pageTarget = {}, { parentHost = null, placementTarget = null } = {}) {
  const explicitLinkTo = normalizeText(options?.["link-to"]);
  if (explicitLinkTo) {
    return explicitLinkTo;
  }
  if (normalizePlacementTargetId(parentHost) && normalizePlacementTargetId(parentHost) === normalizePlacementTargetId(placementTarget)) {
    const inferredLinkTo = resolveRelativeLinkToFromParent(pageTarget, parentHost);
    if (inferredLinkTo) {
      return inferredLinkTo;
    }
  }
  if (pageTarget?.containsNestedChildrenGroup !== true) {
    return "";
  }

  const pageLeafSegment = normalizeText(pageTarget?.pageLeafSegment);
  if (!pageLeafSegment) {
    return "";
  }
  return `./${pageLeafSegment}`;
}

function resolveLinkToPropLine(options = {}, pageTarget = {}, context = {}) {
  const linkTo = resolveAutoRelativeLinkTo(options, pageTarget, context);
  if (!linkTo) {
    return "";
  }
  return `      to: ${JSON.stringify(linkTo)},\n`;
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
  // Child pages inherit tab-link placement from the nearest ancestor page that was
  // upgraded with add-subpages, regardless of whether that parent is a file route
  // (`foo.vue`) or an index route host (`foo/index.vue` with nestedChildren pages).
  const parentHost = await resolveNearestParentSubpagesHost({
    appRoot,
    pageTarget,
    context: "ui-generator page"
  });
  const placementTarget = await resolveShellOutletPlacementTargetFromApp({
    appRoot,
    context: "ui-generator",
    placement: options?.["link-placement"] || parentHost?.id || ""
  });

  return {
    __JSKIT_UI_LINK_PLACEMENT_ID__: pageTarget.placementId,
    __JSKIT_UI_LINK_PLACEMENT_HOST__: normalizeText(placementTarget?.host),
    __JSKIT_UI_LINK_PLACEMENT_POSITION__: normalizeText(placementTarget?.position),
    __JSKIT_UI_LINK_COMPONENT_TOKEN__: resolveLinkComponentToken(options, {
      parentHost,
      placementTarget
    }),
    __JSKIT_UI_LINK_WORKSPACE_SUFFIX__: pageTarget.routeUrlSuffix,
    __JSKIT_UI_LINK_NON_WORKSPACE_SUFFIX__: pageTarget.routeUrlSuffix,
    __JSKIT_UI_LINK_TO_PROP_LINE__: resolveLinkToPropLine(options, pageTarget, {
      parentHost,
      placementTarget
    })
  };
}

export { buildUiPageTemplateContext };
