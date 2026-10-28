import {
  AUTH_EMAIL_MAX_LENGTH,
  AUTH_EMAIL_REGEX,
  AUTH_LOGIN_PASSWORD_MAX_LENGTH,
  AUTH_PASSWORD_MAX_LENGTH,
  AUTH_PASSWORD_MIN_LENGTH
} from "../shared/authConstraints.js";
import { normalizeEmail } from "./utils.js";

// Each failed check carries its English error plus the code and params a client
// renders it from, so the English stays as it is and a translation can replace it.
function failure({ code, params = {}, message }) {
  return { error: message, errorCode: code, errorParams: params };
}

const PASSED = Object.freeze({ error: "", errorCode: "", errorParams: Object.freeze({}) });

function validateEmail(rawEmail) {
  const email = normalizeEmail(rawEmail);

  if (!email) {
    return { email, ...failure({ code: "auth.validation.emailRequired", message: "Email is required." }) };
  }

  if (email.length > AUTH_EMAIL_MAX_LENGTH || !AUTH_EMAIL_REGEX.test(email)) {
    return { email, ...failure({ code: "auth.validation.emailInvalid", message: "Provide a valid email address." }) };
  }

  return { email, ...PASSED };
}

function registerPassword(rawPassword) {
  const password = String(rawPassword || "");
  if (!password) {
    return { password, ...failure({ code: "auth.validation.passwordRequired", message: "Password is required." }) };
  }

  if (password.length < AUTH_PASSWORD_MIN_LENGTH || password.length > AUTH_PASSWORD_MAX_LENGTH) {
    return {
      password,
      ...failure({
        code: "auth.validation.passwordLength",
        params: { min: AUTH_PASSWORD_MIN_LENGTH, max: AUTH_PASSWORD_MAX_LENGTH },
        message: "Password must be between 8 and 128 characters."
      })
    };
  }

  return { password, ...PASSED };
}

function loginPassword(rawPassword) {
  const password = String(rawPassword || "");
  if (!password) {
    return { password, ...failure({ code: "auth.validation.passwordRequired", message: "Password is required." }) };
  }

  if (password.length > AUTH_LOGIN_PASSWORD_MAX_LENGTH) {
    return {
      password,
      ...failure({
        code: "auth.validation.passwordTooLong",
        params: { max: AUTH_LOGIN_PASSWORD_MAX_LENGTH },
        message: `Password must be at most ${AUTH_LOGIN_PASSWORD_MAX_LENGTH} characters.`
      })
    };
  }

  return { password, ...PASSED };
}

function checkConfirmPassword(rawPassword, rawConfirmPassword) {
  const password = String(rawPassword || "");
  const confirmPassword = String(rawConfirmPassword || "");

  if (!confirmPassword) {
    return failure({ code: "auth.validation.confirmPasswordRequired", message: "Confirm your password." });
  }

  if (password !== confirmPassword) {
    return failure({ code: "auth.validation.passwordsMismatch", message: "Passwords do not match." });
  }

  return PASSED;
}

function confirmPassword(rawPassword, rawConfirmPassword) {
  return checkConfirmPassword(rawPassword, rawConfirmPassword).error;
}

function resetPassword(rawPassword) {
  return registerPassword(rawPassword);
}

// fieldErrors keeps the English; fieldErrorCodes carries each one's code.
function buildFieldErrors(entries = []) {
  const fieldErrors = {};
  const fieldErrorCodes = {};
  for (const entry of Array.isArray(entries) ? entries : []) {
    const field = String(entry?.field || "").trim();
    const error = String(entry?.check?.error || "").trim();
    if (!field || !error) {
      continue;
    }
    fieldErrors[field] = error;
    if (entry.check.errorCode) {
      fieldErrorCodes[field] = { code: entry.check.errorCode, params: { ...entry.check.errorParams } };
    }
  }
  return { fieldErrors, fieldErrorCodes };
}

function buildEmailPasswordInput(payload = {}, { passwordValidator } = {}) {
  const emailCheck = validateEmail(payload.email);
  const resolvePassword = typeof passwordValidator === "function" ? passwordValidator : registerPassword;
  const passwordCheck = resolvePassword(payload.password);

  return {
    email: emailCheck.email,
    password: passwordCheck.password,
    ...buildFieldErrors([
      {
        field: "email",
        check: emailCheck
      },
      {
        field: "password",
        check: passwordCheck
      }
    ])
  };
}

function registerInput(payload = {}) {
  return buildEmailPasswordInput(payload, {
    passwordValidator: registerPassword
  });
}

function loginInput(payload = {}) {
  return buildEmailPasswordInput(payload, {
    passwordValidator: loginPassword
  });
}

function forgotPasswordInput(payload = {}) {
  const emailCheck = validateEmail(payload.email);

  return {
    email: emailCheck.email,
    ...buildFieldErrors([
      {
        field: "email",
        check: emailCheck
      }
    ])
  };
}

function resetPasswordInput(payload = {}) {
  const passwordCheck = resetPassword(payload.password);

  return {
    password: passwordCheck.password,
    ...buildFieldErrors([
      {
        field: "password",
        check: passwordCheck
      }
    ])
  };
}

export const validators = {
  email: (rawEmail) => validateEmail(rawEmail).error,
  registerPassword: (rawPassword) => registerPassword(rawPassword).error,
  loginPassword: (rawPassword) => loginPassword(rawPassword).error,
  resetPassword: (rawPassword) => resetPassword(rawPassword).error,
  confirmPassword: ({ password, confirmPassword: confirmPasswordValue }) => confirmPassword(password, confirmPasswordValue),
  registerInput,
  loginInput,
  forgotPasswordInput,
  resetPasswordInput
};

export {
  confirmPassword,
  forgotPasswordInput,
  loginInput,
  loginPassword,
  registerInput,
  registerPassword,
  resetPassword,
  resetPasswordInput
};
