import "dotenv/config";
import {
  Client,
  AccountId,
  PrivateKey,
  AccountCreateTransaction,
  Hbar,
} from "@hashgraph/sdk";
import { upsertDeployed, writeJson, readJson } from "./_helpers.js";

const DEPLOYED_PATH = "./data/deployed.json";
const POOLS_PATH = "./data/pools.json";

function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

async function createAccount(client, initialHbar = 5) {
  const key = PrivateKey.generateECDSA();
  const tx = await new AccountCreateTransaction()
    .setKey(key.publicKey)
    .setInitialBalance(new Hbar(initialHbar))
    .setTransactionMemo("HashSwap: create pool/faucet account")
    .execute(client);

  const receipt = await tx.getReceipt(client);
  return {
    accountId: receipt.accountId.toString(),
    privateKey: key.toStringDer(), // store locally only (do NOT commit)
    publicKey: key.publicKey.toString(),
  };
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
  const tokens = deployed?.tokens;
  if (!tokens?.hUSD || !tokens?.hEUR) {
    throw new Error(
      "Missing tokens in deployed.json. Run scripts/01_create_tokens.js first."
    );
  }

  console.log("Creating pool account for hUSD/hEUR...");
  const pool = await createAccount(client, 10);

  console.log("Creating faucet treasury account...");
  const faucet = await createAccount(client, 10);

  // Save pool configs (expandable)
  const pools = {
    network,
    pools: [
      {
        id: "husd_heur",
        pair: "hUSD/hEUR",
        feeBps: 30,
        accountId: pool.accountId,
      },
    ],
    faucet: {
      accountId: faucet.accountId,
      dailyLimitUi: 100, // UI only for now (enforce later)
    },
    createdAt: new Date().toISOString(),
  };

  writeJson(POOLS_PATH, pools);

  // Put account keys into deployed.json (LOCAL ONLY)
  // IMPORTANT: your .gitignore must exclude data/deployed.json and data/pools.json
  const next = upsertDeployed(DEPLOYED_PATH, {
    network,
    accounts: {
      pool_husd_heur: pool,
      faucet_treasury: faucet,
    },
    pool: { accountId: pool.accountId, feeBps: 30 },
  });

  console.log("✅ Accounts created:");
  console.log("Pool:", pool.accountId);
  console.log("Faucet:", faucet.accountId);
  console.log("Saved pools.json + deployed.json");
  console.log(next);
}

main().catch((e) => {
  console.error("❌ 02_create_pool_accounts failed:", e);
  process.exit(1);
});