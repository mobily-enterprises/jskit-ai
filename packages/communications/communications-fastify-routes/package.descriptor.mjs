export default Object.freeze({
  "packageVersion": 1,
  "packageId": "@jskit-ai/communications-fastify-routes",
  "version": "0.1.0",
  "description": "Fastify controller/routes wiring for communications APIs.",
  "dependsOn": [
    "@jskit-ai/communications-core",
    "@jskit-ai/communications-contracts",
    "@jskit-ai/server-runtime-core"
  ],
  "capabilities": {
    "provides": [
      "communications.server-routes"
    ],
    "requires": [
      "communications.core",
      "contracts.communications",
      "runtime.server"
    ]
  },
  "metadata": {
    "server": {
      "routes": [
        {
          "method": "POST",
          "path": "/api/workspace/sms/send",
          "summary": "Send SMS using configured provider"
        }
      ]
    },
    "ui": {
      "elements": []
    }
  },
  "mutations": {
    "dependencies": {
      "runtime": {
        "@jskit-ai/communications-contracts": "0.1.0"
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
