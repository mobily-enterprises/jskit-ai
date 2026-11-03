// The values the voice client hands out and receives across files: what its composables and factories return, and
// the conversation binding an application implements.

/** @typedef {ReturnType<typeof import("./voiceController.js").createVoiceConversationController>} VoiceConversationController */
/** @typedef {ReturnType<typeof import("./voiceConversation.js").useVoiceConversation>} VoiceSession */
/** @typedef {ReturnType<typeof import("./voiceTransport.js").useVoiceTransport>} VoiceTransport */
/** @typedef {ReturnType<typeof import("./voiceSpeech.js").useVoiceSpeech>} VoiceSpeech */
/** @typedef {Awaited<ReturnType<typeof import("./audioCapture.js").createMicrophoneCapture>>} MicrophoneCapture */

/**
 * One transport's playback receipt for a speaking turn.
 * @typedef {object} VoicePlaybackEvent
 * @property {string} turnId
 * @property {"started" | "completed" | "interrupted" | "failed"} phase
 * @property {string} [reason]
 */

/**
 * The playback receipt an application observes for one canonical assistant output.
 * @typedef {object} VoiceOutputPlayback
 * @property {string} conversationId
 * @property {string} outputId
 * @property {"started" | "completed" | "interrupted" | "failed"} phase
 * @property {string} [reason]
 */

/**
 * A message as voice reads it from a conversation's state.
 * @typedef {object} VoiceConversationMessage
 * @property {string} id
 * @property {string} role
 * @property {string} [text]
 * @property {string} [outputId]
 * @property {string} [streamId]
 * @property {string} [status]
 * @property {boolean} [autonomous]
 * @property {boolean} [receipt] False while the application has not admitted a local user message.
 */

/**
 * The conversation state voice speaks from.
 * @typedef {object} VoiceConversationState
 * @property {VoiceConversationMessage[]} [messages]
 * @property {VoiceConversationMessage | null} [streamingReply]
 * @property {string} [status] "working" while the agent is running.
 * @property {boolean} [available]
 */

/**
 * Optional activity speech: what the agent is doing while it works.
 * @typedef {object} VoiceNarration
 * @property {object[]} [turns]
 * @property {boolean} [loading]
 * @property {boolean} [eligible]
 * @property {boolean} [working]
 * @property {boolean} [vocalizeThinking]
 * @property {boolean} [vocalizeInterimTurns]
 * @property {boolean} [thinkingSounds]
 */

/**
 * The words captured but not yet sent, as an application previews them.
 * @typedef {{ id: string, text: string } | null} VoiceTranscript
 */

/**
 * What an application supplies for one conversation voice can hold. Its members are read where they are used, so a
 * getter may change them while voice holds the binding; each optional part is marked.
 * @typedef {object} VoiceConversationBinding
 * @property {string} id Compared to reveal or switch targets.
 * @property {VoiceConversationState} state
 * @property {(text: string, options: { messageId: string, context: object }) => unknown} submitText
 *   Resolves when the application's normal server operation accepts the message.
 * @property {string} [label]
 * @property {string} [conversationId] The logical conversation id, when `id` is scoped.
 * @property {boolean} [available] False when access to the conversation is lost.
 * @property {boolean} [showAvatar]
 * @property {unknown} [avatar]
 * @property {import("@jskit-ai/assistant-core/client/types").AssistantConversationAdapter | null} [adapter]
 *   The retained conversation presentation, when the application has one.
 * @property {{ mode?: string, reviewBeforeSend?: boolean, voiceId?: string, readAloud?: boolean }} [defaults]
 * @property {VoiceNarration | null} [narration]
 * @property {boolean} [readAloudChangePending]
 * @property {() => object} [captureContext] The destination a new recording keeps.
 * @property {() => unknown} [openText] Opens the application's text conversation.
 * @property {() => unknown} [cancelWork] Stops the agent's work.
 * @property {() => void} [retain] Keeps the conversation reader alive while voice holds it.
 * @property {() => unknown} [release] Lets go of what `retain` kept.
 * @property {(event: VoiceOutputPlayback) => unknown} [onPlayback]
 * @property {(readAloud: boolean) => unknown} [onReadAloudChange]
 * @property {(transcript: VoiceTranscript, metadata?: { canTake: boolean }) => unknown} [onTranscript]
 * @property {(visual: object | null) => unknown} [onVisual]
 * @property {(message: string) => unknown} [onError]
 */

/**
 * What a launcher's `open()` hands back for a held gesture: the shared session's held recording.
 * @typedef {object} VoiceHeldRecording
 * @property {() => unknown} startHeldRecording
 * @property {() => unknown} finishHeldRecording
 * @property {() => unknown} discardHeldRecording
 */

export {};
