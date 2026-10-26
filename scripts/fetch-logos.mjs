// Rebuilds public/logos from their sources (run by hand when a logo changes, then bump
// VERSION in src/modules/logos/logos.routes.ts):
//   npm i --no-save sharp && node scripts/fetch-logos.mjs
// Banks: github.com/ichtrojan/nigerian-banks (MIT). Networks, TV and DisCos: the public
// product images of VTpass (vtpass.com/api/services). All are their owners' trademarks,
// shown only to identify each provider. Everything is resized to 128 px PNG.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import sharp from "sharp";

const out = path.resolve("public/logos");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "logos-"));

// Peyflex id -> VTpass image
const SERVICES = {
  mtn: "MTN-Airtime.jpg",
  airtel: "Airtel-Airtime.jpg",
  glo: "GLO-Airtime.jpg",
  "9mobile": "9mobile-Airtime.jpg",
  dstv: "Pay-DSTV-Subscription.jpg",
  gotv: "Gotv-Payment.jpg",
  startimes: "Startimes-Subscription.jpg",
  "ikeja-electric": "Ikeja-Electric-Payment-PHCN.jpg",
  "eko-electric": "Eko-Electric-Payment-PHCN.jpg",
  "abuja-electric": "Abuja-Electric.jpg",
  "kano-electric": "Kano-Electric.jpg",
  "portharcourt-electric": "PHED-Port-Harcourt-Electric.jpg",
  "jos-electric": "Jos-Electric-JED.jpg",
  "kaduna-electric": "Kaduna-Electric-KAEDCO.jpg",
  "enugu-electric": "Enugu-Electric-EEDC.jpg",
  "ibadan-electric": "IBEDC-Ibadan-Electricity-Distribution-Company.jpg",
  "benin-electric": "Benin-Electricity-BEDC.jpg",
  "aba-electric": "Aba-Electric-Payment-ABEDC.jpg",
  "yola-electric": "Yola-Electric-Payment-IKEDC.jpg",
};

const get = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return Buffer.from(await res.arrayBuffer());
};

fs.mkdirSync(path.join(out, "services"), { recursive: true });
for (const [id, file] of Object.entries(SERVICES)) {
  const img = await get(`https://vtpass.com/resources/products/200X200/${encodeURIComponent(file)}`);
  await sharp(img).resize(128, 128, { fit: "cover" }).png({ compressionLevel: 9, palette: true }).toFile(path.join(out, "services", `${id}.png`));
}

const zip = path.join(tmp, "banks.zip");
fs.writeFileSync(zip, await get("https://codeload.github.com/ichtrojan/nigerian-banks/zip/refs/heads/master"));
execFileSync("tar", ["-xf", zip, "-C", tmp]);
const src = path.join(tmp, "nigerian-banks-master", "logos");
fs.mkdirSync(path.join(out, "banks"), { recursive: true });
for (const f of fs.readdirSync(src)) {
  await sharp(path.join(src, f))
    .resize(128, 128, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9, palette: true })
    .toFile(path.join(out, "banks", f.replace(/\.\w+$/, ".png")));
}
console.log(`Wrote ${Object.keys(SERVICES).length} service and ${fs.readdirSync(src).length} bank logos to ${out}`);
