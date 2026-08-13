# prompt-book

PWA for line prompts. Import a script, mark which character is yours, and the app
performs every other part aloud while listening for your cues.

See [PLAN.md](PLAN.md) for scope, platform constraints, and milestones.

## Development

```sh
npm install
npm run dev      # http://localhost:5173/prompt-book/ — also served on the LAN
npm test         # parser and import-flow tests, headless
npm run build
```

Microphone access requires HTTPS or localhost, so reaching the dev server from a
tablet over the LAN will not grant the mic without an HTTPS certificate.

## Status

Milestone 1 — library, storage, plain-text parser, import preview. Rehearsal
itself lands in milestone 3.
