import { createPlacementRegistry } from "@jskit-ai/shell-web/client/placement";

const registry = createPlacementRegistry();
const { addPlacement } = registry;

addPlacement({
  id: "catalogue.reports.link",
  target: "shell.primary-nav",
  kind: "link",
  surfaces: ["home"],
  order: 120,
  props: {
    label: "Reports",
    icon: "mdi-chart-box-outline",
    surface: "home",
    scopedSuffix: "/reports",
    unscopedSuffix: "/reports"
  }
});

for (const [id, label, suffix, order] of [
  ["overview", "Overview", "/reports/overview", 100],
  ["activity", "Activity", "/reports/activity", 110]
]) {
  addPlacement({
    id: `catalogue.reports.${id}.link`,
    target: "page.section-nav",
    owner: "reports",
    kind: "link",
    surfaces: ["home"],
    order,
    props: {
      label,
      surface: "home",
      scopedSuffix: suffix,
      unscopedSuffix: suffix
    }
  });
}

addPlacement({
  id: "catalogue.sync-status",
  target: "shell.status",
  kind: "component",
  surfaces: ["home"],
  order: 100,
  componentToken: "local.main.ui.sync-status"
});

export default function getPlacements() {
  return registry.build();
}
