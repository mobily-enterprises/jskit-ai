import { authDevLoginAsCommand } from "@jskit-ai/auth-core/shared/commands";
import { requireRequestContext } from "@jskit-ai/auth-core/server/actions/auth.contributor";

const devLoginAsAction = Object.freeze({
  id: "auth.dev.loginAs",
  version: 1,
  kind: "command",
  channels: ["api", "internal"],
  surfacesFrom: "enabled",
  input: authDevLoginAsCommand.operation.body,
  idempotency: "none",
  audit: {
    actionName: "auth.dev.loginAs"
  },
  observability: {},
  async execute(input, context, deps) {
    return deps.authService.devLoginAs(requireRequestContext(context, "auth.dev.loginAs"), input);
  }
});

export { devLoginAsAction };
