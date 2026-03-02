import "dotenv/config";
import { readJson } from "./_helpers.js";

const DEPLOYED_PATH = "./data/deployed.json";

function must(x, msg) {
  if (!x) throw new Error(msg);
  return x;
}

async function fetchJson(url) {
  const r = await fetch(url);
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t}`);
  return JSON.parse(t);
}

async function main() {
  const deployed = readJson(DEPLOYED_PATH, {});
  const mirror = process.env.MIRROR_NODE || "https://testnet.mirrornode.hedera.com";

  const hUSD = must(deployed?.tokens?.hUSD, "Missing hUSD in deployed.json");
  const hEUR = must(deployed?.tokens?.hEUR, "Missing hEUR in deployed.json");

  const poolId = must(deployed?.accounts?.pool_husd_heur?.accountId, "Missing pool account");
  const faucetId = must(deployed?.accounts?.faucet_treasury?.accountId, "Missing faucet account");

  console.log("=== Tokens ===");
  console.log("hUSD:", hUSD, `${mirror}/api/v1/tokens/${hUSD}`);
  console.log("hEUR:", hEUR, `${mirror}/api/v1/tokens/${hEUR}`);

  console.log("\n=== Pool balances ===");
  console.log(`${mirror}/api/v1/balances?account.id=${poolId}&limit=1`);
  console.log(await fetchJson(`${mirror}/api/v1/balances?account.id=${poolId}&limit=1`));

  console.log("\n=== Faucet balances ===");
  console.log(`${mirror}/api/v1/balances?account.id=${faucetId}&limit=1`);
  console.log(await fetchJson(`${mirror}/api/v1/balances?account.id=${faucetId}&limit=1`));
}

main().catch((e) => {
  console.error("❌ 05_verify_mirror failed:", e);
  process.exit(1);
});