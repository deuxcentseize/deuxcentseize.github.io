/* rng.js — deterministic, seedable PRNG.
 * Determinism is essential: an "interesting condition" is only reproducible if
 * the exact same random stream produced it. Every preset/experiment stores a
 * seed and re-creates the identical run. */
(function (PPS) {
  'use strict';

  // mulberry32 — tiny, fast, good enough statistical quality for particle init.
  PPS.makeRNG = function makeRNG(seed) {
    let a = (seed >>> 0) || 1;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  // Derive a stable 32-bit seed from an arbitrary string (for named runs).
  PPS.hashSeed = function hashSeed(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  };
})((window.PPS = window.PPS || {}));
