import {
  AUTH_EMAIL_MAX_LENGTH,
  AUTH_EMAIL_REGEX,
  AUTH_LOGIN_PASSWORD_MAX_LENGTH,
  AUTH_PASSWORD_MAX_LENGTH,
  AUTH_PASSWORD_MIN_LENGTH
} from "./authConstraints.js";
import { normalizeEmail } from "./utils.js";

function validateEmail(rawEmail) {
  const email = normalizeEmail(rawEmail);

  if (!email) {
    return {
      email,
      error: "Email is required."
    };
  }

  if (email.length > AUTH_EMAIL_MAX_LENGTH || !AUTH_EMAIL_REGEX.test(email)) {
    return {
      email,
      error: "Provide a valid email address."
    };
  }

  return {
    email,
    error: ""
  };
}

function registerPassword(rawPassword) {
  const password = String(rawPassword || "");
  if (!password) {
    return {
      password,
      error: "Password is required."
    };
  }

  if (password.length < AUTH_PASSWORD_MIN_LENGTH || password.length > AUTH_PASSWORD_MAX_LENGTH) {
    return {
      password,
      error: "Password must be between 8 and 128 characters."
    };
  }

  return {
    password,
    error: ""
  };
}

function loginPassword(rawPassword) {
  const password = String(rawPassword || "");
  if (!password) {
    return {
      password,
      error: "Password is required."
    };
  }

  if (password.length > AUTH_LOGIN_PASSWORD_MAX_LENGTH) {
    return {
      password,
      error: `Password must be at most ${AUTH_LOGIN_PASSWORD_MAX_LENGTH} characters.`
    };
  }

  return {
    password,
    error: ""
  };
}

function confirmPassword(rawPassword, rawConfirmPassword) {
  const password = String(rawPassword || "");
  const confirmPassword = String(rawConfirmPassword || "");

  if (!confirmPassword) {
    return "Confirm your password.";
  }

  if (password !== confirmPassword) {
    return "Passwords do not match.";
  }

  return "";
}

function resetPassword(rawPassword) {
  return registerPassword(rawPassword);
}

function registerInput(payload = {}) {
  const emailCheck = validateEmail(payload.email);
  const passwordCheck = registerPassword(payload.password);
  const fieldErrors = {};

  if (emailCheck.error) {
    fieldErrors.email = emailCheck.error;
  }
  if (passwordCheck.error) {
    fieldErrors.password = passwordCheck.error;
  }

  return {
    email: emailCheck.email,
    password: passwordCheck.password,
    fieldErrors
  };
}

function loginInput(payload = {}) {
  const emailCheck = validateEmail(payload.email);
  const passwordCheck = loginPassword(payload.password);
  const fieldErrors = {};

  if (emailCheck.error) {
    fieldErrors.email = emailCheck.error;
  }
  if (passwordCheck.error) {
    fieldErrors.password = passwordCheck.error;
  }

  return {
    email: emailCheck.email,
    password: passwordCheck.password,
    fieldErrors
  };
}

function forgotPasswordInput(payload = {}) {
  const emailCheck = validateEmail(payload.email);
  const fieldErrors = {};

  if (emailCheck.error) {
    fieldErrors.email = emailCheck.error;
  }

  return {
    email: emailCheck.email,
    fieldErrors
  };
}

function resetPasswordInput(payload = {}) {
  const passwordCheck = resetPassword(payload.password);
  const fieldErrors = {};

  if (passwordCheck.error) {
    fieldErrors.password = passwordCheck.error;
  }

  return {
    password: passwordCheck.password,
    fieldErrors
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
