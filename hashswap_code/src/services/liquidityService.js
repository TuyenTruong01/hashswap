// src/services/liquidityService.js
import { buildTransferTx } from "./txService.js";

export async function buildAddLiquidity({ CONFIG, userAccountId, amountHUSD, amountHEUR }) {
  const dec = Number(CONFIG.tokens.decimals ?? 6);

  const tokenHUSD = CONFIG.tokens.hUSD;
  const tokenHEUR = CONFIG.tokens.hEUR;
  const poolAcc = CONFIG.pool.accountId;

  const husdInt = Math.floor(Number(amountHUSD) * Math.pow(10, dec));
  const heurInt = Math.floor(Number(amountHEUR) * Math.pow(10, dec));
  if (husdInt <= 0 || heurInt <= 0) throw new Error("amounts must be > 0");

  const transfers = [
    { tokenId: tokenHUSD, accountId: userAccountId, amountInt: -husdInt },
    { tokenId: tokenHUSD, accountId: poolAcc,      amountInt: +husdInt },

    { tokenId: tokenHEUR, accountId: userAccountId, amountInt: -heurInt },
    { tokenId: tokenHEUR, accountId: poolAcc,      amountInt: +heurInt },
  ];

  return buildTransferTx({ CONFIG, payerAccountId: userAccountId, transfers });
}