// src/metrics.js
import { CONFIG } from "./config.js";
import {
  mirrorHealth,
  mirrorGetAccountBalances,
  mirrorGetTokenInfo,
} from "./hedera/mirror.js";

/**
 * Metrics v3.1 (fix timestamp filter):
 * - Use timestamp=gte:SECONDS.NANOSECONDS to avoid mirror edge cases
 * - volume["24h"]: swap-like only in 24h
 * - txCountApprox / uniqueWalletsApprox: activity window (default 7d)
 * - TVL from balances
 */

const isAccountId = (x) => typeof x === "string" && /^\d+\.\d+\.\d+$/.test(x);

function analyzeTxsForPoolActivity({
  txs,
  poolAccountId,
  tokenIdHUSD,
  tokenIdHEUR,
  decHUSD,
  decHEUR,
}) {
  let txCountAll = 0;
  let txCountSwap = 0;
  let volumeApprox = 0;
  const wallets = new Set();
  let lastConsensusTimestamp = null;

  for (const tx of txs) {
    const cts = tx?.consensus_timestamp;
    if (cts && (!lastConsensusTimestamp || String(cts) > String(lastConsensusTimestamp))) {
      lastConsensusTimestamp = cts;
    }

    // payer = part before '-' in transaction_id
    const payer = String(tx?.transaction_id || "").split("-")[0];
    if (payer && payer !== poolAccountId && isAccountId(payer)) wallets.add(payer);

    const tts = Array.isArray(tx?.token_transfers) ? tx.token_transfers : [];
    if (!tts.length) continue;

    const hasHUSD = tts.some((t) => t?.token_id === tokenIdHUSD);
    const hasHEUR = tts.some((t) => t?.token_id === tokenIdHEUR);
    if (!hasHUSD && !hasHEUR) continue;

    txCountAll += 1;

    // pool delta
    let poolHUSD = 0;
    let poolHEUR = 0;

    for (const t of tts) {
      const acc = t?.account;
      const tokenId = t?.token_id;
      const amt = Number(t?.amount ?? 0);
      if (!Number.isFinite(amt)) continue;

      if (tokenId === tokenIdHUSD && acc === poolAccountId) poolHUSD += amt;
      if (tokenId === tokenIdHEUR && acc === poolAccountId) poolHEUR += amt;
    }

    // swap-like: both tokens change and opposite sign (one in, one out)
    const isSwapLike =
      poolHUSD !== 0 &&
      poolHEUR !== 0 &&
      Math.sign(poolHUSD) !== Math.sign(poolHEUR);

    if (isSwapLike) {
      txCountSwap += 1;

      const husd = Math.abs(poolHUSD) / Math.pow(10, decHUSD);
      const heur = Math.abs(poolHEUR) / Math.pow(10, decHEUR);

      volumeApprox += (husd + heur) / 2;
    }
  }

  return {
    txCountAll,
    txCountSwap,
    uniqueWalletsApprox: wallets.size,
    volumeApprox,
    lastConsensusTimestamp,
  };
}

async function fetchPoolTx({
  mirrorBase,
  poolAccountId,
  sinceTs, // "seconds.nanoseconds" string
  maxPages = 12,
  limit = 100,
}) {
  let url = `${mirrorBase}/api/v1/transactions?account.id=${poolAccountId}&timestamp=gte:${sinceTs}&order=desc&limit=${limit}`;
  const out = [];

  for (let i = 0; i < maxPages; i++) {
    const r = await fetch(url);
    if (!r.ok) {
      const t = await r.text().catch(() => "");
      throw new Error(`Mirror tx failed: ${r.status} ${t}`);
    }

    const j = await r.json();
    const txs = j?.transactions || [];
    out.push(...txs);

    const next = j?.links?.next;
    if (!next) break;

    url = next.startsWith("http") ? next : `${mirrorBase}${next}`;
  }

  return out;
}

function pickTokenBalance(tokensArr, tokenId) {
  if (!Array.isArray(tokensArr)) return 0;
  const row = tokensArr.find((t) => t?.token_id === tokenId);
  return Number(row?.balance ?? 0);
}

// helper: convert seconds-int to "seconds.000000000"
function secToTs(secInt) {
  return `${secInt}.000000000`;
}

export async function buildMetrics() {
  const mirrorBase = CONFIG.mirrorBase || "https://testnet.mirrornode.hedera.com";

  const poolAccountId = CONFIG.pool?.accountId;
  const tokenIdHUSD = CONFIG.tokens?.hUSD;
  const tokenIdHEUR = CONFIG.tokens?.hEUR;

  const decimalsFallback = Number(CONFIG.tokens?.decimals ?? 6);

  if (!poolAccountId || !tokenIdHUSD || !tokenIdHEUR) {
    throw new Error("Missing CONFIG.pool.accountId or CONFIG.tokens.{hUSD,hEUR}");
  }

  await mirrorHealth(mirrorBase);

  // token decimals (try from mirror, fallback to CONFIG)
  let decHUSD = decimalsFallback;
  let decHEUR = decimalsFallback;
  try {
    const [infoHUSD, infoHEUR] = await Promise.all([
      mirrorGetTokenInfo(mirrorBase, tokenIdHUSD),
      mirrorGetTokenInfo(mirrorBase, tokenIdHEUR),
    ]);
    const d1 = Number(infoHUSD?.decimals);
    const d2 = Number(infoHEUR?.decimals);
    if (Number.isFinite(d1)) decHUSD = d1;
    if (Number.isFinite(d2)) decHEUR = d2;
  } catch {
    // fallback silently
  }

  const nowSec = Math.floor(Date.now() / 1000);

  const activityWindowDays = Number(CONFIG.metrics?.activityWindowDays ?? 7);
  const sinceActivitySec = nowSec - activityWindowDays * 24 * 60 * 60;
  const since24hSec = nowSec - 24 * 60 * 60;

  const sinceActivityTs = secToTs(sinceActivitySec);
  const since24hTs = secToTs(since24hSec);

  // 1) fetch txs
  const [txs24h, txsActivity] = await Promise.all([
    fetchPoolTx({ mirrorBase, poolAccountId, sinceTs: since24hTs }),
    fetchPoolTx({ mirrorBase, poolAccountId, sinceTs: sinceActivityTs }),
  ]);

  // 2) analyze
  const analyzed24h = analyzeTxsForPoolActivity({
    txs: txs24h,
    poolAccountId,
    tokenIdHUSD,
    tokenIdHEUR,
    decHUSD,
    decHEUR,
  });

  const analyzedActivity = analyzeTxsForPoolActivity({
    txs: txsActivity,
    poolAccountId,
    tokenIdHUSD,
    tokenIdHEUR,
    decHUSD,
    decHEUR,
  });

  // 3) TVL from balances
  const balances = await mirrorGetAccountBalances(mirrorBase, poolAccountId);
  const poolBal = balances?.balances?.[0];
  const tokens = Array.isArray(poolBal?.tokens) ? poolBal.tokens : [];

  const rawHUSD = pickTokenBalance(tokens, tokenIdHUSD);
  const rawHEUR = pickTokenBalance(tokens, tokenIdHEUR);

  const reserveHUSD = rawHUSD / Math.pow(10, decHUSD);
  const reserveHEUR = rawHEUR / Math.pow(10, decHEUR);
  const tvlTotalApprox = reserveHUSD + reserveHEUR;

  const debugTxUrl24h = `${mirrorBase}/api/v1/transactions?account.id=${poolAccountId}&timestamp=gte:${since24hTs}&order=desc&limit=25`;
  const debugTxUrlActivity = `${mirrorBase}/api/v1/transactions?account.id=${poolAccountId}&timestamp=gte:${sinceActivityTs}&order=desc&limit=25`;

  return {
    tvl: {
      totalUsdApprox: tvlTotalApprox,
      byPool: [
        {
          pair: "hUSD/hEUR",
          poolAccountId,
          reserves: { hUSD: reserveHUSD, hEUR: reserveHEUR },
          tvlUsdApprox: tvlTotalApprox,
        },
      ],
    },

    volume: {
      "24h": analyzed24h.volumeApprox,
    },

    uniqueWalletsApprox: analyzedActivity.uniqueWalletsApprox,
    txCountApprox: analyzedActivity.txCountAll,

    activityWindowDays,
    txCount24h: analyzed24h.txCountAll,
    uniqueWallets24h: analyzed24h.uniqueWalletsApprox,
    txCountSwap24h: analyzed24h.txCountSwap,
    lastConsensusTimestamp: analyzedActivity.lastConsensusTimestamp,

    decimals: { hUSD: decHUSD, hEUR: decHEUR },

    links: {
      mirrorBase,
      poolBalances: `${mirrorBase}/api/v1/balances?account.id=${poolAccountId}&limit=1`,
      poolTx25: `${mirrorBase}/api/v1/transactions?account.id=${poolAccountId}&order=desc&limit=25`,
      token_hUSD: `${mirrorBase}/api/v1/tokens/${tokenIdHUSD}`,
      token_hEUR: `${mirrorBase}/api/v1/tokens/${tokenIdHEUR}`,
      debugTxUrl24h,
      debugTxUrlActivity,
    },

    timestamp: new Date().toISOString(),
  };
}