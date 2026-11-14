// Puts the natural-voice files next to the app at build time, so phones download
// them only from the app's own address (no third-party server at runtime).
//   public/models/onnx-community/Kokoro-82M-v1.0-ONNX/...  (from Hugging Face)
//   public/ort/ort-wasm-simd-threaded.jsep.{mjs,wasm}      (from node_modules)
import { copyFile, mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const REV = '1939ad2a8e416c0acfeecc08a694d14ef25f2231'; // pinned revision, so the files can't change under us
export const VOICES = ['af_heart', 'af_bella', 'bf_emma', 'am_michael', 'bm_george', 'bm_fable'];
const FILES = ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'onnx/model_quantized.onnx', ...VOICES.map((v) => `voices/${v}.bin`)];

const exists = async (p) => !!(await stat(p).catch(() => null));

for (const f of FILES) {
  const out = join(root, 'public/models', MODEL, f);
  if (await exists(out)) continue;
  await mkdir(dirname(out), { recursive: true });
  const url = `https://huggingface.co/${MODEL}/resolve/${process.env.KOKORO_REV || REV}/${f}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} for ${url}`);
  await writeFile(out, Buffer.from(await res.arrayBuffer()));
  console.log('fetched', f, ((await stat(out)).size / 1e6).toFixed(1), 'MB');
}

const ortSrc = join(root, 'node_modules/@huggingface/transformers/dist');
await mkdir(join(root, 'public/ort'), { recursive: true });
for (const f of ['ort-wasm-simd-threaded.jsep.mjs', 'ort-wasm-simd-threaded.jsep.wasm']) await copyFile(join(ortSrc, f), join(root, 'public/ort', f));
console.log('voice model ready');
