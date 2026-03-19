export const config = {};
__TENANCY_MODE_LINE__

config.surfaceModeAll = "all";
config.surfaceDefaultId = "home";
config.webRootAllowed = "yes";
config.surfaceDefinitions = {};
config.surfaceDefinitions.home = {
  id: "home",
  pagesRoot: "",
  enabled: true,
  requiresAuth: false,
  requiresWorkspace: false
};
config.surfaceDefinitions.console = {
  id: "console",
  pagesRoot: "console",
  enabled: true,
  requiresAuth: true,
  requiresWorkspace: false
};
