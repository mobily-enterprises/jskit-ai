import DeclarativeRouteView from "./views/DeclarativeRouteView.vue";

const routeComponents = Object.freeze({
  "tut-dec-declarative": DeclarativeRouteView
});

async function bootClient({ logger } = {}) {
  if (logger && typeof logger.debug === "function") {
    logger.debug({ packageId: "@manual-app/tut-custom-client-routes-dec" }, "bootClient executed.");
  }
}

export { routeComponents, bootClient };
