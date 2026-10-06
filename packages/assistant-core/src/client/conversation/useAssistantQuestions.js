import { computed, ref, toValue, watch } from "vue";
import { numberedQuestionSubmissionText, parseNumberedQuestionPrompt } from "../../shared/conversation/numberedQuestionSugar.js";
import { parseAnswerChoicePrompt } from "../../shared/conversation/answerChoiceSugar.js";

/** Ordinary chat answer fields; the caller owns authorized message selection and delivery. */
function useAssistantQuestions({ message = "", extraChoice = null } = {}) {
  const questionText = computed(() => String(toValue(message) || ""));
  const answers = ref({});
  const choice = ref("");
  const dismissedText = ref("");
  const submittedText = ref("");
  const numberedInput = computed(() => parseNumberedQuestionPrompt(questionText.value));
  const questions = computed(() => (
    [dismissedText.value, submittedText.value].includes(questionText.value)
      ? []
      : numberedInput.value.questions || []
  ));
  const selectItems = computed(() => Object.fromEntries(
    questions.value.map((question) => {
      const choices = Array.isArray(question.choices) ? question.choices : [];
      const extra = toValue(extraChoice);
      const includesExtra = extra && choices.some((item) => (
        String(item?.value || "").trim().toLowerCase() === String(extra.value || "").trim().toLowerCase()
      ));
      return [question.name, !extra || includesExtra ? choices : [...choices, extra]];
    })
  ));
  const choices = computed(() => (
    questions.value.length || submittedText.value === questionText.value
      ? []
      : parseAnswerChoicePrompt(questionText.value).choices || []
  ));
  const active = computed(() => Boolean(questions.value.length || choices.value.length));

  function capture(draft = "") {
    const additionalContext = String(draft || "").trim();
    return {
      message: questions.value.length
        ? [numberedQuestionSubmissionText(questions.value, answers.value), additionalContext].filter(Boolean).join("\n\n")
        : choice.value || additionalContext,
      questionText: active.value ? questionText.value : ""
    };
  }

  function markSubmitted(text = "") {
    submittedText.value = text;
    answers.value = {};
    choice.value = "";
  }

  function dismiss() {
    if (!questions.value.length) return false;
    dismissedText.value = questionText.value;
    answers.value = {};
    return true;
  }

  function reset() {
    answers.value = {};
    dismissedText.value = "";
    submittedText.value = "";
    choice.value = "";
  }

  watch(questionText, (text) => {
    answers.value = {};
    if (text !== dismissedText.value) dismissedText.value = "";
    if (text !== submittedText.value) submittedText.value = "";
    choice.value = "";
  });

  return { questions, selectItems, choices, answers, choice, active, capture, markSubmitted, dismiss, reset,
    setAnswers(value) { answers.value = value; }, setChoice(value) { choice.value = value; } };
}

export { useAssistantQuestions };
