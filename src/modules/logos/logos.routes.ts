import path from "node:path";
import express, { Router } from "express";

import { BANK_BY_MONETA_ID, BANK_BY_NAME } from "./bank-logo-map.js";

// Logos for banks, networks, TV and electricity providers, served by this backend so the
// apps never hot-link a third party. Files live in public/logos (128 px PNGs, see
// scripts/fetch-logos.mjs); the apps fetch the map once and build URLs as
// `${API_URL}/logos/files/${path}`.

// Peyflex ids (telecom networks, cable providers, DisCo plan codes) -> file.
const SERVICES: Record<string, string> = Object.fromEntries(
  [
    "mtn", "airtel", "glo", "9mobile",
    "dstv", "gotv", "startimes",
    "ikeja-electric", "eko-electric", "abuja-electric", "kano-electric", "portharcourt-electric", "jos-electric",
    "kaduna-electric", "enugu-electric", "ibadan-electric", "benin-electric", "aba-electric", "yola-electric",
  ].map((id) => [id, `services/${id}.png`]),
);

// Bump when files change, so apps drop their cached copies.
const VERSION = 1;

const files = path.resolve(process.cwd(), "public/logos");
const prefix = (map: Record<string, string>, dir: string) => Object.fromEntries(Object.entries(map).map(([k, slug]) => [k, `${dir}/${slug}.png`]));

export const logoRoutes = Router();

logoRoutes.get("/", (_req, res) => {
  res.set("Cache-Control", "public, max-age=3600, s-maxage=86400");
  res.json({
    version: VERSION,
    banks: { byId: prefix(BANK_BY_MONETA_ID, "banks"), byName: prefix(BANK_BY_NAME, "banks") },
    services: SERVICES,
  });
});

logoRoutes.use(
  "/files",
  express.static(files, {
    maxAge: "30d",
    index: false,
    // helmet's default (same-origin) would stop the web app from showing them.
    setHeaders: (res) => res.setHeader("Cross-Origin-Resource-Policy", "cross-origin"),
  }),
);
