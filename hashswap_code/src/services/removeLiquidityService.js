import {
  AccountId,
  ScheduleId,
  ScheduleCreateTransaction,
  Hbar,
  TransferTransaction,
} from "@hashgraph/sdk";

import { getClient } from "../hedera/client.js"; // nếu bạn có file getClient khác thì đổi đúng path
import { CONFIG as CFG } from "../config.js";    // hoặc bạn đang truyền CONFIG từ server.js

// Helper: convert human -> atomic (decimals=6)
function toAtomic(amountHuman, decimals = 6) {
  const x = Number(amountHuman || 0);
  if (!Number.isFinite(x) || x <= 0) return 0;
  return Math.floor(x * Math.pow(10, decimals));
}

export async function buildRemoveLiquidity({ CONFIG, userAccountId, percentBps }) {
  const client = getClient(); // testnet operator in your setup
  const dec = Number(CONFIG?.tokens?.decimals ?? 6);

  // percentBps: 10000 = 100%
  const p = Math.max(0, Math.min(10000, Number(percentBps ?? 0)));

  // IMPORTANT:
  // Remove uses deposit-ledger totals (not shares).
  // We will not read deposits here (backend doesn't know caller in this layer),
  // Instead: frontend will pass computed amounts OR we add reading ledger here.
  //
  // => simplest: let frontend compute amounts and send amountHUSD/amountHEUR.
  // But user asked remove by % => we compute in backend by reading ledger.
  //
  // To keep file standalone, we'll compute amounts in server.js by reading ledger,
  // and call buildRemoveLiquidityAmounts(...) (see below).
  throw new Error("Use buildRemoveLiquidityAmounts() from server.js (see instructions).");
}

export async function buildRemoveLiquidityAmounts({ CONFIG, userAccountId, amountHUSD, amountHEUR }) {
  const client = getClient();
  const dec = Number(CONFIG?.tokens?.decimals ?? 6);

  const poolId = AccountId.fromString(CONFIG.pool.accountId);
  const userId = AccountId.fromString(userAccountId);

  const tokenHUSD = CONFIG.tokens.hUSD;
  const tokenHEUR = CONFIG.tokens.hEUR;

  const aH = toAtomic(amountHUSD, dec);
  const aE = toAtomic(amountHEUR, dec);

  if (aH <= 0 && aE <= 0) throw new Error("Nothing to remove");

  // Scheduled TX: pool -> user for both tokens
  const inner = new TransferTransaction().setTransactionMemo("HashSwap Remove Liquidity (v1)");
  if (aH > 0) inner.addTokenTransfer(tokenHUSD, poolId, -aH).addTokenTransfer(tokenHUSD, userId, aH);
  if (aE > 0) inner.addTokenTransfer(tokenHEUR, poolId, -aE).addTokenTransfer(tokenHEUR, userId, aE);

  // Wrap into schedule create: USER SIGNS this schedule-create (like swap build)
  const sched = await new ScheduleCreateTransaction()
    .setScheduledTransaction(inner)
    .setPayerAccountId(userId)
    .setAdminKey(null) // optional
    .freezeWith(client);

  const txBytes = sched.toBytes();
  const txBytesBase64 = Buffer.from(txBytes).toString("base64");

  return { txBytesBase64 };
}

// backend signs schedule to execute payout (pool pays)
export async function executeRemoveLiquidity({ scheduleId }) {
  const client = getClient();
  const sid = ScheduleId.fromString(scheduleId);

  // This must be signed by your OPERATOR_KEY (pool operator) in getClient()
  const out = await sid.sign(client);
  const receipt = await out.getReceipt(client);
  return { ok: true, scheduleId, status: receipt.status.toString() };
}