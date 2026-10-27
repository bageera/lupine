// WAV container -> format + packets. Milestone 1: the whole data chunk as one
// packet. Real codecs return many packets later.

export function parseWav(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const str = (o, n) => String.fromCharCode(...bytes.subarray(o, o + n));
  if (str(0, 4) !== "RIFF" || str(8, 4) !== "WAVE") throw new Error("not a RIFF/WAVE file");

  let off = 12, fmt = null, data = null;
  while (off + 8 <= bytes.length) {
    const id = str(off, 4);
    const size = dv.getUint32(off + 4, true);
    const body = off + 8;
    if (id === "fmt ") {
      const audioFormat = dv.getUint16(body, true);
      const channels = dv.getUint16(body + 2, true);
      const sampleRate = dv.getUint32(body + 4, true);
      const bits = dv.getUint16(body + 14, true);
      let isFloat = audioFormat === 3;
      // WAVE_FORMAT_EXTENSIBLE: real format tag lives in the SubFormat GUID
      if (audioFormat === 0xfffe && size >= 40) isFloat = dv.getUint16(body + 24, true) === 3;
      fmt = { sampleRate, channels, bits, isFloat };
    } else if (id === "data") {
      data = { offset: body, len: Math.min(size, bytes.length - body) };
    }
    off = body + size + (size & 1); // chunks are word-aligned
  }
  if (!fmt || !data) throw new Error("WAV missing fmt or data chunk");
  if (fmt.channels < 1 || fmt.channels > 8) throw new Error(`bad channel count: ${fmt.channels}`);
  const okBits = fmt.isFloat ? (fmt.bits === 32 || fmt.bits === 64) : [8, 16, 24, 32].includes(fmt.bits);
  if (!okBits) throw new Error(`unsupported WAV: ${fmt.isFloat ? "float" : "int"} ${fmt.bits}-bit`);
  return { fmt, packets: [data] };
}