# prompt-book

PWA for line prompts. Import a script, mark which character is yours, and the app
performs every other part aloud while listening for your cues.

See [PLAN.md](PLAN.md) for scope, platform constraints, and milestones, and
[TODO.md](TODO.md) for the working backlog.

## Development

```sh
npm install
npm run dev      # http://localhost:5173/prompt-book/ — also served on the LAN
npm test         # headless: parsers, engine, cueing, storage, manifest
npm run build
npm run preview  # serves the build, with the service worker active
npm run icons    # regenerates public/icons/ (the PNGs are committed)
npm run ocr-assets  # copies the OCR engine into public/ocr/ (gitignored)
```

`ocr-assets` runs automatically before `dev` and `build`. The engine's ~8.6MB
of wasm and language data are served from this origin rather than a CDN, are
gitignored, and are deliberately excluded from the service worker precache —
they are fetched only the first time someone scans a page.

The service worker is only emitted by `npm run build`, so offline behaviour has
to be checked through `npm run preview` rather than the dev server.

Microphone access requires HTTPS or localhost, so reaching the dev server from a
tablet over the LAN will not grant the mic without an HTTPS certificate.

## Importing a script

Paste it, choose a `.txt` or `.fountain` file, or **photograph the pages**.
Photo import runs entirely on the device: nothing is uploaded. It reconstructs
character cues from where words sit on the page, because a cue is a cue by
virtue of being indented or centred — flatten that and a name is
indistinguishable from a short line of dialogue.

Everything lands in the same import preview, where you correct it before it is
saved.

## Status

Milestones 1–5 — library, storage, plain-text and Fountain parsers, import
preview, scene management, and rehearsal with text-to-speech, hands-free voice
cueing, progressive line hiding, and a screen wake lock.

Milestone 6 — installable, with a manifest, icons and an offline service
worker. The GitHub Pages deploy is still outstanding; until it exists, voice
cueing can only be tested at localhost, since the microphone needs a secure
context.

Voice cueing needs both HTTPS (or localhost) for the microphone and a network
connection, because Chrome's recogniser is server-side. Where either is
missing the run falls back to tap-to-advance and says so. Testing it on a
tablet therefore needs the milestone 6 deploy, not the LAN dev server.
