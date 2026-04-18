const DEFAULT_TOOLS_LINK_COMPONENT_TOKEN = "local.main.ui.surface-aware-menu-link-item";

const WORKSPACE_TOOLS_OUTLET = Object.freeze({
  target: "workspace-tools:primary-menu",
  defaultLinkComponentToken: DEFAULT_TOOLS_LINK_COMPONENT_TOKEN,
  ariaLabel: "Workspace tools"
});

export { DEFAULT_TOOLS_LINK_COMPONENT_TOKEN, WORKSPACE_TOOLS_OUTLET };
