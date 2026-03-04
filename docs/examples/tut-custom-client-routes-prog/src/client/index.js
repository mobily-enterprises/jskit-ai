import ProgrammaticRouteView from "./views/ProgrammaticRouteView.vue";

const routeComponents = Object.freeze({});

async function bootClient({ logger, registerRoutes } = {}) {
  if (typeof registerRoutes === "function") {
    registerRoutes([
      {
        id: "tut.prog.programmatic",
        name: "tut-prog-programmatic",
        path: "/tut/prog-programmatic",
        scope: "global",
        component: ProgrammaticRouteView
      }
    ]);
  }

  if (logger && typeof logger.debug === "function") {
    logger.debug({ packageId: "@manual-app/tut-custom-client-routes-prog" }, "bootClient executed.");
  }
}

export { routeComponents, bootClient };
