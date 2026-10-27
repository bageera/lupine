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
```

## Build

```
cargo build --target wasm32-unknown-unknown --release -p lupine
cp target/wasm32-unknown-unknown/release/lupine.wasm web/
python3 -m http.server -d web 8000
```

Serve over https or localhost only (AudioWorklet needs a secure context).
The wasm file needs no special MIME from a plain python http.server since we
compile it from bytes ourselves (compileStreaming would want application/wasm).

## Milestone 1 codec

Raw PCM inside a WAV container. `dec_push` decodes the whole buffer eagerly;
streaming/packeted codecs append incrementally later. Decoder resamples the
stream rate to the context rate at runtime (LibreWolf RFP pins it to 44.1 kHz).

Supported input: 8/16/24/32-bit int, 32/64-bit float, 1-8 channels.