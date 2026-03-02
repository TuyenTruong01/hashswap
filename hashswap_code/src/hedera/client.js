// src/hedera/client.js
import { Client, AccountId, PrivateKey } from "@hashgraph/sdk";

let _client = null;
let _operatorKey = null;
let _operatorId = null;
let _faucetKey = null;

function mustEnv(name) {
  const v = String(process.env[name] ?? "").trim();
  if (!v) throw new Error(`Missing ${name} in .env`);
  return v;
}

// Generic key parser (supports DER hex, raw hex, and sdk string formats)
function parseKeyFromEnv(envName) {
  const s0 = String(process.env[envName] ?? "").trim();
  if (!s0) throw new Error(`Missing ${envName} in .env`);

  const s = s0.startsWith("0x") ? s0.slice(2) : s0;

  // DER hex usually starts with 30...
  if (/^[0-9a-fA-F]+$/.test(s) && s.startsWith("30")) {
    return PrivateKey.fromStringDer(s);
  }

  // RAW HEX (HashPack-style): force ECDSA
  if (/^[0-9a-fA-F]+$/.test(s)) {
    return PrivateKey.fromStringECDSA(s);
  }

  // fallback (ED25519 string / mnemonic / etc.)
  return PrivateKey.fromString(s0);
}

function buildClient() {
  const net = String(process.env.HEDERA_NETWORK || "testnet").trim().toLowerCase();

  let client;
  if (net === "mainnet") client = Client.forMainnet();
  else if (net === "previewnet") client = Client.forPreviewnet();
  else client = Client.forTestnet();

  _operatorId = AccountId.fromString(mustEnv("OPERATOR_ID"));
  _operatorKey = parseKeyFromEnv("OPERATOR_KEY");

  client.setOperator(_operatorId, _operatorKey);
  return client;
}

export function getClient() {
  if (_client) return _client;
  _client = buildClient();
  return _client;
}

// ✅ explicit signing keys
export function getOperatorKey() {
  if (!_operatorKey) getClient();
  return _operatorKey;
}

export function getOperatorId() {
  if (!_operatorId) getClient();
  return _operatorId;
}

// ✅ faucet signer key (for scheduled transfers from faucet_treasury)
export function getFaucetKey() {
  if (_faucetKey) return _faucetKey;
  _faucetKey = parseKeyFromEnv("FAUCET_KEY");
  return _faucetKey;
}