import { registerRealtimeClientListener } from "@jskit-ai/realtime/client/listeners";
import { crudScopeQueryKey } from "@jskit-ai/crud-core/client";
import { SHELL_WEB_QUERY_CLIENT_TOKEN } from "@jskit-ai/shell-web/client";
import { crudModuleConfig } from "../../shared/moduleConfig.js";

const REALTIME_LISTENER_TOKEN = "${option:namespace|kebab}.realtime.listener";
const RECORD_CHANGED_EVENT = "${option:namespace|snake}.record.changed";

class ${option:namespace|pascal}ClientProvider {
  static id = "${option:namespace|kebab}.client";

  register(app) {
    if (!app || typeof app.make !== "function" || typeof app.has !== "function") {
      throw new Error("${option:namespace|pascal}ClientProvider requires application has()/make().");
    }

    registerRealtimeClientListener(app, REALTIME_LISTENER_TOKEN, () => ({
      listenerId: REALTIME_LISTENER_TOKEN,
      event: RECORD_CHANGED_EVENT,
      async handle() {
        if (!app.has(SHELL_WEB_QUERY_CLIENT_TOKEN)) {
          return;
        }

        const queryClient = app.make(SHELL_WEB_QUERY_CLIENT_TOKEN);
        if (!queryClient || typeof queryClient.invalidateQueries !== "function") {
          return;
        }

        await queryClient.invalidateQueries({
          queryKey: crudScopeQueryKey(crudModuleConfig.namespace)
        });
      }
    }));
  }
}

export { ${option:namespace|pascal}ClientProvider };
