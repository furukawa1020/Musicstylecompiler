import { createCompiler } from './compiler.mjs?v=score-2';

async function loadCompiler() {
  const response = await fetch(new URL('./music-compiler.wasm?v=score-2', import.meta.url));
  if (!response.ok) throw new Error('MoonBitの編曲エンジンを取得できませんでした。');
  const { instance } = response.headers.get('content-type') === 'application/wasm'
    ? await WebAssembly.instantiateStreaming(response)
    : await WebAssembly.instantiate(await response.arrayBuffer());
  return createCompiler(instance);
}

const ready = loadCompiler();
self.onmessage = async ({ data }) => {
  try {
    const compile = await ready;
    const result = compile(data, stage => self.postMessage({ stage }));
    self.postMessage({ result }, [result.original, result.arranged, result.midi]);
  } catch (error) {
    self.postMessage({ error: error.message });
  }
};
