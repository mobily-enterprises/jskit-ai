function requestPathname(request = {}) {
  try {
    return new URL(String(request.url || "/"), "http://voice.local").pathname;
  } catch {
    return "/";
  }
}

function writeJsonResponse(response, statusCode, payload) {
  const body = Buffer.from(JSON.stringify(payload));
  response.writeHead(statusCode, {
    "cache-control": "no-store",
    "content-length": String(body.byteLength),
    "content-type": "application/json; charset=utf-8"
  });
  response.end(body);
}

function refuseUpgrade(socket, status, extraHeaders = "") {
  socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\n${extraHeaders}\r\n`);
  socket.destroy();
}

export { refuseUpgrade, requestPathname, writeJsonResponse };
