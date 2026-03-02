import { EventEmitter } from "node:events";

function createReplyDouble({ csrfToken = "csrf-token" } = {}) {
  const raw = Object.assign(new EventEmitter(), {
    writes: [],
    ended: false,
    flushHeaders() {},
    write(chunk) {
      this.writes.push(String(chunk));
    },
    end() {
      this.ended = true;
    }
  });

  return {
    statusCode: null,
    payload: null,
    headers: {},
    contentType: null,
    redirectUrl: null,
    cookies: [],
    csrfToken,
    hijacked: false,
    raw,
    header(name, value) {
      const key = String(name || "").trim();
      if (!key) {
        return this;
      }
      this.headers[key] = value;
      this.headers[key.toLowerCase()] = value;
      return this;
    },
    code(status) {
      this.statusCode = status;
      return this;
    },
    type(value) {
      this.contentType = value;
      return this;
    },
    send(payload) {
      this.payload = payload;
      return this;
    },
    hijack() {
      this.hijacked = true;
      return this;
    },
    redirect(url) {
      this.statusCode = 302;
      this.redirectUrl = String(url || "");
      return this;
    },
    async generateCsrf() {
      return this.csrfToken;
    }
  };
}

export { createReplyDouble };
