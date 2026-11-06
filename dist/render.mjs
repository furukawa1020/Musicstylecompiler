export const RENDER_RATE = 24000;
const TAU = Math.PI * 2;
const sin = Math.sin;
const programs = {
  'dry-piano': 0, celesta: 8, pulse: 80, reed: 65, violin: 40, strings: 48, pizz: 45,
  sleigh: 9, 'soft-keys': 8, bell: 9, arp: 80, triangle: 81, 'chip-kick': 116, 'chip-noise': 115,
  'jazz-keys': 0, upright: 32, ride: 119, cello: 42, ensemble: 48, flute: 73,
};
const profiles = {
  'dry-piano': [.26, .003, .045, 0], celesta: [.24, .005, .13, 0],
  pulse: [.15, .004, .024, 0], reed: [.23, .039, .075, 0], violin: [.24, .060, .13, 0],
  strings: [.081, .18, .24, -.32], pizz: [.13, .007, .09, -.17],
  sleigh: [.087, .004, .04, .58], 'soft-keys': [.10, .009, .13, -.46], bell: [.11, .006, .20, .42],
  arp: [.071, .003, .017, .36], triangle: [.20, .006, .035, -.13],
  'chip-kick': [.15, .003, .025, 0], 'chip-noise': [.11, .003, .03, .23],
  'jazz-keys': [.13, .007, .11, -.44], upright: [.22, .009, .09, -.12], ride: [.10, .004, .09, .5],
  cello: [.16, .09, .17, -.26], ensemble: [.105, .17, .24, .29], flute: [.13, .055, .11, .54],
};

function oscillator(instrument, f) {
  const w = TAU * f;
  let random = 521288629;
  let previous = 0;
  const noise = () => {
    random ^= random << 13;
    random ^= random >>> 17;
    random ^= random << 5;
    const sample = random / 2147483648;
    const high = (sample - previous) * .5;
    previous = sample;
    return high;
  };
  const additive = partials => {
    const audible = partials.filter(([ratio]) => f * ratio < RENDER_RATE * .47);
    return t => audible.reduce((sum, [ratio, volume]) => sum + volume * sin(w * ratio * t), 0);
  };
  switch (instrument) {
    case 'dry-piano': {
      const piano = additive([[1, .82], [2, .15], [3, .06]]);
      return t => piano(t) * (.43 + .57 * Math.exp(-4 * t));
    }
    case 'celesta': return t => .73 * sin(w * t) * Math.exp(-2.5 * t) + .19 * sin(2.02 * w * t) * Math.exp(-7 * t) + .095 * sin(3.98 * w * t) * Math.exp(-13 * t);
    case 'soft-keys': return t => (.83 * sin(w * t) + .15 * sin(2 * w * t)) * Math.exp(-2.7 * t);
    case 'bell': return t => (.66 * sin(w * t) + .26 * sin(2.76 * w * t) + .07 * sin(5.4 * w * t)) * Math.exp(-6 * t);
    case 'sleigh': return t => (.49 * noise() + .22 * sin(TAU * 3291 * t) + .15 * sin(TAU * 4583 * t)) * Math.exp(-24 * t);
    case 'pulse': return additive([[1, .78], [2, .44], [3, .15], [5, -.12], [6, -.11], [7, -.05], [9, .08]]);
    case 'arp': return additive([[1, .85], [3, .24], [5, .14], [7, .10], [9, .07]]);
    case 'triangle': return additive([[1, .91], [3, -.101], [5, .036], [7, -.019]]);
    case 'chip-kick': return t => sin(TAU * (43 * t + 3.3 * (1 - Math.exp(-35 * t)))) * Math.exp(-18 * t);
    case 'chip-noise': return t => noise() * Math.exp(-20 * t);
    case 'reed': return t => {
      const phase = w * t + .13 * sin(TAU * 5.1 * t) * Math.min(t * 3, 1);
      return .67 * sin(phase) + .21 * sin(2 * phase) + .19 * sin(3 * phase) + .07 * sin(4 * phase) + .025 * noise();
    };
    case 'jazz-keys': return t => (.71 * sin(w * t) + .22 * sin(2 * w * t) * Math.exp(-7 * t) + .10 * sin(3 * w * t)) * Math.exp(-3.8 * t);
    case 'upright':
    case 'pizz': return t => (.85 * sin(w * t) + .27 * sin(2 * w * t) * Math.exp(-13 * t) + .13 * sin(3 * w * t) * Math.exp(-17 * t)) * Math.exp(-5.4 * t);
    case 'ride': return t => (.74 * noise() + .20 * sin(TAU * 4061 * t) + .08 * sin(TAU * 5869 * t)) * Math.exp(-17 * t);
    case 'violin':
    case 'cello': return t => {
      const p = w * t + .32 * sin(TAU * 5.2 * t) * Math.min(t * 4, 1);
      return .54 * sin(p) + .28 * sin(2 * p) + .14 * sin(3 * p) + .11 * sin(4 * p) + .06 * sin(6 * p);
    };
    case 'strings':
    case 'ensemble': return t => .42 * sin(w * t) + .22 * sin(w * 1.003 * t) + .19 * sin(w * .997 * t) + .14 * sin(w * 2.004 * t) + .075 * sin(w * 3.006 * t);
    case 'flute': return t => .87 * sin(w * t + .19 * sin(TAU * 4.8 * t)) + .11 * sin(w * 2 * t) + .023 * noise();
    default: return t => sin(w * t);
  }
}

export function render(ir, { echo = ir.style !== 'chip' } = {}) {
  const rate = RENDER_RATE;
  const secondsPerTick = 60 / (ir.tempo_map[0].bpm * ir.ticks_per_quarter);
  const size = Math.ceil(rate * ir.duration_sec);
  const channels = [new Float32Array(size), new Float32Array(size)];
  for (const track of ir.tracks) {
    const [gain, attack, release, pan] = profiles[track.instrument];
    const left = Math.sqrt((1 - pan) * .5);
    const right = Math.sqrt((1 + pan) * .5);
    for (const note of track.notes) {
      const wave = oscillator(track.instrument, 440 * 2 ** ((note.pitch - 69) / 12));
      const start = Math.round(note.start_tick * secondsPerTick * rate);
      const duration = note.duration_ticks * secondsPerTick;
      const end = Math.min(size, start + Math.ceil((duration + release) * rate));
      const amplitude = gain * note.velocity / 100;
      for (let i = start; i < end; i++) {
        const time = (i - start) / rate;
        const envelope = Math.min(1, time / attack, (duration + release - time) / release);
        const value = amplitude * envelope * wave(time);
        channels[0][i] += value * left;
        channels[1][i] += value * right;
      }
    }
  }
  let peak = 0;
  const delayL = Math.round(rate * .093);
  const delayR = Math.round(rate * .129);
  for (let i = 0; i < size; i++) {
    if (echo && i >= delayR) {
      channels[0][i] += .115 * channels[1][i - delayL];
      channels[1][i] += .13 * channels[0][i - delayR];
    }
    const fade = Math.min(1, (size - 1 - i) / (rate * .025));
    channels[0][i] *= fade;
    channels[1][i] *= fade;
    peak = Math.max(peak, Math.abs(channels[0][i]), Math.abs(channels[1][i]));
  }
  if (peak < .002) throw new Error('再生できる音声を生成できませんでした。');
  const scale = .83 / peak;
  for (const channel of channels) for (let i = 0; i < size; i++) channel[i] *= scale;
  return { channels, rate };
}

export function encodeWav(channels, rate) {
  const frames = channels[0].length;
  const bytes = new ArrayBuffer(44 + 2 * frames * channels.length);
  const view = new DataView(bytes);
  const str = (offset, word) => [...word].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  view.setUint32(4, bytes.byteLength - 8, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels.length, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * channels.length * 2, true);
  view.setUint16(32, channels.length * 2, true);
  view.setUint16(34, 16, true);
  str(36, 'data');
  view.setUint32(40, bytes.byteLength - 44, true);
  let offset = 44;
  for (let i = 0; i < frames; i++) {
    for (const channel of channels) {
      view.setInt16(offset, Math.round(Math.max(-1, Math.min(1, channel[i])) * 32767), true);
      offset += 2;
    }
  }
  return bytes;
}

export function encodeMidi(ir) {
  const str = word => [...word].map(c => c.charCodeAt(0));
  const uint16 = n => [n >>> 8 & 255, n & 255];
  const uint32 = n => [n >>> 24, n >>> 16 & 255, n >>> 8 & 255, n & 255];
  const variable = value => {
    const bytes = [value & 127];
    for (let n = value >>> 7; n; n >>>= 7) bytes.unshift((n & 127) | 128);
    return bytes;
  };
  const chunk = events => [...str('MTrk'), ...uint32(events.length + 4), ...events, 0, 255, 47, 0];
  const tempo = Math.round(60e6 / ir.tempo_map[0].bpm);
  const bytes = [...str('MThd'), ...uint32(6), ...uint16(1), ...uint16(ir.tracks.length + 1), ...uint16(ir.ticks_per_quarter),
    ...chunk([0, 255, 81, 3, tempo >>> 16, tempo >>> 8 & 255, tempo & 255, 0, 255, 88, 4, 4, 2, 24, 8])];
  for (const [index, track] of ir.tracks.entries()) {
    const percussion = track.role === 'percussion';
    const channel = percussion ? 9 : index < 9 ? index : index + 1;
    const percussionNote = { sleigh: 54, 'chip-kick': 36, 'chip-noise': 42, ride: 51 };
    const events = track.notes.flatMap(note => {
      const pitch = percussion ? percussionNote[track.instrument] : note.pitch;
      return [[note.start_tick, 144 | channel, pitch, note.velocity],
        [note.start_tick + note.duration_ticks, 128 | channel, pitch, 0]];
    }).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const trackBytes = percussion ? [] : [0, 192 | channel, programs[track.instrument] ?? 0];
    let previous = 0;
    for (const [tick, ...event] of events) {
      trackBytes.push(...variable(tick - previous), ...event);
      previous = tick;
    }
    bytes.push(...chunk(trackBytes));
  }
  return Uint8Array.from(bytes).buffer;
}
