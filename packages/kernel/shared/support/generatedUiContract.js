import { normalizeText } from "./normalize.js";

const GENERATED_UI_NAVIGATION_ROLE_VALUES = Object.freeze([
  "primary",
  "secondary",
  "utility",
  "detail",
  "workflow",
  "none"
]);
const GENERATED_UI_NAVIGATION_ROLE_DEFAULT = "primary";
const GENERATED_UI_NAVIGATION_ROLE_LINK_PLACEMENTS = Object.freeze({
  secondary: "shell.secondary-nav",
  utility: "shell.global-actions"
});
const GENERATED_UI_NO_LINK_NAVIGATION_ROLES = Object.freeze(["detail", "workflow", "none"]);
const GENERATED_UI_NO_LINK_NAVIGATION_ROLE_SET = new Set(GENERATED_UI_NO_LINK_NAVIGATION_ROLES);
const GENERATED_UI_SURFACE_PROFILES = Object.freeze({
  task: Object.freeze({
    id: "task",
    className: "generated-ui-screen--app",
    density: "comfortable",
    titleLabel: "Screen",
    emptyStateBody: "Activity and actions for this screen will appear here."
  }),
  operator: Object.freeze({
    id: "operator",
    className: "generated-ui-screen--operator",
    density: "compact",
    titleLabel: "Workspace tool",
    emptyStateBody: "Operational activity and actions for this screen will appear here."
  }),
  settings: Object.freeze({
    id: "settings",
    className: "generated-ui-screen--settings",
    density: "comfortable",
    titleLabel: "Settings",
    emptyStateBody: "Saved settings, controls, and activity for this section will appear here."
  })
});
const GENERATED_UI_NAVIGATION_ROLE_OPTION = Object.freeze({
  required: false,
  inputType: "text",
  validationType: "enum",
  allowedValues: GENERATED_UI_NAVIGATION_ROLE_VALUES,
  defaultValue: GENERATED_UI_NAVIGATION_ROLE_DEFAULT,
  promptLabel: "Navigation role",
  promptHint: "Product navigation role for generated links. When omitted, dynamic detail and workflow routes create no nav link; primary uses normal inference, secondary maps to shell.secondary-nav, utility maps to shell.global-actions, and detail/workflow/none force no nav link."
});
const GENERATED_UI_FORBIDDEN_LIVE_COPY_PATTERNS = Object.freeze([
  Object.freeze({
    id: "replace-this-copy",
    pattern: /replace\s+this/i,
    message: "Generated live UI must not tell users to replace scaffold content."
  }),
  Object.freeze({
    id: "use-this-area-copy",
    pattern: /use\s+this\s+area/i,
    message: "Generated live UI must be a usable screen, not an implementation instruction."
  }),
  Object.freeze({
    id: "this-is-your-page-copy",
    pattern: /this\s+is\s+your\s+page/i,
    message: "Generated live UI must not describe itself as a scaffold page."
  }),
  Object.freeze({
    id: "ready-for-implementation-copy",
    pattern: /ready\s+for\s+your\s+implementation/i,
    message: "Generated live UI must not ask the app author to implement the screen."
  }),
  Object.freeze({
    id: "main-public-surface-copy",
    pattern: /main\s+public\s+surface/i,
    message: "Generated live UI must not expose framework/surface scaffolding language."
  }),
  Object.freeze({
    id: "generate-route-copy",
    pattern: /generate\s+(?:a|your\s+first)\s+(?:page|route)/i,
    message: "Starter UI should present a product-shaped empty state, not CLI instructions."
  }),
  Object.freeze({
    id: "install-package-copy",
    pattern: /install\s+(?:a\s+)?package/i,
    message: "Starter UI should avoid package-installation instructions in live screens."
  }),
  Object.freeze({
    id: "add-product-packages-copy",
    pattern: /add\s+product\s+packages/i,
    message: "Starter UI should avoid package-installation instructions in live screens."
  })
]);
const GENERATED_UI_FORBIDDEN_CARD_SHELL_PATTERNS = Object.freeze([
  Object.freeze({
    id: "vuetify-card-shell",
    pattern: /<v-card\b/i,
    message: "Generated page architecture should not use a generic v-card shell."
  }),
  Object.freeze({
    id: "vuetify-card-title-shell",
    pattern: /<v-card-title\b/i,
    message: "Generated pages should not repeat page titles inside card title chrome."
  })
]);
const GENERATED_UI_SOURCE_CONTRACT_PROFILES = Object.freeze({
  page: Object.freeze({
    forbidCardShell: true,
    requiredPatterns: Object.freeze([
      Object.freeze({
        id: "shared-screen-class",
        pattern: /generated-ui-screen\s+generated-ui-screen--/,
        message: "Generated pages must opt into the shared screen density contract."
      }),
      Object.freeze({
        id: "page-screen-title",
        pattern: /generated-page-screen__title/,
        message: "Generated pages need an explicit responsive page title class."
      }),
      Object.freeze({
        id: "page-empty-state-sheet",
        pattern: /<v-sheet\b[\s\S]*generated-page-screen__empty-state/,
        message: "Generated pages need a direct sheet-based empty/work region."
      }),
      Object.freeze({
        id: "page-responsive-title-type",
        pattern: /--generated-ui-screen-title-size/,
        message: "Generated pages need shared responsive title typography."
      }),
      Object.freeze({
        id: "page-compact-rules",
        pattern: /@media\s*\(max-width:\s*640px\)/,
        message: "Generated pages need explicit compact-width layout rules."
      })
    ])
  }),
  "placed-element": Object.freeze({
    requiredPatterns: Object.freeze([
      Object.freeze({
        id: "placed-element-min-target",
        pattern: /min-height:\s*48px/,
        message: "Placed generated elements need a 48px minimum interactive target."
      })
    ])
  }),
  "crud-list": Object.freeze({
    forbidCardShell: true,
    forbiddenPatterns: Object.freeze([
      Object.freeze({
        id: "desktop-only-data-table",
        pattern: /<v-data-table\b/i,
        message: "Generated CRUD lists must not rely on a desktop-only data table."
      })
    ]),
    requiredPatterns: Object.freeze([
      Object.freeze({
        id: "operator-surface-profile",
        pattern: /generated-ui-screen--operator/,
        message: "Generated CRUD lists must use the operator surface density profile."
      }),
      Object.freeze({
        id: "shared-title-density",
        pattern: /--generated-ui-screen-title-size/,
        message: "Generated CRUD lists must use shared title density variables."
      }),
      Object.freeze({
        id: "compact-list-cards",
        pattern: /d-md-none/,
        message: "Generated CRUD lists need compact card/list presentation."
      }),
      Object.freeze({
        id: "expanded-list-table",
        pattern: /d-none\s+d-md-block/,
        message: "Generated CRUD lists need a separate medium/expanded table presentation."
      }),
      Object.freeze({
        id: "compact-row-actions",
        pattern: /<v-menu\b[\s\S]*Actions/,
        message: "Generated CRUD row actions should collapse into an overflow menu on compact layouts."
      }),
      Object.freeze({
        id: "crud-list-bulk-actions",
        pattern: /CrudListBulkActionSurface/,
        message: "Generated CRUD lists need the shared client-side bulk action seam."
      }),
      Object.freeze({
        id: "crud-list-selection-mode",
        pattern: /bulkActions\.hasActions\.value/,
        message: "Generated CRUD list selection controls must stay hidden until bulk actions are declared."
      }),
      Object.freeze({
        id: "crud-list-empty-state",
        pattern: /__JSKIT_UI_LIST_EMPTY_TITLE__/,
        message: "Generated CRUD lists need resource-shaped empty state copy."
      }),
      Object.freeze({
        id: "crud-list-error-state",
        pattern: /__JSKIT_UI_LIST_LOAD_ERROR_TITLE__/,
        message: "Generated CRUD lists need resource-shaped load error copy."
      }),
      Object.freeze({
        id: "crud-list-tap-targets",
        pattern: /min-height:\s*48px/,
        message: "Generated CRUD lists need 48px tap targets."
      }),
      Object.freeze({
        id: "crud-list-filter-surface",
        pattern: /CrudListFilterSurface/,
        message: "Generated CRUD lists need the shared client-side filter surface seam."
      }),
      Object.freeze({
        id: "crud-list-filter-query-params",
        pattern: /queryParams:\s*filterRuntime\.queryParams/,
        message: "Generated CRUD lists must wire declared filters into list query params."
      })
    ])
  }),
  "crud-detail": Object.freeze({
    forbidCardShell: true,
    requiredPatterns: Object.freeze([
      Object.freeze({
        id: "operator-surface-profile",
        pattern: /generated-ui-screen--operator/,
        message: "Generated CRUD detail screens must use the operator surface density profile."
      }),
      Object.freeze({
        id: "shared-title-density",
        pattern: /--generated-ui-screen-title-size/,
        message: "Generated CRUD detail screens must use shared title density variables."
      }),
      Object.freeze({
        id: "crud-detail-panel",
        pattern: /ui-generator-(?:view|form)-panel/,
        message: "Generated CRUD detail screens need a direct sheet panel."
      }),
      Object.freeze({
        id: "crud-detail-header",
        pattern: /ui-generator-(?:view|form)-header/,
        message: "Generated CRUD detail screens need a direct page header."
      }),
      Object.freeze({
        id: "crud-detail-responsive-form-grid",
        pattern: /ui-generator-(?:view|form)-fields[\s\S]*:deep\(\.v-col\)/,
        message: "Generated CRUD detail screens need compact-first field columns."
      }),
      Object.freeze({
        id: "crud-detail-tap-targets",
        pattern: /min-height:\s*48px/,
        message: "Generated CRUD detail actions need 48px tap targets on compact layouts."
      }),
      Object.freeze({
        id: "crud-detail-load-retry",
        pattern: /loadError[\s\S]*(?:view|addEdit|formRuntime\.addEdit)\.refresh/,
        message: "Generated CRUD detail load errors must expose an inline retry action."
      })
    ])
  }),
  "responsive-smoke": Object.freeze({
    forbidLiveCopy: false,
    requiredPatterns: Object.freeze([
      Object.freeze({
        id: "compact-viewport",
        pattern: /\b390\b/,
        message: "Generated UI smoke tests must include compact phone width."
      }),
      Object.freeze({
        id: "medium-viewport",
        pattern: /\b768\b/,
        message: "Generated UI smoke tests must include tablet-ish medium width."
      }),
      Object.freeze({
        id: "expanded-viewport",
        pattern: /\b1280\b/,
        message: "Generated UI smoke tests must include expanded desktop width."
      }),
      Object.freeze({
        id: "overflow-check",
        pattern: /scrollWidth/,
        message: "Generated UI smoke tests must check horizontal overflow."
      }),
      Object.freeze({
        id: "tap-target-check",
        pattern: /toBeGreaterThanOrEqual\(48\)/,
        message: "Generated UI smoke tests must check compact tap targets."
      }),
      Object.freeze({
        id: "screen-contract-check",
        pattern: /generated-ui-screen/,
        message: "Generated UI smoke tests must verify the generated screen contract."
      })
    ])
  }),
  "starter-home": Object.freeze({
    requiredPatterns: Object.freeze([
      Object.freeze({
        id: "app-surface-profile",
        pattern: /generated-ui-screen--app/,
        message: "Base generated apps must use the app surface density profile."
      }),
      Object.freeze({
        id: "starter-home-screen",
        pattern: /home-start-screen/,
        message: "Base generated apps need a stable starter home screen."
      }),
      Object.freeze({
        id: "starter-home-panel",
        pattern: /<v-sheet\b[\s\S]*home-start-screen__panel/,
        message: "Base generated apps need a real sheet-based starter panel."
      }),
      Object.freeze({
        id: "starter-home-responsive-title",
        pattern: /--generated-ui-screen-title-size/,
        message: "Base generated apps need shared responsive starter typography."
      })
    ])
  }),
  "shell-home": Object.freeze({
    requiredPatterns: Object.freeze([
      Object.freeze({
        id: "app-surface-profile",
        pattern: /generated-ui-screen--app/,
        message: "Shell starter home must use the app surface density profile."
      }),
      Object.freeze({
        id: "shell-home-health",
        pattern: /Service health/,
        message: "Shell starter home should expose real runtime health state."
      }),
      Object.freeze({
        id: "shell-home-responsive-action",
        pattern: /min-height:\s*48px/,
        message: "Shell starter home actions need compact tap targets."
      })
    ])
  })
});
const GENERATED_UI_WORKFLOW_ROUTE_SEGMENTS = new Set(["create", "edit", "new", "setup"]);

function matchesGeneratedUiContractPattern(source = "", pattern) {
  const sourceText = String(source || "");
  if (pattern instanceof RegExp) {
    pattern.lastIndex = 0;
    return pattern.test(sourceText);
  }
  const literalPattern = String(pattern || "");
  return literalPattern ? sourceText.includes(literalPattern) : false;
}

function normalizeGeneratedUiContractPattern(patternEntry = {}, fallbackMessage = "") {
  if (patternEntry instanceof RegExp || typeof patternEntry === "string") {
    return Object.freeze({
      id: String(patternEntry),
      pattern: patternEntry,
      message: fallbackMessage
    });
  }
  return Object.freeze({
    id: normalizeText(patternEntry?.id) || String(patternEntry?.pattern || ""),
    pattern: patternEntry?.pattern || "",
    message: normalizeText(patternEntry?.message) || fallbackMessage
  });
}

function normalizeGeneratedUiContractPatternList(patternEntries = [], fallbackMessage = "") {
  return (Array.isArray(patternEntries) ? patternEntries : [])
    .map((entry) => normalizeGeneratedUiContractPattern(entry, fallbackMessage))
    .filter((entry) => entry.id && entry.pattern);
}

function resolveGeneratedUiSourceContractProfile(profile = "") {
  const normalizedProfile = normalizeText(profile).toLowerCase();
  return GENERATED_UI_SOURCE_CONTRACT_PROFILES[normalizedProfile] || Object.freeze({});
}

function collectGeneratedUiSourceContractIssues(source = "", {
  profile = "",
  forbidLiveCopy = undefined,
  forbidCardShell = undefined,
  forbiddenPatterns = [],
  requiredPatterns = []
} = {}) {
  const profileContract = resolveGeneratedUiSourceContractProfile(profile);
  const shouldForbidLiveCopy = forbidLiveCopy ?? profileContract.forbidLiveCopy ?? true;
  const shouldForbidCardShell = forbidCardShell ?? profileContract.forbidCardShell ?? false;
  const resolvedForbiddenPatterns = [
    ...(shouldForbidLiveCopy ? GENERATED_UI_FORBIDDEN_LIVE_COPY_PATTERNS : []),
    ...(shouldForbidCardShell ? GENERATED_UI_FORBIDDEN_CARD_SHELL_PATTERNS : []),
    ...normalizeGeneratedUiContractPatternList(profileContract.forbiddenPatterns, "Generated UI contains forbidden source."),
    ...normalizeGeneratedUiContractPatternList(forbiddenPatterns, "Generated UI contains forbidden source.")
  ];
  const resolvedRequiredPatterns = [
    ...normalizeGeneratedUiContractPatternList(profileContract.requiredPatterns, "Generated UI is missing required source."),
    ...normalizeGeneratedUiContractPatternList(requiredPatterns, "Generated UI is missing required source.")
  ];
  const issues = [];

  for (const patternEntry of resolvedForbiddenPatterns) {
    if (!matchesGeneratedUiContractPattern(source, patternEntry.pattern)) {
      continue;
    }
    issues.push(Object.freeze({
      kind: "forbidden",
      id: patternEntry.id,
      message: patternEntry.message
    }));
  }

  for (const patternEntry of resolvedRequiredPatterns) {
    if (matchesGeneratedUiContractPattern(source, patternEntry.pattern)) {
      continue;
    }
    issues.push(Object.freeze({
      kind: "missing",
      id: patternEntry.id,
      message: patternEntry.message
    }));
  }

  return Object.freeze(issues);
}

function assertGeneratedUiSourceContract(source = "", options = {}) {
  const issues = collectGeneratedUiSourceContractIssues(source, options);
  if (issues.length < 1) {
    return;
  }
  const sourceName = normalizeText(options?.sourceName);
  const sourceLabel = sourceName ? ` for ${sourceName}` : "";
  throw new Error(
    `Generated UI source contract failed${sourceLabel}: ` +
    issues.map((issue) => `${issue.kind}:${issue.id} - ${issue.message}`).join("; ")
  );
}

function normalizeGeneratedUiNavigationRole(value = "") {
  const normalizedRole = normalizeText(value).toLowerCase();
  if (!normalizedRole) {
    return GENERATED_UI_NAVIGATION_ROLE_DEFAULT;
  }
  if (!GENERATED_UI_NAVIGATION_ROLE_VALUES.includes(normalizedRole)) {
    throw new Error(`navigation-role must be one of: ${GENERATED_UI_NAVIGATION_ROLE_VALUES.join(", ")}.`);
  }
  return normalizedRole;
}

function hasExplicitGeneratedUiNavigationRole(options = {}) {
  if (!options || typeof options !== "object") {
    return false;
  }
  return Object.prototype.hasOwnProperty.call(options, "navigation-role") &&
    Boolean(normalizeText(options?.["navigation-role"]));
}

function normalizeGeneratedUiRouteSegments(routePath = "") {
  return normalizeText(routePath)
    .replaceAll("\\", "/")
    .split("/")
    .map((entry) => normalizeText(entry))
    .filter(Boolean);
}

function isGeneratedUiDynamicRouteSegment(routeSegment = "") {
  const normalizedSegment = normalizeText(routeSegment);
  return normalizedSegment.startsWith("[") && normalizedSegment.endsWith("]");
}

function resolveGeneratedUiSurfaceProfile(surfaceProfile = "") {
  const surfaceProfileId = normalizeText(surfaceProfile).toLowerCase();
  return GENERATED_UI_SURFACE_PROFILES[surfaceProfileId] || GENERATED_UI_SURFACE_PROFILES.task;
}

function buildGeneratedUiScreenClassName(baseClassName = "", {
  surfaceProfile = ""
} = {}) {
  const profile = resolveGeneratedUiSurfaceProfile(surfaceProfile);
  return [
    "generated-ui-screen",
    profile.className,
    normalizeText(baseClassName)
  ]
    .filter(Boolean)
    .join(" ");
}

function inferGeneratedUiNavigationRole(options = {}, {
  dynamicRoutePolicy = "leaf",
  routePath = ""
} = {}) {
  if (hasExplicitGeneratedUiNavigationRole(options)) {
    return normalizeGeneratedUiNavigationRole(options?.["navigation-role"]);
  }

  const routeSegments = normalizeGeneratedUiRouteSegments(routePath);
  const dynamicRouteSegments = routeSegments.filter((routeSegment) => isGeneratedUiDynamicRouteSegment(routeSegment));
  const lastRouteSegment = routeSegments.at(-1) || "";
  if (
    dynamicRouteSegments.length > 0 &&
    (
      normalizeText(dynamicRoutePolicy).toLowerCase() === "any" ||
      isGeneratedUiDynamicRouteSegment(lastRouteSegment)
    )
  ) {
    return "detail";
  }
  if (GENERATED_UI_WORKFLOW_ROUTE_SEGMENTS.has(lastRouteSegment)) {
    return "workflow";
  }
  return GENERATED_UI_NAVIGATION_ROLE_DEFAULT;
}

function isGeneratedUiNoLinkNavigationRole(value = "") {
  return GENERATED_UI_NO_LINK_NAVIGATION_ROLE_SET.has(normalizeGeneratedUiNavigationRole(value));
}

function resolveGeneratedUiNavigationRoleLinkPlacement(options = {}, inferenceContext = {}) {
  const explicitPlacement = normalizeText(options?.["link-placement"]);
  if (explicitPlacement) {
    return explicitPlacement;
  }
  const role = inferGeneratedUiNavigationRole(options, inferenceContext);
  return GENERATED_UI_NAVIGATION_ROLE_LINK_PLACEMENTS[role] || "";
}

function shouldCreateGeneratedUiNavigationLink(options = {}, {
  allowLinkTo = false,
  dynamicRoutePolicy = "leaf",
  routePath = ""
} = {}) {
  const hasExplicitNoLinkRole = hasExplicitGeneratedUiNavigationRole(options) &&
    GENERATED_UI_NO_LINK_NAVIGATION_ROLE_SET.has(normalizeGeneratedUiNavigationRole(options?.["navigation-role"]));
  const role = inferGeneratedUiNavigationRole(options, {
    dynamicRoutePolicy,
    routePath
  });
  const linkPlacement = normalizeText(options?.["link-placement"]);
  const linkTo = allowLinkTo ? normalizeText(options?.["link-to"]) : "";
  if (!GENERATED_UI_NO_LINK_NAVIGATION_ROLE_SET.has(role)) {
    return true;
  }
  if (linkPlacement || linkTo) {
    if (!hasExplicitNoLinkRole) {
      return true;
    }
    const disallowedOptions = allowLinkTo ? "--link-placement or --link-to" : "--link-placement";
    throw new Error(`navigation-role "${role}" cannot be combined with ${disallowedOptions}.`);
  }
  return false;
}

export {
  GENERATED_UI_FORBIDDEN_CARD_SHELL_PATTERNS,
  GENERATED_UI_FORBIDDEN_LIVE_COPY_PATTERNS,
  GENERATED_UI_NAVIGATION_ROLE_DEFAULT,
  GENERATED_UI_NAVIGATION_ROLE_LINK_PLACEMENTS,
  GENERATED_UI_NAVIGATION_ROLE_OPTION,
  GENERATED_UI_NAVIGATION_ROLE_VALUES,
  GENERATED_UI_NO_LINK_NAVIGATION_ROLES,
  GENERATED_UI_SOURCE_CONTRACT_PROFILES,
  GENERATED_UI_SURFACE_PROFILES,
  assertGeneratedUiSourceContract,
  buildGeneratedUiScreenClassName,
  collectGeneratedUiSourceContractIssues,
  inferGeneratedUiNavigationRole,
  isGeneratedUiNoLinkNavigationRole,
  normalizeGeneratedUiNavigationRole,
  resolveGeneratedUiSurfaceProfile,
  resolveGeneratedUiNavigationRoleLinkPlacement,
  shouldCreateGeneratedUiNavigationLink
};
