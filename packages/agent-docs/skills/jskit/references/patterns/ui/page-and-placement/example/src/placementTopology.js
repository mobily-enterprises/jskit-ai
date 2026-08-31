const placements = [];

function addPlacementTopology(value = {}) {
  placements.push(value);
}

addPlacementTopology({
  id: "page.section-nav",
  owner: "reports",
  description: "Navigation between report pages.",
  surfaces: ["home"],
  variants: {
    compact: {
      outlet: "reports:section-nav",
      renderers: { link: "local.main.ui.tab-link-item" }
    },
    medium: {
      outlet: "reports:section-nav",
      renderers: { link: "local.main.ui.tab-link-item" }
    },
    expanded: {
      outlet: "reports:section-nav",
      renderers: { link: "local.main.ui.tab-link-item" }
    }
  }
});

export { addPlacementTopology };
export default { placements };
