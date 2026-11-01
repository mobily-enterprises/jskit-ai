function requireAuthUserSession(response, mapError, status = 401) {
  if (response?.error || !response?.data?.user || !response?.data?.session) {
    throw mapError(response?.error, status);
  }

  return {
    user: response.data.user,
    session: response.data.session
  };
}

function requireAuthUser(response, mapError, status = 400) {
  if (response?.error || !response?.data?.user) {
    throw mapError(response?.error, status);
  }

  return {
    user: response.data.user
  };
}

function requireAuthSession(response, mapError, status = 401) {
  if (response?.error || !response?.data?.session) {
    throw mapError(response?.error, status);
  }

  return {
    session: response.data.session
  };
}

export { requireAuthUserSession, requireAuthUser, requireAuthSession };
