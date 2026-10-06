const VOICE_PROTOCOL_VERSION = 1;
const VOICE_DAEMON_WEBSOCKET_PATH = "/v1/voice";
const VOICE_INPUT_SAMPLE_RATE = 16_000;
const VOICE_OUTPUT_SAMPLE_RATE = 22_050;
const VOICE_MAX_CONTROL_BYTES = 16 * 1024;
const VOICE_MAX_AUDIO_FRAME_BYTES = 64 * 1024;
const VOICE_MAX_UTTERANCE_SECONDS = 60;
const VOICE_MAX_SPEECH_TEXT_CHARACTERS = 4_000;
const VOICE_MAX_SPEECH_CHUNK_CHARACTERS = 280;
const VOICE_SPEECH_EM_DASH_PAUSE_MS = 140;
const VOICE_SPEECH_SENTENCE_PAUSE_MS = 220;
const VOICE_SPEECH_LINE_PAUSE_MS = 350;
const VOICE_SPEECH_PARAGRAPH_PAUSE_MS = 650;
const VOICE_TURN_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/u;
const VOICE_CLIENT_CONTROL_TYPES = new Set([
  "cancel",
  "ping",
  "listen.start",
  "listen.stop",
  "listen.commit",
  "listen.discard",
  "speak.start",
  "speak.append",
  "speak.end",
  "speak.stop-after"
]);

function voiceProtocolError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function voiceTurnId(value = "") {
  const turnId = String(value || "").trim();
  if (!VOICE_TURN_ID_PATTERN.test(turnId)) {
    throw voiceProtocolError(
      "voice_turn_id_invalid",
      "Voice control messages require a valid turn ID."
    );
  }
  return turnId;
}

function parseVoiceClientControl(raw = "") {
  const source = Buffer.isBuffer(raw) || raw instanceof Uint8Array
    ? Buffer.from(raw)
    : Buffer.from(String(raw || ""), "utf8");
  if (source.byteLength < 2 || source.byteLength > VOICE_MAX_CONTROL_BYTES) {
    throw voiceProtocolError(
      "voice_control_size_invalid",
      "Voice control message size is invalid."
    );
  }
  let input;
  try {
    input = JSON.parse(source.toString("utf8"));
  } catch {
    throw voiceProtocolError(
      "voice_control_json_invalid",
      "Voice control messages must be valid JSON."
    );
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw voiceProtocolError(
      "voice_control_object_required",
      "Voice control messages must be JSON objects."
    );
  }
  const type = String(input.type || "").trim();
  if (!VOICE_CLIENT_CONTROL_TYPES.has(type)) {
    throw voiceProtocolError(
      "voice_control_type_invalid",
      `Unsupported voice control type: ${type || "(missing)"}.`
    );
  }
  const turnId = voiceTurnId(input.turnId);
  if (type === "listen.start") {
    const sampleRate = Number(input.sampleRate);
    if (sampleRate !== VOICE_INPUT_SAMPLE_RATE) {
      throw voiceProtocolError(
        "voice_input_sample_rate_invalid",
        `Voice input must be ${VOICE_INPUT_SAMPLE_RATE} Hz mono PCM.`
      );
    }
    return Object.freeze({ sampleRate, turnId, type, ...(input.continuous === true ? { continuous: true } : {}) });
  }
  if (type === "speak.stop-after") {
    if (!Number.isSafeInteger(input.segmentIndex) || input.segmentIndex < 0) throw voiceProtocolError("voice_segment_invalid", "Choose the current spoken phrase.");
    return Object.freeze({ type, turnId, segmentIndex: input.segmentIndex });
  }
  if (type === "listen.commit" || type === "listen.discard") {
    if (!Number.isSafeInteger(input.revision) || input.revision < 1) throw voiceProtocolError("voice_revision_invalid", "Choose the current recognized utterance.");
    return Object.freeze({ type, turnId, revision: input.revision });
  }
  if (type === "speak.start" || type === "speak.append") {
    if (input.voiceId !== undefined && (type !== "speak.start" || typeof input.voiceId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u.test(input.voiceId))) {
      throw voiceProtocolError("voice_selection_invalid", "Choose an available voice before starting speech.");
    }
    const text = String(input.text || "");
    if ((!text.trim() && !/[\r\n]/u.test(text)) || text.length > VOICE_MAX_SPEECH_TEXT_CHARACTERS) {
      throw voiceProtocolError(
        "voice_speech_text_invalid",
        `Speech text must contain 1-${VOICE_MAX_SPEECH_TEXT_CHARACTERS} characters.`
      );
    }
    return Object.freeze({ text, turnId, type, ...(input.stream === true ? { stream: true } : {}), ...(input.voiceId ? { voiceId: input.voiceId } : {}) });
  }
  return Object.freeze({ turnId, type });
}

function assertVoiceAudioFrame(frame = null) {
  const bytes = Buffer.isBuffer(frame)
    ? frame
    : frame instanceof Uint8Array
      ? Buffer.from(frame.buffer, frame.byteOffset, frame.byteLength)
      : null;
  if (
    !bytes ||
    bytes.byteLength < 2 ||
    bytes.byteLength > VOICE_MAX_AUDIO_FRAME_BYTES ||
    bytes.byteLength % 2 !== 0
  ) {
    throw voiceProtocolError(
      "voice_audio_frame_invalid",
      "Voice audio frames must contain bounded 16-bit mono PCM."
    );
  }
  return bytes;
}

function pcm16LeToFloat32(frame = Buffer.alloc(0)) {
  const bytes = assertVoiceAudioFrame(frame);
  const samples = new Float32Array(bytes.byteLength / 2);
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = Math.max(-1, bytes.readInt16LE(index * 2) / 32768);
  }
  return samples;
}

function float32ToPcm16Le(samples = new Float32Array()) {
  const source = samples instanceof Float32Array ? samples : Float32Array.from(samples || []);
  const bytes = Buffer.allocUnsafe(source.length * 2);
  for (let index = 0; index < source.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, Number(source[index]) || 0));
    const value = sample < 0 ? Math.round(sample * 32768) : Math.round(sample * 32767);
    bytes.writeInt16LE(value, index * 2);
  }
  return bytes;
}

function normalizeRecognizedText(value = "", vocabulary = {}) {
  const text = String(value || "").replace(/\s+/gu, " ").trim();
  if (!text || text !== text.toUpperCase() || !/[A-Z]/u.test(text)) {
    return text;
  }
  const normalized = text.toLowerCase().replace(/(^|[.!?]\s+)([a-z])/gu, (_match, prefix, letter) => (
    `${prefix}${letter.toUpperCase()}`
  ));
  let result = normalized
    .replace(/\bc plus plus\b/giu, "C++")
    .replace(/\b(?:j|jay)\s+(?:s|ess)\s+kit\b/giu, "JSKIT")
    .replace(/\bnode\s+(?:(?:j|jay)\s+(?:s|ess)|js)\b/giu, "Node.js")
    .replace(/\bpostgres\s+(?:s\s+)?q\s+l\b/giu, "PostgreSQL")
    .replace(/\bweb socket\b/giu, "WebSocket")
    .replace(/\bsherpa onnx\b/giu, "sherpa-onnx")
    .replace(/\b(?:ai|sql|api|json|http|https|mysql|mariadb|postgresql|erd|id|uuid|env|pty|acl|hmac|onnx|npm|jskit|opencode|openai|javascript|typescript|vue|vuetify|fastify|playwright|vitest|github|git|systemd|cmake|codex|zipformer|websocket)\b/giu, (word) => ({
    acl: "ACL",
    ai: "AI",
    api: "API",
    cmake: "CMake",
    codex: "Codex",
    env: "ENV",
    erd: "ERD",
    fastify: "Fastify",
    git: "Git",
    github: "GitHub",
    http: "HTTP",
    https: "HTTPS",
    hmac: "HMAC",
    id: "ID",
    javascript: "JavaScript",
    jskit: "JSKIT",
    json: "JSON",
    mariadb: "MariaDB",
    mysql: "MySQL",
    npm: "npm",
    onnx: "ONNX",
    opencode: "OpenCode",
    openai: "OpenAI",
    playwright: "Playwright",
    postgresql: "PostgreSQL",
    pty: "PTY",
    sql: "SQL",
    systemd: "systemd",
    typescript: "TypeScript",
    uuid: "UUID",
    vitest: "Vitest",
    vue: "Vue",
    vuetify: "Vuetify",
    websocket: "WebSocket",
    zipformer: "Zipformer"
  })[word.toLowerCase()] || word);
  for (const [phrase, spelling] of Object.entries(vocabulary)) {
    const literal = phrase.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    result = result.replace(new RegExp(`\\b${literal}\\b`, "giu"), () => spelling);
  }
  return result;
}

function speechTextFromAssistant(value = "", maximumCharacters = VOICE_MAX_SPEECH_TEXT_CHARACTERS) {
  let omittedCode = false;
  let omittedTable = false;
  let text = String(value || "").slice(0, maximumCharacters * 2);
  text = text.replace(/```([a-z0-9_-]*)[^\n]*\n[\s\S]*?```/giu, (_match, language) => {
    omittedCode = true;
    return String(language || "").toLowerCase() === "sql"
      ? " I put the SQL on screen. "
      : " I put the code on screen. ";
  });
  text = text.replace(/(?:^|\n)\s*\|[^\n]+\|\s*(?=\n|$)/gu, () => {
    omittedTable = true;
    return "\n";
  });
  text = text
    .replace(/!\[[^\]]*\]\([^)]*\)/gu, " an image ")
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1")
    .replace(/https?:\/\/\S+/giu, " a link ")
    .replace(/`([^`\n]+)`/gu, "$1")
    .replace(/^[\t ]{0,3}#{1,6}[\t ]+/gmu, "");
  const lines = text.split(/\r?\n/u);
  text = lines.map((line, index) => {
    const marker = line.match(/^[\t ]*(?:[-*+]|\d+[.)])[\t ]+/u);
    // A new list item is a paragraph-strength speech boundary. Keep it as
    // whitespace through repeated cleanup; the daemon turns it into silence.
    const boundary = index ? (marker ? "\n\n" : "\n") : "";
    const words = line.slice(marker?.[0].length || 0)
      .replace(/_+/gu, " ").replace(/[*~>]/gu, "")
      .replace(/[^\S\r\n]+/gu, " ").trim();
    return boundary + words;
  }).join("").replace(/\n{3,}/gu, "\n\n");
  if (omittedTable && !/details (?:are|remain) in (?:the )?chat/iu.test(text)) {
    text = `${text}${text ? " " : ""}The details are in the chat.`;
  }
  if (omittedCode && !text) {
    text = "I put the code on screen.";
  }
  return text.slice(0, maximumCharacters);
}

function speechPhrases(value = "") {
  const text = String(value || "");
  const phrases = [];
  let start = 0;
  const appendThrough = (end) => {
    const phrase = text.slice(start, end).replace(/^[\t ]+|[\t ]+$/gu, "");
    if (phrase) {
      phrases.push(phrase);
    }
    start = end;
  };
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === "\n") {
      let end = index + 1;
      while (/\s/u.test(text[end] || "")) end += 1;
      appendThrough(end);
      index = end - 1;
      continue;
    }
    if (["—", "–"].includes(character)) {
      let end = index + 1;
      while (/\s/u.test(text[end] || "")) end += 1;
      if (!text.slice(index + 1, end).includes("\n")) end = index + 1;
      appendThrough(end);
      index = end - 1;
      continue;
    }
    if (![".", "!", "?"].includes(character)) {
      continue;
    }
    let end = index + 1;
    while ([".", "!", "?"].includes(text[end])) {
      end += 1;
    }
    while (["\"", "'", "”", "’", "»", ")", "]"].includes(text[end])) {
      end += 1;
    }
    if (end === text.length || /\s/u.test(text[end])) {
      let whitespaceEnd = end;
      while (/\s/u.test(text[whitespaceEnd] || "")) whitespaceEnd += 1;
      if (text.slice(end, whitespaceEnd).includes("\n")) end = whitespaceEnd;
      appendThrough(end);
      index = end - 1;
    }
  }
  appendThrough(text.length);
  return phrases;
}

function speechPauseDurationMs(value = "") {
  const raw = String(value || "").replace(/[\t ]+$/u, "");
  if (/\n\s*\n$/u.test(raw)) return VOICE_SPEECH_PARAGRAPH_PAUSE_MS;
  if (raw.endsWith("\n")) return VOICE_SPEECH_LINE_PAUSE_MS;
  const text = raw.trim();
  if (/[.!?]+["'”’»)\]]*$/u.test(text)) {
    return VOICE_SPEECH_SENTENCE_PAUSE_MS;
  }
  if (/[—–]+$/u.test(text)) {
    return VOICE_SPEECH_EM_DASH_PAUSE_MS;
  }
  return 0;
}

function splitSpeechText(value = "", maximumCharacters = VOICE_MAX_SPEECH_CHUNK_CHARACTERS) {
  const text = speechTextFromAssistant(value);
  const maximum = Number.isInteger(maximumCharacters) && maximumCharacters >= 80
    ? maximumCharacters
    : VOICE_MAX_SPEECH_CHUNK_CHARACTERS;
  if (!text) {
    return [];
  }
  const chunks = [];
  for (const phraseValue of speechPhrases(text)) {
    let phrase = phraseValue;
    while (phrase.length > maximum) {
      const boundary = Math.max(
        phrase.lastIndexOf(" ", maximum),
        phrase.lastIndexOf(",", maximum),
        phrase.lastIndexOf(";", maximum)
      );
      const splitAt = boundary >= Math.floor(maximum * 0.55) ? boundary : maximum;
      chunks.push(phrase.slice(0, splitAt).trim());
      phrase = phrase.slice(splitAt).replace(/^[\t ]+/u, "");
    }
    if (phrase) {
      chunks.push(phrase);
    }
  }
  return chunks;
}

// Consume only a speakable prefix. Incomplete Markdown stays buffered so code,
// link targets and revised last words never leak into speech a token at a time.
function takeStreamingSpeech(text = "", final = false, maximumCharacters = 140) {
  const source = String(text);
  // Wait for the whole table before summarizing it. Splitting inside a long
  // row would read cells aloud and repeat the summary for every later row.
  if (/^\s*\|/u.test(source)) {
    const lines = source.split("\n");
    let consumed = 0;
    for (const [index, line] of lines.entries()) {
      if (line.trim() && !/^\s*\|/u.test(line)) break;
      if (index === lines.length - 1 && !final) return null;
      consumed += line.length + (index < lines.length - 1 ? 1 : 0);
    }
    if (consumed) {
      const boundary = source.slice(0, consumed).match(/(?:\r?\n[\t ]*)+$/u)?.[0] || "";
      return { text: speechTextFromAssistant(`The details are in the chat.${boundary}`), consumed };
    }
  }
  let fence = false;
  let inline = false;
  let link = 0;
  let target = false;
  let end = 0;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (source.slice(index, index + 3) === "```") { fence = !fence; index += 2; continue; }
    if (fence) continue;
    if (character === "`") { inline = !inline; continue; }
    if (inline) continue;
    if (character === "[") link += 1;
    if (character === "]" && link) {
      link -= 1;
      if (source[index + 1] === "(") target = true;
      else if (index === source.length - 1 && !final) break;
    }
    if (target && character === ")") target = false;
    if (link || target) continue;
    if (!/\s/u.test(character)) continue;
    let whitespaceEnd = index + 1;
    while (/\s/u.test(source[whitespaceEnd] || "")) whitespaceEnd += 1;
    // Wait for the next word/marker so a streaming newline cannot be consumed
    // before we know whether it introduces a paragraph or a list item.
    const hasLineBreak = source.slice(index, whitespaceEnd).includes("\n");
    if (!final && hasLineBreak && (whitespaceEnd === source.length ||
        /^(?:[-*+]|\d+[.)]?)$/u.test(source.slice(whitespaceEnd)))) break;
    const prefix = source.slice(0, index).trimEnd();
    if (/[.!?]["'”’»)\]]*$/u.test(prefix) ||
        (prefix.length >= Math.min(40, maximumCharacters / 2) && /[,;:—–]$/u.test(prefix)) ||
        prefix.length >= maximumCharacters || hasLineBreak) {
      end = whitespaceEnd;
      break;
    }
    index = whitespaceEnd - 1;
  }
  if (!end && final) end = source.length;
  if (!end) return null;
  let raw = source.slice(0, end);
  if (/\n[\t ]*$/u.test(raw) && /^(?:[-*+]|\d+[.)])[\t ]+/u.test(source.slice(end))) {
    raw = `${raw.trimEnd()}\n\n`;
  }
  if (final && fence) raw = raw.replace(/```[\s\S]*$/u, " I put the code on screen. ");
  return { text: speechTextFromAssistant(raw), consumed: end };
}

function voiceServerMessage(type = "", fields = {}) {
  return JSON.stringify({
    ...fields,
    protocolVersion: VOICE_PROTOCOL_VERSION,
    type
  });
}

export {
  VOICE_DAEMON_WEBSOCKET_PATH,
  VOICE_INPUT_SAMPLE_RATE,
  VOICE_MAX_AUDIO_FRAME_BYTES,
  VOICE_MAX_CONTROL_BYTES,
  VOICE_MAX_SPEECH_CHUNK_CHARACTERS,
  VOICE_MAX_SPEECH_TEXT_CHARACTERS,
  VOICE_MAX_UTTERANCE_SECONDS,
  VOICE_OUTPUT_SAMPLE_RATE,
  VOICE_PROTOCOL_VERSION,
  assertVoiceAudioFrame,
  float32ToPcm16Le,
  normalizeRecognizedText,
  parseVoiceClientControl,
  pcm16LeToFloat32,
  speechPauseDurationMs,
  speechPhrases,
  speechTextFromAssistant,
  splitSpeechText,
  takeStreamingSpeech,
  voiceProtocolError,
  voiceServerMessage,
  voiceTurnId
};
