// What the answer-choice and numbered-question sugars share: whether a message input can
// show sugar, and the heading line that introduces answer choices.

function isSingleTextareaMessageField(fields = [], fieldName = "response") {
  return fields.length === 1 &&
    fields[0]?.name === fieldName &&
    fields[0]?.kind === "textarea";
}

function optionalValueMatches(actual = "", expected = "") {
  return !expected || String(actual || "") === String(expected || "");
}

function answerChoiceHeadingLine(line = "") {
  return /^(possible answers|choices):$/iu.test(String(line || "").trim());
}

export { answerChoiceHeadingLine, isSingleTextareaMessageField, optionalValueMatches };
