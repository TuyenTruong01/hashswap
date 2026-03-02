import fs from "fs";
import path from "path";

const CLAIMS_PATH = path.resolve(process.cwd(), "data", "faucetClaims.json");
const WINDOW_SEC = 24 * 60 * 60; // 24h

function ensureFile() {
  if (!fs.existsSync(CLAIMS_PATH)) {
    fs.mkdirSync(path.dirname(CLAIMS_PATH), { recursive: true });
    fs.writeFileSync(CLAIMS_PATH, JSON.stringify({ hUSD: {}, hEUR: {} }, null, 2), "utf8");
  }
}

function readClaims() {
  ensureFile();
  try {
    const raw = fs.readFileSync(CLAIMS_PATH, "utf8");
    const json = JSON.parse(raw || "{}");
    if (!json.hUSD) json.hUSD = {};
    if (!json.hEUR) json.hEUR = {};
    return json;
  } catch {
    return { hUSD: {}, hEUR: {} };
  }
}

// atomic write (write temp then rename)
function writeClaims(data) {
  ensureFile();
  const tmp = CLAIMS_PATH + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmp, CLAIMS_PATH);
}

/**
 * Check if user can claim now (per tokenSymbol).
 * Returns: { ok: true } or { ok: false, retryAfterSec }
 */
export function canClaim({ userAccountId, tokenSymbol }) {
  const claims = readClaims();
  const sym = String(tokenSymbol || "").trim();
  if (!claims[sym]) claims[sym] = {};

  const last = Number(claims[sym][userAccountId] || 0);
  const now = Math.floor(Date.now() / 1000);

  const delta = now - last;
  if (last > 0 && delta < WINDOW_SEC) {
    return { ok: false, retryAfterSec: WINDOW_SEC - delta };
  }
  return { ok: true };
}

/**
 * Mark successful claim time
 */
export function markClaim({ userAccountId, tokenSymbol }) {
  const claims = readClaims();
  const sym = String(tokenSymbol || "").trim();
  if (!claims[sym]) claims[sym] = {};

  const now = Math.floor(Date.now() / 1000);
  claims[sym][userAccountId] = now;
  writeClaims(claims);
}

/**
 * Helper to convert seconds to a friendly string
 */
export function formatRetry(retryAfterSec) {
  const s = Math.max(0, Math.floor(retryAfterSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return `${h}h ${m}m ${r}s`;
  if (m > 0) return `${m}m ${r}s`;
  return `${r}s`;
}