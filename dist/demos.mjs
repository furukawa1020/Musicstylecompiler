import { render } from './render.mjs';

export const demos = {
  'winter-postcard': { title: '冬のポストカード', bpm: 102, duration: 28.24, bars: [
    [60, 64, 67, 69], [67, 64, 62, 60], [62, 65, 69, 72], [71, 67, 65, 62],
    [64, 67, 72, 74], [76, 74, 72, 67], [69, 72, 76, 79], [77, 76, 72, 69],
    [65, 69, 72, 76], [74, 71, 67, 62], [64, 67, 72, 71], [67, 64, 60, 60],
  ] },
  'paper-kite': { title: '紙ひこうき', bpm: 114, duration: 25.26, bars: [
    [69, 72, 76, 74], [72, 69, 67, 64], [65, 69, 72, 76], [74, 72, 69, 65],
    [67, 71, 74, 79], [77, 74, 71, 67], [69, 72, 76, 81], [79, 76, 74, 72],
    [65, 69, 72, 77], [76, 72, 67, 64], [69, 72, 76, 74], [72, 71, 69, 69],
  ] },
};

export function demoAudio(id) {
  const demo = demos[id];
  const lead = [];
  for (const [bar, pitches] of demo.bars.entries()) {
    const offsets = bar % 3 === 1 ? [0, 1.5, 2, 3] : [0, 1, 2, 3];
    for (const [index, pitch] of pitches.entries()) {
      const length = (offsets[index + 1] ?? 4) - offsets[index];
      lead.push({ pitch, start_tick: (bar * 4 + offsets[index]) * 480, duration_ticks: Math.round(length * 480 * .82), velocity: 90 });
    }
  }
  return render({ duration_sec: demo.duration, tempo_map: [{ bpm: demo.bpm }], ticks_per_quarter: 480,
    tracks: [{ instrument: 'dry-piano', notes: lead }] }, { echo: false });
}
