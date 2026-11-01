/**
 * Notices for an app that has none: what is published reaches no one, and no one is ever told
 * anything, so each loop wakes only on its own timer.
 * @type {import("./types.js").AgentNotices}
 */
export const NO_NOTICES = Object.freeze({
  publish: publishToNoOne,
  subscribe: listenToNoOne
});

async function publishToNoOne() {}

function listenToNoOne() {
  return stopListening;
}

function stopListening() {}
