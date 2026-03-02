// src/services/txService.js
import {
  AccountId,
  TokenId,
  TransferTransaction,
  ScheduleCreateTransaction,
  ScheduleSignTransaction,
  TransactionId,
} from "@hashgraph/sdk";

import { getClient, getOperatorKey, getFaucetKey } from "../hedera/client.js";
import { txToBase64, txFromBase64 } from "../hedera/txBuilder.js";
import {
  mirrorGetAccountBalances,
  mirrorGetTokenInfo,
} from "../hedera/mirror.js";

/**
 * Build a NORMAL TransferTransaction (user will sign)
 * - used for: add liquidity deposit (user -> pool)
 */
export async function buildTransferTx({ CONFIG, payerAccountId, transfers }) {
  const payer = AccountId.fromString(payerAccountId);
  const client = getClient();

  const tx = new TransferTransaction()
    .setTransactionId(TransactionId.generate(payer))
    .setMaxTransactionFee(2_000_000);

  for (const t of transfers) {
    tx.addTokenTransfer(
      TokenId.fromString(t.tokenId),
      AccountId.fromString(t.accountId),
      t.amountInt
    );
  }

  await tx.freezeWith(client);

  return {
    txBytesBase64: txToBase64(tx),
    txId: tx.transactionId.toString(),
  };
}

/**
 * Build a SCHEDULE CREATE for an inner TransferTransaction
 * - user signs schedule create (wallet)
 * - backend later signs schedule sign (pool/faucet)
 */
export async function buildScheduledTransferCreate({
  CONFIG,
  payerAccountId,
  innerTransfers,
  memo = "",
}) {
  const payer = AccountId.fromString(payerAccountId);
  const client = getClient();

  // Inner Transfer (NOT frozen)
  const inner = new TransferTransaction();
  if (memo) inner.setTransactionMemo(memo);

  for (const t of innerTransfers) {
    inner.addTokenTransfer(
      TokenId.fromString(t.tokenId),
      AccountId.fromString(t.accountId),
      t.amountInt
    );
  }

  const scheduleCreate = new ScheduleCreateTransaction()
    .setScheduledTransaction(inner)
    .setPayerAccountId(payer)
    .setMaxTransactionFee(20_000_000);

  scheduleCreate.setTransactionId(TransactionId.generate(payer));

  await scheduleCreate.freezeWith(client);

  return {
    txBytesBase64: txToBase64(scheduleCreate),
    txId: scheduleCreate.transactionId.toString(),
  };
}

/**
 * Submit SIGNED tx bytes (from wallet)
 * HƯỚNG B: identical schedule => reuse scheduleId
 */
export async function submitSignedTx({ signedTxBytesBase64 }) {
  const client = getClient();

  try {
    const tx = txFromBase64(signedTxBytesBase64);

    const resp = await tx.execute(client);
    const receipt = await resp.getReceipt(client);

    return {
      transactionId: resp.transactionId.toString(),
      status: receipt.status.toString(),
      scheduleId: receipt.scheduleId ? receipt.scheduleId.toString() : null,
      consensusTimestamp: resp.consensusTimestamp?.toString?.() || null,
    };
  } catch (e) {
    const statusStr =
      e?.status?.toString?.() ||
      e?.transactionReceipt?.status?.toString?.() ||
      e?.receipt?.status?.toString?.() ||
      "";

    if (statusStr === "IDENTICAL_SCHEDULE_ALREADY_CREATED") {
      const scheduleId = e?.transactionReceipt?.scheduleId?.toString?.() || null;

      return {
        transactionId: e?.transactionId?.toString?.() || null,
        status: statusStr,
        scheduleId,
        consensusTimestamp: null,
        note: "Reused existing scheduleId",
      };
    }

    console.error("🔥 submitSignedTx ERROR:", e);
    const err = new Error(String(e?.message || e));
    err.status = statusStr || null;
    throw err;
  }
}

/**
 * Backend signs schedule to execute
 * signer:
 *  - "operator": sign using OPERATOR_KEY
 *  - "faucet":   sign using FAUCET_KEY (for faucet_treasury outgoing transfers)
 */
export async function executeSchedule({ scheduleId, signer = "operator" }) {
  const client = getClient();

  // choose correct key
  const key = signer === "faucet" ? getFaucetKey() : getOperatorKey();

  try {
    const tx = new ScheduleSignTransaction()
      .setScheduleId(scheduleId)
      .setMaxTransactionFee(20_000_000);

    await tx.freezeWith(client);

    // explicit sign
    const signedTx = await tx.sign(key);

    const resp = await signedTx.execute(client);
    const receipt = await resp.getReceipt(client);

    return {
      status: receipt.status.toString(),
      scheduleId: scheduleId.toString(),
      transactionId: resp.transactionId.toString(),
      consensusTimestamp: resp.consensusTimestamp?.toString?.() || null,
    };
  } catch (e) {
    console.error("🔥 executeSchedule ERROR:", e);

    const statusStr =
      e?.status?.toString?.() ||
      e?.transactionReceipt?.status?.toString?.() ||
      e?.receipt?.status?.toString?.() ||
      null;

    const err = new Error(String(e?.message || e));
    err.status = statusStr;
    throw err;
  }
}

/**
 * Read reserves from mirror (pool balances)
 * returns human reserves + decimals
 */
export async function getPoolReserves({ CONFIG }) {
  const mirrorBase = CONFIG.mirrorBase;
  const poolAccountId = CONFIG.pool.accountId;
  const tokenIdHUSD = CONFIG.tokens.hUSD;
  const tokenIdHEUR = CONFIG.tokens.hEUR;

  const [infoHUSD, infoHEUR] = await Promise.all([
    mirrorGetTokenInfo(mirrorBase, tokenIdHUSD),
    mirrorGetTokenInfo(mirrorBase, tokenIdHEUR),
  ]);

  const decHUSD = Number(infoHUSD?.decimals ?? CONFIG.tokens.decimals ?? 6);
  const decHEUR = Number(infoHEUR?.decimals ?? CONFIG.tokens.decimals ?? 6);

  const balances = await mirrorGetAccountBalances(mirrorBase, poolAccountId);
  const row = balances?.balances?.[0];
  const tokens = Array.isArray(row?.tokens) ? row.tokens : [];

  const rawHUSD = Number(
    tokens.find((t) => t?.token_id === tokenIdHUSD)?.balance ?? 0
  );
  const rawHEUR = Number(
    tokens.find((t) => t?.token_id === tokenIdHEUR)?.balance ?? 0
  );

  return {
    decHUSD,
    decHEUR,
    rawHUSD,
    rawHEUR,
    reserveHUSD: rawHUSD / Math.pow(10, decHUSD),
    reserveHEUR: rawHEUR / Math.pow(10, decHEUR),
  };
}