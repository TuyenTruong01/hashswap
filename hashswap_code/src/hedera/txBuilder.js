// src/hedera/txBuilder.js
import { Transaction } from "@hashgraph/sdk";

/**
 * Transaction -> base64 bytes (unsigned or signed)
 */
export function txToBase64(tx) {
  const bytes = tx.toBytes();
  return Buffer.from(bytes).toString("base64");
}

/**
 * base64 bytes -> Transaction
 */
export function txFromBase64(b64) {
  const bytes = Buffer.from(String(b64), "base64");
  return Transaction.fromBytes(bytes);
}