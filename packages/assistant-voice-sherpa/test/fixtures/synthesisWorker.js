process.once("disconnect", () => process.exit(0));
process.on("message", message => {
  if (message.type === "load") {
    if (message.configuration.invalid) process.send({ type: "error", message: "Invalid native model." });
    else process.send({ type: "result", result: { sampleRate: 22050, numSpeakers: 1, pid: process.pid } });
  } else if (message.text === "crash") process.exit(17);
  else {
    process.send({ type: "audio", pcm: Buffer.from([1, 0, 2, 0]) });
    if (message.text === "wait") setTimeout(() => process.send({ type: "result" }), 10000);
    else process.send({ type: "result" });
  }
});
