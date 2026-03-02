import { mirrorHealth } from "../hedera/mirror.js";

export async function getState(CONFIG) {
  const mirror = await mirrorHealth(CONFIG.mirrorBase);

  return {
    status: "ok",
    network: CONFIG.network,
    mirrorBase: CONFIG.mirrorBase,
    mirror,
    tokens: CONFIG.tokens,
    pool: CONFIG.pool,
    timestamp: new Date().toISOString(),
  };
}