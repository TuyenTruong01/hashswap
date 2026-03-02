import { resolveTokenId } from "../hedera/hts.js";
import { buildScheduledTransferCreate, executeSchedule } from "./txService.js";
import { canClaim, markClaim, formatRetry } from "../utils/faucetRateLimit.js";

export async function buildFaucetClaim({
  CONFIG,
  tokenSymbol,
  userAccountId,
  amountHuman,
}) {
  const tokenId = resolveTokenId(CONFIG, tokenSymbol);
  const dec = Number(CONFIG.tokens.decimals ?? 6);

  const amtNum = Number(amountHuman);
  if (!Number.isFinite(amtNum)) throw new Error("amount must be a number");

  const amtInt = Math.floor(amtNum * Math.pow(10, dec));
  if (amtInt <= 0) throw new Error("amount must be > 0");

  const faucetAccountId = CONFIG.faucet.accountId;
  if (!faucetAccountId) throw new Error("Missing CONFIG.faucet.accountId");

  const innerTransfers = [
    { tokenId, accountId: faucetAccountId, amountInt: -amtInt },
    { tokenId, accountId: userAccountId, amountInt: +amtInt },
  ];

  return buildScheduledTransferCreate({
    CONFIG,
    payerAccountId: userAccountId,
    innerTransfers,
    memo: `HashSwap: faucet ${tokenSymbol}`,
  });
}

/**
 * Execute faucet schedule (rate-limited 1 claim / 24h / token / account)
 * NOTE: userAccountId + tokenSymbol must be provided by API caller
 */
export async function executeFaucet({ scheduleId, userAccountId, tokenSymbol }) {
  // 1) rate limit check
  const check = canClaim({ userAccountId, tokenSymbol });
  if (!check.ok) {
    const err = new Error(
      `Faucet limited: 1 per 24h. Retry after ${formatRetry(check.retryAfterSec)}`
    );
    err.code = "FAUCET_RATE_LIMIT_24H";
    err.retryAfterSec = check.retryAfterSec;
    throw err;
  }

  // 2) execute schedule with faucet signer
  const res = await executeSchedule({ scheduleId, signer: "faucet" });

  // 3) mark claim only if SUCCESS
  if (String(res?.status || "").toUpperCase() === "SUCCESS") {
    markClaim({ userAccountId, tokenSymbol });
  }

  return res;
}