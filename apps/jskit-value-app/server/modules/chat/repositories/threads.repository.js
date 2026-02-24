import { db } from "../../../../db/knex.js";
import { createRepository, __testables } from "@jskit-ai/chat-knex-mysql/repositories/threads";

const repository = createRepository(db);

export const {
  insert,
  findById,
  findDmByCanonicalPair,
  findWorkspaceRoomByWorkspaceId,
  listForUser,
  countForUser,
  updateById,
  allocateNextMessageSequence,
  updateLastMessageCache,
  incrementParticipantCount,
  deleteWithoutMessagesOlderThan,
  transaction
} = repository;

export { __testables };
