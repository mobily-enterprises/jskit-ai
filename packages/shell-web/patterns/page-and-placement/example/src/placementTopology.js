const placements = [];

function addPlacementTopology(value = {}) {
  placements.push(value);
}

// The section's tabs: Material 3 primary tabs at every width (the shell's section-tab renderer), never navigation bar
// destinations, which belong to the shell's navigation bar alone.
addPlacementTopology({
  id: "page.section-nav",
  owner: "reports",
  description: "Navigation between report pages.",
  surfaces: ["home"],
  variants: {
    compact: {
      outlet: "reports:section-nav",
      renderers: { link: "local.main.ui.section-tab-link-item" }
    },
    medium: {
      outlet: "reports:section-nav",
      renderers: { link: "local.main.ui.section-tab-link-item" }
    },
    expanded: {
      outlet: "reports:section-nav",
      renderers: { link: "local.main.ui.section-tab-link-item" }
    }
  }
});

export { addPlacementTopology };
export default { placements };
