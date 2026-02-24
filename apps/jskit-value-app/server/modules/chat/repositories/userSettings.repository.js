import { db } from "../../../../db/knex.js";
import { createRepository, __testables } from "@jskit-ai/chat-knex-mysql/repositories/userSettings";

const repository = createRepository(db);

export const { ensureForUserId, findByUserId, findByPublicChatId, updateByUserId, transaction } = repository;

export { __testables };
