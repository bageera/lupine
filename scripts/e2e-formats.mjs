// Extra demux/decoder checks: 24-bit WAV, float32 WAV, odd chunks, bad inputs.
// Reuses the same stub rig as e2e.mjs inline (small enough to duplicate).
import fs from "node:fs";
import assert from "node:assert";

const { parseWav } = await import("../web/demux.js");

function wav(fmtTag, ch, rate, bits, frames, fill) {
  const bytesPer = bits / 8;
  const dataSize = frames * ch * bytesPer;
  const b = Buffer.alloc(44 + dataSize);
  b.write("RIFF", 0); b.writeUInt32LE(36 + dataSize, 4); b.write("WAVE", 8);
  b.write("fmt ", 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(fmtTag, 20);
  b.writeUInt16LE(ch, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * ch * bytesPer, 28);
  b.writeUInt16LE(ch * bytesPer, 32); b.writeUInt16LE(bits, 34);
  b.write("data", 36); b.writeUInt32LE(dataSize, 40);
  if (fill) fill(b.subarray(44));
  return b;
}

// 24-bit: one frame with channel0 = -1 (0x800000 LE) and the WAV 3-byte LE encoding
{
  const w = wav(1, 1, 8000, 24, 1, (d) => { d[0] = 0; d[1] = 0; d[2] = 0x80; });
  const { fmt, packets } = parseWav(new Uint8Array(w));
  assert.strictEqual(fmt.bits, 24);
  const e = new WebAssembly.Instance(new WebAssembly.Module(fs.readFileSync("./web/lupine.wasm")), {}).exports;
  const dec = e.dec_new(fmt.sampleRate, fmt.channels, fmt.bits, 0, 48000);
  const ptr = e.lupine_alloc(3);
  new Uint8Array(e.memory.buffer, ptr, 3).set(w.subarray(44, 47));
  e.dec_push(dec, ptr, 3);
  const out = e.lupine_alloc(4);
  e.dec_pull(dec, out, 1);
  const v = new Float32Array(e.memory.buffer, out, 1)[0];
  assert.ok(Math.abs(v + 1) < 1e-6, `24-bit -1 -> ${v}`);
}

// float32 WAV with a LIST chunk before fmt (odd-size chunk padding)
{
  const b = Buffer.alloc(64 + 10 + 4);
  b.write("RIFF", 0); b.write("WAVE", 8);
  b.write("LIST", 12); b.writeUInt32LE(9, 16); b.write("abcd", 20); b.write("e", 24); // odd size, pad byte follows
  let off = 20 + 9 + (9 & 1); // body ends at 29 (odd) -> pad byte -> next chunk at 30
  b.write("fmt ", off); b.writeUInt32LE(16, off + 4); b.writeUInt16LE(3, off + 8);
  b.writeUInt16LE(2, off + 10); b.writeUInt32LE(44100, off + 12); b.writeUInt32LE(44100 * 8, off + 16);
  b.writeUInt16LE(8, off + 20); b.writeUInt16LE(32, off + 22);
  off += 24;
  b.write("data", off); b.writeUInt32LE(8, off + 4);
  const f32Start = off + 8;
  b.writeFloatLE(0.5, f32Start);
  b.writeFloatLE(0.0, f32Start + 4); // L=0.5 R=0.0
  const { fmt, packets } = parseWav(new Uint8Array(b.subarray(0, f32Start + 8)));
  assert.deepStrictEqual(fmt, { sampleRate: 44100, channels: 2, bits: 32, isFloat: true });
  assert.strictEqual(packets[0].len, 8);
  const e = new WebAssembly.Instance(new WebAssembly.Module(fs.readFileSync("./web/lupine.wasm")), {}).exports;
  const dec = e.dec_new(44100, 2, 32, 1, 44100);
  const ptr = e.lupine_alloc(8);
  new Uint8Array(e.memory.buffer, ptr, 8).set(b.subarray(f32Start, f32Start + 8));
  e.dec_push(dec, ptr, 8);
  const out = e.lupine_alloc(8);
  const got = e.dec_pull(dec, out, 1);
  assert.strictEqual(got, 1);
  const v = new Float32Array(e.memory.buffer, out, 2);
  assert.ok(v[0] === 0.5, `f32 L 0.5 -> ${v[0]}`);
  assert.ok(v[1] === 0.0, `f32 R 0.0 -> ${v[1]}`);
}

// malformed inputs rejected
assert.throws(() => parseWav(new Uint8Array(Buffer.alloc(20))), "not RIFF");
{
  const b = wav(1, 1, 8000, 12, 1); // unsupported 12-bit
  assert.throws(() => parseWav(new Uint8Array(b)), /unsupported WAV/);
}

// player.js parses as ESM (browser APIs only touched inside methods)
await import("../web/player.js");

console.log("EXTRA CHECKS PASSED (24-bit, f32 WAV w/ odd chunks, rejects malformed, player.js parses)");