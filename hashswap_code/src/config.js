// src/config.js
export const CONFIG = {
  network: process.env.HEDERA_NETWORK || "testnet",

  mirrorBase:
    process.env.MIRROR_BASE ||
    ((process.env.HEDERA_NETWORK || "testnet") === "mainnet"
      ? "https://mainnet.mirrornode.hedera.com"
      : "https://testnet.mirrornode.hedera.com"),

  tokens: {
    hUSD: process.env.TOKEN_HUSD || "0.0.8052711",
    hEUR: process.env.TOKEN_HEUR || "0.0.8052712",
    decimals: 6,
  },

  pool: {
    accountId: process.env.POOL_ACCOUNT_ID || "0.0.8052715",
    feeBps: 30,
  },

  faucet: {
    accountId: process.env.FAUCET_ACCOUNT_ID || "0.0.8052716",
    // optional to keep in CONFIG (source of truth is .env)
    privateKey: process.env.FAUCET_KEY || null,
  },
};