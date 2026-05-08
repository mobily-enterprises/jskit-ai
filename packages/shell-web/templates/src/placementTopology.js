const placements = [];

function addPlacementTopology(value = {}) {
  placements.push(value);
}

export { addPlacementTopology };
export default { placements };

const menuLinkRenderers = Object.freeze({
  link: "local.main.ui.surface-aware-menu-link-item"
});

addPlacementTopology({
  id: "shell.primary-nav",
  description: "Primary top-level navigation for the current surface.",
  surfaces: ["*"],
  default: true,
  variants: {
    compact: {
      outlet: "shell-layout:primary-menu",
      renderers: menuLinkRenderers
    },
    medium: {
      outlet: "shell-layout:primary-menu",
      renderers: menuLinkRenderers
    },
    expanded: {
      outlet: "shell-layout:primary-menu",
      renderers: menuLinkRenderers
    }
  }
});

addPlacementTopology({
  id: "shell.secondary-nav",
  description: "Secondary navigation for the current surface.",
  surfaces: ["*"],
  variants: {
    compact: {
      outlet: "shell-layout:secondary-menu",
      renderers: menuLinkRenderers
    },
    medium: {
      outlet: "shell-layout:secondary-menu",
      renderers: menuLinkRenderers
    },
    expanded: {
      outlet: "shell-layout:secondary-menu",
      renderers: menuLinkRenderers
    }
  }
});

addPlacementTopology({
  id: "shell.identity",
  description: "Current surface identity and switcher controls.",
  surfaces: ["*"],
  variants: {
    compact: {
      outlet: "shell-layout:top-left"
    },
    medium: {
      outlet: "shell-layout:top-left"
    },
    expanded: {
      outlet: "shell-layout:top-left"
    }
  }
});

addPlacementTopology({
  id: "shell.status",
  description: "Surface status, connection, and utility indicators.",
  surfaces: ["*"],
  variants: {
    compact: {
      outlet: "shell-layout:top-right"
    },
    medium: {
      outlet: "shell-layout:top-right"
    },
    expanded: {
      outlet: "shell-layout:top-right"
    }
  }
});

addPlacementTopology({
  id: "page.section-nav",
  owner: "home-settings",
  description: "Navigation between child pages in the home settings section.",
  surfaces: ["home"],
  variants: {
    compact: {
      outlet: "home-settings:primary-menu",
      renderers: menuLinkRenderers
    },
    medium: {
      outlet: "home-settings:primary-menu",
      renderers: menuLinkRenderers
    },
    expanded: {
      outlet: "home-settings:primary-menu",
      renderers: menuLinkRenderers
    }
  }
});
