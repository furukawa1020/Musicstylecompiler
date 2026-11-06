import { STYLES, TPQ } from './music-ir.mjs?v=moon-1';
import { demos, demoNotes } from './demos.mjs?v=moon-1';

const instruments = ['dry-piano', 'demo-keys', 'celesta', 'pulse', 'reed', 'violin', 'strings', 'pizz',
  'sleigh', 'soft-keys', 'bell', 'arp', 'triangle', 'chip-kick', 'chip-noise', 'jazz-keys', 'upright',
  'ride', 'cello', 'ensemble', 'flute'];
const percussion = new Set(['sleigh', 'chip-kick', 'chip-noise', 'ride']);
const names = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];

export function createCompiler({ exports: wasm }) {
  function resultBytes(address) {
    return new Uint8Array(wasm.memory.buffer, address, wasm.output_size()).slice().buffer;
  }

  function tracks(arranged, definition) {
    const notes = new Map();
    const lead = { id: 'lead', role: 'melody', instrument: arranged ? definition.lead : 'unknown', notes: [] };
    const count = wasm.note_count(arranged);
    const leadCount = wasm.note_count(0);
    for (let i = 0; i < count; i++) {
      const note = { pitch: wasm.note_field(arranged, i, 0), start_tick: wasm.note_field(arranged, i, 1),
        duration_ticks: wasm.note_field(arranged, i, 2), velocity: wasm.note_field(arranged, i, 3) };
      if (i < leadCount) {
        note.confidence = wasm.note_field(arranged, i, 4);
        lead.notes.push(note);
      } else {
        const instrument = instruments[wasm.note_field(arranged, i, 5)];
        if (!notes.has(instrument)) notes.set(instrument, { id: instrument, instrument,
          role: percussion.has(instrument) ? 'percussion' : 'accompaniment', notes: [] });
        notes.get(instrument).notes.push(note);
      }
    }
    return [lead, ...notes.values()];
  }

  function sourceIR(source, demo) {
    const root = wasm.info(5);
    const end = wasm.info(1);
    const chords = Array.from({ length: wasm.chord_count() }, (_, i) => {
      const base = wasm.chord_field(i, 0), third = wasm.chord_field(i, 1), fifth = wasm.chord_field(i, 2);
      return { root: base, third, fifth, seventh: wasm.chord_field(i, 3),
        symbol: names[base] + (fifth === 6 ? 'dim' : third === 3 ? 'm' : ''),
        start_tick: wasm.chord_field(i, 4), duration_ticks: wasm.chord_field(i, 5), confidence: wasm.chord_field(i, 6) };
    });
    return { schema_version: '0.1', kind: 'source', source, duration_sec: wasm.info(0), total_ticks: end,
      ticks_per_quarter: TPQ, tempo_map: [{ tick: 0, bpm: wasm.info(2), confidence: wasm.info(3) }],
      meter: [{ tick: 0, numerator: wasm.info(4), denominator: 4, assumed: !demo }],
      key: { root, tonic: names[root], mode: wasm.info(6) ? 'minor' : 'major', confidence: wasm.info(7) },
      sections: [{ kind: 'full-excerpt', start_tick: 0, end_tick: end }], tracks: tracks(0), chords,
      provenance: { analyzer: 'moonbit-wasm-acf', harmony: demo ? 'melody' : 'melody-and-audio-chroma',
        melody_band_emphasis: Boolean(wasm.info(8)), voiced_fraction: wasm.info(9) } };
  }

  return function compile({ channels, rate, demo, source, style }, onStage = () => {}) {
    const measurements = {};
    const stage = (name, action) => {
      onStage(name);
      const start = performance.now();
      const result = action();
      measurements[name] = Math.round(performance.now() - start);
      return result;
    };
    if (!Object.hasOwn(STYLES, style)) throw new Error('このスタイルは利用できません。');
    const definition = STYLES[style];
    stage('analyzing', () => {
      if (demo) {
        const track = demos[demo];
        const instrument = instruments.indexOf(track.instrument ?? 'dry-piano');
        for (const { pitch, start_tick, duration_ticks, velocity } of demoNotes(demo)) {
          wasm.add_demo_note(pitch, start_tick, duration_ticks, velocity, instrument);
        }
        if (!wasm.render_demo(track.duration, track.bpm)) throw new Error('収録曲の音声を生成できませんでした。');
      } else {
        const length = channels?.[0]?.length;
        if (!length || !Number.isInteger(rate) || !channels.every(channel => channel.length === length)) {
          throw new Error('音源のチャンネルまたは長さが不正です。');
        }
        const address = wasm.prepare_input(length, channels.length, rate);
        if (!address) throw new Error('30秒以内の音声を指定してください。');
        const view = new Float32Array(wasm.memory.buffer, address, length * channels.length);
        channels.forEach((channel, index) => view.set(channel, index * length));
      }
      if (!wasm.analyze(Number(Boolean(demo)))) {
        throw new Error('音源が無音か、音量が小さすぎます。旋律が聞こえる音源をお試しください。');
      }
    });
    const input = stage('transcribing', () => {
      if (!wasm.transcribe(demo ? demos[demo].beats ?? 4 : 0)) {
        throw new Error('安定した旋律を採譜できませんでした。メロディがはっきりした単音・少編成の音源をお試しください。');
      }
      return sourceIR(source, demo);
    });
    const arrangement = stage('arranging', () => {
      wasm.arrange(definition.id);
      return { ...input, kind: 'arrangement', style, tracks: tracks(1, definition),
        provenance: { ...input.provenance, compiler: 'moonbit-wasm', passes: definition.passes,
          preserved: ['melody.pitch', 'sections'] } };
    });
    const outputs = stage('rendering', () => {
      const original = resultBytes(wasm.render_original());
      const address = wasm.render();
      if (!address) throw new Error('再生できる音声を生成できませんでした。');
      return { original, arranged: resultBytes(address), midi: resultBytes(wasm.export_midi()) };
    });
    return { ...outputs, diagnostic: { source: input, arrangement, elapsed_ms: measurements } };
  };
}
