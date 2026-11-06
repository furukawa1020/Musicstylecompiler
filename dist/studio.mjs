import { STYLES } from './music-ir.mjs';
import { demos, suggestDemo } from './demos.mjs';
import { resolveSource, loadAudio, loadFile, resolveCommonsAudio, sliceAudio, youtubeMetadata } from './sources.mjs';

const themes = {
  christmas: ['冬の音楽郵便', 'チェレスタ、スレイベル、あたたかな弦', '収録曲'],
  chip: ['SOUND SELECT', 'パルス波と三角波のゲーム音源', '曲を選ぶ'],
  jazz: ['SESSION / 03', 'リード、ウォーキングベース、スウィング', 'セッション曲目'],
  classical: ['室内楽演奏会', 'ヴァイオリン、チェロ、木管', 'プログラム'],
};
const stages = ['analyzing', 'transcribing', 'arranging', 'rendering'];
const statusText = {
  idle: '編曲すると、ここで原曲と聴き比べられます。',
  queued: '編曲を準備しています…', analyzing: '音声から旋律の候補を解析中…',
  transcribing: 'テンポ・調性を推定し、旋律を採譜中…', arranging: 'スタイルに合わせて伴奏を編曲中…',
  rendering: '楽器を合成し、試聴用の音声を生成中…', canceled: '編曲を中止しました。もう一度実行できます。',
};
const $ = id => document.getElementById(id);
const presetButtons = [...document.querySelectorAll('[data-preset]')];
const demoButtons = new Map();
const mixButtons = [...document.querySelectorAll('[data-mix]')];
const player = $('player');
const urlInput = $('source-url');
const fileInput = $('audio-file');
const clipStart = $('clip-start');
const shareHome = new URL('./', location.href);
let selectedStyle = 'christmas';
let source = null;
let decoded = null;
let commonsLicense = null;
let suggestionId = null;
let urlTimer = null;
let run = null;
let metadata = null;
let output = null;
let mix = 'arranged';

const demoLink = id => {
  const url = new URL(shareHome);
  url.searchParams.set('demo', id);
  return url.href;
};
const duration = seconds => {
  const n = Math.round(seconds);
  return Math.floor(n / 60) + ':' + String(n % 60).padStart(2, '0');
};

const catalogId = item => item?.kind === 'demo' ? item.id : item?.catalogId;
const canCompile = item => Boolean(catalogId(item)) || item?.kind === 'audio' || item?.kind === 'commons' || item?.kind === 'file';

function updateControls() {
  $('compile').disabled = !canCompile(source) || Boolean(run);
  $('cancel').hidden = !run;
  $('compile-label').textContent = STYLES[selectedStyle].label + ' に編曲';
  clipStart.disabled = Boolean(run);
}

function jobStatus(state, detail = statusText[state]) {
  $('job-message').textContent = detail;
  $('job-message').dataset.error = String(state === 'failed');
  const active = stages.indexOf(state);
  for (const [index, step] of [...$('stages').children].entries()) {
    step.dataset.state = state === 'completed' || (active >= 0 && index < active) ? 'done' : index === active ? 'active' : '';
    if (index === active) step.setAttribute('aria-current', 'step');
    else step.removeAttribute('aria-current');
  }
}

function stopRun() {
  if (!run) return;
  run.controller.abort();
  run.worker?.terminate();
  clearTimeout(run.timeout);
  run = null;
  updateControls();
}

function clearResult() {
  player.pause();
  player.onloadedmetadata = null;
  player.removeAttribute('src');
  player.load();
  if (output) for (const url of Object.values(output)) URL.revokeObjectURL(url);
  output = null;
  for (const id of ['wav', 'midi', 'ir']) $(id).removeAttribute('href');
  $('result').hidden = true;
}

function pickStyle(style) {
  const changed = style !== selectedStyle;
  const recompile = changed && source?.kind === 'youtube' && source.catalogId && (output || run);
  if (changed) {
    stopRun();
    clearResult();
    jobStatus('idle');
  }
  selectedStyle = style;
  const [kicker, copy, heading] = themes[style];
  document.documentElement.dataset.style = style;
  $('hero-kicker').textContent = kicker;
  $('headline').textContent = STYLES[style].label;
  $('hero-copy').textContent = copy;
  $('library-heading').textContent = heading;
  $('hero-art').src = './art/' + style + '.svg';
  presetButtons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.preset === style)));
  updateControls();
  if (recompile) startCompile();
}

function sourceStatus(message = '', error = false) {
  $('source-message').textContent = message;
  $('source-message').dataset.error = String(error);
}

function updateClip() {
  const length = decoded?.duration ?? 0;
  $('clip-panel').hidden = length <= 30;
  if (length <= 30) return;
  clipStart.max = String(Math.ceil(length - 30));
  const start = Number(clipStart.value);
  $('clip-time').textContent = duration(start) + ' – ' + duration(Math.min(start + 30, length));
  clipStart.setAttribute('aria-valuetext', $('clip-time').textContent);
}

function setSource(next) {
  metadata?.abort();
  metadata = null;
  stopRun();
  clearResult();
  jobStatus('idle');
  sourceStatus();
  source = next;
  decoded = null;
  commonsLicense = null;
  suggestionId = null;
  clipStart.value = '0';
  updateClip();
  $('suggestion').hidden = true;
  $('source-details').hidden = !next;
  $('watch-link').hidden = !['youtube', 'commons'].includes(next?.kind);
  $('copy-link').hidden = next?.kind !== 'demo';
  $('youtube-preview').hidden = true;
  $('youtube-preview').open = false;
  $('youtube-frame').replaceChildren();
  for (const [id, button] of demoButtons) button.setAttribute('aria-pressed', String(catalogId(next) === id));

  const demo = demos[catalogId(next)];
  if (demo) {
    $('track-title').textContent = demo.title;
    $('track-meta').textContent = demo.credit + ' / ' + duration(demo.duration) + ' / 収録音源';
  } else if (['audio', 'file', 'commons'].includes(next?.kind)) {
    let title = next.title;
    if (next.kind === 'audio') {
      try { title = decodeURIComponent(title); } catch { /* Keep the original URL label. */ }
    }
    $('track-title').textContent = title.replace(/^File:/, '').replaceAll('_', ' ');
    $('track-meta').textContent = (next.host ?? '端末内のファイル') + ' / 30秒ずつ編曲';
    if (next.kind === 'commons') $('watch-link').href = next.url;
    if (next.kind === 'file') sourceStatus('音源は端末から送信されません。');
  } else if (next?.kind === 'youtube') {
    $('track-title').textContent = 'YouTube の曲';
    $('track-meta').textContent = 'リンクの曲情報を読み込み中…';
  }

  if (next?.kind === 'youtube') {
    $('watch-link').href = next.watchUrl;
    $('youtube-preview').hidden = false;
    if (demo) sourceStatus('同じ曲の収録音源で編曲します。リンク先とは別の演奏です。');
    else {
      sourceStatus('このリンクで編曲に使える音源を確認できません。リンク元の試聴はできます。');
      metadata = new AbortController();
      const current = metadata;
      const timer = setTimeout(() => current.abort(), 5000);
      youtubeMetadata(next, current.signal).then(({ title, channel }) => {
        if (source !== next) return;
        if (title) $('track-title').textContent = title;
        $('track-meta').textContent = channel || 'YouTube / プレビュー';
        suggestionId = title ? suggestDemo(title) : null;
        if (suggestionId) {
          $('suggestion').textContent = '同名の収録曲「' + demos[suggestionId].title + '」を編曲する';
          $('suggestion').hidden = false;
        }
      }).catch(() => {
        if (source === next) $('track-meta').textContent = 'YouTube / プレビュー';
      }).finally(() => clearTimeout(timer));
    }
  }
  updateControls();
}

function selectDemo(id, fillInput = true) {
  const url = demoLink(id);
  if (fillInput) urlInput.value = url;
  setSource({ kind: 'demo', id, url });
}

function openUrl(value, autoCompile = true) {
  clearTimeout(urlTimer);
  try {
    const next = resolveSource(value.trim(), location.href);
    setSource(next);
    if (autoCompile && canCompile(next)) startCompile();
  } catch (error) {
    setSource(null);
    sourceStatus(error.message, true);
  }
}

function selectFile(file) {
  if (!file) return;
  clearTimeout(urlTimer);
  urlInput.value = '';
  setSource({ kind: 'file', file, title: file.name });
  startCompile();
}

function chooseMix(next, resume = false, position = 0) {
  if (!output) return;
  mix = next;
  mixButtons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.mix === mix)));
  player.onloadedmetadata = () => {
    if (position > 0 && Number.isFinite(player.duration)) player.currentTime = Math.min(position, player.duration);
    if (resume) player.play().catch(() => {});
    player.onloadedmetadata = null;
  };
  player.src = output[mix];
  player.load();
}

function showResult(result, style, start) {
  clearResult();
  const file = (data, mime) => URL.createObjectURL(new Blob([data], { type: mime }));
  output = {
    original: file(result.original, 'audio/wav'),
    arranged: file(result.arranged, 'audio/wav'),
    midi: file(result.midi, 'audio/midi'),
    ir: file(JSON.stringify(result.diagnostic, null, 2), 'application/json'),
  };
  for (const [id, key, extension] of [['wav', 'arranged', 'wav'], ['midi', 'midi', 'mid'], ['ir', 'ir', 'json']]) {
    $(id).href = output[key];
    $(id).download = 'music-style-' + style + '.' + extension;
  }
  const ir = result.diagnostic.source;
  const bpm = ir.tempo_map[0];
  $('player-style').textContent = STYLES[style].label;
  $('original-label').textContent = catalogId(source) ? '収録音源' : '入力音源';
  $('result').hidden = false;
  chooseMix('arranged');
  jobStatus('completed', '編曲完了 / ' + duration(ir.duration_sec) + ' / ' + (bpm.confidence === 0 ? 'BPM ' : '推定BPM ') + bpm.bpm
    + ' / ' + ir.tracks[0].notes.length + '音 / ' + ((performance.now() - start) / 1000).toFixed(1) + '秒');
}

async function startCompile() {
  const next = source;
  if (!canCompile(next) || run) return;
  clearResult();
  const style = selectedStyle;
  const started = performance.now();
  const task = { controller: new AbortController(), worker: null, timeout: null };
  run = task;
  updateControls();
  jobStatus('queued');
  const fail = message => {
    if (run !== task) return;
    stopRun();
    jobStatus('failed', message);
  };
  try {
    let payload;
    const id = catalogId(next);
    if (id) {
      const provenance = next.kind === 'youtube' ? { selected_via: 'youtube-video-id', linked_video_id: next.id } : {};
      payload = { demo: id, source: { id, provider: 'catalog', license_ref: 'CC0-1.0', ...provenance }, style };
    } else {
      const local = next.kind === 'file';
      const commons = next.kind === 'commons';
      if (!decoded) {
        jobStatus('queued', local ? '端末の音声を開いています…' : 'URLから音声を読み込み中…');
        task.timeout = setTimeout(() => fail('音声の読み込みが時間切れになりました。短い音声で再試行してください。'), 24000);
        const signal = task.controller.signal;
        const remote = commons ? await resolveCommonsAudio(next, signal) : next;
        const buffer = await (local ? loadFile(next.file, signal) : loadAudio(remote, signal));
        clearTimeout(task.timeout);
        if (run !== task) return;
        decoded = buffer;
        if (commons) {
          commonsLicense = remote.license;
          $('track-meta').textContent = 'Wikimedia Commons / ' + commonsLicense + ' / ' + duration(decoded.duration);
        }
        updateClip();
      }
      const data = sliceAudio(decoded, clipStart.value);
      const provider = local ? 'local-file' : commons ? 'wikimedia-commons' : 'direct-audio';
      payload = { channels: data.channels, rate: data.rate,
        source: { id: provider, provider, offset_sec: data.offset_sec,
          ...(commons ? { license_ref: commonsLicense, public_source_url: next.url } : {}) }, style };
    }
    if (run !== task) return;
    const worker = new Worker(new URL('./compiler-worker.mjs', import.meta.url), { type: 'module' });
    task.worker = worker;
    task.timeout = setTimeout(() => fail('編曲が時間切れになりました。短い音声で再試行してください。'), 45000);
    worker.onmessage = ({ data }) => {
      if (run !== task) return;
      if (data.stage) jobStatus(data.stage);
      else if (data.error) fail(data.error);
      else if (data.result) {
        stopRun();
        showResult(data.result, style, started);
      }
    };
    worker.onerror = () => fail('編曲エンジンを起動できませんでした。ページを再読み込みしてお試しください。');
    worker.postMessage(payload, payload.channels?.map(channel => channel.buffer) ?? []);
  } catch (error) {
    fail(error.message || '編曲に失敗しました。もう一度お試しください。');
  }
}

presetButtons.forEach(button => button.addEventListener('click', () => pickStyle(button.dataset.preset)));
for (const [index, [id, demo]] of Object.entries(demos).entries()) {
  const row = document.createElement('li');
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.demo = id;
  button.setAttribute('aria-pressed', 'false');
  const number = document.createElement('span');
  number.className = 'track-number';
  number.textContent = String(index + 1).padStart(2, '0');
  number.setAttribute('aria-hidden', 'true');
  const name = document.createElement('span');
  name.className = 'track-name';
  const title = document.createElement('strong');
  title.textContent = demo.title;
  const credit = document.createElement('small');
  credit.textContent = demo.credit;
  name.append(title, credit);
  const length = document.createElement('span');
  length.className = 'track-duration';
  length.textContent = duration(demo.duration);
  button.append(number, name, length);
  button.addEventListener('click', () => selectDemo(id));
  row.append(button);
  $('track-list').append(row);
  demoButtons.set(id, button);
}
$('track-count').textContent = Object.keys(demos).length + ' 曲';

const examples = [
  ['ジングルベル · YouTube Music', 'https://music.youtube.com/watch?v=4b7dFqv94iI'],
  ['歓喜の歌 · YouTube Music', 'https://music.youtube.com/watch?v=nl3-k5GfYlw'],
  ['きらきら星 · YouTube Music', 'https://music.youtube.com/watch?v=uzu-pSlOS8w'],
  ['エリーゼのために · Wikimedia Commons', 'https://commons.wikimedia.org/wiki/File:FurElise.ogg'],
];
for (const [label, url] of examples) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'text-button';
  button.textContent = label;
  button.addEventListener('click', () => {
    urlInput.value = url;
    openUrl(url);
  });
  $('example-links').append(button);
}

mixButtons.forEach(button => button.addEventListener('click', () => {
  if (mix !== button.dataset.mix) chooseMix(button.dataset.mix, !player.paused, player.currentTime);
}));
urlInput.addEventListener('paste', event => {
  const value = event.clipboardData?.getData('text').trim();
  if (!value || !/^https?:\/\/\S+$/i.test(value)) return;
  event.preventDefault();
  urlInput.value = value;
  openUrl(value);
});
urlInput.addEventListener('input', () => {
  clearTimeout(urlTimer);
  if (source) setSource(null);
  else sourceStatus();
  const value = urlInput.value.trim();
  if (/^https:\/\/(?:music\.youtube\.com|(?:www\.|m\.)?youtube\.com|youtu\.be)\//i.test(value)) {
    urlTimer = setTimeout(() => openUrl(value), 320);
  }
});
$('source-form').addEventListener('submit', event => {
  event.preventDefault();
  openUrl(urlInput.value);
});
$('copy-link').addEventListener('click', async () => {
  const url = source?.url;
  if (!url) return;
  try {
    await navigator.clipboard.writeText(url);
    sourceStatus('収録曲のURLをコピーしました。');
  } catch {
    urlInput.value = url;
    urlInput.select();
    sourceStatus('選択したURLをコピーしてください。');
  }
});
$('suggestion').addEventListener('click', () => {
  if (!suggestionId) return;
  selectDemo(suggestionId, false);
  sourceStatus('同名の収録曲を選びました。演奏は収録音源です。');
  startCompile();
});
$('youtube-preview').addEventListener('toggle', event => {
  if (!event.target.open || source?.kind !== 'youtube' || $('youtube-frame').firstChild) return;
  const frame = document.createElement('iframe');
  frame.title = 'YouTube公式プレビュー';
  frame.src = 'https://www.youtube-nocookie.com/embed/' + source.id;
  frame.allowFullscreen = true;
  $('youtube-frame').append(frame);
});
fileInput.addEventListener('change', () => {
  selectFile(fileInput.files[0]);
  fileInput.value = '';
});
const sourcePanel = document.querySelector('.source-panel');
sourcePanel.addEventListener('dragover', event => {
  if (!event.dataTransfer.types.includes('Files')) return;
  event.preventDefault();
  sourcePanel.dataset.drop = 'true';
});
sourcePanel.addEventListener('dragleave', event => {
  if (!sourcePanel.contains(event.relatedTarget)) delete sourcePanel.dataset.drop;
});
sourcePanel.addEventListener('drop', event => {
  if (!event.dataTransfer.files.length) return;
  event.preventDefault();
  delete sourcePanel.dataset.drop;
  selectFile(event.dataTransfer.files[0]);
});
clipStart.addEventListener('input', () => {
  clearResult();
  updateClip();
  jobStatus('idle', '開始位置を変更しました。「編曲」を押すとこの範囲を処理します。');
});
$('compile').addEventListener('click', startCompile);
$('cancel').addEventListener('click', () => { stopRun(); jobStatus('canceled'); });

const requestedDemo = new URL(location.href).searchParams.get('demo');
if (requestedDemo && Object.hasOwn(demos, requestedDemo)) selectDemo(requestedDemo);
else selectDemo('winter-postcard', false);
pickStyle('christmas');
