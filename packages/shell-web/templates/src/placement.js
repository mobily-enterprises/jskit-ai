import { createPlacementRegistry } from "@jskit-ai/shell-web/client/placement";

const registry = createPlacementRegistry();
const { addPlacement } = registry;

export { addPlacement };

// Keep the default export near the top so module installers can append addPlacement(...)
// blocks at the bottom of this file without changing the export section.
export default function getPlacements() {
  return registry.build();
}

addPlacement({
  id: "shell-web.home.menu.home",
  target: "shell-layout:primary-menu",
  surfaces: ["*"],
  order: 50,
  componentToken: "local.main.ui.surface-aware-menu-link-item",
  props: {
    label: "Home",
    surface: "home",
    workspaceSuffix: "/",
    nonWorkspaceSuffix: "/",
    exact: true
  }
});

addPlacement({
  id: "shell-web.home.menu.settings",
  target: "shell-layout:primary-menu",
  surfaces: ["home"],
  order: 100,
  componentToken: "local.main.ui.surface-aware-menu-link-item",
  props: {
    label: "Settings",
    surface: "home",
    workspaceSuffix: "/settings",
    nonWorkspaceSuffix: "/settings"
  }
});
