import {
  mirrorHealth,
  mirrorGetAccountBalances,
  mirrorGetTokenInfo,
} from "../hedera/mirror.js";

function isValidId(id) {
  return typeof id === "string" && id.startsWith("0.0.") && id !== "0.0.0";
}

function pickTokenBalanceFromBalancesJson(balancesJson, tokenId) {
  const b0 = balancesJson?.balances?.[0];
  const tokens = b0?.tokens || [];
  const found = tokens.find((t) => t.token_id === tokenId);
  return found ? Number(found.balance || 0) : 0; // tiny units
}

export async function getMetrics(CONFIG) {
  const mirror = await mirrorHealth(CONFIG.mirrorBase);

  const poolId = CONFIG.pool.accountId;
  const hUSD = CONFIG.tokens.hUSD;
  const hEUR = CONFIG.tokens.hEUR;

  const base = {
    tvl: { totalUsdApprox: 0, byPool: [] },
    volume: { "24h": 0, "7d": 0 }, // (phase sau sẽ tính từ tx history)
    uniqueWalletsApprox: 0,        // (phase sau)
    txCountApprox: 0,              // (phase sau)
    links: { mirrorBase: CONFIG.mirrorBase },
    mirror,
    timestamp: new Date().toISOString(),
  };

  if (!isValidId(poolId) || !isValidId(hUSD) || !isValidId(hEUR)) {
    return {
      ...base,
      note: "Config not deployed yet (pool/token ids are placeholders).",
      config: { poolId, hUSD, hEUR },
    };
  }

  // Read balances of pool
  const balancesJson = await mirrorGetAccountBalances(CONFIG.mirrorBase, poolId);
  const poolHusdTiny = pickTokenBalanceFromBalancesJson(balancesJson, hUSD);
  const poolHeurTiny = pickTokenBalanceFromBalancesJson(balancesJson, hEUR);

  // Read decimals from mirror (or fallback)
  const husdInfo = await mirrorGetTokenInfo(CONFIG.mirrorBase, hUSD);
  const heurInfo = await mirrorGetTokenInfo(CONFIG.mirrorBase, hEUR);
  const husdDecimals = Number(husdInfo?.decimals ?? CONFIG.tokens.decimals ?? 6);
  const heurDecimals = Number(heurInfo?.decimals ?? CONFIG.tokens.decimals ?? 6);

  const poolHusd = poolHusdTiny / 10 ** husdDecimals;
  const poolHeur = poolHeurTiny / 10 ** heurDecimals;

  // Stable+Stable TVL approx (1:1)
  const tvlApprox = poolHusd + poolHeur;

  base.tvl.totalUsdApprox = tvlApprox;
  base.tvl.byPool = [
    {
      pair: "hUSD/hEUR",
      poolAccountId: poolId,
      reserves: { hUSD: poolHusd, hEUR: poolHeur },
      tvlUsdApprox: tvlApprox,
    },
  ];

  base.links.poolBalances = `${CONFIG.mirrorBase}/api/v1/balances?account.id=${poolId}&limit=1`;
  base.links.token_hUSD = `${CONFIG.mirrorBase}/api/v1/tokens/${hUSD}`;
  base.links.token_hEUR = `${CONFIG.mirrorBase}/api/v1/tokens/${hEUR}`;

  return base;
}