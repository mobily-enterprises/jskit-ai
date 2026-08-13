const MATERIAL_MEDIUM_MIN_WIDTH = 600;
const MATERIAL_EXPANDED_MIN_WIDTH = 840;

function resolveMaterialWindowClass(width) {
  const numericWidth = Number(width);
  if (!Number.isFinite(numericWidth) || numericWidth < MATERIAL_MEDIUM_MIN_WIDTH) {
    return "compact";
  }
  if (numericWidth < MATERIAL_EXPANDED_MIN_WIDTH) {
    return "medium";
  }
  return "expanded";
}

export {
  MATERIAL_EXPANDED_MIN_WIDTH,
  MATERIAL_MEDIUM_MIN_WIDTH,
  resolveMaterialWindowClass
};
