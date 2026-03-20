export const config = {};
__TENANCY_MODE_LINE__

config.surfaceModeAll = "all";
config.surfaceDefaultId = "home";
config.webRootAllowed = "no";
config.surfaceDefinitions = {};
config.surfaceDefinitions.home = {
  id: "home",
  label: "Home",
  pagesRoot: "home",
  enabled: true,
  requiresAuth: false,
  requiresWorkspace: false
};
config.surfaceDefinitions.console = {
  id: "console",
  label: "Console",
  pagesRoot: "console",
  enabled: true,
  requiresAuth: true,
  requiresWorkspace: false
};
