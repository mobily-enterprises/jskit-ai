const DEFAULT_SHELL_DRAWER_WIDTH = 248;
const DEFAULT_SHELL_RAIL_WIDTH = 80;
const MINIMUM_SHELL_DRAWER_WIDTH = 120;
const MAXIMUM_SHELL_DRAWER_WIDTH = 360;
const MINIMUM_SHELL_RAIL_WIDTH = 48;
const MAXIMUM_SHELL_RAIL_WIDTH = 160;
const DEFAULT_SHELL_NAVIGATION_ITEM_SPACING = 12;
const MINIMUM_SHELL_NAVIGATION_ITEM_SPACING = 8;
const MAXIMUM_SHELL_NAVIGATION_ITEM_SPACING = 24;

function clampNumber(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function normalizeShellDrawerWidth(value, fallback = DEFAULT_SHELL_DRAWER_WIDTH) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return clampNumber(
    parsed,
    MINIMUM_SHELL_DRAWER_WIDTH,
    MAXIMUM_SHELL_DRAWER_WIDTH
  );
}

function normalizeShellRailWidth(value, fallback = DEFAULT_SHELL_RAIL_WIDTH) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return clampNumber(
    Math.round(parsed),
    MINIMUM_SHELL_RAIL_WIDTH,
    MAXIMUM_SHELL_RAIL_WIDTH
  );
}

function normalizeShellNavigationItemSpacing(
  value,
  fallback = DEFAULT_SHELL_NAVIGATION_ITEM_SPACING
) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return clampNumber(
    Math.round(parsed),
    MINIMUM_SHELL_NAVIGATION_ITEM_SPACING,
    MAXIMUM_SHELL_NAVIGATION_ITEM_SPACING
  );
}

function resolveContentAwareDrawerWidth(
  measurements = [],
  {
    endGap = DEFAULT_SHELL_NAVIGATION_ITEM_SPACING,
    minimum = MINIMUM_SHELL_DRAWER_WIDTH,
    maximum = MAXIMUM_SHELL_DRAWER_WIDTH,
    fallback = DEFAULT_SHELL_DRAWER_WIDTH
  } = {}
) {
  let requiredWidth = 0;
  for (const measurement of measurements) {
    const logicalStart = Number(measurement?.logicalStart);
    const textWidth = Number(measurement?.textWidth);
    if (!Number.isFinite(logicalStart) || logicalStart < 0 || !Number.isFinite(textWidth) || textWidth <= 0) {
      continue;
    }
    requiredWidth = Math.max(requiredWidth, logicalStart + textWidth + Number(endGap || 0));
  }

  if (requiredWidth <= 0) {
    return normalizeShellDrawerWidth(fallback);
  }
  // Preserve subpixel font metrics while rounding outward enough to avoid
  // clipping the final glyph at the exact spacing boundary.
  return clampNumber(Math.ceil(requiredWidth * 4) / 4, minimum, maximum);
}

function measureRenderedText(element) {
  const range = document.createRange();
  range.selectNodeContents(element);
  return range.getBoundingClientRect();
}

// The width the drawer's rendered labels need, from where each one starts on the drawer's inline axis.
function measureDrawerContentWidth(drawerElement, navigationItemSpacing) {
  const drawerRect = drawerElement.getBoundingClientRect();
  const drawerStyle = window.getComputedStyle(drawerElement);
  const rightToLeft = drawerStyle.direction === "rtl";
  const endBorderWidth = Number.parseFloat(
    rightToLeft ? drawerStyle.borderLeftWidth : drawerStyle.borderRightWidth
  ) || 0;
  const measurements = [];

  for (const label of drawerElement.querySelectorAll(".v-list-item-title")) {
    const labelStyle = window.getComputedStyle(label);
    if (labelStyle.display === "none" || labelStyle.visibility === "hidden") {
      continue;
    }
    const textRect = measureRenderedText(label);
    if (!textRect || textRect.width <= 0) {
      continue;
    }
    measurements.push({
      logicalStart: rightToLeft
        ? drawerRect.right - textRect.right
        : textRect.left - drawerRect.left,
      textWidth: textRect.width
    });
  }

  return resolveContentAwareDrawerWidth(measurements, {
    endGap: navigationItemSpacing + endBorderWidth
  });
}

export {
  DEFAULT_SHELL_DRAWER_WIDTH,
  DEFAULT_SHELL_NAVIGATION_ITEM_SPACING,
  DEFAULT_SHELL_RAIL_WIDTH,
  MAXIMUM_SHELL_DRAWER_WIDTH,
  MINIMUM_SHELL_DRAWER_WIDTH,
  measureDrawerContentWidth,
  normalizeShellDrawerWidth,
  normalizeShellNavigationItemSpacing,
  normalizeShellRailWidth,
  resolveContentAwareDrawerWidth
};
