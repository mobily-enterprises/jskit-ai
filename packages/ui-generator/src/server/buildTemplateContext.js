import {
  resolvePageLinkTargetDetails,
  resolvePageTargetDetails
} from "@jskit-ai/kernel/server/support";

const DEFAULT_GENERATED_LINK_ICON = "mdi-view-list-outline";

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
    placement: options?.["link-placement"],
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

export { buildUiPageTemplateContext };
