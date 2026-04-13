import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const PACKAGE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function createLocalLinkItemDefinition({
  token = "",
  componentFile = "",
  componentName = "",
  templateFile = ""
} = {}) {
  return Object.freeze({
    token: String(token || "").trim(),
    componentFile: String(componentFile || "").trim(),
    componentName: String(componentName || "").trim(),
    templateFile: String(templateFile || "").trim()
  });
}

const LOCAL_LINK_ITEM_COMPONENT_DEFINITIONS = Object.freeze([
  createLocalLinkItemDefinition({
    token: "local.main.ui.menu-link-item",
    componentFile: "src/components/menus/MenuLinkItem.vue",
    componentName: "MenuLinkItem",
    templateFile: "templates/src/components/menus/MenuLinkItem.vue"
  }),
  createLocalLinkItemDefinition({
    token: "local.main.ui.surface-aware-menu-link-item",
    componentFile: "src/components/menus/SurfaceAwareMenuLinkItem.vue",
    componentName: "SurfaceAwareMenuLinkItem",
    templateFile: "templates/src/components/menus/SurfaceAwareMenuLinkItem.vue"
  }),
  createLocalLinkItemDefinition({
    token: "local.main.ui.tab-link-item",
    componentFile: "src/components/menus/TabLinkItem.vue",
    componentName: "TabLinkItem",
    templateFile: "templates/src/components/menus/TabLinkItem.vue"
  })
]);

const LOCAL_LINK_ITEM_COMPONENT_TOKENS = Object.freeze(
  LOCAL_LINK_ITEM_COMPONENT_DEFINITIONS.map((entry) => entry.token)
);

function findLocalLinkItemDefinition(componentToken = "") {
  const normalizedComponentToken = String(componentToken || "").trim();
  return LOCAL_LINK_ITEM_COMPONENT_DEFINITIONS.find((entry) => entry.token === normalizedComponentToken) || null;
}

function resolveLocalLinkItemDefinition(componentTokenOrDefinition = "") {
  if (
    componentTokenOrDefinition &&
    typeof componentTokenOrDefinition === "object" &&
    !Array.isArray(componentTokenOrDefinition)
  ) {
    return componentTokenOrDefinition;
  }
  return findLocalLinkItemDefinition(componentTokenOrDefinition);
}

function resolveLocalLinkItemTemplateAbsolutePath(componentTokenOrDefinition = "") {
  const definition = resolveLocalLinkItemDefinition(componentTokenOrDefinition);
  if (!definition) {
    throw new Error(`Unknown local link-item scaffold: ${String(componentTokenOrDefinition || "").trim() || "(empty)"}.`);
  }
  return path.join(PACKAGE_DIR, definition.templateFile);
}

async function readLocalLinkItemComponentSource(componentTokenOrDefinition = "") {
  return await readFile(resolveLocalLinkItemTemplateAbsolutePath(componentTokenOrDefinition), "utf8");
}

export {
  LOCAL_LINK_ITEM_COMPONENT_DEFINITIONS,
  LOCAL_LINK_ITEM_COMPONENT_TOKENS,
  findLocalLinkItemDefinition,
  readLocalLinkItemComponentSource,
  resolveLocalLinkItemTemplateAbsolutePath
};
