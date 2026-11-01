// Wrappers on a turn's tools: each replaces a tool's `execute` for that turn only.

/**
 * What the person writes while the model works reaches it with the next tool result (as Claude Code
 * takes messages mid-task), so the model can change course at once instead of finishing the
 * old plan first. inbox() returns what's new since it was last asked.
 */
export function hearWhileWorking(tool, inbox) {
  const execute = tool.execute;
  tool.execute = async (input, context) => {
    const result = await execute(input, context);
    const said = await inbox().catch(() => []);
    if (!said.length) return result;
    const personWrote = `While you were working, the person wrote: ${said.map((text) => JSON.stringify(text)).join(" then ")}. Take it into account now: if it changes what they want, change course; if it's a new request, deal with it in this reply too.`;
    return result && typeof result === "object" && !Array.isArray(result) ? { ...result, personWrote } : { result, personWrote };
  };
}

// The same call with the same arguments, over and over, isn't getting anywhere (after DeepSeek
// Harness G1): at the 3rd, 5th and 8th call in a row the result says so. Any other call
// starts the count again; a reply starts with none.
const REPEAT_AT = [3, 5, 8];
const sortedJson = (value) => JSON.stringify(value, (_key, inner) => (inner && typeof inner === "object" && !Array.isArray(inner) ? Object.fromEntries(Object.entries(inner).sort(([a], [b]) => a.localeCompare(b))) : inner));

export function remindOnRepeat(tool, repeats) {
  const execute = tool.execute;
  tool.execute = async (input, context) => {
    const key = `${tool.id} ${sortedJson(input ?? {})}`;
    repeats.count = repeats.key === key ? repeats.count + 1 : 1;
    repeats.key = key;
    const result = await execute(input, context);
    if (!REPEAT_AT.includes(repeats.count)) return result;
    const reminder = repeats.count === REPEAT_AT[0]
      ? "You are repeating the exact same tool call with identical arguments. Carefully look at the previous result before calling again: if the task isn't done, try a different approach or different arguments instead of repeating the call."
      : `This is call number ${repeats.count} in a row of ${tool.id} with these exact arguments, and it isn't making progress. Don't call it with these arguments again: look at the latest result and choose a different action or different arguments, or finish if you already have enough.`;
    return result && typeof result === "object" && !Array.isArray(result) ? { ...result, reminder } : { result, reminder };
  };
}
