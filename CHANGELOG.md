# Changelog

All notable changes to lupine are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions
are semver. During 0.x, breaking changes may land in minors — cargo-semver-checks
reports them against the previous tag on every CI run and becomes a gate at 1.0.

## [Unreleased]

### Added
- Security scanning: CodeQL SAST (Rust + JS), cargo-deny advisory checks
  (Cargo.lock vs RustSec), gitleaks full-history secret scan, Dependabot
  (cargo + actions) — all on push/PR and weekly schedule
- SECURITY.md (report to security@nocturnalinc.com or GitHub private advisories)

## [0.1.0] - 2026-10-27

### Added
- `crates/lupine`: pure-Rust wasm decoder, C ABI (`lupine_alloc`/`free`,
  `dec_new`/`dec_push`/`dec_pull`/`dec_seek`/`dec_reset`/`dec_tell`/
  `dec_frames_total`), no I/O, no third-party deps
- WAV demuxer (`web/demux.js`): 8/16/24/32-bit int + 32/64-bit float PCM,
  1-8 channels, WAVE_FORMAT_EXTENSIBLE, odd-size chunk padding
- Runtime resampling in the decoder: stream rate -> `AudioContext.sampleRate`
  read at runtime (LibreWolf RFP pins the context to 44.1 kHz)
- `web/worklet.js`: AudioWorkletProcessor; playback clocked by the decoder
  frame counter, never main-thread timestamps
- `web/player.js`: `LupinePlayer` — load from URL/File/Blob/ArrayBuffer,
  play/pause/seek, `onready`/`onpos`/`onend`, feature detection with clear
  errors for missing WebAssembly/AudioWorklet
- `web/index.html` demo page
- Tests: 3 cargo unit tests; Node e2e driving the real processor (pipeline +
  format/malformed-input suites)
- CI: cargo tests + wasm build + e2e; cargo-semver-checks (advisory)
- Release: tag `v*` -> GH Release with `lupine-<version>.tar.gz`
  (demux/worklet/player/index/wasm)

[Unreleased]: https://github.com/bageera/lupine/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/bageera/lupine/releases/tag/v0.1.0