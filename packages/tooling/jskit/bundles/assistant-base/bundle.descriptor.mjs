export default Object.freeze({
  "bundleVersion": 1,
  "bundleId": "assistant-base",
  "version": "0.1.0",
  "description": "Assistant runtime, API adapter, and transcript persistence base.",
  "packages": [
    "@jskit-ai/assistant-contracts",
    "@jskit-ai/assistant-core",
    "@jskit-ai/assistant-fastify-adapter",
    "@jskit-ai/assistant-client-runtime",
    "@jskit-ai/assistant-client-element",
    "@jskit-ai/assistant-transcripts-core",
    "@jskit-ai/assistant-transcripts-knex-mysql",
    "@jskit-ai/assistant-transcript-explorer-client-element"
  ]
});
