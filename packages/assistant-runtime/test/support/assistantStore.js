import { ActionProvider } from "@jskit-ai/kernel/server/actions";
import { EventProvider } from "@jskit-ai/kernel/server/runtime";
import { silentLogger } from "@jskit-ai/kernel/server/runtime/logger";
import { createCapabilityRuntime, defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { ResourceRuntimeProvider } from "@jskit-ai/resource-runtime/server";
import { AssistantStoreFeature } from "../../src/server/AssistantStoreFeature.js";

/**
 * The assistant's repositories on a test's own Knex, as an application gets
 * them: AssistantStoreFeature owning its tables through the resource runtime.
 * `close()` shuts that runtime down; the Knex stays the test's.
 * @param {import("knex").Knex} knex
 */
export async function createTestAssistantStore(knex) {
  let repositories = null;
  const runtime = createCapabilityRuntime({
    inputs: { "runtime.logger": silentLogger },
    providers: [
      EventProvider,
      ActionProvider,
      defineProvider({ id: "test.database", provides: { value: "runtime.database" }, setup: () => ({ value: { knex } }) }),
      ResourceRuntimeProvider,
      AssistantStoreFeature,
      defineProvider({
        id: "test.assistant-store",
        requires: { store: "assistant.repositories" },
        setup({ store }) {
          repositories = store;
          return {};
        }
      })
    ]
  });
  await runtime.start();
  return {
    ...repositories,
    close: () => runtime.shutdown()
  };
}
