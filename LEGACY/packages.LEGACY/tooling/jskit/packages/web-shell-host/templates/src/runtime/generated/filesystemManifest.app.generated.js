// GENERATED FILE. DO NOT EDIT MANUALLY.
// Run: npm run web-shell:generate

export const filesystemRouteEntries = Object.freeze([
  Object.freeze({
    id: "app:/",
    surface: "app",
    routePath: "/",
    fullPath: "/app",
    guard: null,
    loadModule: () => import("../../pages/app/index.vue")
  }),
  Object.freeze({
    id: "app:/settings",
    surface: "app",
    routePath: "/settings",
    fullPath: "/app/settings",
    guard: null,
    loadModule: () => import("../../pages/app/settings.vue")
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
        resolvedRoute: "/app"
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
        resolvedRoute: "/app/settings"
      })
    ]),
    config: Object.freeze([])
  })
});
