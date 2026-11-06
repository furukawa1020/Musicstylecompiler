import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { compile } from '../dist/compiler.mjs';
import { demos } from '../dist/demos.mjs';
import { STYLES, analyze, validate } from '../dist/music-ir.mjs';
import { loadAudio, resolveSource } from '../dist/sources.mjs';

const decoder = new TextDecoder();
const fingerprint = buffer => createHash('sha256').update(Buffer.from(buffer)).digest('hex');

function checkWav(buffer, duration) {
  const view = new DataView(buffer);
  assert.equal(decoder.decode(buffer.slice(0, 4)), 'RIFF');
  assert.equal(decoder.decode(buffer.slice(8, 12)), 'WAVE');
  assert.equal(view.getUint32(4, true), buffer.byteLength - 8);
  const frames = (buffer.byteLength - 44) / (view.getUint16(22, true) * 2);
  assert.ok(Math.abs(frames / view.getUint32(24, true) - duration) < .001);
  let peak = 0, sum = 0;
  for (let offset = 44; offset < buffer.byteLength; offset += 2) {
    const amplitude = view.getInt16(offset, true) / 32767;
    peak = Math.max(peak, Math.abs(amplitude));
    sum += amplitude ** 2;
  }
  assert.ok(peak > .2 && peak < .95);
  assert.ok(Math.sqrt(sum / ((buffer.byteLength - 44) / 2)) > .015);
}

for (const [id, demo] of Object.entries(demos)) {
  test(id + ' PCM → 採譜 → 4スタイル → WAV / MIDI', () => {
    const hashes = new Set();
    for (const style of Object.keys(STYLES)) {
      const stages = [];
      const result = compile({ demo: id, source: { id, license_ref: 'CC0-1.0' }, style }, step => stages.push(step));
      assert.deepEqual(stages, ['analyzing', 'transcribing', 'arranging', 'rendering']);
      const { source, arrangement } = result.diagnostic;
      assert.equal(source.tempo_map[0].bpm, demo.bpm);
      assert.deepEqual(source.tracks[0].notes.map(note => note.pitch), demo.bars.flat());
      assert.deepEqual(arrangement.tracks[0].notes, source.tracks[0].notes);
      assert.deepEqual(arrangement.sections, source.sections);
      assert.equal(arrangement.tracks[0].instrument, STYLES[style].lead);
      assert.ok(arrangement.tracks.length >= 4);
      assert.ok(arrangement.provenance.passes.length >= 4);
      checkWav(result.original, demo.duration);
      checkWav(result.arranged, demo.duration);
      assert.notEqual(fingerprint(result.original), fingerprint(result.arranged));
      hashes.add(fingerprint(result.arranged));
      assert.equal(decoder.decode(result.midi.slice(0, 4)), 'MThd');
      assert.equal(new DataView(result.midi).getUint16(10), arrangement.tracks.length + 1);
      validate(arrangement);
      arrangement.tracks[0].notes[0].duration_ticks = 0;
      assert.throws(() => validate(arrangement), /ノート範囲/);
    }
    assert.equal(hashes.size, 4);
  });
}

test('silence fails before arrangement', () => {
  assert.throws(() => analyze(new Float32Array(24000), 24000), /無音/);
});

test('catalog, direct audio and YouTube links are classified separately', () => {
  const base = 'https://example.com/studio/';
  assert.equal(resolveSource(base + '?demo=paper-kite', base).id, 'paper-kite');
  assert.equal(resolveSource('https://songs.example.com/track.wav', base).kind, 'audio');
  for (const url of ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'https://youtu.be/dQw4w9WgXcQ', 'https://music.youtube.com/watch?v=dQw4w9WgXcQ', 'https://www.youtube.com/shorts/dQw4w9WgXcQ']) {
    assert.deepEqual(resolveSource(url, base), { kind: 'youtube', id: 'dQw4w9WgXcQ', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' });
  }
  assert.throws(() => resolveSource('https://r1.googlevideo.com/sample.wav', base), /YouTube/);
  assert.throws(() => resolveSource('https://www.youtube.googleapis.com/sample.wav', base), /YouTube/);
  assert.throws(() => resolveSource('https://drive.google.com/file/d/abc/view', base), /Google Drive/);
  assert.throws(() => resolveSource('http://songs.example.com/track.wav', base), /HTTPS/);
  assert.throws(() => resolveSource('https://user:pass@songs.example.com/track.wav', base), /認証情報/);
  assert.throws(() => resolveSource(base + '?demo=toString', base), /見つかりません/);
});

test('audio resolver enforces response type before decoding', async () => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.equal(options.redirect, 'error');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.referrerPolicy, 'no-referrer');
    return new Response('<html>not audio</html>', { headers: { 'content-type': 'text/html' } });
  };
  try {
    await assert.rejects(loadAudio({ url: 'https://songs.example.com/page' }, new AbortController().signal), /直接返すURL/);
  } finally {
    globalThis.fetch = oldFetch;
  }
});
