function safeRequestCookies(request) {
  if (request?.cookies && typeof request.cookies === "object") {
    return request.cookies;
  }

  return {};
}

function cookieOptions(isDeployed, maxAge) {
  const options = {
    httpOnly: true,
    sameSite: "lax",
    secure: isDeployed,
    path: "/"
  };

  if (Number.isFinite(maxAge)) {
    options.maxAge = Math.max(0, Math.floor(maxAge));
  }

  return options;
}

function cookieClearOptions(isDeployed) {
  return [
    cookieOptions(isDeployed, 0),
    {
      ...cookieOptions(isDeployed, 0),
      path: "/api"
    }
  ];
}

export { safeRequestCookies, cookieOptions, cookieClearOptions };
