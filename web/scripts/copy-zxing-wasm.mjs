// Copies the ZXing reader WebAssembly binary that barcode-detector uses into
// public/zxing/, so QR scanning loads it from this app instead of a CDN.
// Runs before `next dev` and `next build`. The output is generated, not committed.
import { copyFileSync, existsSync, mkdirSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const bd = realpathSync(join(root, "node_modules", "barcode-detector"));
const candidates = [
  // pnpm: dependencies sit next to the package in node_modules/.pnpm/<id>/node_modules
  join(dirname(bd), "zxing-wasm", "dist", "reader", "zxing_reader.wasm"),
  // npm or yarn: hoisted
  join(root, "node_modules", "zxing-wasm", "dist", "reader", "zxing_reader.wasm"),
];
const source = candidates.find((p) => existsSync(p));
if (!source) {
  console.error("copy-zxing-wasm: zxing_reader.wasm not found. Run pnpm install in web/ first.");
  process.exit(1);
}
const outDir = join(root, "public", "zxing");
mkdirSync(outDir, { recursive: true });
copyFileSync(source, join(outDir, "zxing_reader.wasm"));
console.log("copy-zxing-wasm: public/zxing/zxing_reader.wasm ready");
