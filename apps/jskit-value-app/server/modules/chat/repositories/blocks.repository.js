import { db } from "../../../../db/knex.js";
import { createRepository, __testables } from "@jskit-ai/chat-core/repositories/blocks";

const repository = createRepository(db);

export const {
  findByUserIdAndBlockedUserId,
  isBlockedEitherDirection,
  addBlock,
  removeBlock,
  listBlockedUsers,
  transaction
} = repository;

export { __testables };
