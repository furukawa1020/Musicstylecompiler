import { render } from './render.mjs';

const originals = {
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

const phrase = (...notes) => notes.map(note => typeof note === 'number' ? [note, 1] : note);

const repertoire = {
  'jingle-bells': { title: 'ジングルベル', credit: 'James L. Pierpont', bpm: 124, instrument: 'dry-piano',
    score: phrase(64, 64, [64, 2], 64, 64, [64, 2], 64, 67, 60, 62, [64, 4],
      65, 65, [65, 1.5], [65, .5], 65, 64, 64, [64, .5], [64, .5], 64, 62, 62, 64, [62, 2], [67, 2],
      64, 64, [64, 2], 64, 64, [64, 2], 64, 67, 60, 62, [64, 4], 65, 65, [65, 1.5], [65, .5], 65, 64, 64, [64, .5], [64, .5], 67, 67, 65, 62, [60, 4]) },
  'twinkle': { title: 'きらきら星', credit: 'フランス民謡', bpm: 110, instrument: 'demo-keys',
    score: phrase(60, 60, 67, 67, 69, 69, [67, 2], 65, 65, 64, 64, 62, 62, [60, 2],
      67, 67, 65, 65, 64, 64, [62, 2], 67, 67, 65, 65, 64, 64, [62, 2],
      60, 60, 67, 67, 69, 69, [67, 2], 65, 65, 64, 64, 62, 62, [60, 2]) },
  'ode-to-joy': { title: '歓喜の歌', credit: 'L. van Beethoven', bpm: 112, instrument: 'dry-piano',
    score: phrase(64, 64, 65, 67, 67, 65, 64, 62, 60, 60, 62, 64, [64, 1.5], [62, .5], [62, 2],
      64, 64, 65, 67, 67, 65, 64, 62, 60, 60, 62, 64, [62, 1.5], [60, .5], [60, 2],
      62, 62, 64, 60, 62, [64, .5], [65, .5], 64, 60, 62, [64, .5], [65, .5], 64, 62, 60, 62, [55, 2],
      64, 64, 65, 67, 67, 65, 64, 62, 60, 60, 62, 64, [62, 1.5], [60, .5], [60, 2]) },
  'frere-jacques': { title: 'フレール・ジャック', credit: 'フランス民謡', bpm: 106, instrument: 'pizz',
    score: phrase(60, 62, 64, 60, 60, 62, 64, 60, 64, 65, [67, 2], 64, 65, [67, 2],
      [67, .5], [69, .5], [67, .5], [65, .5], 64, 60, [67, .5], [69, .5], [67, .5], [65, .5], 64, 60,
      60, 55, [60, 2], 60, 55, [60, 2]) },
  'sakura': { title: 'さくらさくら', credit: '日本古謡', bpm: 88, instrument: 'pizz',
    score: phrase(69, 69, [71, 2], 69, 69, [71, 2], 69, 71, 72, 71, 69, 71, [69, 1], [65, 1],
      64, 60, 64, 65, 64, 64, [60, 2], 69, 69, [71, 2], 69, 69, [71, 2], 64, 65, 71, 69, 65, [64, 2]) },
  'auld-lang-syne': { title: '蛍の光', credit: 'スコットランド民謡', bpm: 100, instrument: 'demo-keys',
    score: phrase(55, [60, 1.5], [60, .5], 60, 64, [62, 1.5], [60, .5], 62, 64, [60, 1.5], [60, .5], 64, 67,
      [69, 3], 69, [67, 1.5], [64, .5], 64, 60, [62, 1.5], [60, .5], 62, 64,
      [60, 1.5], [57, .5], 57, 55, [60, 4]) },
  'greensleeves': { title: 'グリーンスリーヴス', credit: 'イングランド民謡', bpm: 98, beats: 3, instrument: 'flute',
    score: phrase([69, .5], 72, [74, .5], [76, .75], [77, .25], [76, .5], 74, [71, .5], [67, .75], [69, .25], [71, .5],
      72, [69, .5], [69, .75], [68, .25], [69, .5], 71, [68, .5], 64, [69, .5],
      72, [74, .5], [76, .75], [77, .25], [76, .5], 74, [71, .5], [67, .75], [69, .25], [71, .5],
      [72, .75], [71, .25], [69, .5], [68, .75], [66, .25], [68, .5], [69, 2]) },
  'amazing-grace': { title: 'アメイジング・グレイス', credit: '伝承曲 New Britain', bpm: 91, beats: 3, instrument: 'dry-piano',
    score: phrase(55, [60, 2], [64, .5], [60, .5], [64, 2], 62, [60, 2], 57, [55, 2], 55,
      [60, 2], [64, .5], [60, .5], [64, 2], [62, 1], [67, 5], 64, [67, 1.5], [64, .5], 67, [64, 1.5],
      [60, .5], 55, [57, 1.5], [60, .5], [60, .5], [57, .5], [55, 2], 55, [60, 2], [64, .5], [60, .5], [64, 2], 62, [60, 3]) },
};

export const demos = Object.fromEntries([
  ...Object.entries(originals).map(([id, track]) => [id, { ...track, credit: 'スタジオ・オリジナル', group: 'original' }]),
  ...Object.entries(repertoire).map(([id, track]) => [id, { ...track, group: 'repertoire',
    duration: Math.min(30, track.score.reduce((beats, [, length]) => beats + length, 0) * 60 / track.bpm) }]),
]);

// Verified video IDs index compositions only. Their recordings are never used as compiler input.
export const youtubeCatalog = {
  'nl3-k5GfYlw': 'ode-to-joy',
  'uzu-pSlOS8w': 'twinkle',
  aFbOyqUUDik: 'jingle-bells',
  '4b7dFqv94iI': 'jingle-bells',
  SqvlTw1KZdA: 'jingle-bells',
};

const titleIndex = new Map(Object.entries({
  'ode-to-joy': ['Ode to Joy', '歓喜の歌', 'An die Freude'],
  twinkle: ['Twinkle Twinkle Little Star', 'きらきら星', 'Ah vous dirai je maman'],
  'jingle-bells': ['Jingle Bells', 'ジングルベル'],
  'frere-jacques': ['Frère Jacques', 'フレールジャック'],
  sakura: ['Sakura Sakura', 'さくらさくら'],
  'auld-lang-syne': ['Auld Lang Syne', '蛍の光'],
  greensleeves: ['Greensleeves', 'グリーンスリーヴス'],
  'amazing-grace': ['Amazing Grace', 'アメイジンググレイス'],
}).flatMap(([id, aliases]) => aliases.map(title => [normalizeTitle(title), id])));

function normalizeTitle(title) {
  return title.normalize('NFKD').toLowerCase().replace(/[\p{Mark}\p{Punctuation}\p{Symbol}\s]/gu, '');
}

export function suggestDemo(title) {
  const plain = title.split(/[|｜(（]/, 1)[0].replace(/\s*[-–—]\s*(piano|instrumental|acoustic|version|cover).*$/i, '');
  return titleIndex.get(normalizeTitle(plain)) ?? null;
}

export function demoAudio(id) {
  const demo = demos[id];
  const lead = [];
  if (demo.score) {
    let tick = 0;
    const totalTicks = Math.round(demo.duration * 480 * demo.bpm / 60);
    for (const [pitch, length] of demo.score) {
      const step = Math.round(length * 480);
      const duration = Math.min(totalTicks - tick, Math.round(step * .72));
      if (duration <= 0) break;
      lead.push({ pitch, start_tick: tick, duration_ticks: duration, velocity: 90 });
      tick += step;
    }
  } else {
    for (const [bar, pitches] of demo.bars.entries()) {
      const offsets = bar % 3 === 1 ? [0, 1.5, 2, 3] : [0, 1, 2, 3];
      for (const [index, pitch] of pitches.entries()) {
        const length = (offsets[index + 1] ?? 4) - offsets[index];
        lead.push({ pitch, start_tick: (bar * 4 + offsets[index]) * 480, duration_ticks: Math.round(length * 480 * .82), velocity: 90 });
      }
    }
  }
  return render({ duration_sec: demo.duration, tempo_map: [{ bpm: demo.bpm }], ticks_per_quarter: 480,
    tracks: [{ instrument: demo.instrument ?? 'dry-piano', notes: lead }] }, { echo: false });
}
