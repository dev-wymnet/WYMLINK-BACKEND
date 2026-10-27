// Downloads each bank's logo from the bank's own website (the icons its homepage declares:
// web-app manifest icons, apple-touch-icon, SVG/PNG favicons), keeps the best one and writes
// it as a 128 px PNG to <outDir>/<slug>.png, recording each source URL in scripts/bank-logo-sources.json.
// Run by hand, review every image (sites change), then bump VERSION in src/modules/logos/logos.routes.ts.
//   npm i --no-save sharp && node scripts/fetch-bank-logos.mjs public/logos/banks
// Logos are their owners' trademarks, shown only to identify each bank.
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

// What each site gave on review (Oct 2026) was unusable for these, so they keep the existing file:
// default CMS favicon (taj), cropped wordmark (suntrust, rmb), washed out (parallex), artifacts
// (safe haven), tiny favicon (fairmoney, opay), unconfirmed asset (mint).
// Banks whose sites block automated requests (GTBank, Zenith, UBA, Access, First Bank, ...) also keep theirs.
export const KEEP_EXISTING = ["taj-bank","suntrust-bank","rand-merchant-bank","parallex-bank","safe-haven-mfb","fairmoney-microfinance-bank","paycom","mint-mfb"];

// logo slug (see bank-logo-map.ts) -> the bank's official website(s), tried in order.
export const BANK_SITES = {
  "access-bank": ["accessbankplc.com"],
  "access-bank-diamond": ["accessbankplc.com"],
  "citibank-nigeria": ["citigroup.com", "citi.com"],
  "ecobank-nigeria": ["ecobank.com"],
  "fidelity-bank": ["fidelitybank.ng"],
  "first-bank-of-nigeria": ["firstbanknigeria.com", "firstbanknigeria.com.ng", "firstbankgroup.com"],
  "first-city-monument-bank": ["fcmb.com"],
  "globus-bank": ["globusbank.com"],
  "guaranty-trust-bank": ["gtbank.com"],
  "jaiz-bank": ["jaizbankplc.com"],
  "keystone-bank": ["keystonebankng.com"],
  "lotus-bank": ["lotusbank.com"],
  "nova-bank": ["novabank.ng"],
  "optimus-bank-limited": ["optimusbank.com"],
  "parallex-bank": ["parallexbank.com"],
  "polaris-bank": ["polarisbanklimited.com"],
  "premiumtrust-bank": ["premiumtrustbank.com"],
  "providus-bank": ["providusbank.com"],
  "signature-bank-ltd": ["signaturebankng.com"],
  "stanbic-ibtc-bank": ["stanbicibtcbank.com"],
  "standard-chartered-bank": ["sc.com"],
  "sterling-bank": ["sterling.ng"],
  "suntrust-bank": ["suntrustng.com"],
  "taj-bank": ["tajbank.com"],
  "titan-trust-bank": ["titantrustbank.com"],
  "union-bank-of-nigeria": ["unionbankng.com"],
  "united-bank-for-africa": ["ubagroup.com"],
  "unity-bank": ["unitybankng.com"],
  "wema-bank": ["wemabank.com"],
  "alat-by-wema": ["alat.ng"],
  "zenith-bank": ["zenithbank.com"],
  "coronation-merchant-bank": ["coronationmb.com"],
  "fsdh-merchant-bank-limited": ["fsdhgroup.com"],
  "greenwich-merchant-bank": ["greenwichbankgroup.com"],
  "rand-merchant-bank": ["rmb.com.ng"],
  "alternative-bank": ["altbank.ng"],
  "alpha-morgan-bank": ["alphamorganbank.com"],
  "tatum-bank": ["tatumbank.com"],
  "summit-bank": ["summitbank.ng"],
  "bank-of-agriculture": ["boanigeria.com"],
  "kuda-bank": ["kuda.com"],
  "moniepoint-mfb-ng": ["moniepoint.com"],
  paycom: ["opayweb.com"],
  palmpay: ["palmpay.com"],
  vfd: ["vbank.ng", "vfdgroup.com"],
  "safe-haven-mfb": ["safehavenmfb.com"],
  "fairmoney-microfinance-bank": ["fairmoney.io"],
  carbon: ["getcarbon.co"],
  paga: ["paga.com"],
  gomoney: ["gomoney.global"],
  eyowo: ["eyowo.com"],
  "mtn-momo-psb": ["momopsb.com"],
  "airtel-smartcash-psb": ["smartcashpsb.ng", "smartcash.ng"],
  "9mobile-9payment-service-bank": ["9psb.com.ng"],
  hopepsb: ["hopepsb.com"],
  "money-master-psb": ["moneymasterpsb.com"],
  "paystack-titan": ["paystack.com"],
  "paystack-mfb": ["paystack.com"],
  "flutterwave-mfb": ["flutterwave.com"],
  "tangerine-money": ["tangerine.africa"],
  "letshego-microfinance-bank": ["letshego.com"],
  "accion-microfinance-bank": ["accionmfb.com"],
  "abbey-mortgage-bank": ["abbeymortgagebank.com"],
  "bankly-mfb": ["bankly.ng"],
  "rubies-mfb": ["rubies.ng"],
  "mint-mfb": ["mintyn.com"],
  "sparkle-microfinance-bank": ["sparkle.ng"],
  "parkway-readycash": ["readycash.com.ng"],
  "cashconnect-mfb": ["cashconnectmfb.com"],
  "branch-international-finance-company-limited": ["branch.com.ng"],
  "credit-direct-limited": ["creditdirect.ng"],
  "nirsal-microfinance": ["nirsalmfb.com"],
  "lagos-building-investment-company-plc": ["lbic.com.ng"],
  "infinity-mfb": ["infinitymfb.com"],
  "mainstreet-microfinance-bank": ["mainstreetmfb.com"],
  "baobab-microfinance-bank": ["baobabgroup.com"],
  "hasal-microfinance-bank": ["hasalmfb.com"],
  "firmus-mfb": ["firmusmfb.com"],
  "advancly-mfb": ["advancly.com"],
  "aella-mfb": ["aellaapp.com"],
  "pettysave-mfb": ["pettysave.com"],
  "bloc-mfb": ["blochq.io"],
};

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";
const get = async (url, ms = 20000) => {
  const res = await fetch(url, { headers: { "user-agent": UA, accept: "*/*" }, redirect: "follow", signal: AbortSignal.timeout(ms) });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res;
};

const attr = (tag, name) => tag.match(new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, "i"))?.[1];

// Every icon the homepage declares, best first.
async function candidates(site) {
  const res = await get(`https://${site}/`);
  const base = res.url;
  const html = await res.text();
  const out = [];
  const abs = (href) => new URL(href.replace(/&amp;/g, "&"), base).href;
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = (attr(tag, "rel") ?? "").toLowerCase();
    const href = attr(tag, "href");
    if (!href) continue;
    if (rel === "manifest") {
      try {
        const manifest = await (await get(abs(href))).json();
        for (const icon of manifest.icons ?? []) {
          const size = parseInt(String(icon.sizes ?? "0").split("x")[0], 10) || 0;
          out.push({ url: new URL(icon.src, abs(href)).href, score: 300 + Math.min(size, 512) / 10, kind: "manifest" });
        }
      } catch {}
    } else if (rel.includes("apple-touch-icon")) {
      out.push({ url: abs(href), score: 280, kind: "apple-touch" });
    } else if (rel.split(/\s+/).includes("icon")) {
      const size = parseInt(String(attr(tag, "sizes") ?? "0").split("x")[0], 10) || 0;
      const svg = /\.svg(\?|$)/i.test(href) || /svg/i.test(attr(tag, "type") ?? "");
      out.push({ url: abs(href), score: svg ? 290 : 100 + Math.min(size, 512) / 4, kind: svg ? "svg-icon" : "icon" });
    }
  }
  out.push({ url: abs("/apple-touch-icon.png"), score: 200, kind: "apple-touch (default path)" });
  out.push({ url: abs("/favicon.ico"), score: 90, kind: "favicon.ico" });
  return { base, list: out.sort((a, b) => b.score - a.score) };
}

// Pulls the largest PNG-encoded image out of an .ico (sharp can't read .ico itself).
function icoPng(buf) {
  if (buf.length < 6 || buf.readUInt16LE(0) !== 0 || buf.readUInt16LE(2) !== 1) return null;
  let best = null;
  for (let i = 0, n = buf.readUInt16LE(4); i < n; i++) {
    const e = 6 + i * 16;
    const offset = buf.readUInt32LE(e + 12);
    const data = buf.subarray(offset, offset + buf.readUInt32LE(e + 8));
    const w = buf[e] || 256;
    if (data.subarray(1, 4).toString() === "PNG" && (!best || w > best.w)) best = { w, data };
  }
  return best?.data ?? null;
}

// Decodes an icon and returns a 128 px square PNG, or null if it's smaller than `min` px.
async function toPng(buf, min) {
  buf = icoPng(buf) ?? buf;
  const img = sharp(buf, { density: 300 });
  const meta = await img.metadata();
  if (meta.format !== "svg" && Math.min(meta.width ?? 0, meta.height ?? 0) < min) return null;
  return sharp(buf, { density: 300 })
    .resize(128, 128, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 0 } })
    .png()
    .toBuffer();
}

async function fetchOne(slug, sites) {
  const found = [];
  for (const site of sites.flatMap((s) => [s, `www.${s}`])) {
    try {
      found.push(...(await candidates(site)).list);
    } catch {}
  }
  // Prefer a proper-size icon; fall back to a small one rather than nothing.
  for (const min of [96, 48]) {
    for (const c of found) {
      try {
        const buf = Buffer.from(await (await get(c.url)).arrayBuffer());
        const png = await toPng(buf, min);
        if (png) return { slug, png, source: c.url, kind: min < 96 ? `${c.kind} (small)` : c.kind };
      } catch {}
    }
  }
  return { slug, error: `no usable icon on ${sites.join(", ")}` };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, "$1"))) {
  const outDir = path.resolve(process.argv[2] ?? "public/logos/banks");
  const only = process.argv[3]?.split(",");
  fs.mkdirSync(outDir, { recursive: true });
  const entries = Object.entries(BANK_SITES).filter(([slug]) => (only ? only.includes(slug) : !KEEP_EXISTING.includes(slug)));
  const results = [];
  for (let i = 0; i < entries.length; i += 8) {
    results.push(...(await Promise.all(entries.slice(i, i + 8).map(([slug, sites]) => fetchOne(slug, sites)))));
  }
  const sourcesFile = path.resolve("scripts/bank-logo-sources.json");
  const sources = fs.existsSync(sourcesFile) ? JSON.parse(fs.readFileSync(sourcesFile, "utf8")) : {};
  for (const r of results) {
    if (r.png) {
      fs.writeFileSync(path.join(outDir, `${r.slug}.png`), r.png);
      sources[r.slug] = r.source;
      console.log("ok  ", r.slug.padEnd(44), r.kind, r.source);
    } else console.log("FAIL", r.slug.padEnd(44), r.error);
  }
  fs.writeFileSync(sourcesFile, JSON.stringify(sources, null, 2));
}
