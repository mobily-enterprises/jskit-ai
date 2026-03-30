import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { resolveShellOutletPlacementTargetFromApp } from "@jskit-ai/kernel/server/support";

async function buildUiPageTemplateContext({ appRoot, options } = {}) {
  const placementTarget = await resolveShellOutletPlacementTargetFromApp({
    appRoot,
    context: "ui-generator",
    placement: options?.placement
  });

  return {
    __JSKIT_UI_MENU_PLACEMENT_HOST__: normalizeText(placementTarget?.host),
    __JSKIT_UI_MENU_PLACEMENT_POSITION__: normalizeText(placementTarget?.position)
  };
}

export { buildUiPageTemplateContext };
