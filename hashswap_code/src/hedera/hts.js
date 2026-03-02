// src/hedera/hts.js

/**
 * Map symbol -> TokenId string from CONFIG
 * Supports: hUSD, hEUR
 */
export function resolveTokenId(CONFIG, symbol) {
  if (!CONFIG?.tokens) throw new Error("CONFIG.tokens missing");

  if (symbol === "hUSD") return CONFIG.tokens.hUSD;
  if (symbol === "hEUR") return CONFIG.tokens.hEUR;

  throw new Error(`Unsupported token symbol: ${symbol}`);
}