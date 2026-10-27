// AudioWorkletProcessor wrapping the wasm decoder.
// Playback time is driven by the decoder's frame counter (dec_tell), never by
// main-thread timestamps (RFP coarsens performance.now()).
//
// ponytail: decoder instance leaks with the page (no dec_free on close); tied
// to AudioWorkletNode lifetime, fine for the milestone.

class LupineProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = options.processorOptions;
    const e = new WebAssembly.Instance(new WebAssembly.Module(o.wasmBytes), {}).exports;
    this.e = e;
    // out_rate = this sampleRate (AudioWorkletGlobalScope) — under RFP this is
    // the pinned 44.1 kHz; the decoder resamples the stream rate to it.
    this.dec = e.dec_new(o.streamRate, o.channels, o.bits, o.isFloat ? 1 : 0, sampleRate);
    this.decCh = o.channels; // decoder interleave width; output may differ (clamped destination)
    this.totalFrames = 0;
    this.lastPos = 0;
    this.loaded = false;
    this.ended = false;
    this.scratchPtr = 0;
    this.scratchCap = 0;
    this.port.onmessage = (m) => {
      const d = m.data;
      if (d.type === "push") this.push(d.packet);
      else if (d.type === "seek") {
        this.e.dec_seek(this.dec, d.frame | 0);
        this.ended = false;
        this.lastPos = 0;
      } else if (d.type === "reset") {
        this.e.dec_reset(this.dec);
        this.loaded = false;
        this.ended = false;
      }
    };
  }

  push(packet) {
    const e = this.e, len = packet.byteLength;
    const ptr = e.lupine_alloc(len);
    new Uint8Array(e.memory.buffer, ptr, len).set(packet);
    e.dec_push(this.dec, ptr, len);
    e.lupine_free(ptr, len); // dec_push copied the bytes
    this.loaded = true;
    this.totalFrames = e.dec_frames_total(this.dec);
    this.port.postMessage({ type: "ready", frames: this.totalFrames });
  }

  process(_inputs, outputs) {
    const out = outputs[0], frames = out[0].length, ch = out.length;
    if (this.loaded && !this.ended) {
      const need = frames * ch;
      if (this.scratchCap < need) {
        if (this.scratchPtr) this.e.lupine_free(this.scratchPtr, this.scratchCap * 4);
        this.scratchPtr = this.e.lupine_alloc(need * 4);
        this.scratchCap = need;
      }
      let filled = 0;
      while (filled < frames) {
        const dst = this.scratchPtr + filled * this.decCh;
        const got = this.e.dec_pull(this.dec, dst, frames - filled);
        if (got === 0) break;
        const view = new Float32Array(this.e.memory.buffer, dst, got * this.decCh);
        for (let j = 0; j < got; j++)
          for (let c = 0; c < ch; c++) out[c][filled + j] = view[j * this.decCh + Math.min(c, this.decCh - 1)];
        filled += got;
      }
      if (filled < frames)
        for (let c = 0; c < ch; c++) out[c].fill(0, filled); // tail silence

      const pos = this.e.dec_tell(this.dec);
      if (pos >= this.totalFrames && this.totalFrames > 0) {
        this.ended = true;
        this.port.postMessage({ type: "end" });
      }
      // ~4 position updates/sec
      if (pos - this.lastPos > (sampleRate >> 2)) {
        this.lastPos = pos;
        this.port.postMessage({ type: "pos", frame: pos });
      }
    }
    return true; // stay alive; seek can restart after 'end'
  }
}

registerProcessor("lupine", LupineProcessor);