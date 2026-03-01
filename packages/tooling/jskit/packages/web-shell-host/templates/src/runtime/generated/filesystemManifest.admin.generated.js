// GENERATED FILE. DO NOT EDIT MANUALLY.
// Run: npm run web-shell:generate

export const filesystemRouteEntries = Object.freeze([
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
  })
]);

export const shellEntriesBySurface = Object.freeze({
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
        id: "admin-settings",
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
        id: "admin-workspace",
        title: "Workspace",
        route: "/settings",
        icon: "$workspace",
        group: "",
        description: "",
        order: 30,
        guard: null,
        resolvedRoute: "/admin/settings"
      })
    ])
  })
});
