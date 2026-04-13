const DEFAULT_TOOLS_LINK_COMPONENT_TOKEN = "local.main.ui.surface-aware-menu-link-item";

const HOME_TOOLS_OUTLET = Object.freeze({
  target: "home-tools:primary-menu",
  defaultLinkComponentToken: DEFAULT_TOOLS_LINK_COMPONENT_TOKEN,
  ariaLabel: "Home tools"
});

const WORKSPACE_TOOLS_OUTLET = Object.freeze({
  target: "workspace-tools:primary-menu",
  defaultLinkComponentToken: DEFAULT_TOOLS_LINK_COMPONENT_TOKEN,
  ariaLabel: "Workspace tools"
});

export {
  DEFAULT_TOOLS_LINK_COMPONENT_TOKEN,
  HOME_TOOLS_OUTLET,
  WORKSPACE_TOOLS_OUTLET
};
