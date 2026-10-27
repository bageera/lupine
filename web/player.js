// Player glue: fetch, compile, backpressure (trivially: decode-ahead is the
// whole stream at milestone 1), seek.

import { parseWav } from "./demux.js";

const here = (f) => new URL(f, import.meta.url);
export const WORKLET_URL = here("./worklet.js");
export const WASM_URL = here("./lupine.wasm");

export class LupinePlayer {
  constructor(ctx) {
    this.ctx = ctx;
    this.node = null;
    this.duration = 0;
    this.currentTime = 0;
  }

  static async create() {
    if (!("WebAssembly" in globalThis)) throw new Error("WebAssembly is disabled in this browser");
    if (!this.ctx?.audioWorklet && !("AudioWorklet" in globalThis))
      throw new Error("AudioWorklet is unavailable in this browser");
    const ctx = new AudioContext(); // RFP may pin sampleRate; we never assume it
    await ctx.audioWorklet.addModule(WORKLET_URL);
    return new LupinePlayer(ctx);
  }

  get sampleRate() {
    return this.ctx.sampleRate; // read at runtime, resampling handled in wasm
  }
  get playing() {
    return this.ctx.state === "running";
  }

  /** source: URL string | File | Blob | ArrayBuffer */
  async load(source) {
    const bytes =
      source instanceof ArrayBuffer
        ? new Uint8Array(source)
        : source instanceof Blob
          ? new Uint8Array(await source.arrayBuffer())
          : new Uint8Array(await (await fetch(source)).arrayBuffer());
    const { fmt, packets } = parseWav(bytes);
    const wasmBytes = await (await fetch(WASM_URL)).arrayBuffer();

    if (this.node) this.node.disconnect();
    const node = new AudioWorkletNode(this.ctx, "lupine", {
      outputChannelCount: [Math.min(fmt.channels, this.ctx.destination.channelCount)],
      processorOptions: {
        wasmBytes,
        streamRate: fmt.sampleRate,
        channels: fmt.channels,
        bits: fmt.bits,
        isFloat: fmt.isFloat,
      },
    });
    node.port.onmessage = (e) => {
      const d = e.data;
      if (d.type === "ready") {
        this.duration = d.frames / this.ctx.sampleRate;
        this.onready?.(this.duration);
      } else if (d.type === "pos") {
        this.currentTime = d.frame / this.ctx.sampleRate;
        this.onpos?.(this.currentTime);
      } else if (d.type === "end") {
        this.onend?.();
      }
    };
    node.connect(this.ctx.destination);
    this.node = node;

    const [p] = packets;
    node.port.postMessage({ type: "push", packet: bytes.subarray(p.offset, p.offset + p.len) });
  }

  async play() {
    this.ctx.resume(); // user-gesture context requirement
  }
  pause() {
    this.ctx.suspend();
  }
  seek(seconds) {
    this.node?.port.postMessage({ type: "seek", frame: Math.round(seconds * this.ctx.sampleRate) });
  }
  async close() {
    this.node?.disconnect();
    this.node = null;
    await this.ctx.close();
  }
}