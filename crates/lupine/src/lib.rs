//! Lupine wasm decoder: C-ABI, no I/O, pure Rust.
//! Milestone 1 codec: raw PCM bytes in (WAV data chunk) -> interleaved f32 at
//! out_rate. Input format (rates/bits/float) is validated by the JS demuxer
//! (the trust boundary); this module trusts it.

use std::alloc::{alloc, dealloc, Layout};

pub struct Decoder {
    bits: u32,
    is_float: bool,
    in_rate: u32,
    ch: u32,
    out_rate: u32,
    out: Vec<f32>, // interleaved frames at out_rate
    pos: usize,    // frame cursor into `out`
}

impl Decoder {
    fn seek_frame(&mut self, frame: u32) {
        self.pos = (frame as usize).min(self.out.len() / self.ch as usize);
    }

    fn push(&mut self, bytes: &[u8]) {
        let ch = self.ch as usize;
        let mut pcm: Vec<f32> = Vec::with_capacity(bytes.len() / 2);
        pcm.extend(convert_samples(bytes, self.bits, self.is_float));
        let n = pcm.len() / ch.max(1);
        pcm.truncate(n * ch);
        self.out = if self.in_rate == self.out_rate {
            pcm
        } else {
            // ponytail: linear interp resampler; fine for playback, swap in a
            // sinc/polyphase filter when audible artifacts matter
            resample(&pcm, self.in_rate, self.out_rate, ch)
        };
        self.pos = 0;
    }
}

/// Convert interleaved PCM bytes to interleaved f32 (-1.0..1.0).
/// Remaining bytes shorter than one sample are dropped.
fn convert_samples(bytes: &[u8], bits: u32, is_float: bool) -> impl Iterator<Item = f32> + '_ {
    let w = (bits / 8) as usize;
    bytes.chunks_exact(w).map(move |c| match (bits, is_float) {
        (8, false) => (c[0] as f32 / 127.5) - 1.0, // WAV 8-bit is unsigned
        (16, false) => i16::from_le_bytes([c[0], c[1]]) as f32 / 32768.0,
        (24, false) => {
            let mut v = (c[0] as i32) | ((c[1] as i32) << 8) | ((c[2] as i32) << 16);
            if c[2] & 0x80 != 0 {
                v -= 1 << 24;
            }
            v as f32 / 8388608.0
        }
        (32, false) => i32::from_le_bytes([c[0], c[1], c[2], c[3]]) as f32 / 2147483648.0,
        (32, true) => f32::from_le_bytes([c[0], c[1], c[2], c[3]]),
        (64, true) => f64::from_le_bytes([c[0], c[1], c[2], c[3], c[4], c[5], c[6], c[7]]) as f32,
        _ => 0.0,
    })
}

/// Per-channel linear interpolation resample.
fn resample(pcm: &[f32], in_rate: u32, out_rate: u32, ch: usize) -> Vec<f32> {
    let in_frames = pcm.len() / ch.max(1);
    if in_frames == 0 {
        return Vec::new();
    }
    let ratio = in_rate as f64 / out_rate as f64;
    let out_frames = ((in_frames as f64) / ratio) as usize;
    let mut v = Vec::with_capacity(out_frames * ch);
    for i in 0..out_frames {
        let t = i as f64 * ratio;
        let i0 = (t as usize).min(in_frames - 1);
        let frac = (t - i0 as f64) as f32;
        let i1 = (i0 + 1).min(in_frames - 1);
        for c in 0..ch {
            let a = pcm[i0 * ch + c];
            let b = pcm[i1 * ch + c];
            v.push(a + (b - a) * frac);
        }
    }
    v
}

// ---- C ABI ---------------------------------------------------------------

#[no_mangle]
pub extern "C" fn lupine_alloc(n: usize) -> *mut u8 {
    if n == 0 {
        return std::ptr::null_mut();
    }
    unsafe { alloc(Layout::from_size_align(n, 16).unwrap()) }
}

#[no_mangle]
pub extern "C" fn lupine_free(ptr: *mut u8, n: usize) {
    if ptr.is_null() || n == 0 {
        return;
    }
    unsafe { dealloc(ptr, Layout::from_size_align(n, 16).unwrap()) }
}

/// dec_new(stream_rate, channels, bits, is_float, out_rate) -> handle
#[no_mangle]
pub extern "C" fn dec_new(in_rate: u32, ch: u32, bits: u32, is_float: u32, out_rate: u32) -> *mut Decoder {
    Box::into_raw(Box::new(Decoder {
        bits,
        is_float: is_float != 0,
        in_rate: in_rate.max(1),
        ch: ch.max(1),
        out_rate: out_rate.max(1),
        out: Vec::new(),
        pos: 0,
    }))
}

#[no_mangle]
pub extern "C" fn dec_free(dec: *mut Decoder) {
    if !dec.is_null() {
        unsafe { drop(Box::from_raw(dec)) }
    }
}

/// Copy `len` packet bytes into the decoder and decode them. Milestone 1
/// decodes eagerly at push (whole buffer); streaming codecs append to `out`
/// incrementally later.
#[no_mangle]
pub extern "C" fn dec_push(dec: *mut Decoder, data: *const u8, len: usize) {
    if dec.is_null() || data.is_null() {
        return;
    }
    let d = unsafe { &mut *dec };
    let bytes = unsafe { std::slice::from_raw_parts(data, len) };
    d.push(bytes);
}

/// Pull up to `max_frames` resampled interleaved f32 frames. Returns frames written.
#[no_mangle]
pub extern "C" fn dec_pull(dec: *mut Decoder, out: *mut f32, max_frames: u32) -> u32 {
    if dec.is_null() || out.is_null() {
        return 0;
    }
    let d = unsafe { &mut *dec };
    let ch = d.ch as usize;
    let avail = d.out.len() / ch - d.pos.min(d.out.len() / ch);
    let n = (max_frames as usize).min(avail);
    if n > 0 {
        let dst = unsafe { std::slice::from_raw_parts_mut(out, n * ch) };
        dst.copy_from_slice(&d.out[d.pos * ch..(d.pos + n) * ch]);
        d.pos += n;
    }
    n as u32
}

#[no_mangle]
pub extern "C" fn dec_seek(dec: *mut Decoder, frame: u32) {
    if dec.is_null() {
        return;
    }
    let d = unsafe { &mut *dec };
    d.seek_frame(frame);
}

#[no_mangle]
pub extern "C" fn dec_reset(dec: *mut Decoder) {
    if dec.is_null() {
        return;
    }
    let d = unsafe { &mut *dec };
    d.out.clear();
    d.pos = 0;
}

/// Current playback position in output frames.
#[no_mangle]
pub extern "C" fn dec_tell(dec: *mut Decoder) -> u32 {
    if dec.is_null() {
        return 0;
    }
    unsafe { (*dec).pos as u32 }
}

/// Total decoded frames (stream time at out_rate = this / out_rate).
#[no_mangle]
pub extern "C" fn dec_frames_total(dec: *mut Decoder) -> u32 {
    if dec.is_null() {
        return 0;
    }
    (unsafe { &*dec }).out.len() as u32 / unsafe { &*dec }.ch
}

#[cfg(test)]
mod tests {
    use super::*;

    fn approx(a: f32, b: f32) {
        assert!((a - b).abs() < 1e-4, "{a} != {b}");
    }

    #[test]
    fn decodes_i16_i24_i32_f32() {
        let s: Vec<f32> = convert_samples(&[0x00, 0x80][..], 16, false).collect();
        approx(s[0], -1.0);
        let s: Vec<f32> = convert_samples(&[0xFF, 0x7F][..], 16, false).collect();
        approx(s[0], 32767.0 / 32768.0);
        let s: Vec<f32> = convert_samples(&[0x00, 0x00, 0x80][..], 24, false).collect();
        approx(s[0], -1.0);
        let s: Vec<f32> = convert_samples(&[0x00, 0x00, 0x80, 0x3F][..], 32, true).collect();
        approx(s[0], 1.0);
    }

    #[test]
    fn resamples_8k_to_16k() {
        let pcm = [0.0f32, 1.0, 0.0, -1.0];
        let out = resample(&pcm, 8000, 16000, 1);
        let want = [0.0, 0.5, 1.0, 0.5, 0.0, -0.5, -1.0, -1.0];
        assert_eq!(out.len(), want.len());
        for (a, b) in out.iter().zip(want) {
            approx(*a, b);
        }
    }

    #[test]
    fn decoder_roundtrip() {
        let mut d = Decoder {
            bits: 16,
            is_float: false,
            in_rate: 8000,
            ch: 1,
            out_rate: 16000,
            out: Vec::new(),
            pos: 0,
        };
        d.push(&[0x00, 0x80, 0x00, 0x80]); // two frames of -1.0 at 8k
        assert_eq!(d.out.len(), 4);
        assert_eq!(d.out[0], -1.0);
        assert_eq!(d.out[3], -1.0);
        d.seek_frame(1);
        assert_eq!(d.pos, 1);
    }
}