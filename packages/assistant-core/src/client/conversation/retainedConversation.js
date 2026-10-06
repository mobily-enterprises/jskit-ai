import { effectScope, shallowReactive } from "vue";

const applicationConversations = new WeakMap();

/** Views and voice retain the same readers and delivery state for an exact target. */
function retainAssistantConversation(app, key, createRuntime, reader = { active: true }) {
  let conversations = applicationConversations.get(app);
  if (!conversations) { conversations = new Map(); applicationConversations.set(app, conversations); }
  let entry = conversations.get(key);
  if (!entry) {
    const scope = effectScope(true);
    const readers = shallowReactive(new Map());
    try {
      const runtime = app.runWithContext(() => scope.run(() => createRuntime(readers)));
      entry = { scope, readers, runtime };
      runtime.retain = () => retainAssistantConversation(app, key, createRuntime);
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
