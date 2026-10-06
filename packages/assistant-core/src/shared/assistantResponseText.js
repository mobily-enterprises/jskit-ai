const MAX_PROGRESS_ONLY_TEXT_CHARS = 600;

const PROGRESS_SENTENCE_PATTERNS = Object.freeze([
  /^(?:let me|i(?:'|’)ll|i will|i(?:'|’)m going to|i am going to)\s+(?:(?:first|now|quickly)\s+)*(?:analy[sz]e|call|check|confirm|do|execute|fetch|find|inspect|investigate|load|look up|open|prepare|query|read|retrieve|review|run|search|summarize|test|try|use|verify)\b/iu,
  /^(?:analy[sz]ing|calling|checking|confirming|executing|fetching|finding|inspecting|investigating|loading|looking up|opening|preparing|querying|reading|retrieving|reviewing|running|searching|summarizing|testing|trying|using|verifying)\b/iu,
  /^(?:one moment|please wait)\b/iu
]);

function isAssistantProgressOnlyText(value) {
  const text = String(value || "")
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/^(?:okay|sure)[,;:!\s—-]+/iu, "");

  if (!text || text.length > MAX_PROGRESS_ONLY_TEXT_CHARS) {
    return false;
  }

  const sentences = text
    .split(/(?<=[.!?…])\s+/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  return sentences.length > 0 && sentences.every((sentence) =>
    PROGRESS_SENTENCE_PATTERNS.some((pattern) => pattern.test(sentence))
  );
}

export { isAssistantProgressOnlyText };
