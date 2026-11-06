import { demos } from './demos.mjs';
import { MAX_SECONDS } from './music-ir.mjs';

const youtubeHosts = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be',
  'www.youtu.be', 'youtube-nocookie.com', 'www.youtube-nocookie.com']);
const isYouTubeAudioHost = host => /(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com|googlevideo\.com|youtubei\.googleapis\.com|youtube\.googleapis\.com|ytimg\.com)$/.test(host);
const maxBytes = 12 * 1024 * 1024;

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
    if (!id || !/^[\w-]{11}$/.test(id)) throw new Error('YouTubeの個別の動画URLを指定してください。');
    return { kind: 'youtube', id, url: 'https://www.youtube.com/watch?v=' + id };
  }
  if (isYouTubeAudioHost(host)) throw new Error('YouTubeの音声URLは利用できません。動画URLを指定するとプレビューできます。');
  if (/(^|\.)drive\.google\.com$/.test(host)) throw new Error('Google Driveの共有ページはこの版では読み込めません。直接再生できる音声URLか、デモ曲を選んでください。');
  if (/(^|\.)jamendo\.com$/.test(host)) throw new Error('Jamendoの曲ページはこの版では読み込めません。編曲許諾のある直接音声URLか、デモ曲を選んでください。');
  return { kind: 'audio', url: url.href, title: url.pathname.split('/').filter(Boolean).at(-1) ?? url.hostname, host };
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
  const context = new OfflineAudioContext(1, 1, 24000);
  let buffer;
  try { buffer = await context.decodeAudioData(bytes.buffer); }
  catch { throw new Error('この音源をデコードできませんでした。ブラウザ対応の WAV / MP3 / M4A / Ogg をお試しください。'); }
  if (buffer.duration < 2) throw new Error('2秒以上の音源を指定してください。');
  const frames = Math.min(buffer.length, Math.round(MAX_SECONDS * buffer.sampleRate));
  const channels = Array.from({ length: Math.min(2, buffer.numberOfChannels) }, (_, i) => buffer.getChannelData(i).slice(0, frames));
  return { channels, rate: buffer.sampleRate };
}

export async function youtubeMetadata(source, signal) {
  const endpoint = new URL('https://www.youtube.com/oembed');
  endpoint.search = new URLSearchParams({ url: source.url, format: 'json' });
  const response = await fetch(endpoint, { credentials: 'omit', referrerPolicy: 'no-referrer', signal });
  if (!response.ok) throw new Error('メタデータを取得できませんでした。');
  const { title, author_name } = await response.json();
  return { title: typeof title === 'string' ? title : '', channel: typeof author_name === 'string' ? author_name : '' };
}
