import { createRequire } from "node:module";
import { float32ToPcm16Le } from "@jskit-ai/assistant-voice/shared/protocol";

const { OfflineTts, GenerationConfig, LinearResampler } = createRequire(import.meta.url)("sherpa-onnx-node");
let synthesizer;
let resampler;

function sendAudio(samples) {
  if (samples.length) process.send({ type: "audio", pcm: float32ToPcm16Le(samples) });
}

// A lost parent must not leave a native model resident in an orphan process.
process.once("disconnect", () => process.exit(0));
process.on("message", async message => {
  try {
    if (message.type === "load") {
      synthesizer = new OfflineTts(message.configuration);
      const sampleRate = message.outputSampleRate || synthesizer.sampleRate;
      resampler = sampleRate === synthesizer.sampleRate ? null : new LinearResampler(synthesizer.sampleRate, sampleRate);
      process.send({ type: "result", result: { sampleRate, numSpeakers: synthesizer.numSpeakers } });
    } else if (message.type === "synthesize") {
      let streamed = false;
      resampler?.reset();
      const audio = await synthesizer.generateAsync({
        text: message.text,
        generationConfig: new GenerationConfig({ sid: message.speakerId, silenceScale: 0.18, speed: message.speed }),
        onProgress({ samples } = {}) {
          if (samples?.length) {
            streamed = true;
            sendAudio(resampler ? resampler.resample(samples) : samples);
          }
          return true;
        }
      });
      if (!streamed && audio?.samples?.length) sendAudio(resampler ? resampler.resample(audio.samples) : audio.samples);
      if (resampler) sendAudio(resampler.flush(new Float32Array()));
      process.send({ type: "result" });
    }
  } catch (error) { process.send({ type: "error", message: error.message }); }
});
