import { createApp } from "vue";
import { createRouter, createWebHistory } from "vue-router/auto";
import { routes } from "vue-router/auto-routes";
import "vuetify/styles";
import { createVuetify } from "vuetify";
import * as components from "vuetify/components";
import * as directives from "vuetify/directives";
import { aliases as mdiAliases, mdi } from "vuetify/iconsets/mdi-svg";
import App from "./App.vue";
import NotFoundView from "./views/NotFound.vue";
import { createSurfaceRuntime, filterRoutesBySurface } from "@jskit-ai/framework-core/surface/runtime";
import {
  SURFACE_DEFAULT_ID,
  SURFACE_DEFINITIONS,
  SURFACE_MODE_ALL,
  WEB_ROOT_ALLOWED
} from "../config/surfaces.js";

const GLOBAL_GUARD_EVALUATOR_KEY = "__JSKIT_WEB_SHELL_GUARD_EVALUATOR__";
const AUTH_POLICY_AUTHENTICATED = "authenticated";
const AUTH_POLICY_PUBLIC = "public";
const WEB_ROOT_ALLOW_YES = "yes";
const WEB_ROOT_ALLOW_NO = "no";

const surfaceRuntime = createSurfaceRuntime({
  allMode: SURFACE_MODE_ALL,
  surfaces: SURFACE_DEFINITIONS,
  defaultSurfaceId: SURFACE_DEFAULT_ID
});

function normalizeGuardPolicy(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function resolveRouteGuardFromMeta(meta) {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
    return null;
  }

  if (meta.guard && typeof meta.guard === "object" && !Array.isArray(meta.guard)) {
    return meta.guard;
  }

  if (meta.jskit && typeof meta.jskit === "object" && !Array.isArray(meta.jskit)) {
    const jskitGuard = meta.jskit.guard;
    if (jskitGuard && typeof jskitGuard === "object" && !Array.isArray(jskitGuard)) {
      return jskitGuard;
    }
  }

  return null;
}

function resolveRouteGuard(to) {
  const matched = Array.isArray(to?.matched) ? to.matched : [];
  for (let index = matched.length - 1; index >= 0; index -= 1) {
    const routeRecord = matched[index] && typeof matched[index] === "object" ? matched[index] : null;
    if (!routeRecord) {
      continue;
    }

    if (routeRecord.guard && typeof routeRecord.guard === "object" && !Array.isArray(routeRecord.guard)) {
      return routeRecord.guard;
    }

    const metaGuard = resolveRouteGuardFromMeta(routeRecord.meta);
    if (metaGuard) {
      return metaGuard;
    }
  }

  return null;
}

function resolveSearchFromFullPath(fullPath) {
  const rawFullPath = String(fullPath || "").trim();
  const queryStart = rawFullPath.indexOf("?");
  if (queryStart < 0) {
    return "";
  }

  const hashStart = rawFullPath.indexOf("#", queryStart);
  return hashStart < 0 ? rawFullPath.slice(queryStart) : rawFullPath.slice(queryStart, hashStart);
}

function resolveSurfaceDefinition(surfaceId) {
  const normalizedSurfaceId = String(surfaceId || "")
    .trim()
    .toLowerCase();
  if (!normalizedSurfaceId) {
    return null;
  }
  const definition = SURFACE_DEFINITIONS[normalizedSurfaceId];
  if (!definition || typeof definition !== "object") {
    return null;
  }
  return definition;
}

function normalizeWebRootAllowed(value) {
  const normalizedValue = String(value || "")
    .trim()
    .toLowerCase();
  if (normalizedValue === WEB_ROOT_ALLOW_YES || normalizedValue === WEB_ROOT_ALLOW_NO) {
    return normalizedValue;
  }
  return WEB_ROOT_ALLOW_YES;
}

function normalizeSurfacePrefix(prefix) {
  const rawPrefix = String(prefix || "").trim();
  if (!rawPrefix || rawPrefix === "/") {
    return "/";
  }
  const withLeadingSlash = rawPrefix.startsWith("/") ? rawPrefix : `/${rawPrefix}`;
  return withLeadingSlash.replace(/\/+$/, "") || "/";
}

function resolveDefaultSurfaceRootPath() {
  const defaultSurface = resolveSurfaceDefinition(SURFACE_DEFAULT_ID);
  return normalizeSurfacePrefix(defaultSurface?.prefix);
}

function resolveSurfaceRequiresAuth(pathname) {
  const normalizedPathname = String(pathname || "/").trim() || "/";
  const surfaceId = surfaceRuntime.resolveSurfaceFromPathname(normalizedPathname);
  const surfaceDefinition = resolveSurfaceDefinition(surfaceId);
  return Boolean(surfaceDefinition?.requiresAuth);
}

function resolveEffectiveRouteGuard(to) {
  const routeGuard = resolveRouteGuard(to);
  const routePolicy = normalizeGuardPolicy(routeGuard?.policy);
  if (routePolicy) {
    return {
      policy: routePolicy
    };
  }

  if (resolveSurfaceRequiresAuth(to?.path || "/")) {
    return {
      policy: AUTH_POLICY_AUTHENTICATED
    };
  }

  return {
    policy: AUTH_POLICY_PUBLIC
  };
}

function resolveGuardEvaluator() {
  if (typeof globalThis !== "object" || !globalThis) {
    return null;
  }

  const evaluator = globalThis[GLOBAL_GUARD_EVALUATOR_KEY];
  if (typeof evaluator !== "function") {
    return null;
  }
  return evaluator;
}

function normalizeGuardOutcome(outcome) {
  if (outcome === false) {
    return {
      allow: false,
      redirectTo: "",
      reason: ""
    };
  }

  if (outcome == null || outcome === true || typeof outcome !== "object" || Array.isArray(outcome)) {
    return {
      allow: true,
      redirectTo: "",
      reason: ""
    };
  }

  return {
    allow: outcome.allow !== false,
    redirectTo: String(outcome.redirectTo || "").trim(),
    reason: String(outcome.reason || "").trim()
  };
}

function evaluateShellGuard({ guard, to }) {
  const evaluator = resolveGuardEvaluator();
  if (!evaluator) {
    return {
      allow: true,
      redirectTo: "",
      reason: ""
    };
  }

  const pathname = String(to?.path || "/").trim() || "/";
  const search = resolveSearchFromFullPath(to?.fullPath || "");

  try {
    return normalizeGuardOutcome(
      evaluator({
        guard,
        phase: "route",
        context: {
          to,
          location: {
            pathname,
            search
          }
        }
      })
    );
  } catch {
    return {
      allow: false,
      redirectTo: "",
      reason: "guard-evaluator-error"
    };
  }
}

const surfaceMode = surfaceRuntime.normalizeSurfaceMode(import.meta.env.VITE_SURFACE);
const fallbackRoute = Object.freeze({
  path: "/:pathMatch(.*)*",
  name: "not-found",
  component: NotFoundView,
  meta: {
    jskit: {
      scope: "global"
    }
  }
});
const activeRoutes = filterRoutesBySurface([...routes, fallbackRoute], {
  surfaceRuntime,
  surfaceMode
});

const router = createRouter({
  history: createWebHistory(),
  routes: activeRoutes
});

router.beforeEach((to) => {
  const webRootAllowed = normalizeWebRootAllowed(WEB_ROOT_ALLOWED);
  const defaultSurfaceRootPath = resolveDefaultSurfaceRootPath();
  if (webRootAllowed === WEB_ROOT_ALLOW_NO && String(to?.path || "/").trim() === "/" && defaultSurfaceRootPath !== "/") {
    const search = resolveSearchFromFullPath(to?.fullPath || "");
    const hash = String(to?.hash || "").trim();
    return `${defaultSurfaceRootPath}${search}${hash}`;
  }

  const guard = resolveEffectiveRouteGuard(to);
  if (guard.policy !== AUTH_POLICY_AUTHENTICATED) {
    return true;
  }

  const outcome = evaluateShellGuard({ guard, to });
  if (outcome.allow) {
    return true;
  }

  if (outcome.redirectTo) {
    return outcome.redirectTo;
  }

  return false;
});

const vuetify = createVuetify({
  components,
  directives,
  theme: {
    defaultTheme: "light",
    themes: {
      light: {
        colors: {
          primary: "#0f6b54",
          secondary: "#3f5150",
          background: "#eef3ee",
          surface: "#f7fbf6",
          "surface-variant": "#dfe8df",
          "on-surface-variant": "#3b4c44",
          error: "#9f1d1d"
        }
      },
      dark: {
        colors: {
          primary: "#6fd0b5",
          secondary: "#9db2af",
          background: "#0f1715",
          surface: "#16211e",
          "surface-variant": "#253430",
          "on-surface-variant": "#c5d6d2",
          error: "#ffb4ab"
        }
      }
    }
  },
  icons: {
    defaultSet: "mdi",
    aliases: mdiAliases,
    sets: { mdi }
  }
});

createApp(App).use(router).use(vuetify).mount("#app");
