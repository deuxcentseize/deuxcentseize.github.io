/* presets.js — curated "interesting conditions" + experiment persistence.
 *
 * A preset is a fully reproducible condition: parameters + seed + notes. Because
 * the RNG is deterministic, loading a preset re-creates the exact same run.
 * Presets are starting points known to produce qualitatively different regimes
 * of the PPS; the classic set (alpha=180, beta=17, v=0.67, r=5, d=0.08) is the
 * canonical "cells" configuration from the Schmickl et al. paper.
 *
 * User experiments (saved live conditions) persist in localStorage and can be
 * exported/imported as JSON so a genuinely novel result can be shared. */
(function (PPS) {
  'use strict';

  PPS.PRESETS = [
    {
      name: 'Classic Cells',
      notes: 'Canonical Schmickl et al. parameters. Self-organising cells that grow, divide and dissolve.',
      params: { count: 12000, density: 0.08, alpha: 180, beta: 17, v: 0.67, r: 5, seed: 1 },
    },
    {
      name: 'Dense Colony',
      notes: 'Higher density packs cells tightly into a colony-like tissue.',
      params: { count: 20000, density: 0.11, alpha: 180, beta: 17, v: 0.67, r: 5, seed: 7 },
    },
    {
      name: 'Sparse Gas',
      notes: 'Low density: mostly free wanderers with transient encounters.',
      params: { count: 6000, density: 0.04, alpha: 180, beta: 17, v: 0.67, r: 5, seed: 3 },
    },
    {
      name: 'Nervous Swarm',
      notes: 'Higher beta amplifies turning: jittery, restless structures.',
      params: { count: 12000, density: 0.08, alpha: 180, beta: 25, v: 0.67, r: 5, seed: 5 },
    },
    {
      name: 'Lazy Turners',
      notes: 'Low beta: slow to react, forms large loose rings and filaments.',
      params: { count: 12000, density: 0.08, alpha: 180, beta: 8, v: 0.67, r: 5, seed: 11 },
    },
    {
      name: 'Off-axis Drift',
      notes: 'Alpha away from 180 breaks the reversal symmetry: drifting, streaming clusters.',
      params: { count: 14000, density: 0.08, alpha: 168, beta: 17, v: 0.67, r: 5, seed: 2 },
    },
    {
      name: 'Fast Movers',
      notes: 'Larger step length: cells stretch and travel further before reforming.',
      params: { count: 12000, density: 0.08, alpha: 180, beta: 17, v: 1.1, r: 5, seed: 9 },
    },
    {
      name: 'Big Neighbourhood',
      notes: 'Larger radius: broader coordination, fewer but bigger structures.',
      params: { count: 12000, density: 0.08, alpha: 180, beta: 14, v: 0.67, r: 8, seed: 4 },
    },
    {
      name: 'Crawling Filaments',
      notes: 'Tuned to favour long moving strands rather than round cells.',
      params: { count: 16000, density: 0.09, alpha: 176, beta: 20, v: 0.8, r: 5, seed: 13 },
    },
    {
      name: 'Stress Test (40k)',
      notes: 'Large population to benchmark the spatial grid and renderer.',
      params: { count: 40000, density: 0.08, alpha: 180, beta: 17, v: 0.67, r: 5, seed: 21 },
    },
  ];

  const STORAGE_KEY = 'pps.experiments.v1';

  const ExperimentStore = {
    load() {
      try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      } catch (e) {
        return [];
      }
    },
    save(list) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
      } catch (e) {
        /* storage may be unavailable over file://; ignore */
      }
    },
    add(exp) {
      const list = this.load();
      list.push(exp);
      this.save(list);
      return list;
    },
    remove(index) {
      const list = this.load();
      list.splice(index, 1);
      this.save(list);
      return list;
    },
    exportAll() {
      return JSON.stringify(this.load(), null, 2);
    },
    importJSON(text) {
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) throw new Error('Expected an array of experiments');
      this.save(parsed);
      return parsed;
    },
  };

  PPS.ExperimentStore = ExperimentStore;
})((window.PPS = window.PPS || {}));
