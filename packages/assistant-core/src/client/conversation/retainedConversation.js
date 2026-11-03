import { effectScope, shallowReactive } from "vue";

// Each application's retained conversations, by target key; the entry goes when its last reader releases it.
const applicationConversations = new WeakMap();

/**
 * Views and voice retain the same readers and delivery state for an exact target. The runtime is created once per
 * application and key, as `createRuntime(readers, retain)`: `readers` holds every current reader, and `retain()`
 * retains the same runtime again for another reader, so the runtime lists it in its result.
 * @template Runtime
 * @param {import("vue").App} app
 * @param {string} key
 * @param {(readers: Map<symbol, { active: boolean }>, retain: () => { runtime: Runtime, release: () => void }) => Runtime} createRuntime
 * @param {{ active: boolean }} [reader]
 * @returns {{ runtime: Runtime, release: () => void }}
 */
function retainAssistantConversation(app, key, createRuntime, reader = { active: true }) {
  let conversations = applicationConversations.get(app);
  if (!conversations) { conversations = new Map(); applicationConversations.set(app, conversations); }
  let entry = conversations.get(key);
  if (!entry) {
    const scope = effectScope(true);
    const readers = shallowReactive(new Map());
    const retain = () => retainAssistantConversation(app, key, createRuntime);
    try {
      const runtime = app.runWithContext(() => scope.run(() => createRuntime(readers, retain)));
      entry = { scope, readers, runtime };
      conversations.set(key, entry);
    } catch (error) { scope.stop(); throw error; }
  }
  const token = Symbol("conversation reader");
  entry.readers.set(token, reader);
  return {
    runtime: entry.runtime,
    release() {
      if (!entry.readers.delete(token) || entry.readers.size) return;
      entry.scope.stop();
      conversations.delete(key);
    }
  };
}

export { retainAssistantConversation };
