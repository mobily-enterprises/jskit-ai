# Changelog

## 0.2.0 - 2026-10-29

- Translation ready: every user-visible text is a message key with its English in `locales/en.json`, so an app translates it by supplying translation files only. With no translations, texts and behaviour are unchanged. See the guide "Translating a JSKIT app".

### New message keys (146)

All keys in `locales/en.json` (exported as `./locales/en.json`) are new in this version.

<details><summary>Key list</summary>

- `jskit.assistant.voice.assistant`
- `jskit.assistant.voice.dialog.label`
- `jskit.assistant.voice.dialog.minimize`
- `jskit.assistant.voice.dialog.close`
- `jskit.assistant.voice.dialog.modes`
- `jskit.assistant.voice.dialog.talk`
- `jskit.assistant.voice.dialog.text`
- `jskit.assistant.voice.host.close`
- `jskit.assistant.voice.host.switchPrompt`
- `jskit.assistant.voice.host.thisConversation`
- `jskit.assistant.voice.host.anotherConversation`
- `jskit.assistant.voice.host.stayHere`
- `jskit.assistant.voice.host.discardAndSwitch`
- `jskit.assistant.voice.host.switch`
- `jskit.assistant.voice.host.stopWork`
- `jskit.assistant.voice.host.reopen`
- `jskit.assistant.voice.conversation.listening`
- `jskit.assistant.voice.conversation.speaking`
- `jskit.assistant.voice.conversation.captions`
- `jskit.assistant.voice.conversation.recognizedWords`
- `jskit.assistant.voice.conversation.you`
- `jskit.assistant.voice.conversation.youHearing`
- `jskit.assistant.voice.conversation.youNotSent`
- `jskit.assistant.voice.conversation.latestAnswer`
- `jskit.assistant.voice.controls.label`
- `jskit.assistant.voice.controls.sendOrDiscard`
- `jskit.assistant.voice.controls.listening`
- `jskit.assistant.voice.controls.recordingFinish`
- `jskit.assistant.voice.controls.finishSpeech`
- `jskit.assistant.voice.controls.connecting`
- `jskit.assistant.voice.controls.releaseToSend`
- `jskit.assistant.voice.controls.pause`
- `jskit.assistant.voice.controls.talk`
- `jskit.assistant.voice.controls.notSent`
- `jskit.assistant.voice.controls.soundBlocked`
- `jskit.assistant.voice.controls.enableSound`
- `jskit.assistant.voice.controls.review`
- `jskit.assistant.voice.controls.reviewMessage`
- `jskit.assistant.voice.controls.discard`
- `jskit.assistant.voice.controls.sending`
- `jskit.assistant.voice.controls.send`
- `jskit.assistant.voice.controls.stopTargetSpeaking`
- `jskit.assistant.voice.controls.stopSpeaking`
- `jskit.assistant.voice.controls.talkHint`
- `jskit.assistant.voice.controls.readAloudOff`
- `jskit.assistant.voice.controls.readAloudOn`
- `jskit.assistant.voice.controls.spokenRepliesOn`
- `jskit.assistant.voice.controls.spokenRepliesOff`
- `jskit.assistant.voice.controls.tapToPause`
- `jskit.assistant.voice.controls.tapForHandsFree`
- `jskit.assistant.voice.settings.title`
- `jskit.assistant.voice.settings.speakingVoice`
- `jskit.assistant.voice.settings.speakingVoiceHint`
- `jskit.assistant.voice.avatar.label`
- `jskit.assistant.voice.status.interrupted`
- `jskit.assistant.voice.status.needsAttention`
- `jskit.assistant.voice.status.starting`
- `jskit.assistant.voice.status.active`
- `jskit.assistant.voice.status.off`
- `jskit.assistant.voice.status.reconnecting`
- `jskit.assistant.voice.status.connecting`
- `jskit.assistant.voice.status.openingMicrophone`
- `jskit.assistant.voice.status.openingMic`
- `jskit.assistant.voice.status.listeningToYou`
- `jskit.assistant.voice.status.listening`
- `jskit.assistant.voice.status.targetSpeaking`
- `jskit.assistant.voice.status.speaking`
- `jskit.assistant.voice.status.preparingSpeech`
- `jskit.assistant.voice.status.thinking`
- `jskit.assistant.voice.status.sending`
- `jskit.assistant.voice.status.review`
- `jskit.assistant.voice.status.microphoneMuted`
- `jskit.assistant.voice.status.transcribing`
- `jskit.assistant.voice.status.holdToSpeak`
- `jskit.assistant.voice.status.preparingMicrophone`
- `jskit.assistant.voice.status.live`
- `jskit.assistant.voice.narration.murmur`
- `jskit.assistant.voice.speech.codeOnScreen`
- `jskit.assistant.voice.speech.sqlOnScreen`
- `jskit.assistant.voice.speech.detailsInChat`
- `jskit.assistant.voice.speech.image`
- `jskit.assistant.voice.speech.link`
- `jskit.assistant.voice.errors.notAccepted`
- `jskit.assistant.voice.errors.setupTimeout`
- `jskit.assistant.voice.errors.finishAndReview`
- `jskit.assistant.voice.errors.microphoneNotReady`
- `jskit.assistant.voice.errors.recordingInterrupted`
- `jskit.assistant.voice.errors.noSpeech`
- `jskit.assistant.voice.errors.couldNotContinue`
- `jskit.assistant.voice.errors.interruptedRecording`
- `jskit.assistant.voice.errors.interrupted`
- `jskit.assistant.voice.errors.speechStalled`
- `jskit.assistant.voice.errors.notConnected`
- `jskit.assistant.voice.errors.playbackUnsupported`
- `jskit.assistant.voice.errors.soundBlocked`
- `jskit.assistant.voice.errors.busy`
- `jskit.assistant.voice.errors.serviceCouldNotContinue`
- `jskit.assistant.voice.errors.invalidResponse`
- `jskit.assistant.voice.errors.conversationRequired`
- `jskit.assistant.voice.errors.connectTimeout`
- `jskit.assistant.voice.errors.couldNotConnect`
- `jskit.assistant.voice.errors.unreachable`
- `jskit.assistant.voice.errors.closedWhileConnecting`
- `jskit.assistant.voice.errors.microphoneInUse`
- `jskit.assistant.voice.errors.microphoneBehind`
- `jskit.assistant.voice.errors.microphoneDenied`
- `jskit.assistant.voice.errors.microphoneUnavailable`
- `jskit.assistant.voice.errors.pageSuspended`
- `jskit.assistant.voice.errors.speechNotConfigured`
- `jskit.assistant.voice.errors.noLongerAvailable`
- `jskit.assistant.voice.errors.hostDisposed`
- `jskit.assistant.voice.errors.notAvailable`
- `jskit.assistant.voice.errors.finishBeforeEnding`
- `jskit.assistant.voice.protocol.chooseVoice`
- `jskit.assistant.voice.daemon.operationFailed`
- `jskit.assistant.voice.daemon.speechFailed`
- `jskit.assistant.voice.daemon.queueClosing`
- `jskit.assistant.voice.daemon.queueUnavailable`
- `jskit.assistant.voice.daemon.capacityBusy`
- `jskit.assistant.voice.daemon.speechTooFast`
- `jskit.assistant.voice.daemon.audioWithoutRecording`
- `jskit.assistant.voice.daemon.noRecording`
- `jskit.assistant.voice.daemon.voiceUnavailable`
- `jskit.assistant.voice.proxy.voicesUnavailable`
- `jskit.assistant.voice.proxy.notInstalled`
- `jskit.assistant.voice.proxy.unreachable`
- `jskit.assistant.voice.proxy.busy`
- `jskit.assistant.voice.proxy.sessionFailed`
- `jskit.errors.voice_turn_id_invalid`
- `jskit.errors.voice_control_size_invalid`
- `jskit.errors.voice_control_json_invalid`
- `jskit.errors.voice_control_object_required`
- `jskit.errors.voice_control_type_invalid`
- `jskit.errors.voice_input_sample_rate_invalid`
- `jskit.errors.voice_segment_invalid`
- `jskit.errors.voice_revision_invalid`
- `jskit.errors.voice_speech_text_invalid`
- `jskit.errors.voice_audio_frame_invalid`
- `jskit.errors.voice_utterance_too_long`
- `jskit.errors.voice_recognition_backpressure`
- `jskit.errors.voice_speech_not_active`
- `jskit.errors.voice_access_revoked`
- `jskit.errors.voice_playback_backpressure`
- `jskit.errors.voice_auth_required`
- `jskit.errors.voice_frame_too_large`
- `jskit.errors.voice_connecting`

</details>

### Codes (33)

Error, field-error and message codes this package sends, with their English. Undotted codes kept their existing values and render from `jskit.errors.<code>`.

| Code | English |
| --- | --- |
| `assistant.voice.protocol.chooseVoice` | Choose an available voice before starting speech. |
| `assistant.voice.daemon.operationFailed` | Voice operation failed. |
| `assistant.voice.daemon.speechFailed` | Speech could not be generated. |
| `assistant.voice.daemon.queueClosing` | Voice speech queue is shutting down. |
| `assistant.voice.daemon.queueUnavailable` | Voice speech queue is unavailable. |
| `assistant.voice.daemon.capacityBusy` | Voice speech capacity is currently busy. Try again shortly. |
| `assistant.voice.daemon.speechTooFast` | Speech is arriving faster than playback. |
| `assistant.voice.daemon.audioWithoutRecording` | Audio arrived without an active recording. |
| `assistant.voice.daemon.noRecording` | No matching voice recording is active. |
| `assistant.voice.daemon.voiceUnavailable` | This voice is unavailable. Choose another voice. |
| `assistant.voice.proxy.voicesUnavailable` | Speaking voices could not load. Check the speech service and retry. |
| `assistant.voice.proxy.notInstalled` | Voice is not installed on this server. |
| `assistant.voice.proxy.unreachable` | Voice service could not be reached. |
| `assistant.voice.proxy.busy` | Voice is busy. Try again shortly. |
| `assistant.voice.proxy.sessionFailed` | Voice could not open for this conversation. |
| `voice_turn_id_invalid` | Voice control messages require a valid turn ID. |
| `voice_control_size_invalid` | Voice control message size is invalid. |
| `voice_control_json_invalid` | Voice control messages must be valid JSON. |
| `voice_control_object_required` | Voice control messages must be JSON objects. |
| `voice_control_type_invalid` | Unsupported voice control type: {type}. |
| `voice_input_sample_rate_invalid` | Voice input must be {sampleRate} Hz mono PCM. |
| `voice_segment_invalid` | Choose the current spoken phrase. |
| `voice_revision_invalid` | Choose the current recognized utterance. |
| `voice_speech_text_invalid` | Speech text must contain 1-{maximum} characters. |
| `voice_audio_frame_invalid` | Voice audio frames must contain bounded 16-bit mono PCM. |
| `voice_utterance_too_long` | Voice recordings are limited to {seconds} seconds. |
| `voice_recognition_backpressure` | Speech recognition fell behind. Your recording may be incomplete; review the recognized words. |
| `voice_speech_not_active` | No matching speech stream is open. |
| `voice_access_revoked` | This application's voice access was revoked. |
| `voice_playback_backpressure` | Voice playback fell behind. Speech stopped; the answer remains in chat. |
| `voice_auth_required` | Voice access was denied. |
| `voice_frame_too_large` | Voice message is too large. |
| `voice_connecting` | Voice is still connecting. Try again. |
