// Mirror helper (no SDK needed)
export async function mirrorHealth(mirrorBase) {
  const url = `${mirrorBase}/api/v1/network/nodes?limit=1`;
  const r = await fetch(url, { method: "GET" });

  if (!r.ok) {
    throw new Error(`Mirror health failed: HTTP ${r.status}`);
  }

  const json = await r.json();
  return {
    ok: true,
    sampleNodeCount: json?.nodes?.length ?? 0,
  };
}
export async function mirrorGetAccountBalances(mirrorBase, accountId) {
  const url = `${mirrorBase}/api/v1/balances?account.id=${accountId}&limit=1`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Mirror balances failed: HTTP ${r.status}`);
  return await r.json();
}

export async function mirrorGetTokenInfo(mirrorBase, tokenId) {
  const url = `${mirrorBase}/api/v1/tokens/${tokenId}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Mirror token info failed: HTTP ${r.status}`);
  return await r.json();
}