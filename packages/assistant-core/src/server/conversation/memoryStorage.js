import { createConversationStorage } from "./storage.js";

/** Transient storage: share one instance across the application's conversations. */
export function createMemoryConversationStorage() {
  const conversations = new Map();
  return createConversationStorage({
    readRecord: (id) => conversations.get(id) || { turns: new Map(), metadata: {} },
    writeRecord: (id, record) => { conversations.set(id, record); },
    deleteRecord: (id) => { conversations.delete(id); }
  });
}
