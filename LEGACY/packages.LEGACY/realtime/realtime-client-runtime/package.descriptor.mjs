export default Object.freeze({
  "packageVersion": 1,
  "packageId": "@jskit-ai/realtime-client-runtime",
  "version": "0.1.0",
  "dependsOn": [
    "@jskit-ai/realtime-contracts"
  ],
  "capabilities": {
    "provides": [
      "realtime.client"
    ],
    "requires": [
      "contracts.realtime"
    ]
  },
  "mutations": {
    "dependencies": {
      "runtime": {
        "@jskit-ai/realtime-contracts": "0.1.0",
        "socket.io-client": "^4.8.1"
      },
      "dev": {}
    },
    "packageJson": {
      "scripts": {}
    },
    "procfile": {},
    "files": []
  }
});
