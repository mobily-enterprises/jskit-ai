// GENERATED FILE. DO NOT EDIT MANUALLY.
// Run: npm run web-shell:generate

export const filesystemRouteEntries = Object.freeze([
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
