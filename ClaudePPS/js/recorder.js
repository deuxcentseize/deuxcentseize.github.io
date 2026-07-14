/* recorder.js — ultra-compact run recording + playback.
 *
 * Goal: capture a run as *just the particles*, every Nth timestep, using a
 * single-digit number of bytes per particle. We store quantised positions only:
 *
 *   16-bit : 4 bytes/particle  (x,y as uint16, ~1/65536 world resolution)
 *   12-bit : 3 bytes/particle  (x,y packed into 3 bytes, 1/4096 resolution)
 *    8-bit : 2 bytes/particle  (x,y as uint8, coarse but tiny)
 *
 * Heading and colour are NOT stored — on playback the neighbour count N is
 * recomputed from the decoded positions (a grid pass), so the classic palette
 * is fully reconstructed for free. This keeps recordings ~30x smaller than
 * storing full float state.
 *
 * Export format ("PPS1"): [magic 4B][headerLen u32][header JSON][frame bytes...] */
(function (PPS) {
  'use strict';

  const MAGIC = 0x31535050; // "PPS1" little-endian

  class Recorder {
    constructor() {
      this.recording = false;
      this.reset();
    }

    reset() {
      this.frames = []; // array of typed-array frames
      this.header = null;
      this.recording = false;
    }

    bytesPerParticle() {
      switch (this.quant) {
        case 8: return 2;
        case 12: return 3;
        default: return 4;
      }
    }

    // Begin capturing from `sim`. everyN: keep 1 of every N steps. quant: 8/12/16.
    start(sim, everyN, quant) {
      this.reset();
      this.quant = quant || 16;
      this.everyN = Math.max(1, everyN || 1);
      this.header = {
        version: 1,
        count: sim.params.count,
        worldW: sim.W,
        worldH: sim.H,
        everyN: this.everyN,
        quant: this.quant,
        params: Object.assign({}, sim.params),
        startStep: sim.step,
        created: new Date().toISOString(),
      };
      this.recording = true;
    }

    stop() {
      this.recording = false;
      if (this.header) this.header.frameCount = this.frames.length;
    }

    // Capture one frame (caller decides cadence, but everyN is enforced too).
    capture(sim) {
      if (!this.recording) return;
      const n = sim.params.count;
      const x = sim.x, y = sim.y;
      const invW = 1 / sim.W;
      const invH = 1 / sim.H;
      let frame;
      if (this.quant === 16) {
        frame = new Uint16Array(n * 2);
        for (let i = 0; i < n; i++) {
          frame[i * 2] = clamp16(x[i] * invW * 65535);
          frame[i * 2 + 1] = clamp16(y[i] * invH * 65535);
        }
      } else if (this.quant === 8) {
        frame = new Uint8Array(n * 2);
        for (let i = 0; i < n; i++) {
          frame[i * 2] = clamp8(x[i] * invW * 255);
          frame[i * 2 + 1] = clamp8(y[i] * invH * 255);
        }
      } else {
        // 12-bit packed: two 12-bit values into 3 bytes.
        frame = new Uint8Array(n * 3);
        for (let i = 0; i < n; i++) {
          const qx = clamp12(x[i] * invW * 4095);
          const qy = clamp12(y[i] * invH * 4095);
          const o = i * 3;
          frame[o] = qx & 0xff;
          frame[o + 1] = ((qx >> 8) & 0x0f) | ((qy & 0x0f) << 4);
          frame[o + 2] = (qy >> 4) & 0xff;
        }
      }
      this.frames.push(frame);
    }

    // Estimated total size in bytes.
    sizeBytes() {
      if (!this.header) return 0;
      return this.header.count * this.bytesPerParticle() * this.frames.length;
    }

    // Decode one frame into caller-supplied Float32Arrays (world coords).
    decodeFrame(index, outX, outY) {
      const h = this.header;
      const frame = this.frames[index];
      const n = h.count;
      if (h.quant === 16) {
        for (let i = 0; i < n; i++) {
          outX[i] = (frame[i * 2] / 65535) * h.worldW;
          outY[i] = (frame[i * 2 + 1] / 65535) * h.worldH;
        }
      } else if (h.quant === 8) {
        for (let i = 0; i < n; i++) {
          outX[i] = (frame[i * 2] / 255) * h.worldW;
          outY[i] = (frame[i * 2 + 1] / 255) * h.worldH;
        }
      } else {
        for (let i = 0; i < n; i++) {
          const o = i * 3;
          const qx = frame[o] | ((frame[o + 1] & 0x0f) << 8);
          const qy = ((frame[o + 1] >> 4) & 0x0f) | (frame[o + 2] << 4);
          outX[i] = (qx / 4095) * h.worldW;
          outY[i] = (qy / 4095) * h.worldH;
        }
      }
    }

    // Serialize the whole recording to a downloadable ArrayBuffer.
    toBlob() {
      this.stop();
      const headerStr = JSON.stringify(this.header);
      const headerBytes = new TextEncoder().encode(headerStr);
      let bodyLen = 0;
      for (const f of this.frames) bodyLen += f.byteLength;
      const total = 12 + headerBytes.length + bodyLen;
      const buf = new ArrayBuffer(total);
      const dv = new DataView(buf);
      dv.setUint32(0, MAGIC, true);
      dv.setUint32(4, headerBytes.length, true);
      dv.setUint32(8, this.frames.length, true);
      const u8 = new Uint8Array(buf);
      u8.set(headerBytes, 12);
      let off = 12 + headerBytes.length;
      for (const f of this.frames) {
        u8.set(new Uint8Array(f.buffer, f.byteOffset, f.byteLength), off);
        off += f.byteLength;
      }
      return new Blob([buf], { type: 'application/octet-stream' });
    }

    // Parse a recording ArrayBuffer back into this recorder (for playback).
    fromBuffer(buf) {
      const dv = new DataView(buf);
      if (dv.getUint32(0, true) !== MAGIC) throw new Error('Not a PPS recording');
      const headerLen = dv.getUint32(4, true);
      const frameCount = dv.getUint32(8, true);
      const headerStr = new TextDecoder().decode(new Uint8Array(buf, 12, headerLen));
      const header = JSON.parse(headerStr);
      this.header = header;
      this.quant = header.quant;
      this.everyN = header.everyN;
      const bpp = this.bytesPerParticle();
      const frameBytes = header.count * bpp;
      let off = 12 + headerLen;
      this.frames = [];
      for (let f = 0; f < frameCount; f++) {
        if (header.quant === 16) {
          this.frames.push(new Uint16Array(buf.slice(off, off + frameBytes)));
        } else {
          this.frames.push(new Uint8Array(buf.slice(off, off + frameBytes)));
        }
        off += frameBytes;
      }
      this.recording = false;
      return header;
    }
  }

  function clamp16(v) { return v < 0 ? 0 : v > 65535 ? 65535 : v | 0; }
  function clamp12(v) { return v < 0 ? 0 : v > 4095 ? 4095 : v | 0; }
  function clamp8(v) { return v < 0 ? 0 : v > 255 ? 255 : v | 0; }

  PPS.Recorder = Recorder;
})((window.PPS = window.PPS || {}));
