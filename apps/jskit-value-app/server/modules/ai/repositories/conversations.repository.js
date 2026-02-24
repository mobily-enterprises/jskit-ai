import { db } from "../../../../db/knex.js";
import { createRepository, __testables } from "@jskit-ai/assistant-transcripts-knex-mysql/repositories/conversations";

const repository = createRepository(db);

export const {
  insert,
  findById,
  findByIdForWorkspace,
  findByIdForWorkspaceAndUser,
  updateById,
  incrementMessageCount,
  list,
  count,
  deleteWithoutMessagesOlderThan,
  transaction
} = repository;

export { __testables };
