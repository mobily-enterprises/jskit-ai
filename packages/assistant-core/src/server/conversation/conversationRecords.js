// What the conversation runtime reads from saved turns and runtime segments.
import { isDeepStrictEqual } from "node:util";

const submittedMessage = turn => turn.user || turn.system;
const retainedSegments = state => [...new Map([...state.predecessors, state].map(segment => [segment.segmentId, segment])).values()];
const pendingSuccessor = state => state.engine !== "api" && state.predecessors.findLast(segment => segment.successorId === state.segmentId &&
  segment.segmentId !== state.segmentId && segment.replacement?.operation === "replace" && !segment.acceptedAt);
const sameRequest = (left, right) => left.text === right.text && (left.origin || "user") === right.origin &&
  isDeepStrictEqual(left.goal, right.goal) && isDeepStrictEqual(left.data, right.data) &&
  isDeepStrictEqual((left.attachments || []).map(file => file.attachmentId), right.attachments.map(file => file.attachmentId));

/** Saves the application tool receipts of an admitted request on its turn. */
async function saveTools(entry, transaction, request, calls) {
  if (entry.conversation) {
    const saved = await transaction.readTurn(request.turnId);
    if (submittedMessage(saved || {})?.messageId !== request.input.messageId) {
      throw new Error("The application tool receipt does not belong to this authored request.");
    }
  }
  await transaction.updateTurnMetadata(request.turnId, { applicationTools: calls });
}

export { pendingSuccessor, retainedSegments, sameRequest, saveTools, submittedMessage };
