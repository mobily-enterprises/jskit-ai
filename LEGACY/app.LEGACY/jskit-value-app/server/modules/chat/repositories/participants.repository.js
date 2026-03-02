import { db } from "../../../../db/knex.js";
import { createRepository, __testables } from "@jskit-ai/chat-core/repositories/participants";

const repository = createRepository(db);

export const {
  insert,
  findById,
  listByThreadId,
  findByThreadIdAndUserId,
  listActiveUserIdsByThreadId,
  upsertDmParticipants,
  upsertWorkspaceRoomParticipants,
  updateByThreadIdAndUserId,
  markLeft,
  markRemoved,
  updateReadCursorMonotonic,
  listThreadsForInboxUser,
  repairPointersForThread,
  transaction
} = repository;

export { __testables };
