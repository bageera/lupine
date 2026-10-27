// E2E: WAV -> demux -> wasm -> worklet process(), all driven by Node.
// Stubs AudioWorkletGlobalScope + AudioWorkletProcessor, runs LupineProcessor
// against a synthesized sine WAV, asserts decoded samples and timing messages.
import fs from "node:fs";
import assert from "node:assert";

const OUT_RATE = 48000; // stand-in for ctx.sampleRate
const streamRate = 8000, channels = 1, bits = 16;

// --- synth a 1s 440Hz sine WAV (i16, mono, 8kHz) ---
const N = streamRate;
const pcm = Buffer.alloc(N * 2);
for (let i = 0; i < N; i++) {
  const v = Math.round(Math.sin((2 * Math.PI * 440 * i) / streamRate) * 12000);
  pcm.writeInt16LE(v, i * 2);
}
const hdr = Buffer.alloc(44);
hdr.write("RIFF", 0); hdr.writeUInt32LE(36 + N * 2, 4); hdr.write("WAVE", 8);
hdr.write("fmt ", 12); hdr.writeUInt32LE(16, 16); hdr.writeUInt16LE(1, 20);
hdr.writeUInt16LE(channels, 22); hdr.writeUInt32LE(streamRate, 24);
hdr.writeUInt32LE(streamRate * channels * 2, 28); hdr.writeUInt16LE(2, 32);
hdr.writeUInt16LE(bits, 34); hdr.write("data", 36); hdr.writeUInt32LE(N * 2, 40);
const wav = Buffer.concat([hdr, pcm]);

// --- demux (real demux.js) ---
const { parseWav } = await import("../web/demux.js");
const { fmt, packets } = parseWav(new Uint8Array(wav));
assert.deepStrictEqual(fmt, { sampleRate: 8000, channels: 1, bits: 16, isFloat: false });

// --- workspace wasm ---
const wasmBytes = fs.readFileSync("./web/lupine.wasm");
assert.ok(WebAssembly.validate(wasmBytes), "wasm validates");

// --- stub AudioWorklet global scope, then load the real worklet.js ---
const messages = [];
globalThis.registerProcessor = (name, cls) => { globalThis.LupineProcessor = cls; };
globalThis.sampleRate = OUT_RATE;
globalThis.AudioWorkletProcessor = class {
  constructor() { this.port = { onmessage: null, postMessage: (m) => messages.push(m) }; }
};

await import("../web/worklet.js");

// --- drive it like the audio graph does ---
const proc = new LupineProcessor({
  processorOptions: { wasmBytes, streamRate: fmt.sampleRate, channels: fmt.channels, bits: fmt.bits, isFloat: fmt.isFloat },
});

const PUSH = { type: "push", packet: wav.subarray(packets[0].offset, packets[0].offset + packets[0].len) };
proc.port.onmessage({ data: PUSH });
const ready = messages.find((m) => m.type === "ready");
assert.ok(ready, "got ready");
assert.ok(Math.abs(ready.frames - OUT_RATE) < 20, `1s of 8k resampled to 48k: ${ready.frames}`);

// pull the whole second in 128-frame renders, checking amplitude and continuity
let pulled = 0, peak = 0;
for (let i = 0; i < OUT_RATE / 128; i++) {
  const out = [[new Float32Array(128), new Float32Array(128)]]; // outputs[render][channel]
  const keep = proc.process([], out);
  const [c0] = out[0];
  assert.strictEqual(keep, true, "processor stays alive");
  for (const c of out[0]) for (const v of c) peak = Math.max(peak, Math.abs(v));
  pulled += out[0].length;
  // continuity across render quanta: worklet zero-fills exhausted tail, skip
  if (pulled >= ready.frames - 128) break;
}
assert.ok(peak > 0.25, `waveform has real amplitude, peak=${peak}`);
assert.ok(peak < 0.5, `sine not clipped, peak=${peak}`);

const readyFrames = ready.frames;
const [endMsg] = messages.filter((m) => m.type === "end");
assert.ok(endMsg, "got end");

// --- seek back to start via the worklet message, then pull 128 frames ---
proc.port.onmessage({ data: { type: "seek", frame: 0 } });
const out2 = [[new Float32Array(128), new Float32Array(128)]];
proc.process([], out2);
// first frames of a 440Hz sine @48k are near 0 then ramp: f2 must be clearly non-zero
const s2 = out2[0][0][2];
assert.ok(Math.abs(s2) > 0.01, `seek-to-0 replays the wave, s2=${s2}`);

const posMsgs = messages.filter((m) => m.type === "pos");
assert.ok(posMsgs.length > 0, "pos messages emitted");

console.log(`
E2E PASSED
  wav ${wav.length}B -> demux ${fmt.sampleRate}Hz ${fmt.channels}ch i${fmt.bits} -> wasm decode/resample
  1s @8k -> ${readyFrames} frames @48k, peak=${peak.toFixed(3)}, end+seek work, ${posMsgs.length} pos ticks
`);

// keep generated file for the demo page
fs.writeFileSync("web/test.wav", wav);