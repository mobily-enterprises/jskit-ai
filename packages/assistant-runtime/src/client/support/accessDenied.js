/** Whether a conversation failure means the viewer lost access to it. */
function isAccessDenied(error) {
  return [401, 403].includes(Number(error.status || error.statusCode));
}

export { isAccessDenied };
