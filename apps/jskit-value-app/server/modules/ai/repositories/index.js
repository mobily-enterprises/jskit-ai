import * as conversationsRepositoryModule from "./conversations.repository.js";
import * as messagesRepositoryModule from "./messages.repository.js";

const { __testables: _conversationsTestables, ...conversationsRepository } = conversationsRepositoryModule;
const { __testables: _messagesTestables, ...messagesRepository } = messagesRepositoryModule;

function createRepository() {
  return {
    conversationsRepository,
    messagesRepository
  };
}

export { createRepository };
