# lupine

Audio pipeline in a browser: WAV -> demux.js -> wasm decoder -> AudioWorklet -> speakers.
Standalone package first; a LibreWolf extension later can reuse the same files from extension origin.

## Layout

```
crates/lupine/   # decoder: C-ABI wasm module, pure Rust, no I/O
web/
  demux.js       # WAV container -> format + packets
  worklet.js     # AudioWorkletProcessor wrapping the wasm
  player.js      # createPlayer-style glue: fetch, compile, load, seek
  index.html     # demo page
scripts/         # node e2e suites (drive the real processor)
```

## Download

Prebuilt web bundles on [GitHub Releases](https://github.com/bageera/lupine/releases/latest),
or build from source:

```
make build   # cargo build --target wasm32-unknown-unknown --release, copies wasm into web/
make test    # cargo unit tests
make e2e     # node e2e (pipeline + WAV format suites)
make serve   # python3 -m http.server -d web 8000
```

The toolchain comes from rustup; if cargo isn't on PATH:

```
export PATH="/opt/homebrew/bin:$HOME/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH"
```

Serve over https or localhost only (AudioWorklet needs a secure context).
The wasm file needs no special MIME from a plain python http.server since we
compile it from bytes ourselves (compileStreaming would want application/wasm).

## Milestone 1 codec

Raw PCM inside a WAV container. `dec_push` decodes the whole buffer eagerly;
streaming/packeted codecs append incrementally later. Decoder resamples the
stream rate to the context rate at runtime (LibreWolf RFP pins it to 44.1 kHz).

Supported input: 8/16/24/32-bit int, 32/64-bit float, 1-8 channels.

## Release

Tag `v<version>` -> GH Release with `lupine-<version>.tar.gz`
(demux.js, worklet.js, player.js, index.html, lupine.wasm). Bump the version in
`crates/lupine/Cargo.toml`, commit, tag, push — the release ships itself.

## Security

CI runs CodeQL (SAST, Rust + JS), cargo-deny (RustSec advisories on
Cargo.lock), gitleaks (secret scan) and Dependabot on push/PR and weekly.
Report vulnerabilities per [SECURITY.md](SECURITY.md). Changes are tracked in
[CHANGELOG.md](CHANGELOG.md).