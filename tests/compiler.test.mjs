import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { compile } from '../dist/compiler.mjs';
import { demos, suggestDemo } from '../dist/demos.mjs';
import { STYLES, analyze, validate } from '../dist/music-ir.mjs';
import { getPastedUrl, loadAudio, resolveSource, resolveCommonsAudio, sliceAudio } from '../dist/sources.mjs';

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
      if (demo.bars) {
        assert.equal(source.tempo_map[0].bpm, demo.bpm);
        assert.deepEqual(source.tracks[0].notes.map(note => note.pitch), demo.bars.flat());
      } else {
        assert.equal(source.meter[0].numerator, demo.beats ?? 4);
        assert.ok(source.tracks[0].notes.length >= 18);
        assert.deepEqual(source.tracks[0].notes.slice(0, 4).map(note => note.pitch), demo.score.slice(0, 4).map(([pitch]) => pitch));
      }
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
    const source = resolveSource(url, base);
    assert.equal(source.kind, 'youtube');
    assert.equal(source.id, 'dQw4w9WgXcQ');
    assert.equal(source.catalogId, null);
    assert.equal(new URL(source.watchUrl).hostname, url.includes('music.youtube.com') ? 'music.youtube.com' : 'www.youtube.com');
  }
  const linked = resolveSource('https://music.youtube.com/watch?v=nl3-k5GfYlw&si=tracking', base);
  assert.equal(linked.catalogId, 'ode-to-joy');
  assert.equal(linked.watchUrl, 'https://music.youtube.com/watch?v=nl3-k5GfYlw');
  assert.equal(suggestDemo('Frère Jacques (Instrumental)'), 'frere-jacques');
  assert.equal(suggestDemo('Jingle Bells Rock'), null);
  assert.throws(() => resolveSource('https://music.youtube.com/playlist?list=1234', base), /プレイリスト/);
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


test('an unregistered PCM melody with quiet accompaniment compiles by pitch', () => {
  const rate = 24000;
  const pitches = [63, 70, 68, 65, 74, 72, 68, 67];
  const samples = new Float32Array(rate * 5);
  for (let i = 0; i < samples.length; i++) {
    const time = i / rate;
    const index = Math.floor(time / .6);
    const phase = time - index * .6;
    if (index >= pitches.length || phase >= .48) continue;
    const envelope = Math.min(phase / .013, (.48 - phase) / .022, 1);
    const frequency = 440 * 2 ** ((pitches[index] - 69) / 12);
    samples[i] = envelope * (.54 * Math.sin(2 * Math.PI * frequency * phase) + .045 * Math.sin(2 * Math.PI * 98 * phase));
  }
  const result = compile({ channels: [samples], rate, source: { id: 'external-test' }, style: 'jazz' });
  assert.deepEqual(result.diagnostic.source.tracks[0].notes.map(note => note.pitch), pitches);
  assert.deepEqual(result.diagnostic.arrangement.tracks[0].notes, result.diagnostic.source.tracks[0].notes);
  checkWav(result.arranged, 5);
});

test('the selected excerpt is bounded and independent of the decoded buffer', () => {
  const pcm = Float32Array.from({ length: 700 }, (_, i) => i);
  const decoded = { sampleRate: 10, duration: 70, length: 700, numberOfChannels: 1, getChannelData: () => pcm };
  const clip = sliceAudio(decoded, 12);
  assert.equal(clip.offset_sec, 12);
  assert.equal(clip.channels[0].length, 300);
  assert.equal(clip.channels[0][0], 120);
  clip.channels[0][0] = -1;
  assert.equal(pcm[120], 120);
  assert.equal(sliceAudio(decoded, Infinity).channels[0].length, 20);
});


test('Commons resolution requires openly marked audio from the Wikimedia host', async () => {
  const base = 'https://example.com/studio/';
  const source = resolveSource('https://commons.wikimedia.org/wiki/File%3AFurElise.ogg', base);
  assert.equal(source.kind, 'commons');
  assert.equal(source.title, 'File:FurElise.ogg');
  const signal = new AbortController().signal;
  const oldFetch = globalThis.fetch;
  let license = 'Public domain';
  let url = 'https://upload.wikimedia.org/example.ogg';
  globalThis.fetch = async endpoint => {
    assert.equal(endpoint.searchParams.get('origin'), '*');
    assert.equal(endpoint.searchParams.get('titles'), source.title);
    return Response.json({ query: { pages: [{ imageinfo: [{ mime: 'application/ogg', url,
      extmetadata: { LicenseShortName: { value: license } } }] }] } });
  };
  try {
    assert.deepEqual(await resolveCommonsAudio(source, signal), { url, license });
    license = 'CC BY-ND 4.0';
    await assert.rejects(resolveCommonsAudio(source, signal), /確認できません/);
    license = 'Public domain';
    url = 'https://example.org/audio.ogg';
    await assert.rejects(resolveCommonsAudio(source, signal), /配信URL/);
  } finally {
    globalThis.fetch = oldFetch;
  }
});


test('paste accepts a single shared URL with optional track text', () => {
  const url = 'https://commons.wikimedia.org/wiki/File:FurElise.ogg';
  assert.equal(getPastedUrl(url), url);
  assert.equal(getPastedUrl('エリーゼのために\n<' + url + '>'), url);
  assert.equal(getPastedUrl(url + '\nhttps://example.com/other.ogg'), null);
  assert.equal(getPastedUrl('javascript:alert(1)'), null);
});
