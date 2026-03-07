import {
  definePlacement
} from "./contracts.js";

function createPlacementRegistry({ entries = [] } = {}) {
  const placements = [];
  const ids = new Set();

  function addPlacement(value = {}) {
    const placement = definePlacement(value);
    if (ids.has(placement.id)) {
      return false;
    }

    ids.add(placement.id);
    placements.push(placement);
    return true;
  }

  for (const entry of Array.isArray(entries) ? entries : []) {
    addPlacement(entry);
  }

  function hasPlacement(id) {
    return ids.has(String(id || "").trim());
  }

  function build() {
    return Object.freeze([...placements]);
  }

  return Object.freeze({
    addPlacement,
    hasPlacement,
    build
  });
}

export {
  createPlacementRegistry
};
