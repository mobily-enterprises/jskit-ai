const DEFAULT_SHELL_DRAWER_WIDTH = 248;
const DEFAULT_SHELL_RAIL_WIDTH = 80;
const MINIMUM_SHELL_DRAWER_WIDTH = 120;
const MAXIMUM_SHELL_DRAWER_WIDTH = 360;
const MINIMUM_SHELL_RAIL_WIDTH = 48;
const MAXIMUM_SHELL_RAIL_WIDTH = 160;
const SHELL_DRAWER_LABEL_END_GAP = 10;

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

function resolveContentAwareDrawerWidth(
  measurements = [],
  {
    endGap = SHELL_DRAWER_LABEL_END_GAP,
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
  // Layout boxes expose integer client widths even when the rendered glyph
  // range is fractional. Round outward so the final glyph is never ellipsized
  // at the exact end-gap boundary.
  return clampNumber(Math.ceil(requiredWidth), minimum, maximum);
}

export {
  DEFAULT_SHELL_DRAWER_WIDTH,
  DEFAULT_SHELL_RAIL_WIDTH,
  MAXIMUM_SHELL_DRAWER_WIDTH,
  MINIMUM_SHELL_DRAWER_WIDTH,
  SHELL_DRAWER_LABEL_END_GAP,
  normalizeShellDrawerWidth,
  normalizeShellRailWidth,
  resolveContentAwareDrawerWidth
};
