# Todo

Working backlog. Items carry the evidence behind them where it was measured, so
the reasoning does not have to be reconstructed later. See [PLAN.md](PLAN.md)
for the original milestones and `.impeccable/critique/` for the design review.

## Next

- [ ] **Benchmark PaddleOCR and Florence-2 against Tesseract** on the two sample
      photos. `tools/ocr-bench/` already has the harness and hand-written ground
      truth for both pages; the baseline to beat is **69% word accuracy on page
      91 and 88% on page 92**.

      Score on word accuracy against the truth files, not by reading the output.
      Small vision-language models fail *silently* on dense text — they produce
      fluent, plausible, wrong lines rather than visible garbage — and that
      failure mode is worse here than Tesseract's, because the import preview
      cannot flag text that looks fine. Measure omissions as well as errors.

## Photo import

- [ ] **Crop step before recognition.** Measured the largest single win
      available: page 91 went **24% → 69%** and page 92 **79% → 88%** when the
      facing page, the cat and the thumb were cropped out by hand. Helps
      whatever engine ends up behind it.
- [ ] **Stop running `greyAndStretch` on photographs.** Measured actively
      harmful: page 91 scored **55% with it and 62% without**, and 38% vs 60% at
      full resolution. One global contrast curve is the wrong tool for a page
      with a lighting gradient across it. Adaptive/local thresholding would be
      the right replacement; plain greyscale already beats it.
- [ ] **Decide the vision-model question.** A frontier model reads *through* the
      curl, the handwriting and the facing page in a way no local pipeline does,
      at roughly 1–3¢ per page — but it needs a proxy to hold the API key and it
      sends the script off the device. Currently unresolved.

## Deploy

- [x] **GitHub Pages deploy** — `.github/workflows/deploy.yml`, triggered by
      pushes to `main`.
- [ ] **Merge `dev` into `main`** so the first deploy actually has the app in
      it. Everything since the initial commit lives on `dev`.
- [ ] **Test voice cueing on the tablet** once it is live. The microphone needs
      a secure context, so this has never been possible from the LAN dev
      server — it is the first thing the deploy unblocks.

## Voices

- [ ] **Reconsider preferring `localService` voices.** `voicePool` sorts device
      voices ahead of network ones, which suits Android but is probably backwards
      on desktop Chrome, where the network Google voices are the better ones — so
      the default may be choosing the worse voice available.
- [ ] **Rate control and a pause between lines.** Deferred from the original
      plan. Likely does more for how a run *feels* than voice quality does:
      right now one line ends and the next begins immediately, and real actors
      breathe.
- [ ] **Per-character voice picker for the neural voices.** They are currently
      auto-assigned from a curated list; setup lets you choose device voices but
      not Kokoro ones.
- [ ] **Persist generated audio.** A scene could be generated once and replayed
      offline forever, which would make the app *more* offline-capable rather
      than less. Deferred because pipelining already covers the latency.

## From the design critique

- [ ] **Keyboard operation outside the rehearsal screen.** The stage is now a
      real control; the rest of the app has not had the same pass.
- [ ] **The import preview's wall of selects.** A `<select>` on every line when
      the parser is right about roughly 95% of them. Passive classification with
      tap-to-correct would invert that ratio.

## Known gaps, accepted for now

- Photo import and the neural voice both fetch from third parties at runtime
  (Hugging Face, the ONNX CDN). Everything else in the app is self-hosted.
- `kokoro-js` must stay behind a dynamic import. A static one inlines the ONNX
  WebAssembly and produces a **58MB** bundle.
