function requireNoFieldErrors(parsed, validationError) {
  if (typeof validationError !== "function") {
    throw new TypeError("requireNoFieldErrors requires validationError.");
  }

  const fieldErrors =
    parsed && typeof parsed === "object" && parsed.fieldErrors && typeof parsed.fieldErrors === "object"
      ? parsed.fieldErrors
      : {};
  if (Object.keys(fieldErrors).length > 0) {
    throw validationError(fieldErrors);
  }
}

function requireAuthUserSession(response, mapError, status = 401) {
  if (typeof mapError !== "function") {
    throw new TypeError("requireAuthUserSession requires mapError.");
  }

  if (response?.error || !response?.data?.user || !response?.data?.session) {
    throw mapError(response?.error, status);
  }

  return {
    user: response.data.user,
    session: response.data.session
  };
}

function requireAuthUser(response, mapError, status = 400) {
  if (typeof mapError !== "function") {
    throw new TypeError("requireAuthUser requires mapError.");
  }

  if (response?.error || !response?.data?.user) {
    throw mapError(response?.error, status);
  }

  return {
    user: response.data.user
  };
}

function requireAuthSession(response, mapError, status = 401) {
  if (typeof mapError !== "function") {
    throw new TypeError("requireAuthSession requires mapError.");
  }

  if (response?.error || !response?.data?.session) {
    throw mapError(response?.error, status);
  }

  return {
    session: response.data.session
  };
}

export { requireNoFieldErrors, requireAuthUserSession, requireAuthUser, requireAuthSession };
