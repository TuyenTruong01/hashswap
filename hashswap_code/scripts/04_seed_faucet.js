import "dotenv/config";
import {
  Client,
  AccountId,
  PrivateKey,
  TokenAssociateTransaction,
  TransferTransaction,
  Hbar,
} from "@hashgraph/sdk";
import { readJson } from "./_helpers.js";

const DEPLOYED_PATH = "./data/deployed.json";

function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

async function associateToken(client, accountId, accountKey, tokenIds) {
  const tx = await new TokenAssociateTransaction()
    .setAccountId(accountId)
    .setTokenIds(tokenIds)
    .setMaxTransactionFee(new Hbar(10))
    .freezeWith(client)
    .sign(accountKey);

  const resp = await tx.execute(client);
  await resp.getReceipt(client);
}

async function main() {
  const network = process.env.HEDERA_NETWORK || "testnet";
  const operatorId = AccountId.fromString(mustEnv("OPERATOR_ID"));
  const rawKey = String(mustEnv("OPERATOR_KEY")).trim();

let operatorKey;
try {
  if (rawKey.startsWith("302e")) {
    operatorKey = PrivateKey.fromStringDer(rawKey);
  } else {
    operatorKey = PrivateKey.fromStringECDSA(rawKey);
  }
} catch (e1) {
  try {
    operatorKey = PrivateKey.fromStringED25519(rawKey);
  } catch (e2) {
    operatorKey = PrivateKey.fromString(rawKey);
  }
}

  const client =
    network === "mainnet" ? Client.forMainnet() : Client.forTestnet();
  client.setOperator(operatorId, operatorKey);

  const deployed = readJson(DEPLOYED_PATH, {});
  const { hUSD, hEUR, decimals } = deployed.tokens;
  const faucetAcc = deployed.accounts.faucet_treasury;

  if (!faucetAcc?.accountId || !faucetAcc?.privateKey) {
    throw new Error("Missing faucet account in deployed.json. Run 02 first.");
  }

  const faucetId = AccountId.fromString(faucetAcc.accountId);
  const faucetKey = PrivateKey.fromStringDer(faucetAcc.privateKey);

  const ONE = 10 ** decimals;
  const SEED_UI = 200_000;
  const SEED_TINY = SEED_UI * ONE;

  console.log("Associating faucet with tokens...");
  await associateToken(client, faucetId, faucetKey, [hUSD, hEUR]);
  console.log("✅ Associated.");

  console.log("Seeding faucet balances...");
  const tx = await new TransferTransaction()
    .addTokenTransfer(hUSD, operatorId, -SEED_TINY)
    .addTokenTransfer(hUSD, faucetId, SEED_TINY)
    .addTokenTransfer(hEUR, operatorId, -SEED_TINY)
    .addTokenTransfer(hEUR, faucetId, SEED_TINY)
    .setTransactionMemo("HashSwap: seed faucet")
    .execute(client);

  await tx.getReceipt(client);
  console.log("✅ Seeded faucet:", faucetAcc.accountId);
  console.log("hUSD:", SEED_UI, "hEUR:", SEED_UI);
}

main().catch((e) => {
  console.error("❌ 04_seed_faucet failed:", e);
  process.exit(1);
});