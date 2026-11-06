export const TPQ = 480;
export const BAR = TPQ * 4;
export const MAX_SECONDS = 30;
export const STYLES = {
  christmas: { label: 'Christmas', lead: 'celesta', passes: ['チェレスタへ再配音', '3和音とadd9の弦伴奏', '拍同期のスレイベル', 'フレーズ末尾のベル'] },
  chip: { label: '8-bit', lead: 'pulse', passes: ['パルス波の旋律', '三角波ベース', '高速アルペジオ', 'ノイズ打楽器'] },
  jazz: { label: 'Jazz', lead: 'reed', passes: ['リード音色の旋律', '7th系コードの裏拍コンピング', 'ウォーキングベース', 'スウィングのライド'] },
  classical: { label: 'Classical', lead: 'violin', passes: ['弦の旋律', 'チェロの低音', '木管の応答', '弦楽アンサンブルの分散和音'] },
};
const names = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
const scales = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10] };
const pitchClass = n => ((n % 12) + 12) % 12;
const mean = a => a.reduce((sum, n) => sum + n, 0) / a.length;

function pitchAt(samples, start, rate, energy) {
  const size = Math.round(rate * .038);
  const minLag = Math.floor(rate / 1550);
  const maxLag = Math.ceil(rate / 73);
  const correlations = new Float32Array(maxLag + 1);
  for (let lag = minLag; lag <= maxLag; lag++) {
    let dot = 0, delayed = 0;
    for (let i = 0; i < size; i++) {
      const y = samples[start + i + lag];
      dot += samples[start + i] * y;
      delayed += y * y;
    }
    correlations[lag] = dot / Math.sqrt(energy * delayed || 1);
  }
  let best = minLag;
  for (let lag = minLag + 1; lag < maxLag; lag++) {
    if (correlations[lag] > correlations[best]) best = lag;
  }
  const threshold = Math.max(.72, correlations[best] * .92);
  for (let lag = minLag + 1; lag < maxLag; lag++) {
    if (correlations[lag] >= threshold && correlations[lag] > correlations[lag - 1] && correlations[lag] >= correlations[lag + 1]) {
      const [a, b, c] = [correlations[lag - 1], correlations[lag], correlations[lag + 1]];
      const period = lag + .5 * (a - c) / (a - 2 * b + c || -1);
      return { pitch: Math.round(69 + 12 * Math.log2(rate / period / 440)), confidence: b };
    }
  }
  return { pitch: null, confidence: 0 };
}

export function analyze(samples, rate) {
  const stride = Math.max(1, Math.round(rate / 10000));
  const reduced = new Float32Array(Math.floor(samples.length / stride));
  for (let i = 0; i < reduced.length; i++) {
    let sum = 0;
    for (let j = 0; j < stride; j++) sum += samples[i * stride + j];
    reduced[i] = sum / stride;
  }
  const hz = rate / stride, size = Math.round(hz * .038), hop = Math.round(hz * .015);
  const frames = [];
  let peak = 0;
  for (let start = 0; start + size + Math.ceil(hz / 73) < reduced.length; start += hop) {
    let energy = 0;
    for (let j = 0; j < size; j++) energy += reduced[start + j] ** 2;
    const rms = Math.sqrt(energy / size);
    peak = Math.max(peak, rms);
    frames.push({ start, energy, rms });
  }
  if (peak < .001) throw new Error('音源が無音か、音量が小さすぎます。旋律が聞こえる音源をお試しください。');
  for (const frame of frames) {
    const pitch = frame.rms > Math.max(.001, peak * .055) ? pitchAt(reduced, frame.start, hz, frame.energy) : { pitch: null, confidence: 0 };
    frame.time = (frame.start + size / 2) / hz;
    Object.assign(frame, pitch);
  }
  return { frames, hop_sec: hop / hz, duration_sec: samples.length / rate };
}

function estimateTempo(notes) {
  const intervals = notes.slice(1).map((note, i) => note.start - notes[i].start).filter(t => t >= .13 && t <= 1.8);
  if (intervals.length < 4) return { bpm: 108, confidence: 0 };
  let best = { bpm: 108, score: -Infinity };
  for (let bpm = 72; bpm <= 156; bpm++) {
    const beat = 60 / bpm;
    const score = mean(intervals.map(interval => {
      const units = interval / beat;
      const nearest = Math.max(.5, Math.round(units * 2) / 2);
      const error = (units - nearest) * beat;
      return Math.exp(-((error / .047) ** 2)) * (nearest === 1 ? 1 : nearest === .5 ? .82 : .86);
    })) - Math.abs(bpm - 108) * .0007;
    if (score > best.score) best = { bpm, score };
  }
  return { bpm: best.score > .55 ? best.bpm : 108, confidence: Math.max(0, best.score) };
}

function estimateKey(notes) {
  const weight = Array(12).fill(0);
  for (const note of notes) weight[pitchClass(note.pitch)] += note.duration_ticks;
  const profiles = { major: [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88],
    minor: [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17] };
  const center = mean(weight);
  const spread = Math.sqrt(weight.reduce((sum, w) => sum + (w - center) ** 2, 0)) || 1;
  const candidates = [];
  for (const [mode, profile] of Object.entries(profiles)) {
    const mid = mean(profile);
    const scale = Math.sqrt(profile.reduce((sum, w) => sum + (w - mid) ** 2, 0));
    for (let root = 0; root < 12; root++) {
      const fit = profile.reduce((sum, p, i) => sum + (p - mid) * (weight[(i + root) % 12] - center), 0) / (scale * spread);
      const ending = pitchClass(notes.at(-1).pitch) === root ? .075 : 0;
      candidates.push({ root, tonic: names[root], mode, score: fit + ending });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const { root, tonic, mode, score } = candidates[0];
  return { root, tonic, mode, confidence: Math.min(1, Math.max(0, score)) };
}

function chooseHarmony(notes, key, totalTicks) {
  const scale = scales[key.mode];
  const chords = [];
  for (let start = 0; start < totalTicks; start += BAR) {
    const local = notes.filter(n => n.start_tick < start + BAR && n.start_tick + n.duration_ticks > start);
    const candidates = scale.map((degree, index) => {
      const root = key.root + degree;
      const third = pitchClass(scale[(index + 2) % 7] - degree);
      const fifth = pitchClass(scale[(index + 4) % 7] - degree);
      const seventh = pitchClass(scale[(index + 6) % 7] - degree);
      const quality = fifth === 6 ? 'dim' : third === 3 ? 'm' : '';
      let score = [1.15, .15, .05, .58, .65, .42, -.45][index] * TPQ;
      if (start + BAR >= totalTicks && index === 0) score += .9 * TPQ;
      for (const note of local) {
        const interval = pitchClass(note.pitch - root);
        const overlap = Math.min(start + BAR, note.start_tick + note.duration_ticks) - Math.max(start, note.start_tick);
        score += overlap * ([0, third, fifth].includes(interval) ? 1 : [1, 6, 11].includes(interval) ? -.9 : -.15);
      }
      return { root: pitchClass(root), third, fifth, seventh, symbol: names[pitchClass(root)] + quality, score };
    }).sort((a, b) => b.score - a.score);
    const { score, ...chord } = candidates[0];
    chords.push({ ...chord, start_tick: start, duration_ticks: Math.min(BAR, totalTicks - start),
      confidence: Math.max(0, Math.min(1, (score - candidates[1].score) / BAR)) });
  }
  return chords;
}

export function transcribe(analysis, source) {
  const { frames, hop_sec, duration_sec } = analysis;
  const notes = [];
  for (let i = 0; i < frames.length;) {
    const first = frames[i];
    let j = i + 1;
    while (j < frames.length && frames[j].pitch === first.pitch) j++;
    if (first.pitch !== null && first.pitch >= 36 && first.pitch <= 96 && j - i >= 4) {
      notes.push({ pitch: first.pitch, start: Math.max(0, first.time - hop_sec / 2),
        length: (j - i) * hop_sec, confidence: mean(frames.slice(i, j).map(frame => frame.confidence)) });
    }
    i = j;
  }
  const voiced = notes.reduce((sum, note) => sum + note.length, 0) / duration_sec;
  if (notes.length < 4 || voiced < .16) throw new Error('安定した旋律を採譜できませんでした。メロディがはっきりした単音・少編成の音源をお試しください。');
  const tempo = estimateTempo(notes);
  const toTick = time => Math.round(time * TPQ * tempo.bpm / 60);
  const total_ticks = Math.max(1, toTick(duration_sec));
  const melody = notes.map(note => ({ pitch: note.pitch, start_tick: toTick(note.start),
    duration_ticks: Math.min(Math.max(1, toTick(note.length)), total_ticks - toTick(note.start)), velocity: 93,
    confidence: Math.round(note.confidence * 1000) / 1000 }));
  const key = estimateKey(melody);
  const ir = {
    schema_version: '0.1', kind: 'source', source, duration_sec, total_ticks, ticks_per_quarter: TPQ,
    tempo_map: [{ tick: 0, ...tempo }], meter: [{ tick: 0, numerator: 4, denominator: 4, assumed: true }],
    key, sections: [{ kind: 'full-excerpt', start_tick: 0, end_tick: total_ticks }],
    tracks: [{ id: 'lead', role: 'melody', instrument: 'unknown', notes: melody }],
    chords: chooseHarmony(melody, key, total_ticks),
    provenance: { analyzer: 'monophonic-acf-v1', harmony: 'suggested-from-melody', voiced_fraction: voiced },
  };
  validate(ir);
  return ir;
}

export function validate(ir) {
  if (!Number.isInteger(ir.total_ticks) || ir.total_ticks < 1 || !Number.isFinite(ir.duration_sec)
      || ir.duration_sec <= 0 || !Number.isFinite(ir.tempo_map[0]?.bpm) || ir.tempo_map[0].bpm <= 0
      || !Number.isInteger(ir.ticks_per_quarter) || ir.ticks_per_quarter <= 0) throw new Error('Music IR の曲長またはテンポが不正です。');
  if (new Set(ir.tracks.map(track => track.id)).size !== ir.tracks.length) throw new Error('Music IR のトラックIDが重複しています。');
  for (const section of ir.sections) {
    if (section.start_tick < 0 || section.end_tick > ir.total_ticks || section.end_tick <= section.start_tick) throw new Error('Music IR の区間が不正です。');
  }
  for (const track of ir.tracks) {
    for (const note of track.notes) {
      if (!Number.isInteger(note.pitch) || note.pitch < 0 || note.pitch > 127
          || !Number.isInteger(note.velocity) || note.velocity < 1 || note.velocity > 127
          || !Number.isInteger(note.start_tick) || note.start_tick < 0
          || !Number.isInteger(note.duration_ticks) || note.duration_ticks < 1
          || note.start_tick + note.duration_ticks > ir.total_ticks) throw new Error('Music IR のノート範囲が不正です。');
    }
  }
}

export function arrange(source, style) {
  validate(source);
  if (!Object.hasOwn(STYLES, style)) throw new Error('このスタイルは利用できません。');
  const definition = STYLES[style];
  const tracks = [{ ...source.tracks[0], instrument: definition.lead,
    notes: source.tracks[0].notes.map(note => ({ ...note })) }];
  const instruments = new Map();
  const add = (instrument, pitch, start_tick, length, velocity, role = 'accompaniment') => {
    const duration_ticks = Math.min(length, source.total_ticks - start_tick);
    if (duration_ticks < 1) return;
    if (!instruments.has(instrument)) instruments.set(instrument, { id: instrument, instrument, role, notes: [] });
    instruments.get(instrument).notes.push({ pitch, start_tick, duration_ticks, velocity });
  };
  const beat = TPQ;
  for (const [barIndex, chord] of source.chords.entries()) {
    const bar = chord.start_tick;
    const bass = 36 + chord.root;
    const root = 48 + chord.root;
    const triad = [root, root + chord.third, root + chord.fifth];
    if (style === 'christmas') {
      triad.forEach(p => add('strings', p, bar, BAR - 60, 45));
      add('pizz', bass, bar, beat * 2 - 30, 70);
      add('pizz', bass + chord.fifth, bar + beat * 2, beat * 2 - 30, 59);
      for (let i = 0; i < 8; i++) {
        add('sleigh', 83, bar + i * beat / 2, 150, i % 2 === 0 ? 62 : 44, 'percussion');
        if (i % 2 === 1) add('soft-keys', triad[(i + barIndex) % 3] + 12, bar + i * beat / 2, 205, 43);
      }
      if (chord.confidence > .12) add('soft-keys', root + 14, bar + 3 * beat, 220, 36);
      if (barIndex % 2 === 1) add('bell', root + 24, bar + beat * 3.5, 180, 53);
    } else if (style === 'chip') {
      for (let i = 0; i < 16; i++) {
        add('arp', triad[i % 3] + (i % 4 === 3 ? 24 : 12), bar + i * beat / 4, 100, 52);
      }
      [0, chord.fifth, 12, chord.fifth].forEach((p, i) => add('triangle', bass + p, bar + i * beat, 370, 76));
      for (let i = 0; i < 8; i++) add(i % 2 === 0 ? 'chip-kick' : 'chip-noise', 36 + i, bar + i * beat / 2, 110, i % 2 === 0 ? 74 : 51, 'percussion');
    } else if (style === 'jazz') {
      const voicing = [root + chord.third, root + chord.seventh, root + 12 + chord.fifth];
      for (const [i, when] of [320, 800, 1440].entries()) {
        voicing.forEach(p => add('jazz-keys', p, bar + when, i === 1 ? 380 : 210, i === 1 ? 54 : 65));
      }
      const following = source.chords[barIndex + 1]?.root ?? chord.root;
      [bass, bass + chord.third, bass + chord.fifth, 35 + following].forEach((p, i) => add('upright', p, bar + i * beat, 407, 78));
      for (const when of [0, 480, 800, 960, 1440, 1760]) add('ride', 51, bar + when, 125, when % beat === 0 ? 56 : 38, 'percussion');
    } else {
      add('cello', bass, bar, BAR - 30, 63);
      add('ensemble', root + chord.third, bar, BAR - 25, 47);
      add('ensemble', root + chord.fifth, bar + beat, beat * 3 - 25, 45);
      const sequence = [0, 1, 2, 1, 0, 2, 1, 2];
      sequence.forEach((degree, i) => add('pizz', triad[degree], bar + i * beat / 2, 170, i % 2 === 0 ? 57 : 45));
      if (barIndex % 2 === 1) {
        add('flute', root + 24 + chord.third, bar + beat * 2, 350, 42);
        add('flute', root + 24, bar + beat * 3, 390, 49);
      }
    }
  }
  const result = { ...source, kind: 'arrangement', style, tracks: [...tracks, ...instruments.values()],
    provenance: { ...source.provenance, compiler: 'rule-passes-v1', passes: definition.passes,
      preserved: ['melody.pitch', 'melody.start_tick', 'melody.duration_ticks', 'sections'] } };
  validate(result);
  return result;
}
