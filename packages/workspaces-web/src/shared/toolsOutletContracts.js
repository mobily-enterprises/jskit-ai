const DEFAULT_COG_LINK_COMPONENT_TOKEN = "local.main.ui.surface-aware-menu-link-item";

const ADMIN_COG_OUTLET = Object.freeze({
  target: "admin-cog:primary-menu",
  defaultLinkComponentToken: DEFAULT_COG_LINK_COMPONENT_TOKEN,
  ariaLabel: "Admin cog"
});

export { DEFAULT_COG_LINK_COMPONENT_TOKEN, ADMIN_COG_OUTLET };
