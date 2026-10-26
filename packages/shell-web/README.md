# Shell Web

The existing client exports provide the JSKIT web shell, navigation and outlet
placements.

## Architecture inspection

The static Vue architecture inspector lives in
`@jskit-ai/architecture-inspector`; see its README for the command contract.
`@jskit-ai/shell-web/architecture` and `src/architecture/cli.js` re-export it
unchanged for existing consumers.
