import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { VOICE_INPUT_SAMPLE_RATE, normalizeRecognizedText, parseRecognitionSpellings, parseVoiceClientControl, recognitionSpellingCount, recognitionSpellings, speechPauseDurationMs, speechTextFromAssistant, splitSpeechText, takeStreamingSpeech } from '../src/shared/protocol.js';
import { visemeCuesFromText, visemeUnitsFromText } from '../src/shared/visemes.js';
import { createVoiceClientToken, isVoiceClientToken, parseVoiceCredentials, voiceTokenSha256 } from '../src/server/voiceCredentials.js';
import { readVoiceAccessToken, resolveVoiceProxyConfig, voiceEndpoint } from '../src/server/voiceProxyConfig.js';

test("voice control messages are strict, bounded, and turn scoped", () => {
  assert.deepEqual(parseVoiceClientControl(JSON.stringify({
    sampleRate: VOICE_INPUT_SAMPLE_RATE,
    turnId: "turn-123",
    type: "listen.start"
  })), {
    sampleRate: VOICE_INPUT_SAMPLE_RATE,
    turnId: "turn-123",
    type: "listen.start"
  });
  assert.throws(
    () => parseVoiceClientControl(JSON.stringify({ sampleRate: 44_100, turnId: "turn-1", type: "listen.start" })),
    { code: "voice_input_sample_rate_invalid" }
  );
  assert.throws(
    () => parseVoiceClientControl(JSON.stringify({ turnId: "../tenant", type: "cancel" })),
    { code: "voice_turn_id_invalid" }
  );
  assert.throws(
    () => parseVoiceClientControl(JSON.stringify({ turnId: "turn-1", type: "unknown" })),
    { code: "voice_control_type_invalid" }
  );
});

test("assistant speech removes code, links, and table detail from spoken output", () => {
  const speech = speechTextFromAssistant([
    "Here is the result:",
    "",
    "| id | name |",
    "| --- | --- |",
    "| 1 | Ada |",
    "",
    "```sql",
    "select * from users;",
    "```",
    "See [the docs](https://example.test/private)."
  ].join("\n"));
  assert.doesNotMatch(speech, /select \*|https:|\|/u);
  assert.match(speech, /SQL on screen/u);
  assert.match(speech, /details are in the chat/iu);
  assert.ok(splitSpeechText("One sentence. Two sentence. Three sentence.", 80).length >= 1);
});

test("assistant speech preserves quoted sentences and creates audible punctuation boundaries", () => {
  const answer = [
    "I understand your intended meaning most of the time, but not every spoken word perfectly.",
    "I only receive the transcript, and we’ve seen errors such as “AI” becoming “ita” and “come across as” becoming “karama kazan.”",
    "When the transcript is unclear, I’ll tell you rather than pretend I understood."
  ];

  assert.deepEqual(splitSpeechText(answer.join(" ")), answer);
  assert.deepEqual(splitSpeechText("Let me check—then I’ll answer. Done."), [
    "Let me check—",
    "then I’ll answer.",
    "Done."
  ]);
  assert.ok(speechPauseDurationMs("Done.") > speechPauseDurationMs("Let me check—"));
  assert.ok(speechPauseDurationMs("Let me check—") > 0);
  assert.equal(speechPauseDurationMs("Still speaking"), 0);
});

test("assistant speech preserves list item pauses through client and daemon normalization", () => {
  const answer = "The session labels are:\n\n* Save source\n* Update target — currently selected\n* Alternative approach";
  const speech = speechTextFromAssistant(answer);
  assert.equal(speech, "The session labels are:\n\nSave source\n\nUpdate target — currently selected\n\nAlternative approach");
  assert.equal(speechTextFromAssistant(speech), speech);
  assert.deepEqual(splitSpeechText(speech), [
    "The session labels are:\n\n",
    "Save source\n\n",
    "Update target —",
    "currently selected\n\n",
    "Alternative approach"
  ]);
  assert.equal(speechPauseDurationMs(splitSpeechText(speech)[0]), 650);
  assert.equal(speechPauseDurationMs(splitSpeechText(speech)[3]), 650);

  for (const marker of ["-", "*", "+", "1.", "2)"]) {
    assert.equal(speechTextFromAssistant(`${marker} **Save source**\n  and keep history\n${marker} “Already done.”\n\nContinue here.`),
      "Save source\nand keep history\n\n“Already done.”\n\nContinue here.");
  }
  assert.equal(speechTextFromAssistant("- Parent\n  - Nested item\n- Next item"), "Parent\n\nNested item\n\nNext item");
  assert.equal(speechTextFromAssistant("Ordinary prose\nwraps without a pause."), "Ordinary prose\nwraps without a pause.");
});

test("streaming recognizer text is made readable without changing mixed-case input", () => {
  assert.equal(normalizeRecognizedText("SELECT THE MYSQL ID"), "Select the MySQL ID");
  assert.equal(
    normalizeRecognizedText("THIS USES JAY ESS KIT WITH NODE J S AND POSTGRES Q L AND WEB SOCKET"),
    "This uses JSKIT with Node.js and PostgreSQL and WebSocket"
  );
  assert.equal(normalizeRecognizedText("Keep MySQL as it is"), "Keep MySQL as it is");
});

test("recognition vocabulary supplies literal application spellings without changing mixed-case input", () => {
  const vocabulary = { "acme labs": "Acme Labs", "example.org": "Example.org", cash: "$Cash" };
  assert.equal(normalizeRecognizedText("ACME LABS USES EXAMPLE.ORG AND CASH", vocabulary), "Acme Labs uses Example.org and $Cash");
  assert.equal(normalizeRecognizedText("ACME LABS USES EXAMPLEXORG AND CASHIER", vocabulary), "Acme Labs uses examplexorg and cashier");
  assert.equal(normalizeRecognizedText("Keep acme labs as written", vocabulary), "Keep acme labs as written");
  assert.equal(normalizeRecognizedText("ACME LABS"), "Acme labs");
});

test("a host's spellings win over JSKIT's on a clash, longest phrase first", () => {
  const vocabulary = recognitionSpellings({
    "vibe sixty four": "Vibe64", vibe: "Vibe", merc: "Merc", one: "1",
    "J  S Kit": "J.S. Kit", postgresql: "Postgres", "web socket": "web-socket"
  });
  assert.equal(
    normalizeRecognizedText("MERC BUILT VIBE SIXTY FOUR ON ONE VIBE WITH J S KIT", vocabulary),
    "Merc built Vibe64 on 1 Vibe with J.S. Kit"
  );
  assert.equal(normalizeRecognizedText("POSTGRESQL OVER WEB SOCKET AND SQL", vocabulary), "Postgres over web-socket and SQL",
    "JSKIT's spellings still apply to the words a host's do not take");
  assert.equal(normalizeRecognizedText("Vibe sixty four as typed", vocabulary), "Vibe sixty four as typed");
  assert.equal(recognitionSpellingCount({}), 41, "JSKIT's own: six phrases and 35 words");
  assert.equal(recognitionSpellingCount(vocabulary), 45, "four added; a clash replaces JSKIT's own");
});

test("a spellings file maps each spoken phrase to its written form, one per line", () => {
  assert.deepEqual(parseRecognitionSpellings([
    "# Product words",
    "vibe sixty four => Vibe64",
    "",
    "  MERC   BOT =>  Mercbot  ",
    "o'reilly => O'Reilly => Media",
    "pay pal => PayPal\r"
  ].join("\n")), { "vibe sixty four": "Vibe64", "merc bot": "Mercbot", "o'reilly": "O'Reilly => Media", "pay pal": "PayPal" });
  assert.deepEqual(parseRecognitionSpellings(""), {});
  const refusals = [
    ["Vibe64", /line 1 must read "spoken phrase => Written form"/u],
    ["# first\nsemi;colon => x", /line 2: Spelling "semi;colon": the spoken phrase must be 1 to 100/u],
    [" => Vibe64", /line 1: .*spoken phrase must be/u],
    ["vibe =>", /line 1: .*written form must be 1 to 100 characters/u],
    ["vibe => Vi\u0007be", /line 1: .*no control characters/u],
    [`vibe => ${"x".repeat(101)}`, /line 1: .*written form must be/u],
    [`${"a".repeat(101)} => A`, /line 1: .*spoken phrase must be/u],
    ["merc => Merc\n\nMERC => MERC", /line 3: "MERC" is already spelled on line 1/u],
    [Array.from({ length: 1001 }, (_, index) => `word ${index} => W${index}`).join("\n"), /line 1001: spellings are limited to 1000 phrases/u]
  ];
  for (const [text, message] of refusals) assert.throws(() => parseRecognitionSpellings(text), { name: "TypeError", message });
  for (const value of [null, [], { "a;b": "x" }, { vibe: 64 }, { vibe: " Vibe" }, { vibe: "Vibe", VIBE: "VIBE" }]) {
    assert.throws(() => recognitionSpellings(value), TypeError);
  }
  assert.throws(() => recognitionSpellings(Object.fromEntries(Array.from({ length: 1001 }, (_, index) => [`w ${index}`, "W"]))), /limited to 1000/u);
});

test("speech text becomes a bounded phoneme-informed viseme timeline", () => {
  const units = visemeUnitsFromText("Merc will make a rounded voice.");
  assert.ok(units.some((unit) => unit.pose === "closed"));
  assert.ok(units.some((unit) => unit.pose === "open"));
  assert.ok(units.some((unit) => unit.pose === "round"));
  assert.ok(units.some((unit) => unit.pose === "wide"));
  const cues = visemeCuesFromText("Hello from Merc.", 1_200);
  assert.deepEqual(cues[0], { atMs: 0, level: 0, pose: "closed" });
  assert.equal(cues.at(-1).pose, "closed");
  assert.ok(cues.every((cue, index) => index === 0 || cue.atMs >= cues[index - 1].atMs));
  assert.ok(cues.at(-1).atMs <= 1_200);
});

test("voice proxy configuration is explicit and reads a private credential file or a token value", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "jskit-voice-config-"));
  context.after(async () => {
    const { rm } = await import("node:fs/promises");
    await rm(root, { force: true, recursive: true });
  });
  const tokenFile = path.join(root, "token");
  const token = createVoiceClientToken();
  await writeFile(tokenFile, `${token}\n`, { mode: 0o600 });
  assert.equal(readVoiceAccessToken(tokenFile), token);
  assert.equal(voiceEndpoint("ws://127.0.0.1:3092/v1/voice"), "ws://127.0.0.1:3092/v1/voice");
  assert.equal(resolveVoiceProxyConfig({}).available, false);
  assert.deepEqual(resolveVoiceProxyConfig({
    accessTokenFile: tokenFile,
    endpoint: "ws://127.0.0.1:3092/v1/voice"
  }), {
    available: true,
    endpoint: "ws://127.0.0.1:3092/v1/voice",
    token
  });
  assert.deepEqual(resolveVoiceProxyConfig({ accessToken: ` ${token}\n`, endpoint: "wss://speech.example.test/v1/voice" }), {
    available: true,
    endpoint: "wss://speech.example.test/v1/voice",
    token
  });
  assert.throws(
    () => resolveVoiceProxyConfig({ endpoint: "ws://127.0.0.1:3092/v1/voice" }),
    /configured together/u
  );
  assert.throws(
    () => resolveVoiceProxyConfig({ accessToken: token, accessTokenFile: tokenFile, endpoint: "ws://127.0.0.1:3092/v1/voice" }),
    /not both/u
  );
  assert.throws(
    () => resolveVoiceProxyConfig({ accessToken: "short", endpoint: "ws://127.0.0.1:3092/v1/voice" }),
    /credential is malformed/u
  );
});

test("voice proxy endpoints preserve supported URLs and encoded or empty fragments", () => {
  for (const protocol of ["ws", "wss"]) {
    for (const suffix of ["", "/%23part?label=%23value", "#"]) {
      const endpoint = `${protocol}://voice.example.test/v1/voice${suffix}`;
      assert.equal(voiceEndpoint(` \t${endpoint}\n`), endpoint);
    }
  }
});

for (const protocol of ["ws", "wss"]) {
  test(`voice proxy endpoints reject nonempty ${protocol} URL fragments`, () => {
    assert.throws(
      () => voiceEndpoint(`${protocol}://voice.example.test/v1/voice#fragment`),
      /Voice endpoint/u
    );
  });
}

test("voice client tokens are any RFC 6750 bearer token of 32 or more characters, read trimmed", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "jskit-voice-token-valid-"));
  context.after(async () => {
    const { rm } = await import("node:fs/promises");
    await rm(root, { force: true, recursive: true });
  });
  const tokenFile = path.join(root, "token");
  const generated = createVoiceClientToken();
  assert.match(generated, /^[A-Za-z0-9_-]{43}$/u);
  assert.notEqual(createVoiceClientToken(), generated);
  for (const token of [generated, "a".repeat(32), "0123456789abcdef".repeat(4), `crd_${"Ab9-_.~+/".repeat(4)}==`]) {
    assert.equal(isVoiceClientToken(token), true, token);
    await writeFile(tokenFile, ` \t${token}\r\n`, { mode: 0o600 });
    assert.equal(readVoiceAccessToken(` ${tokenFile} `), token);
  }
  assert.equal(voiceTokenSha256("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", "the hash of the token's UTF-8 bytes in lowercase hex");
});

test("voice client tokens refuse short, spaced or non-token text", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "jskit-voice-token-invalid-"));
  context.after(async () => {
    const { rm } = await import("node:fs/promises");
    await rm(root, { force: true, recursive: true });
  });
  const tokenFile = path.join(root, "token");
  for (const [name, malformed] of [
    ["31 characters", "a".repeat(31)],
    ["inner space", `${"a".repeat(20)} ${"b".repeat(20)}`],
    ["padding inside", `${"a".repeat(20)}=${"b".repeat(20)}`],
    ["non-ASCII", `${"a".repeat(32)}é`],
    ["over 1024 characters", "a".repeat(1025)]
  ]) {
    await context.test(name, async () => {
      assert.equal(isVoiceClientToken(malformed), false);
      await writeFile(tokenFile, `${malformed}\n`, { mode: 0o600 });
      assert.throws(() => readVoiceAccessToken(tokenFile), /credential (is malformed|file is invalid)/u);
    });
  }
});

test("voice credentials documents list each client's token hashes and optional limit", () => {
  const [first, second] = [createVoiceClientToken(), createVoiceClientToken()];
  const credentials = parseVoiceCredentials({
    schema: "jskit.assistant-voice.credentials.v1",
    clients: {
      "mercbot-app": { tokenSha256: [voiceTokenSha256(first), voiceTokenSha256(second)], maximumConnections: 3 },
      "ws.12": { tokenSha256: [voiceTokenSha256(createVoiceClientToken())] }
    }
  });
  assert.deepEqual(credentials.get(voiceTokenSha256(first)), { client: "mercbot-app", maximumConnections: 3 });
  assert.deepEqual(credentials.get(voiceTokenSha256(second)), { client: "mercbot-app", maximumConnections: 3 });
  assert.equal(credentials.size, 3);
  const valid = { tokenSha256: [voiceTokenSha256(first)] };
  for (const [name, document] of [
    ["an array", []],
    ["no schema", { clients: {} }],
    ["an extra top-level field", { schema: "jskit.assistant-voice.credentials.v1", clients: {}, keys: [] }],
    ["clients as a list", { schema: "jskit.assistant-voice.credentials.v1", clients: [valid] }],
    ["a client name ending in a dash", { schema: "jskit.assistant-voice.credentials.v1", clients: { "client-": valid } }],
    ["a 65-character client name", { schema: "jskit.assistant-voice.credentials.v1", clients: { ["a".repeat(65)]: valid } }],
    ["no token hashes", { schema: "jskit.assistant-voice.credentials.v1", clients: { client: { tokenSha256: [] } } }],
    ["nine token hashes", { schema: "jskit.assistant-voice.credentials.v1", clients: { client: { tokenSha256: Array.from({ length: 9 }, (_, index) => voiceTokenSha256(String(index))) } } }],
    ["an upper-case hash", { schema: "jskit.assistant-voice.credentials.v1", clients: { client: { tokenSha256: [voiceTokenSha256(first).toUpperCase()] } } }],
    ["a zero limit", { schema: "jskit.assistant-voice.credentials.v1", clients: { client: { ...valid, maximumConnections: 0 } } }],
    ["a fractional limit", { schema: "jskit.assistant-voice.credentials.v1", clients: { client: { ...valid, maximumConnections: 1.5 } } }]
  ]) {
    assert.throws(() => parseVoiceCredentials(document), { code: "voice_credentials_invalid" }, name);
  }
});

test("voice credentials accept mobilynet's link and credential ids as client names", () => {
  const credentials = parseVoiceCredentials({
    schema: "jskit.assistant-voice.credentials.v1",
    clients: {
      lnk_abcdefghijklmnop: { tokenSha256: [voiceTokenSha256(createVoiceClientToken())] },
      crd_abcdefghijklmnop: { tokenSha256: [voiceTokenSha256(createVoiceClientToken())] }
    }
  });
  assert.deepEqual([...credentials.values()].map(entry => entry.client), ["lnk_abcdefghijklmnop", "crd_abcdefghijklmnop"]);
});

test("incremental speech holds incomplete Markdown and starts on a natural clause", () => {
  assert.equal(takeStreamingSpeech("An unfinished thought"), null);
  assert.deepEqual(takeStreamingSpeech("A whole sentence. Still writing"), { text: "A whole sentence.", consumed: 18 });
  assert.equal(takeStreamingSpeech("See [the documentation. "), null);
  assert.equal(takeStreamingSpeech("```js\nthrow new Error('private');\n"), null);
  assert.deepEqual(takeStreamingSpeech("```js\nthrow new Error('private');\n", true).text, "I put the code on screen.");
  assert.equal(takeStreamingSpeech("See [the documentation](https://example.com). More").text, "See the documentation.");
  const prose = "Keep a useful amount of speech ready while more words arrive without needing the entire response to finish first. ";
  let buffer = "", spoken = [];
  for (const character of prose.repeat(5)) {
    buffer += character;
    const chunk = takeStreamingSpeech(buffer);
    if (chunk) { spoken.push(chunk.text); buffer = buffer.slice(chunk.consumed); }
  }
  const last = takeStreamingSpeech(buffer, true);
  if (last?.text) spoken.push(last.text);
  assert.equal(spoken.join(" "), prose.repeat(5).trim());
});

test("streaming speech holds long table rows and summarizes the whole table once", () => {
  const table = `| Name | Details |\n| --- | --- |\n| Item | ${"cell ".repeat(60)}|`;
  assert.equal(takeStreamingSpeech(table), null);
  const introduction = takeStreamingSpeech("Rows:\n" + table);
  assert.equal(introduction.text, "Rows:\n");
  assert.equal(takeStreamingSpeech(("Rows:\n" + table).slice(introduction.consumed)), null);
  const complete = `${table}\n\nHere is the explanation. `;
  const summary = takeStreamingSpeech(complete);
  assert.equal(summary.text, "The details are in the chat.\n\n");
  assert.equal(takeStreamingSpeech(complete.slice(summary.consumed), true).text, "Here is the explanation.");
});

test("the first spoken chunk can start at a shorter natural clause", () => {
  const text = "I think this is an interesting idea, especially if we make the first version simple";
  assert.equal(takeStreamingSpeech(text, false, 64).text, "I think this is an interesting idea,");
  assert.equal(takeStreamingSpeech(text), null);
});

test("line, paragraph and list pauses survive every cleanup and the speech transport", () => {
  const original = "Intro.\r\nNext line\r\n\r\n## Options\r\n1. Use `my_project`\r\n2) Keep another_value\r\n\r\nDone.";
  const expected = ["Intro.\n", "Next line\n\n", "Options\n\n", "Use my project\n\n", "Keep another value\n\n", "Done."];
  let text = original;
  for (let pass = 0; pass < 3; pass += 1) text = speechTextFromAssistant(text);
  const control = parseVoiceClientControl(JSON.stringify({ type: "speak.start", turnId: "pauses", text }));
  assert.deepEqual(splitSpeechText(control.text), expected);
  assert.deepEqual(expected.map(speechPauseDurationMs), [350, 650, 650, 650, 650, 220]);
  assert.equal(speechTextFromAssistant("__Bold__ and _italic_ use `my_project` or my__other_value."),
    "Bold and italic use my project or my other value.");
  assert.equal(speechTextFromAssistant("Normal sentence. Another sentence!"), "Normal sentence. Another sentence!");
  assert.deepEqual(splitSpeechText("Section—\nNext."), ["Section—\n", "Next."]);
  assert.equal(speechPauseDurationMs("Section—\n"), 350);
});

test("streamed line and list boundaries keep the same pauses at every arrival split", () => {
  const text = "Intro.\nNext line\n\nOptions:\n- Use my_project\n- Keep another_value\n\nDone.";
  const expected = ["Intro.\n", "Next line\n\n", "Options:\n\n", "Use my project\n\n", "Keep another value\n\n", "Done."];
  const arrivals = [
    ...Array.from({ length: text.length + 1 }, (_, split) => [[text.slice(0, split), false], [text.slice(split), true]]),
    Array.from(text, (character, index) => [character, index === text.length - 1])
  ];
  for (const [split, pieces] of arrivals.entries()) {
    let buffer = "";
    const phrases = [];
    for (const [part, final] of pieces) {
      buffer += part;
      while (buffer) {
        const chunk = takeStreamingSpeech(buffer, final, 64);
        if (!chunk) break;
        buffer = buffer.slice(chunk.consumed);
        const browser = speechTextFromAssistant(chunk.text);
        if (browser) {
          const control = parseVoiceClientControl(JSON.stringify({ type: "speak.append", turnId: "stream-pauses", text: browser }));
          phrases.push(...splitSpeechText(control.text));
        }
      }
    }
    assert.deepEqual(phrases, expected, `arrival split ${split}`);
  }
  assert.equal(takeStreamingSpeech("First.\n"), null);
  assert.equal(takeStreamingSpeech("First.\n-"), null);
  assert.equal(takeStreamingSpeech("First.\n12."), null);
});

test("very long lines retain their final structural pause after length splitting", () => {
  const phrases = splitSpeechText(`${"x".repeat(280)}\n\nNext.`);
  assert.equal(phrases.join(""), `${"x".repeat(280)}\n\nNext.`);
  assert.equal(speechPauseDurationMs(phrases.at(-2)), 650);
  assert.equal(parseVoiceClientControl(JSON.stringify({ type: "speak.append", turnId: "boundary", text: "\n\n" })).text, "\n\n");
  assert.throws(() => parseVoiceClientControl(JSON.stringify({ type: "speak.start", turnId: "empty", text: "  " })), { code: "voice_speech_text_invalid" });
});
