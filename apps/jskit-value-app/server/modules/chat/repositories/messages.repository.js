import { db } from "../../../../db/knex.js";
import { createRepository, __testables } from "@jskit-ai/chat-knex-mysql/repositories/messages";

const repository = createRepository(db);

export const {
  insert,
  findById,
  findByClientMessageId,
  listByThreadId,
  listByThreadIdBeforeSeq,
  updateById,
  countByThreadId,
  deleteOlderThan,
  listRetentionCandidatesOlderThan,
  deleteByIds,
  findLatestByThreadId,
  transaction
} = repository;

export { __testables };
