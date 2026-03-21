import {
  mdiAccountGroupOutline,
  mdiArrowRightCircleOutline,
  mdiCogOutline,
  mdiConsole,
  mdiHomeOutline,
  mdiLogin,
  mdiLogout,
  mdiRobotOutline,
  mdiShieldCrownOutline,
  mdiViewDashboardOutline,
  mdiViewListOutline
} from "@mdi/js";

const SURFACE_SWITCH_ICON_BY_ID = Object.freeze({
  home: mdiHomeOutline,
  app: mdiViewDashboardOutline,
  admin: mdiShieldCrownOutline,
  console: mdiConsole
});

function normalizeText(value) {
  return String(value || "").trim();
}

function resolveSurfaceSwitchIcon(surfaceId = "", explicitIcon = "") {
  const normalizedExplicitIcon = normalizeText(explicitIcon);
  if (normalizedExplicitIcon) {
    return normalizedExplicitIcon;
  }

  const normalizedSurfaceId = normalizeText(surfaceId).toLowerCase();
  return SURFACE_SWITCH_ICON_BY_ID[normalizedSurfaceId] || mdiArrowRightCircleOutline;
}

function resolveMenuLinkIcon({ icon = "", label = "", to = "" } = {}) {
  const normalizedIcon = normalizeText(icon);
  if (normalizedIcon) {
    return normalizedIcon;
  }

  const normalizedLabel = normalizeText(label).toLowerCase();
  const normalizedTarget = normalizeText(to).toLowerCase();
  if (!normalizedLabel && !normalizedTarget) {
    return "";
  }

  if (
    normalizedLabel.includes("sign in") ||
    normalizedTarget.includes("/auth/login")
  ) {
    return mdiLogin;
  }

  if (
    normalizedLabel.includes("sign out") ||
    normalizedTarget.includes("/auth/signout")
  ) {
    return mdiLogout;
  }

  if (normalizedLabel.includes("settings") || normalizedTarget.includes("/settings")) {
    return mdiCogOutline;
  }

  if (
    normalizedLabel.includes("members") ||
    normalizedLabel.includes("team") ||
    normalizedTarget.includes("/members")
  ) {
    return mdiAccountGroupOutline;
  }

  if (normalizedLabel.includes("assistant") || normalizedTarget.includes("/assistant")) {
    return mdiRobotOutline;
  }

  if (normalizedLabel.includes("console") || normalizedTarget.includes("/console")) {
    return mdiConsole;
  }

  if (
    normalizedLabel.includes("workspace") ||
    normalizedLabel.includes("admin") ||
    normalizedTarget.includes("/w/")
  ) {
    return mdiViewDashboardOutline;
  }

  return mdiViewListOutline;
}

export {
  resolveMenuLinkIcon,
  resolveSurfaceSwitchIcon
};
