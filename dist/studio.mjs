import { STYLES } from './music-ir.mjs';
import { demos } from './demos.mjs';
import { resolveSource, loadAudio, youtubeMetadata } from './sources.mjs';

const themes = {
  christmas: ['01', 'THE HOLIDAY SESSIONS', 'いつもの曲に、冬のきらめきを。', 'チェレスタの旋律、スレイベルの刻み、あたたかな弦。街に灯りがともるようなアレンジに。', 'CELESTA & SLEIGH BELLS'],
  chip: ['02', 'CARTRIDGE SOUND LAB', 'あの曲を、カセットの中へ。', 'パルス波のメロディに、三角波の低音と高速アルペジオ。レトロゲームのステージを駆ける音へ。', 'PULSE WAVE & ARPEGGIO'],
  jazz: ['03', 'LATE NIGHT SESSIONS', '夜更けの一曲に、スウィングを。', 'リードの旋律、ウォーキングベース、7thコード。小さなジャズクラブのセッションへ。', 'REED & WALKING BASS'],
  classical: ['04', 'THE CHAMBER SERIES', '聴き慣れた旋律を、弦と木管で。', 'ヴァイオリンの旋律をチェロが支え、フルートが応える。室内オーケストラの編成へ。', 'STRINGS & WOODWINDS'],
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
const demoButtons = [...document.querySelectorAll('[data-demo]')];
const mixButtons = [...document.querySelectorAll('[data-mix]')];
const player = $('player');
const urlInput = $('source-url');
const permission = $('permission');
const shareHome = new URL('./', location.href);
let selectedStyle = 'christmas';
let source = null;
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

function updateControls() {
  const ready = source?.kind === 'demo' || (source?.kind === 'audio' && permission.checked);
  $('compile').disabled = !ready || Boolean(run);
  $('cancel').hidden = !run;
  $('compile-label').textContent = STYLES[selectedStyle].label + ' に編曲';
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
  if (style !== selectedStyle) {
    stopRun();
    clearResult();
    jobStatus('idle');
  }
  selectedStyle = style;
  const [index, kicker, tagline, copy, caption] = themes[style];
  document.documentElement.dataset.style = style;
  $('hero-index').textContent = index + ' / 04';
  $('hero-kicker').textContent = kicker;
  $('headline').textContent = STYLES[style].label;
  $('hero-tagline').textContent = tagline;
  $('hero-copy').textContent = copy;
  $('hero-art').src = './art/' + style + '.svg';
  $('hero-caption').textContent = 'FIG. ' + index + ' — ' + caption;
  presetButtons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.preset === style)));
  updateControls();
}

function sourceStatus(message = '', error = false) {
  $('source-message').textContent = message;
  $('source-message').dataset.error = String(error);
}

function setSource(next) {
  metadata?.abort();
  metadata = null;
  stopRun();
  clearResult();
  jobStatus('idle');
  sourceStatus();
  source = next;
  permission.checked = false;
  $('permission-row').hidden = next?.kind !== 'audio';
  $('source-details').hidden = !next;
  $('watch-link').hidden = next?.kind !== 'youtube';
  $('copy-link').hidden = next?.kind !== 'demo';
  $('youtube-preview').hidden = true;
  $('youtube-preview').replaceChildren();
  demoButtons.forEach(button => button.setAttribute('aria-pressed', String(next?.kind === 'demo' && button.dataset.demo === next.id)));

  if (next?.kind === 'demo') {
    const demo = demos[next.id];
    $('track-title').textContent = demo.title;
    $('track-meta').textContent = 'オリジナルデモ / ' + duration(demo.duration) + ' / 編曲・書き出し可（CC0）';
  } else if (next?.kind === 'audio') {
    let title = next.title;
    try { title = decodeURIComponent(title); } catch { /* Keep the original URL label. */ }
    $('track-title').textContent = title;
    $('track-meta').textContent = next.host + ' / 最大30秒 / 権利の確認が必要';
    sourceStatus('権利の確認にチェックすると編曲できます。');
  } else if (next?.kind === 'youtube') {
    $('track-title').textContent = 'YouTube 動画';
    $('track-meta').textContent = 'YouTube / 動画のプレビュー';
    $('watch-link').href = next.url;
    sourceStatus('YouTubeの音声は編曲できません。許諾のある別の音声URLかデモ曲を選んでください。');
    const frame = document.createElement('iframe');
    frame.title = 'YouTube公式プレビュー';
    frame.src = 'https://www.youtube-nocookie.com/embed/' + next.id;
    frame.allowFullscreen = true;
    $('youtube-preview').append(frame);
    $('youtube-preview').hidden = false;
    metadata = new AbortController();
    const current = metadata;
    const timer = setTimeout(() => current.abort(), 5000);
    youtubeMetadata(next, current.signal).then(({ title, channel }) => {
      if (source !== next) return;
      if (title) $('track-title').textContent = title;
      if (channel) $('track-meta').textContent = 'YouTube / ' + channel;
    }).catch(() => {
      // The embedded player and original video link remain available when oEmbed is blocked.
    }).finally(() => clearTimeout(timer));
  }
  updateControls();
}

function selectDemo(id, fillInput = true) {
  const url = demoLink(id);
  if (fillInput) urlInput.value = url;
  setSource({ kind: 'demo', id, url });
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
  $('result').hidden = false;
  chooseMix('arranged');
  jobStatus('completed', '編曲完了 / ' + duration(ir.duration_sec) + ' / ' + (bpm.confidence === 0 ? 'BPM ' : '推定BPM ') + bpm.bpm
    + ' / ' + ir.tracks[0].notes.length + '音 / ' + ((performance.now() - start) / 1000).toFixed(1) + '秒');
}

async function startCompile() {
  const next = source;
  if (!next || run || (next.kind !== 'demo' && !(next.kind === 'audio' && permission.checked))) return;
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
    if (next.kind === 'demo') {
      payload = { demo: next.id, source: { id: next.id, provider: 'demo', license_ref: 'CC0-1.0' }, style };
    } else {
      jobStatus('queued', '指定されたURLから音声を読み込み中…');
      task.timeout = setTimeout(() => fail('音声の読み込みが時間切れになりました。短い音声で再試行してください。'), 18000);
      const data = await loadAudio(next, task.controller.signal);
      clearTimeout(task.timeout);
      payload = { ...data, source: { id: 'direct-audio', provider: 'direct-audio', license_ref: 'user-confirmed' }, style };
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
demoButtons.forEach(button => button.addEventListener('click', () => selectDemo(button.dataset.demo)));
mixButtons.forEach(button => button.addEventListener('click', () => {
  if (mix !== button.dataset.mix) chooseMix(button.dataset.mix, !player.paused, player.currentTime);
}));
urlInput.addEventListener('input', () => { if (source) setSource(null); else sourceStatus(); });
$('source-form').addEventListener('submit', event => {
  event.preventDefault();
  try { setSource(resolveSource(urlInput.value.trim(), location.href)); }
  catch (error) { setSource(null); sourceStatus(error.message, true); }
});
$('copy-link').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(source.url);
    sourceStatus('デモ曲のURLをコピーしました。');
  } catch {
    urlInput.value = source.url;
    urlInput.select();
    sourceStatus('選択したURLをコピーしてください。');
  }
});
permission.addEventListener('change', () => {
  if (!permission.checked) {
    stopRun();
    clearResult();
    jobStatus('idle');
  }
  $('track-meta').textContent = source.host + ' / 最大30秒 / ' + (permission.checked ? '利用・編曲の権利を確認済み（自己申告）' : '権利の確認が必要');
  sourceStatus(permission.checked ? '最初の30秒までをブラウザ内で編曲します。' : '権利の確認にチェックすると編曲できます。');
  updateControls();
});
$('compile').addEventListener('click', startCompile);
$('cancel').addEventListener('click', () => { stopRun(); jobStatus('canceled'); });

const requestedDemo = new URL(location.href).searchParams.get('demo');
if (requestedDemo && Object.hasOwn(demos, requestedDemo)) selectDemo(requestedDemo);
else selectDemo('winter-postcard', false);
pickStyle('christmas');
