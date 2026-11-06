function resolveSeverityColor(severity = "error") {
  const normalized = String(severity || "error").trim().toLowerCase();
  if (normalized === "info") {
    return "info";
  }
  if (normalized === "success") {
    return "success";
  }
  if (normalized === "warning") {
    return "warning";
  }
  return "error";
}

function resolveSeverityIcon(severity = "error") {
  const normalized = String(severity || "error").trim().toLowerCase();
  if (normalized === "info") {
    return "$info";
  }
  if (normalized === "success") {
    return "$success";
  }
  return "$warning";
}

function resolveTimeout(entry) {
  if (!entry) {
    return -1;
  }
  if (entry.persist) {
    return -1;
  }
  return 5000;
}

function actionsFor(entry) {
  return entry ? [entry.action, ...entry.additionalActions].filter(Boolean) : [];
}

// Banners float just below a top app bar. A surface without one (sign-in pages)
// has nothing to float under, so the banners join the page flow above the
// content instead of covering it.
function resolveBannerPlacement(rect) {
  const top = Number(rect.top) || 0;
  if (top <= 0) {
    return { inline: true, style: undefined };
  }

  return {
    inline: false,
    style: {
      top: `calc(env(safe-area-inset-top, 0px) + ${top}px)`,
      left: `${Number(rect.left) || 0}px`,
      right: `${Number(rect.right) || 0}px`
    }
  };
}

export {
  actionsFor,
  resolveBannerPlacement,
  resolveSeverityColor,
  resolveSeverityIcon,
  resolveTimeout
};
