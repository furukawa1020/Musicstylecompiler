import { analyze, transcribe, arrange } from './music-ir.mjs';
import { render, encodeWav, encodeMidi } from './render.mjs';
import { demos, demoAudio } from './demos.mjs';

export function compile({ channels, rate, demo, source, style }, onStage = () => {}) {
  const measurements = {};
  const stage = (name, action) => {
    onStage(name);
    const start = performance.now();
    const result = action();
    measurements[name] = Math.round(performance.now() - start);
    return result;
  };
  const analysis = stage('analyzing', () => {
    if (demo) ({ channels, rate } = demoAudio(demo));
    const mono = new Float32Array(channels[0].length);
    for (const channel of channels) for (let i = 0; i < mono.length; i++) mono[i] += channel[i] / channels.length;
    const raw = analyze(mono, rate);
    if (demo) return raw;
    const voiced = raw.frames.filter(frame => frame.pitch !== null);
    const leadRange = voiced.filter(frame => frame.pitch >= 56).length;
    if (leadRange >= raw.frames.length * .32) return raw;
    const filtered = analyze(mono, rate, true);
    const improved = filtered.frames.filter(frame => frame.pitch >= 56).length;
    return improved > leadRange * 1.16 ? filtered : raw;
  });
  const input = stage('transcribing', () => transcribe(analysis, source, demo ? demos[demo].beats ?? 4 : undefined));
  const arrangement = stage('arranging', () => arrange(input, style));
  const outputs = stage('rendering', () => {
    const rendered = render(arrangement);
    return {
      original: encodeWav(channels, rate),
      arranged: encodeWav(rendered.channels, rendered.rate),
      midi: encodeMidi(arrangement),
    };
  });
  return { ...outputs, diagnostic: { source: input, arrangement, elapsed_ms: measurements } };
}
