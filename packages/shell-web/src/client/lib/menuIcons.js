import * as mdiIcons from "@mdi/js";
import {
  mdiAccountCircleOutline,
  mdiAccountCogOutline,
  mdiAccountGroupOutline,
  mdiArrowRightCircleOutline,
  mdiClipboardListOutline,
  mdiCogOutline,
  mdiConsoleNetworkOutline,
  mdiFolderOutline,
  mdiHomeVariantOutline,
  mdiLogin,
  mdiLogout,
  mdiRobotOutline,
  mdiShieldCrownOutline,
  mdiViewDashboardOutline,
  mdiViewListOutline
} from "@mdi/js";
import { isExternalLinkTarget, splitPathQueryHash } from "@jskit-ai/kernel/shared/support/linkPath";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { normalizePathname as normalizeKernelPathname } from "@jskit-ai/kernel/shared/surface/paths";

const SURFACE_SWITCH_ICON_BY_ID = Object.freeze({
  home: mdiHomeVariantOutline,
  app: mdiViewDashboardOutline,
  admin: mdiShieldCrownOutline,
  console: mdiConsoleNetworkOutline
});

function resolveExplicitIconValue(explicitIcon = "") {
  const normalizedExplicitIcon = normalizeText(explicitIcon);
  if (!normalizedExplicitIcon) {
    return "";
  }

  if (!normalizedExplicitIcon.startsWith("mdi-")) {
    return normalizedExplicitIcon;
  }

  const iconKey = normalizedExplicitIcon
    .slice("mdi-".length)
    .split("-")
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join("");
  const exportName = `mdi${iconKey}`;
  const resolvedIcon = mdiIcons[exportName];
  return typeof resolvedIcon === "string" && resolvedIcon ? resolvedIcon : normalizedExplicitIcon;
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
  return SURFACE_SWITCH_ICON_BY_ID[normalizedSurfaceId] || mdiArrowRightCircleOutline;
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
    return mdiLogin;
  }

  if (
    normalizedLabel.includes("sign out") ||
    normalizedPathname.includes("/auth/signout")
  ) {
    return mdiLogout;
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
      return mdiAccountCogOutline;
    }
    return mdiAccountCircleOutline;
  }

  if (
    normalizedLabel.includes("members") ||
    normalizedLabel.includes("team") ||
    normalizedPathname.includes("/members")
  ) {
    return mdiAccountGroupOutline;
  }

  if (normalizedLabel.includes("assistant") || normalizedPathname.includes("/assistant")) {
    return mdiRobotOutline;
  }

  if (
    normalizedLabel.includes("console") ||
    normalizedPathname.startsWith("/console")
  ) {
    return mdiConsoleNetworkOutline;
  }

  if (
    normalizedLabel.includes("admin") ||
    normalizedPathname.includes("/admin")
  ) {
    return mdiShieldCrownOutline;
  }

  if (normalizedLabel.includes("settings") || normalizedPathname.includes("/settings")) {
    return mdiCogOutline;
  }

  if (
    normalizedLabel.includes("home") ||
    normalizedPathname === "/"
  ) {
    return mdiHomeVariantOutline;
  }

  if (
    normalizedLabel.includes("workspace") ||
    normalizedLabel.includes("dashboard") ||
    normalizedPathname.includes("/w/")
  ) {
    return mdiViewDashboardOutline;
  }

  if (normalizedPathname) {
    const segments = normalizedPathname.split("/").filter(Boolean);
    if (segments.length === 1) {
      return mdiFolderOutline;
    }
  }

  if (normalizedLabel.includes("list")) {
    return mdiClipboardListOutline;
  }

  return mdiViewListOutline;
}

export {
  resolveMenuLinkIcon,
  resolveSurfaceSwitchIcon
};
