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

Milestones 1–5 — library, storage, plain-text and Fountain parsers, import
preview, scene management, and rehearsal with text-to-speech, hands-free voice
cueing, progressive line hiding, and a screen wake lock.

Remaining: milestone 6 — manifest, icons, service worker and the GitHub Pages
deploy.

Voice cueing needs both HTTPS (or localhost) for the microphone and a network
connection, because Chrome's recogniser is server-side. Where either is
missing the run falls back to tap-to-advance and says so. Testing it on a
tablet therefore needs the milestone 6 deploy, not the LAN dev server.
