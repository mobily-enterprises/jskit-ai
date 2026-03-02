import * as conversationsRepositoryModule from "./conversations.repository.js";
import * as messagesRepositoryModule from "./messages.repository.js";

const conversationsRepository = { ...conversationsRepositoryModule };
delete conversationsRepository.__testables;
const messagesRepository = { ...messagesRepositoryModule };
delete messagesRepository.__testables;

function createRepository() {
  return {
    conversationsRepository,
    messagesRepository
  };
}

export { createRepository };
