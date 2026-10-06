import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { VOICE_INPUT_SAMPLE_RATE, normalizeRecognizedText, parseVoiceClientControl, speechPauseDurationMs, speechTextFromAssistant, splitSpeechText, takeStreamingSpeech } from '../src/shared/protocol.js';
import { visemeCuesFromText, visemeUnitsFromText } from '../src/shared/visemes.js';
import { createVoiceAccessToken, verifyVoiceAccessToken, voiceTenant } from '../src/server/voiceAccessToken.js';
import { readVoiceAccessToken, resolveVoiceProxyConfig, voiceEndpoint } from '../src/server/voiceProxyConfig.js';
import { normalizeVoiceCloseMetadata } from '../src/server/voiceSocketClose.js';

test("voice proxy safely translates peer close metadata", () => {
  assert.deepEqual(
    normalizeVoiceCloseMetadata(1006, "abnormal browser close"),
    { code: 1000, reason: "abnormal browser close" }
  );
  assert.deepEqual(
    normalizeVoiceCloseMetadata(1013, "Voice service unavailable"),
    { code: 1013, reason: "Voice service unavailable" }
  );

  const invalidLongClose = normalizeVoiceCloseMetadata(5000, "🙂".repeat(120));
  assert.equal(invalidLongClose.code, 1000);
  assert.ok(Buffer.byteLength(invalidLongClose.reason, "utf8") <= 123);
});

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

test("tenant access tokens are scoped and authenticated", () => {
  const key = "0123456789abcdef0123456789abcdef";
  const token = createVoiceAccessToken({ key, tenant: "tenant-42" });
  assert.deepEqual(verifyVoiceAccessToken(token, { key }), {
    tenant: "tenant-42",
    version: "v1"
  });
  assert.equal(verifyVoiceAccessToken(token, { key: `${key}-wrong` }), null);
  assert.equal(verifyVoiceAccessToken(token.replace("tenant-42", "tenant-43"), { key }), null);
});

test("voice proxy configuration is explicit and reads a private credential file", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-voice-config-"));
  context.after(async () => {
    const { rm } = await import("node:fs/promises");
    await rm(root, { force: true, recursive: true });
  });
  const tokenFile = path.join(root, "token");
  const token = createVoiceAccessToken({
    key: "0123456789abcdef0123456789abcdef",
    tenant: "local"
  });
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
  assert.throws(
    () => resolveVoiceProxyConfig({ endpoint: "ws://127.0.0.1:3092/v1/voice" }),
    /configured together/u
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

test("voice proxy credentials preserve generated boundary tenants and trimmed tokens", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-voice-token-valid-"));
  context.after(async () => {
    const { rm } = await import("node:fs/promises");
    await rm(root, { force: true, recursive: true });
  });
  const tokenFile = path.join(root, "token");
  const key = "0123456789abcdef0123456789abcdef";
  for (const tenant of ["a", "tenant-42", `${"a".repeat(62)}9`]) {
    assert.equal(voiceTenant(tenant), tenant);
    const token = createVoiceAccessToken({ key, tenant });
    assert.equal(token.split(".")[2].length, 43);
    await writeFile(tokenFile, ` \t${token}\r\n`, { mode: 0o600 });
    const loaded = readVoiceAccessToken(` ${tokenFile} `);
    assert.equal(loaded, token);
    assert.deepEqual(verifyVoiceAccessToken(loaded, { key }), { tenant, version: "v1" });
  }
});

test("voice proxy credentials reject impossible signed token shapes", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-voice-token-invalid-"));
  context.after(async () => {
    const { rm } = await import("node:fs/promises");
    await rm(root, { force: true, recursive: true });
  });
  const tokenFile = path.join(root, "token");
  const key = "0123456789abcdef0123456789abcdef";
  const token = createVoiceAccessToken({ key, tenant: "tenant-42" });
  const [version, tenant, signature] = token.split(".");
  assert.throws(() => voiceTenant(`${tenant}-`), { code: "voice_tenant_invalid" });
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const noncanonicalSignature = signature.slice(0, -1) + alphabet[alphabet.indexOf(signature.at(-1)) + 1];
  assert.notEqual(noncanonicalSignature, signature);
  assert.equal(noncanonicalSignature.length, 43);
  assert.deepEqual(Buffer.from(noncanonicalSignature, "base64url"), Buffer.from(signature, "base64url"));

  for (const [name, malformed] of [
    ["trailing-hyphen tenant", `${version}.${tenant}-.${signature}`],
    ["42-character signature", `${version}.${tenant}.${signature.slice(0, -1)}`],
    ["44-character signature", `${version}.${tenant}.${signature}A`],
    ["noncanonical base64url signature bits", `${version}.${tenant}.${noncanonicalSignature}`]
  ]) {
    await context.test(name, async () => {
      await writeFile(tokenFile, `${malformed}\n`, { mode: 0o600 });
      assert.equal(verifyVoiceAccessToken(malformed, { key }), null);
      assert.throws(() => readVoiceAccessToken(tokenFile), /credential is malformed/u);
    });
  }
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
