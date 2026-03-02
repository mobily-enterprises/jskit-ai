export default Object.freeze({
  "packageVersion": 1,
  "packageId": "@jskit-ai/realtime-server-socketio",
  "version": "0.1.0",
  "dependsOn": [
    "@jskit-ai/realtime-contracts",
    "@jskit-ai/server-runtime-core"
  ],
  "capabilities": {
    "provides": [
      "realtime.server"
    ],
    "requires": [
      "contracts.realtime",
      "runtime.server"
    ]
  },
  "mutations": {
    "dependencies": {
      "runtime": {
        "@jskit-ai/realtime-contracts": "0.1.0",
        "@socket.io/redis-streams-adapter": "^0.2.3",
        "redis": "^4.7.1",
        "socket.io": "^4.8.1"
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
