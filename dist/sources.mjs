import { demos, youtubeCatalog } from './demos.mjs?v=moon-1';
import { MAX_SECONDS } from './music-ir.mjs?v=moon-1';

const youtubeHosts = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be',
  'www.youtu.be', 'youtube-nocookie.com', 'www.youtube-nocookie.com']);
const isYouTubeAudioHost = host => /(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com|googlevideo\.com|youtubei\.googleapis\.com|youtube\.googleapis\.com|ytimg\.com)$/.test(host);
const maxBytes = 12 * 1024 * 1024;
const maxLocalBytes = 32 * 1024 * 1024;
const maxDuration = 8 * 60;

export function getPastedUrl(value) {
  const matches = value.match(/https?:\/\/[^\s<>"「」]+/gi);
  return matches?.length === 1 ? matches[0] : null;
}

export function resolveSource(value, base) {
  let url;
  try { url = new URL(value); } catch { throw new Error('https:// から始まる曲のURLを入力してください。'); }
  if (url.username || url.password) throw new Error('認証情報を含むURLは利用できません。');
  const home = new URL('./', base);
  const ownPage = url.origin === home.origin && [home.pathname, home.pathname + 'index.html'].includes(url.pathname);
  if (ownPage && url.searchParams.has('demo')) {
    const id = url.searchParams.get('demo');
    if (!Object.hasOwn(demos, id)) throw new Error('このデモ曲は見つかりません。');
    return { kind: 'demo', id, url: url.href };
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && url.origin === home.origin)) {
    throw new Error('HTTPSの音声URLを指定してください。');
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (youtubeHosts.has(host)) {
    const [, route, segment] = url.pathname.split('/');
    const id = host.endsWith('youtu.be') ? route : route === 'watch' ? url.searchParams.get('v')
      : ['shorts', 'embed', 'live'].includes(route) ? segment : null;
    if (!id || !/^[\w-]{11}$/.test(id)) throw new Error('アルバムやプレイリストでは、曲を開いてから「共有」で1曲のURLをコピーしてください。');
    return { kind: 'youtube', id, url: 'https://www.youtube.com/watch?v=' + id,
      watchUrl: host === 'music.youtube.com' ? 'https://music.youtube.com/watch?v=' + id : 'https://www.youtube.com/watch?v=' + id,
      catalogId: Object.hasOwn(youtubeCatalog, id) ? youtubeCatalog[id] : null };
  }
  if (host === 'commons.wikimedia.org' && /^\/wiki\/File(?::|%3a)/i.test(url.pathname)) {
    let title;
    try { title = decodeURIComponent(url.pathname.slice('/wiki/'.length)); }
    catch { throw new Error('Wikimedia CommonsのファイルURLを確認してください。'); }
    return { kind: 'commons', title, url: 'https://commons.wikimedia.org/wiki/' + encodeURIComponent(title), host };
  }
  if (isYouTubeAudioHost(host)) throw new Error('YouTubeの音声URLは利用できません。動画URLを指定するとプレビューできます。');
  if (/(^|\.)drive\.google\.com$/.test(host)) throw new Error('Google Driveの共有ページはこの版では読み込めません。直接再生できる音声URLか、デモ曲を選んでください。');
  if (/(^|\.)jamendo\.com$/.test(host)) throw new Error('Jamendoの曲ページはこの版では読み込めません。編曲許諾のある直接音声URLか、デモ曲を選んでください。');
  return { kind: 'audio', url: url.href, title: url.pathname.split('/').filter(Boolean).at(-1) ?? url.hostname, host };
}

export async function resolveCommonsAudio(source, signal) {
  const endpoint = new URL('https://commons.wikimedia.org/w/api.php');
  endpoint.search = new URLSearchParams({ action: 'query', prop: 'imageinfo', iiprop: 'url|mime|extmetadata',
    titles: source.title, format: 'json', formatversion: '2', origin: '*' });
  const response = await fetch(endpoint, { signal, credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error' });
  if (!response.ok) throw new Error('Wikimedia Commonsのファイル情報を取得できませんでした。');
  const info = (await response.json()).query?.pages?.[0]?.imageinfo?.[0];
  if (!info || !/^audio\/|^application\/ogg$/i.test(info.mime)) throw new Error('Wikimedia Commonsの音声ファイルページを指定してください。');
  const license = info.extmetadata?.LicenseShortName?.value?.trim();
  if (!['CC0', 'CC0 1.0', 'Public domain', 'PDM'].includes(license)) {
    throw new Error('このファイルは収録音声のCC0またはパブリックドメイン表示を確認できませんでした。');
  }
  const url = new URL(info.url);
  if (url.protocol !== 'https:' || url.hostname !== 'upload.wikimedia.org') throw new Error('Wikimediaの配信URLを確認できませんでした。');
  return { url: url.href, license };
}

export async function loadAudio(source, signal) {
  let response;
  try {
    response = await fetch(source.url, { signal, credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer' });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new Error('音声を読み込めませんでした。リダイレクトせず、ブラウザから読み込める（CORS対応の）直接URLをお試しください。');
  }
  if (!response.ok) throw new Error('音声の読み込みに失敗しました（HTTP ' + response.status + '）。');
  const mime = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ?? '';
  if (!mime.startsWith('audio/') && !['application/ogg', 'application/octet-stream', 'video/mp4'].includes(mime)) {
    throw new Error('音声ファイルを直接返すURLを指定してください。');
  }
  if (Number(response.headers.get('content-length')) > maxBytes) throw new Error('12 MB以下の音源を指定してください。');
  if (!response.body) throw new Error('空の音声データが返されました。');
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > maxBytes) {
        await reader.cancel();
        throw new Error('12 MB以下の音源を指定してください。');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return decodeAudio(bytes.buffer, new Blob(chunks, { type: mime }), signal);
}

export async function loadFile(file, signal) {
  if (!file.size) throw new Error('空のファイルです。別の音声ファイルを選んでください。');
  if (file.size > maxLocalBytes) throw new Error('32 MB以下の音声ファイルを選んでください。');
  return decodeAudio(await file.arrayBuffer(), file, signal);
}

function checkMediaLength(file, signal) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const audio = new Audio();
    const url = URL.createObjectURL(file);
    const finish = error => {
      clearTimeout(timeout);
      signal.removeEventListener('abort', abort);
      audio.onloadedmetadata = null;
      audio.onerror = null;
      audio.removeAttribute('src');
      audio.load();
      URL.revokeObjectURL(url);
      if (error) reject(error);
      else resolve();
    };
    const abort = () => finish(signal.reason);
    const timeout = setTimeout(() => finish(new Error('音声の長さを確認できませんでした。WAV / MP3 / M4A / Ogg をお試しください。')), 6000);
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => {
      if (!Number.isFinite(audio.duration) || audio.duration > maxDuration) finish(new Error('8分以内の音声を指定してください。'));
      else if (audio.duration < 2) finish(new Error('2秒以上の音源を指定してください。'));
      else finish();
    };
    audio.onerror = () => finish(new Error('この音声形式を読み込めません。WAV / MP3 / M4A / Ogg をお試しください。'));
    signal.addEventListener('abort', abort, { once: true });
    audio.src = url;
  });
}

async function decodeAudio(bytes, file, signal) {
  await checkMediaLength(file, signal);
  const context = new OfflineAudioContext(1, 1, 24000);
  let buffer;
  try { buffer = await context.decodeAudioData(bytes); }
  catch { throw new Error('この音源をデコードできませんでした。ブラウザ対応の WAV / MP3 / M4A / Ogg をお試しください。'); }
  signal.throwIfAborted();
  if (buffer.duration < 2 || buffer.duration > maxDuration) throw new Error('2秒から8分までの音声を指定してください。');
  return buffer;
}

export function sliceAudio(buffer, start) {
  const rate = buffer.sampleRate;
  const maxOffset = Math.max(0, buffer.duration - 2);
  const from = Math.round(Math.min(maxOffset, Math.max(0, Number(start) || 0)) * rate);
  const to = Math.min(buffer.length, from + MAX_SECONDS * rate);
  const channels = Array.from({ length: Math.min(2, buffer.numberOfChannels) }, (_, i) => buffer.getChannelData(i).slice(from, to));
  return { channels, rate, offset_sec: from / rate };
}

export async function youtubeMetadata(source, signal) {
  const endpoint = new URL('https://www.youtube.com/oembed');
  endpoint.search = new URLSearchParams({ url: source.url, format: 'json' });
  const response = await fetch(endpoint, { credentials: 'omit', referrerPolicy: 'no-referrer', signal });
  if (!response.ok) throw new Error('メタデータを取得できませんでした。');
  const { title, author_name } = await response.json();
  return { title: typeof title === 'string' ? title : '', channel: typeof author_name === 'string' ? author_name : '' };
}
