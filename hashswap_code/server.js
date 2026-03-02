// server.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

import { mirrorGetAccountBalances } from "./src/hedera/mirror.js";
import { CONFIG } from "./src/config.js";

import { getState } from "./src/services/stateService.js";
import { getQuote } from "./src/services/quoteService.js";
import { buildMetrics } from "./src/metrics.js";

import { submitSignedTx, buildScheduledTransferCreate, executeSchedule } from "./src/services/txService.js";
import { buildFaucetClaim, executeFaucet } from "./src/services/faucetService.js";
import { buildAddLiquidity } from "./src/services/liquidityService.js";
import { buildSwap, executeSwap } from "./src/services/swapService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ép đọc đúng .env nằm cùng cấp server.js
dotenv.config({ path: path.join(__dirname, ".env") });

// debug nhanh: xem có load được không
console.log(
  "[env] loaded keys:",
  Object.keys(process.env).filter(
    (k) =>
      k.startsWith("HEDERA_") ||
      k.startsWith("OPERATOR_") ||
      k.startsWith("POOL_") ||
      k.startsWith("TOKEN_") ||
      k.startsWith("MIRROR_") ||
      k.startsWith("FAUCET_")
  )
);

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 8787;

/**
 * =========================
 * Deposits Ledger (v1)
 * =========================
 * Save to: hashswap_code/data/deposits.json
 */
const DATA_DIR = path.join(__dirname, "data");
const LEDGER_PATH = path.join(DATA_DIR, "deposits.json");

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}
function readLedger() {
  ensureDataDir();
  if (!fs.existsSync(LEDGER_PATH)) return {};
  return JSON.parse(fs.readFileSync(LEDGER_PATH, "utf8"));
}
function writeLedger(obj) {
  ensureDataDir();
  fs.writeFileSync(LEDGER_PATH, JSON.stringify(obj, null, 2), "utf8");
}
function clamp0(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return x < 0 ? 0 : x;
}
function toAtomic(amountHuman, decimals = 6) {
  const x = Number(amountHuman || 0);
  if (!Number.isFinite(x) || x <= 0) return 0;
  return Math.floor(x * Math.pow(10, decimals));
}

/**
 * =========================
 * Health
 * =========================
 */
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    service: "HashSwap Backend",
    network: process.env.HEDERA_NETWORK || "not-set",
    timestamp: new Date().toISOString(),
  });
});

/**
 * =========================
 * State
 * =========================
 */
app.get("/api/state", async (req, res) => {
  try {
    const state = await getState(CONFIG);
    res.json(state);
  } catch (e) {
    res.status(500).json({
      error: "STATE_ERROR",
      message: e?.message || String(e),
    });
  }
});

/**
 * =========================
 * Quote (x*y=k)
 * =========================
 * Example:
 *   /api/quote?amountIn=100
 */
app.get("/api/quote", (req, res) => {
  try {
    const amountIn = Number(req.query.amountIn || 0);
    const quote = getQuote(amountIn, CONFIG.pool.feeBps);
    res.json(quote);
  } catch (e) {
    res.status(400).json({
      error: "QUOTE_ERROR",
      message: e?.message || String(e),
    });
  }
});

/**
 * =========================
 * Metrics (single source of truth)
 * =========================
 */
app.get("/api/metrics", async (req, res) => {
  try {
    const metrics = await buildMetrics();
    res.json(metrics);
  } catch (e) {
    res.status(500).json({
      error: "METRICS_ERROR",
      message: e?.message || String(e),
    });
  }
});

/**
 * =========================
 * TX submit (wallet-signed)
 * =========================
 * Frontend signs bytes via HashPack -> submit here
 */
app.post("/api/tx/submit", async (req, res) => {
  try {
    const { signedTxBytesBase64 } = req.body || {};
    if (!signedTxBytesBase64) {
      return res.status(400).json({
        error: "TX_SUBMIT_ERROR",
        message: "missing signedTxBytesBase64",
      });
    }

    const out = await submitSignedTx({ signedTxBytesBase64 });
    res.json(out);
  } catch (e) {
    res.status(500).json({
      error: "TX_SUBMIT_ERROR",
      message: e?.message || String(e),
    });
  }
});

/**
 * =========================
 * Balances (Mirror)
 * =========================
 * GET /api/balances?accountId=0.0.xxxx
 */
app.get("/api/balances", async (req, res) => {
  try {
    const accountId = String(req.query.accountId || "").trim();
    if (!accountId) return res.status(400).json({ error: "Missing accountId" });

    const mirrorBase = CONFIG.mirrorBase;
    const tokenIdHUSD = CONFIG.tokens.hUSD;
    const tokenIdHEUR = CONFIG.tokens.hEUR;

    const balances = await mirrorGetAccountBalances(mirrorBase, accountId);
    const row = balances?.balances?.[0];
    const tokens = Array.isArray(row?.tokens) ? row.tokens : [];

    const rawHUSD = Number(tokens.find((t) => t?.token_id === tokenIdHUSD)?.balance ?? 0);
    const rawHEUR = Number(tokens.find((t) => t?.token_id === tokenIdHEUR)?.balance ?? 0);

    const dec = Number(CONFIG.tokens.decimals ?? 6);

    return res.json({
      accountId,
      hUSD: rawHUSD / Math.pow(10, dec),
      hEUR: rawHEUR / Math.pow(10, dec),
      raw: { hUSD: rawHUSD, hEUR: rawHEUR },
      decimals: dec,
      ts: new Date().toISOString(),
    });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
});

/**
 * =========================
 * Liquidity Ledger (Deposits v1)
 * =========================
 */

// GET /api/liquidity/user?accountId=0.0.xxxx
app.get("/api/liquidity/user", async (req, res) => {
  try {
    const accountId = String(req.query.accountId || "").trim();
    if (!accountId) return res.status(400).json({ error: "Missing accountId" });

    const ledger = readLedger();
    const row = ledger[accountId] || { hUSD: 0, hEUR: 0 };

    res.json({
      accountId,
      hUSD: Number(row.hUSD || 0),
      hEUR: Number(row.hEUR || 0),
      ts: new Date().toISOString(),
    });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// POST /api/liquidity/record  { accountId, deltaHUSD, deltaHEUR }
app.post("/api/liquidity/record", async (req, res) => {
  try {
    const { accountId, deltaHUSD, deltaHEUR } = req.body || {};
    const id = String(accountId || "").trim();
    if (!id) return res.status(400).json({ error: "Missing accountId" });

    const dH = Number(deltaHUSD || 0);
    const dE = Number(deltaHEUR || 0);

    const ledger = readLedger();
    const cur = ledger[id] || { hUSD: 0, hEUR: 0 };

    const next = {
      hUSD: clamp0(Number(cur.hUSD || 0) + dH),
      hEUR: clamp0(Number(cur.hEUR || 0) + dE),
    };

    ledger[id] = next;
    writeLedger(ledger);

    res.json({ ok: true, accountId: id, ...next, ts: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/**
 * =========================
 * Faucet (Scheduled)
 * =========================
 */
app.post("/api/faucet/build", async (req, res) => {
  try {
    const { token, userAccountId, amount } = req.body || {};
    if (!token || !userAccountId || !amount) {
      return res.status(400).json({
        error: "FAUCET_BUILD_ERROR",
        message: "required: token, userAccountId, amount",
      });
    }

    const out = await buildFaucetClaim({
      CONFIG,
      tokenSymbol: token, // "hUSD" | "hEUR"
      userAccountId,
      amountHuman: amount,
    });

    res.json(out);
  } catch (e) {
    res.status(400).json({
      error: "FAUCET_BUILD_ERROR",
      message: e?.message || String(e),
    });
  }
});

app.post("/api/faucet/execute", async (req, res) => {
  try {
    const { scheduleId, userAccountId, tokenSymbol } = req.body || {};
    if (!scheduleId) return res.status(400).json({ error: "Missing scheduleId" });
    if (!userAccountId) return res.status(400).json({ error: "Missing userAccountId" });
    if (!tokenSymbol) return res.status(400).json({ error: "Missing tokenSymbol" });

    const out = await executeFaucet({ scheduleId, userAccountId, tokenSymbol });
    res.json(out);
  } catch (e) {
    res.status(400).json({
      error: String(e?.message || e),
      code: e?.code || null,
      retryAfterSec: e?.retryAfterSec || null,
      status: e?.status || null,
    });
  }
});

/**
 * =========================
 * Liquidity Add (deposit only)
 * =========================
 */
app.post("/api/liquidity/add/build", async (req, res) => {
  try {
    const { userAccountId, amountHUSD, amountHEUR } = req.body || {};
    if (!userAccountId || !amountHUSD || !amountHEUR) {
      return res.status(400).json({
        error: "LIQ_ADD_BUILD_ERROR",
        message: "required: userAccountId, amountHUSD, amountHEUR",
      });
    }

    const out = await buildAddLiquidity({
      CONFIG,
      userAccountId,
      amountHUSD,
      amountHEUR,
    });

    res.json(out);
  } catch (e) {
    res.status(400).json({
      error: "LIQ_ADD_BUILD_ERROR",
      message: e?.message || String(e),
    });
  }
});

/**
 * =========================
 * Liquidity Remove (Scheduled payout from pool -> user)
 * Remove by % of "Your deposited" ledger
 * =========================
 */

// POST /api/liquidity/remove/build  { userAccountId, percentBps }
app.post("/api/liquidity/remove/build", async (req, res) => {
  try {
    const { userAccountId, percentBps } = req.body || {};
    if (!userAccountId) return res.status(400).json({ error: "Missing userAccountId" });

    const p = Math.max(0, Math.min(10000, Number(percentBps ?? 1000))); // bps
    const ledger = readLedger();
    const cur = ledger[userAccountId] || { hUSD: 0, hEUR: 0 };

    const amountHUSD = (Number(cur.hUSD || 0) * p) / 10000;
    const amountHEUR = (Number(cur.hEUR || 0) * p) / 10000;

    if (!(amountHUSD > 0 || amountHEUR > 0)) {
      return res.status(400).json({ error: "NOTHING_TO_REMOVE", message: "Deposits are zero" });
    }

    const dec = Number(CONFIG.tokens.decimals ?? 6);
    const poolId = CONFIG.pool.accountId;

    const innerTransfers = [];

    // pool -> user means: pool negative, user positive
    if (amountHUSD > 0) {
      const amt = toAtomic(amountHUSD, dec);
      innerTransfers.push({ tokenId: CONFIG.tokens.hUSD, accountId: poolId, amountInt: -amt });
      innerTransfers.push({ tokenId: CONFIG.tokens.hUSD, accountId: userAccountId, amountInt: amt });
    }
    if (amountHEUR > 0) {
      const amt = toAtomic(amountHEUR, dec);
      innerTransfers.push({ tokenId: CONFIG.tokens.hEUR, accountId: poolId, amountInt: -amt });
      innerTransfers.push({ tokenId: CONFIG.tokens.hEUR, accountId: userAccountId, amountInt: amt });
    }

    // user signs schedule create
    const out = await buildScheduledTransferCreate({
      CONFIG,
      payerAccountId: userAccountId,
      innerTransfers,
      memo: "HashSwap Remove Liquidity (v1)",
    });

    res.json({
      ...out,
      percentBps: p,
      amountHUSD,
      amountHEUR,
    });
  } catch (e) {
    res.status(400).json({
      error: "LIQ_REMOVE_BUILD_ERROR",
      message: e?.message || String(e),
    });
  }
});

// POST /api/liquidity/remove/execute  { scheduleId }
app.post("/api/liquidity/remove/execute", async (req, res) => {
  try {
    const { scheduleId } = req.body || {};
    if (!scheduleId) return res.status(400).json({ error: "Missing scheduleId" });

    // operator signs schedule to execute payout (pool pays)
    const out = await executeSchedule({ scheduleId, signer: "operator" });
    res.json(out);
  } catch (e) {
    res.status(400).json({
      error: "LIQ_REMOVE_EXEC_ERROR",
      message: e?.message || String(e),
      status: e?.status || null,
    });
  }
});

/**
 * =========================
 * Swap (Scheduled)
 * =========================
 */
app.post("/api/swap/build", async (req, res) => {
  try {
    const { userAccountId, from, to, amountIn, slippageBps } = req.body || {};
    if (!userAccountId || !from || !to || !amountIn) {
      return res.status(400).json({
        error: "SWAP_BUILD_ERROR",
        message: "required: userAccountId, from, to, amountIn",
      });
    }

    const out = await buildSwap({
      CONFIG,
      userAccountId,
      from,
      to,
      amountIn,
      slippageBps: Number(slippageBps ?? 50),
    });

    res.json(out);
  } catch (e) {
    res.status(400).json({
      error: "SWAP_BUILD_ERROR",
      message: e?.message || String(e),
    });
  }
});

app.post("/api/swap/execute", async (req, res) => {
  try {
    const { scheduleId } = req.body || {};
    if (!scheduleId) {
      return res.status(400).json({
        error: "SWAP_EXEC_ERROR",
        message: "missing scheduleId",
      });
    }

    const out = await executeSwap({ scheduleId });
    res.json(out);
  } catch (e) {
    res.status(400).json({
      error: "SWAP_EXEC_ERROR",
      message: e?.message || String(e),
    });
  }
});

/**
 * Root
 */
app.get("/", (req, res) => res.send("HashSwap API running"));

app.listen(PORT, () => {
  console.log(`🚀 HashSwap API running on http://localhost:${PORT}`);
  console.log(`Endpoints:
  GET  /api/health
  GET  /api/state
  GET  /api/quote?amountIn=100
  GET  /api/metrics
  GET  /api/balances?accountId=0.0.xxxx

  GET  /api/liquidity/user?accountId=0.0.xxxx
  POST /api/liquidity/record
  POST /api/liquidity/remove/build
  POST /api/liquidity/remove/execute

  POST /api/tx/submit
  POST /api/faucet/build
  POST /api/faucet/execute
  POST /api/liquidity/add/build
  POST /api/swap/build
  POST /api/swap/execute
  `);
});