// What a native command does when its caller leaves out one of its optional callbacks.

/** A command whose caller records no delivery timing for a receipt: the native acknowledgement or its persisted copy. */
export function ignoreReceipt() {}

/** A command whose caller has nothing to do before its prompt is sent. */
export function ignorePromptSending() {}

/** A command whose caller keeps no record of a rejected prompt. */
export function ignorePromptRejection() {}
