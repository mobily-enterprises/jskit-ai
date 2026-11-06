import { createPlacementRegistry } from "@jskit-ai/shell-web/client/placement";

const registry = createPlacementRegistry();
const { addPlacement } = registry;

export { addPlacement };

// Keep the default export near the top so module installers can append addPlacement(...)
// blocks at the bottom of this file without changing the export section.
export default function getPlacements() {
  return registry.build();
}

// Settings is a main destination of the console: choosing it starts a fresh trail, and its sections' Up returns to
// the settings list.
addPlacement({
  id: "console.web.menu.settings",
  target: "shell.primary-nav",
  kind: "link",
  surfaces: ["console"],
  order: 100,
  props: {
    label: "Settings",
    surface: "console",
    scopedSuffix: "/settings",
    unscopedSuffix: "/settings"
  }
});
