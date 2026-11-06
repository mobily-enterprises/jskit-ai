import { isExternalLinkTarget, splitPathQueryHash } from "@jskit-ai/kernel/shared/support/linkPath";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { normalizePathname as normalizeKernelPathname } from "@jskit-ai/kernel/shared/surface/paths";

// Navigation icons are Vuetify icon aliases, which @jskit-ai/material-web maps to Material Symbols Rounded.
const SURFACE_SWITCH_ICON_BY_ID = Object.freeze({
  home: "$home",
  app: "$dashboard",
  admin: "$adminPanelSettings",
  console: "$terminal"
});

function resolveExplicitIconValue(explicitIcon = "") {
  return normalizeText(explicitIcon);
}

function normalizePathname(value = "") {
  const normalizedValue = normalizeText(value);
  if (!normalizedValue) {
    return "";
  }

  if (isExternalLinkTarget(normalizedValue)) {
    const isHttpTarget = normalizedValue.startsWith("http://") || normalizedValue.startsWith("https://");
    if (!isHttpTarget) {
      return "";
    }

    let parsedPathname = "";
    try {
      parsedPathname = String(new URL(normalizedValue).pathname || "");
    } catch {
      return "";
    }

    const normalizedPathname = normalizeText(parsedPathname);
    if (!normalizedPathname) {
      return "";
    }
    return normalizeKernelPathname(normalizedPathname).toLowerCase();
  }

  const { pathname } = splitPathQueryHash(normalizedValue);
  const normalizedPathname = normalizeText(pathname);
  if (!normalizedPathname) {
    return "";
  }

  return normalizeKernelPathname(normalizedPathname).toLowerCase();
}

function resolveSurfaceSwitchIdFromLabel(label = "") {
  const normalizedLabel = normalizeText(label).toLowerCase();
  if (!normalizedLabel.startsWith("go to ")) {
    return "";
  }
  return normalizeText(normalizedLabel.slice("go to ".length));
}

function resolveSurfaceSwitchIcon(surfaceId = "", explicitIcon = "") {
  const resolvedExplicitIcon = resolveExplicitIconValue(explicitIcon);
  if (resolvedExplicitIcon) {
    return resolvedExplicitIcon;
  }

  const normalizedSurfaceId = normalizeText(surfaceId).toLowerCase();
  return SURFACE_SWITCH_ICON_BY_ID[normalizedSurfaceId] || "$arrowCircleRight";
}

function resolveMenuLinkIcon({ icon = "", label = "", to = "" } = {}) {
  const resolvedExplicitIcon = resolveExplicitIconValue(icon);
  if (resolvedExplicitIcon) {
    return resolvedExplicitIcon;
  }

  const normalizedLabel = normalizeText(label).toLowerCase();
  const normalizedPathname = normalizePathname(to);
  if (!normalizedLabel && !normalizedPathname) {
    return "";
  }

  const surfaceSwitchSurfaceId = resolveSurfaceSwitchIdFromLabel(normalizedLabel);
  if (surfaceSwitchSurfaceId) {
    return resolveSurfaceSwitchIcon(surfaceSwitchSurfaceId);
  }

  if (
    normalizedLabel.includes("sign in") ||
    normalizedPathname.includes("/auth/login")
  ) {
    return "$login";
  }

  if (
    normalizedLabel.includes("sign out") ||
    normalizedPathname.includes("/auth/signout")
  ) {
    return "$logout";
  }

  if (
    normalizedLabel.includes("account") ||
    normalizedPathname.includes("/account")
  ) {
    if (
      normalizedLabel.includes("settings") ||
      normalizedPathname.includes("/settings") ||
      normalizedPathname === "/account"
    ) {
      return "$manageAccounts";
    }
    return "$accountCircle";
  }

  if (
    normalizedLabel.includes("members") ||
    normalizedLabel.includes("team") ||
    normalizedPathname.includes("/members")
  ) {
    return "$group";
  }

  if (normalizedLabel.includes("assistant") || normalizedPathname.includes("/assistant")) {
    return "$smartToy";
  }

  if (
    normalizedLabel.includes("console") ||
    normalizedPathname.startsWith("/console")
  ) {
    return "$terminal";
  }

  if (
    normalizedLabel.includes("admin") ||
    normalizedPathname.includes("/admin")
  ) {
    return "$adminPanelSettings";
  }

  if (normalizedLabel.includes("settings") || normalizedPathname.includes("/settings")) {
    return "$settings";
  }

  if (
    normalizedLabel.includes("home") ||
    normalizedPathname === "/"
  ) {
    return "$home";
  }

  if (
    normalizedLabel.includes("workspace") ||
    normalizedLabel.includes("dashboard") ||
    normalizedPathname.includes("/w/")
  ) {
    return "$dashboard";
  }

  if (normalizedPathname) {
    const segments = normalizedPathname.split("/").filter(Boolean);
    if (segments.length === 1) {
      return "$folder";
    }
  }

  if (normalizedLabel.includes("list")) {
    return "$assignment";
  }

  return "$viewList";
}

export {
  resolveMenuLinkIcon,
  resolveSurfaceSwitchIcon
};
