import {
  resolvePageLinkTargetDetails,
  resolvePageTargetDetails
} from "@jskit-ai/kernel/server/support";

function resolveLinkToPropLine(linkTo = "") {
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
  const linkTarget = await resolvePageLinkTargetDetails({
    appRoot: pageTarget.appRoot,
    pageTarget,
    targetFile,
    context: "ui-generator page",
    placement: options?.["link-placement"],
    componentToken: options?.["link-component-token"],
    linkTo: options?.["link-to"]
  });

  return {
    __JSKIT_UI_LINK_PLACEMENT_ID__: pageTarget.placementId,
    __JSKIT_UI_LINK_PLACEMENT_TARGET__: String(linkTarget.placementTarget?.id || ""),
    __JSKIT_UI_LINK_COMPONENT_TOKEN__: String(linkTarget.componentToken || ""),
    __JSKIT_UI_LINK_WORKSPACE_SUFFIX__: pageTarget.routeUrlSuffix,
    __JSKIT_UI_LINK_NON_WORKSPACE_SUFFIX__: pageTarget.routeUrlSuffix,
    __JSKIT_UI_LINK_TO_PROP_LINE__: resolveLinkToPropLine(linkTarget.linkTo)
  };
}

export { buildUiPageTemplateContext };
