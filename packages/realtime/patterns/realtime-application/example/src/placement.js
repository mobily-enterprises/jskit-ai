import { createPlacementRegistry } from "@jskit-ai/shell-web/client/placement";

const registry = createPlacementRegistry();
const { addPlacement } = registry;

addPlacement({
  id: "realtime.connection.indicator",
  target: "shell.status",
  kind: "component",
  surfaces: ["*"],
  order: 950,
  componentToken: "realtime.web.connection.indicator"
});

export default function getPlacements() {
  return registry.build();
}
