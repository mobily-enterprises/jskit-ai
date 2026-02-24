import * as conversationsRepository from "./conversations.repository.js";
import * as messagesRepository from "./messages.repository.js";

function createRepositories() {
  return {
    conversationsRepository,
    messagesRepository
  };
}

export { createRepositories, conversationsRepository, messagesRepository };
