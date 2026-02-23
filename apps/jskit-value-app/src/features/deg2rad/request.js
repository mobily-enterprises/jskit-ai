const DEG2RAD_VALIDATION_ERROR = "DEG2RAD_degrees must be a valid number.";
const DEG2RAD_OPERATION = "DEG2RAD";

function toNumber(value) {
  return Number(value);
}

export function validateDeg2radForm(form) {
  if (String(form?.DEG2RAD_operation || "") !== DEG2RAD_OPERATION) {
    return {
      ok: false,
      message: "DEG2RAD_operation must be DEG2RAD."
    };
  }

  const DEG2RAD_degrees = toNumber(form?.DEG2RAD_degrees);

  if (!Number.isFinite(DEG2RAD_degrees)) {
    return {
      ok: false,
      message: DEG2RAD_VALIDATION_ERROR
    };
  }

  return {
    ok: true,
    message: ""
  };
}

export function buildDeg2radPayload(form) {
  return {
    DEG2RAD_operation: DEG2RAD_OPERATION,
    DEG2RAD_degrees: toNumber(form?.DEG2RAD_degrees)
  };
}

export const __testables = {
  DEG2RAD_VALIDATION_ERROR,
  DEG2RAD_OPERATION
};
