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

// Banners sit just below a top app bar, in a top layout item of their own height, so the page's content starts below
// them as it starts below the app bar. A surface without one (sign-in pages) has no app bar to sit under, so the
// banners join the page flow above the content instead. Neither covers the content. `top` is where the banners start:
// the height of the top app bar, 0 without one.
function resolveBannerPlacement(top = 0) {
  return Object.freeze({ inline: !(Number(top) > 0) });
}

export {
  actionsFor,
  resolveBannerPlacement,
  resolveSeverityColor,
  resolveSeverityIcon,
  resolveTimeout
};
