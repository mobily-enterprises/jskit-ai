import { createRequire } from "node:module";
import { float32ToPcm16Le } from "@jskit-ai/assistant-voice/shared/protocol";

const { OfflineTts, GenerationConfig } = createRequire(import.meta.url)("sherpa-onnx-node");
let synthesizer;

// A lost parent must not leave a native model resident in an orphan process.
process.once("disconnect", () => process.exit(0));
process.on("message", async message => {
  try {
    if (message.type === "load") {
      synthesizer = new OfflineTts(message.configuration);
      process.send({ type: "result", result: { sampleRate: synthesizer.sampleRate, numSpeakers: synthesizer.numSpeakers } });
    } else if (message.type === "synthesize") {
      let streamed = false;
      const audio = await synthesizer.generateAsync({
        text: message.text,
        generationConfig: new GenerationConfig({ sid: message.speakerId, silenceScale: 0.18, speed: 1 }),
        onProgress({ samples } = {}) {
          if (samples?.length) {
            streamed = true;
            process.send({ type: "audio", pcm: float32ToPcm16Le(samples) });
          }
          return true;
        }
      });
      if (!streamed && audio?.samples?.length) process.send({ type: "audio", pcm: float32ToPcm16Le(audio.samples) });
      process.send({ type: "result" });
    }
  } catch (error) { process.send({ type: "error", message: error.message }); }
});
