// GENERATED FILE. DO NOT EDIT MANUALLY.
// Run: npm run web-shell:generate

export const filesystemRouteEntries = Object.freeze([
  Object.freeze({
    id: "app:/",
    surface: "app",
    routePath: "/",
    fullPath: "/",
    guard: null,
    loadModule: () => import("../../pages/app/index.vue")
  }),
  Object.freeze({
    id: "app:/settings",
    surface: "app",
    routePath: "/settings",
    fullPath: "/settings",
    guard: null,
    loadModule: () => import("../../pages/app/settings.vue")
  }),
  Object.freeze({
    id: "admin:/",
    surface: "admin",
    routePath: "/",
    fullPath: "/admin",
    guard: null,
    loadModule: () => import("../../pages/admin/index.vue")
  }),
  Object.freeze({
    id: "admin:/settings",
    surface: "admin",
    routePath: "/settings",
    fullPath: "/admin/settings",
    guard: null,
    loadModule: () => import("../../pages/admin/settings.vue")
  }),
  Object.freeze({
    id: "console:/",
    surface: "console",
    routePath: "/",
    fullPath: "/console",
    guard: null,
    loadModule: () => import("../../pages/console/index.vue")
  })
]);

export const shellEntriesBySurface = Object.freeze({
  app: Object.freeze({
    drawer: Object.freeze([
      Object.freeze({
        id: "app-home",
        title: "Home",
        route: "/",
        icon: "$home",
        group: "",
        description: "",
        order: 10,
        guard: null,
        resolvedRoute: "/"
      })
    ]),
    top: Object.freeze([
      Object.freeze({
        id: "app-settings",
        title: "Settings",
        route: "/settings",
        icon: "$settings",
        group: "",
        description: "",
        order: 20,
        guard: null,
        resolvedRoute: "/settings"
      })
    ]),
    config: Object.freeze([])
  }),
  admin: Object.freeze({
    drawer: Object.freeze([
      Object.freeze({
        id: "admin-dashboard",
        title: "Dashboard",
        route: "/",
        icon: "$dashboard",
        group: "",
        description: "",
        order: 10,
        guard: null,
        resolvedRoute: "/admin"
      })
    ]),
    top: Object.freeze([
      Object.freeze({
        id: "admin-settings-top",
        title: "Settings",
        route: "/settings",
        icon: "$settings",
        group: "",
        description: "",
        order: 20,
        guard: null,
        resolvedRoute: "/admin/settings"
      })
    ]),
    config: Object.freeze([
      Object.freeze({
        id: "admin-workspace-config",
        title: "Workspace",
        route: "/settings",
        icon: "$workspace",
        group: "",
        description: "",
        order: 10,
        guard: null,
        resolvedRoute: "/admin/settings"
      })
    ])
  }),
  console: Object.freeze({
    drawer: Object.freeze([
      Object.freeze({
        id: "console-overview",
        title: "Overview",
        route: "/",
        icon: "$console",
        group: "",
        description: "",
        order: 10,
        guard: null,
        resolvedRoute: "/console"
      })
    ]),
    top: Object.freeze([]),
    config: Object.freeze([])
  })
});
