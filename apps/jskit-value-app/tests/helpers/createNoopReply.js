function createNoopReply() {
  return {
    code() {
      return this;
    },
    send() {
      return this;
    }
  };
}

export { createNoopReply };
