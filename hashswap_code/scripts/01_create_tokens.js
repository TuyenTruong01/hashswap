import "dotenv/config";
import {
  Client,
  AccountId,
  PrivateKey,
  TokenCreateTransaction,
  TokenSupplyType,
  Hbar,
} from "@hashgraph/sdk";
import { upsertDeployed } from "./_helpers.js";

const DEPLOYED_PATH = "./data/deployed.json";

function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

async function createFungible({
  client,
  treasuryId,
  treasuryKey,
  name,
  symbol,
  decimals,
  initialSupplyTiny,
  maxSupplyTiny,
}) {
  const tx = await new TokenCreateTransaction()
    .setTokenName(name)
    .setTokenSymbol(symbol)
    .setDecimals(decimals)
    .setInitialSupply(initialSupplyTiny)
    .setTreasuryAccountId(treasuryId)
    .setSupplyType(TokenSupplyType.Finite)
    .setMaxSupply(maxSupplyTiny)
    .setSupplyKey(treasuryKey) // supply controlled by operator for now
    .setAdminKey(treasuryKey)
    .setFreezeKey(treasuryKey)
    .setWipeKey(treasuryKey)
    .setPauseKey(treasuryKey)
    .setTransactionMemo("HashSwap: create stable token")
    .setMaxTransactionFee(new Hbar(30))
    .execute(client);

  const receipt = await tx.getReceipt(client);
  return receipt.tokenId.toString();
}

async function main() {
  const network = process.env.HEDERA_NETWORK || "testnet";
  const operatorId = AccountId.fromString(mustEnv("OPERATOR_ID"));
  const rawKey = String(mustEnv("OPERATOR_KEY")).trim();

let operatorKey;
try {
  // ECDSA DER keys commonly start with 302e...
  if (rawKey.startsWith("302e")) {
    operatorKey = PrivateKey.fromStringDer(rawKey);
  } else {
    operatorKey = PrivateKey.fromStringECDSA(rawKey);
  }
} catch (e1) {
  try {
    operatorKey = PrivateKey.fromStringED25519(rawKey);
  } catch (e2) {
    operatorKey = PrivateKey.fromString(rawKey); // fallback
  }
}

  const client =
    network === "mainnet" ? Client.forMainnet() : Client.forTestnet();
  client.setOperator(operatorId, operatorKey);

  const DECIMALS = 6;
  const ONE = 10 ** DECIMALS;

  // 1,000,000,000 tokens (UI) => tiny = 1,000,000,000 * 10^6
  const TOTAL_SUPPLY_UI = 1_000_000_000;
  const TOTAL_SUPPLY_TINY = TOTAL_SUPPLY_UI * ONE;

  console.log("Creating tokens...");
  const hUSD = await createFungible({
    client,
    treasuryId: operatorId,
    treasuryKey: operatorKey,
    name: "Hash USD",
    symbol: "hUSD",
    decimals: DECIMALS,
    initialSupplyTiny: TOTAL_SUPPLY_TINY,
    maxSupplyTiny: TOTAL_SUPPLY_TINY,
  });

  const hEUR = await createFungible({
    client,
    treasuryId: operatorId,
    treasuryKey: operatorKey,
    name: "Hash EUR",
    symbol: "hEUR",
    decimals: DECIMALS,
    initialSupplyTiny: TOTAL_SUPPLY_TINY,
    maxSupplyTiny: TOTAL_SUPPLY_TINY,
  });

  const deployed = upsertDeployed(DEPLOYED_PATH, {
    network,
    operatorId: operatorId.toString(),
    tokens: { hUSD, hEUR, decimals: DECIMALS },
  });

  console.log("✅ Tokens created:");
  console.log("hUSD:", hUSD);
  console.log("hEUR:", hEUR);
  console.log("Saved:", deployed);
}

main().catch((e) => {
  console.error("❌ 01_create_tokens failed:", e);
  process.exit(1);
});