import { TOKENS } from "@jskit-ai/support-core/tokens";
import { createController, buildRoutes } from "../lib/index.js";

class BillingRouteServiceProvider {
  static id = "billing.routes";

  static dependsOn = [];

  register(app) {
    if (!app || typeof app.has !== "function") {
      throw new Error("BillingRouteServiceProvider requires application has().");
    }
    if (!app.has("actionExecutor")) {
      throw new Error("BillingRouteServiceProvider requires actionExecutor binding.");
    }
    if (!app.has("billingWebhookService")) {
      throw new Error("BillingRouteServiceProvider requires billingWebhookService binding.");
    }
  }

  boot(app) {
    if (!app || typeof app.make !== "function") {
      throw new Error("BillingRouteServiceProvider requires application make().");
    }

    const router = app.make(TOKENS.HttpRouter);
    const controller = createController({
      billingWebhookService: app.make("billingWebhookService"),
      actionExecutor: app.make("actionExecutor")
    });

    const routes = buildRoutes({ billing: controller }, {});
    for (const route of routes) {
      router.register(route.method, route.path, route, route.handler);
    }
  }
}

export { BillingRouteServiceProvider };
