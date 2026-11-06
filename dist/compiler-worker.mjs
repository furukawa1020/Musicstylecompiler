import { compile } from './compiler.mjs';

self.onmessage = ({ data }) => {
  try {
    const result = compile(data, stage => self.postMessage({ stage }));
    self.postMessage({ result }, [result.original, result.arranged, result.midi]);
  } catch (error) {
    self.postMessage({ error: error.message });
  }
};
