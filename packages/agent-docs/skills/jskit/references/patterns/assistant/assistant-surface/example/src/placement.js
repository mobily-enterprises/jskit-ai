import { createPlacementRegistry } from "@jskit-ai/shell-web/client/placement";

const registry = createPlacementRegistry();
const { addPlacement } = registry;

addPlacement({
  id: "assistant.admin.chat.link",
  target: "shell.primary-nav",
  kind: "link",
  surfaces: ["admin"],
  order: 140,
  props: {
    label: "Assistant",
    icon: "mdi-creation-outline",
    surface: "admin",
    scopedSuffix: "/assistant",
    unscopedSuffix: "/assistant"
  }
});

addPlacement({
  id: "assistant.admin.settings.link",
  target: "page.section-nav",
  owner: "admin-settings",
  kind: "link",
  surfaces: ["admin"],
  order: 160,
  props: {
    label: "Assistant",
    surface: "admin",
    scopedSuffix: "/settings/assistant",
    unscopedSuffix: "/settings/assistant"
  }
});

export default function getPlacements() {
  return registry.build();
}
