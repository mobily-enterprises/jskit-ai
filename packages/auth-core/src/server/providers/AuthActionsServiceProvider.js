import { withActionDefaults } from "@jskit-ai/kernel/shared/actions";
import { buildAuthActions } from "../actions/auth.contributor.js";
import { createAuthSessionEventsService } from "../services/authSessionEventsService.js";

class AuthActionsServiceProvider {
  static id = "auth.actions";

  static dependsOn = ["runtime.actions"];

  register(app) {
    if (
      !app ||
      typeof app.actions !== "function" ||
      typeof app.has !== "function" ||
      typeof app.service !== "function"
    ) {
      throw new Error("AuthActionsServiceProvider requires application actions()/has()/service().");
    }

    if (!app.has("auth.session.events.service")) {
      app.service(
        "auth.session.events.service",
        () => createAuthSessionEventsService(),
        {
          events: {
            notifySessionChanged: [
              {
                type: "entity.changed",
                source: "auth",
                entity: "session",
                operation: "updated",
                entityId: ({ result }) => result?.id,
                realtime: {
                  event: "auth.session.changed",
                  audience: "actor_user"
                }
              },
              {
                type: "entity.changed",
                source: "users",
                entity: "bootstrap",
                operation: "updated",
                entityId: ({ result }) => result?.id,
                realtime: {
                  event: "users.bootstrap.changed",
                  audience: "actor_user"
                }
              }
            ]
          }
        }
      );
    }

    app.actions(
      withActionDefaults(buildAuthActions(), {
        domain: "auth",
        dependencies: {
          authService: "authService",
          authSessionEventsService: "auth.session.events.service"
        }
      })
    );
  }
}

export { AuthActionsServiceProvider };
