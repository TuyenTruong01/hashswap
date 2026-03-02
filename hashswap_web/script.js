// ===============================
// IMPORTS (ESM)
// ===============================
import {
  DAppConnector,
  HederaJsonRpcMethod,
  HederaSessionEvent,
  HederaChainId,
} from "https://esm.sh/@hashgraph/hedera-wallet-connect@1.5.1?bundle";

import { LedgerId, Transaction } from "https://esm.sh/@hiero-ledger/sdk@2.70.0?bundle";

// ===============================
// CONFIG
// ===============================
const CONFIG = window.HASHSWAP_CONFIG || {};
const API = String(CONFIG.apiBase || "http://127.0.0.1:8787").replace(/\/$/, "");
const PROJECT_ID = String(CONFIG.wcProjectId || "").trim();

const $ = (id) => document.getElementById(id);

let dAppConnector = null;
let accountId = null;
let currentSigner = null;

// ===============================
// STATE + POOL SNAPSHOT
// ===============================
let STATE = {
  mirrorBase: "https://testnet.mirrornode.hedera.com",
  tokens: { hUSD: "", hEUR: "" },
  decimals: { hUSD: 6, hEUR: 6 },
  pool: { accountId: "", feeBps: 30 },
};

let POOL = { reserveHUSD: 0, reserveHEUR: 0, feeBps: 30 };

// Deposits (ledger v1)
let USER_DEPOSITS = { hUSD: 0, hEUR: 0 };

// ===============================
// UTILS
// ===============================
function toNum(v) {
  const x = Number(String(v ?? "").trim());
  return Number.isFinite(x) ? x : 0;
}

function setStatusPill(id, text, show = true) {
  const el = $(id);
  if (!el) return;
  el.textContent = text || "—";
  el.style.display = show ? "inline-flex" : "none";
}

function setBtnDisabled(id, disabled) {
  const el = $(id);
  if (!el) return;
  el.disabled = !!disabled;
}

function setPillAccount(text) {
  const pill = $("pillAccount");
  if (!pill) return;
  pill.textContent = text || "—";
  pill.style.display = text ? "block" : "none";
}

function setConnectButton(text, disabled = false) {
  const btn = $("btnConnect");
  if (!btn) return;
  btn.textContent = text;
  btn.disabled = disabled;
}

function disableApp() {
  [
    "btnSwap",
    "btnLiquidityAdd",
    "btnLiquidityRefresh",
    "btnLiquidityRemove",
    "btnFaucetHUSD",
    "btnFaucetHEUR",
  ].forEach((id) => setBtnDisabled(id, true));
}

function enableApp() {
  [
    "btnSwap",
    "btnLiquidityAdd",
    "btnLiquidityRefresh",
    "btnLiquidityRemove",
    "btnFaucetHUSD",
    "btnFaucetHEUR",
  ].forEach((id) => setBtnDisabled(id, false));
}

// ===============================
// ROUTER
// ===============================
const ROUTES = ["swap", "liquidity", "faucet"];

function showView(routeRaw) {
  const route = ROUTES.includes(routeRaw) ? routeRaw : "swap";

  ROUTES.forEach((name) => {
    const v = document.getElementById("view-" + name);
    if (v) v.classList.toggle("is-active", name === route);
  });

  const setTabActive = (id, on) => {
    const a = $(id);
    if (a) a.classList.toggle("is-active", !!on);
  };

  setTabActive("tabSwap", route === "swap");
  setTabActive("tabLiq", route === "liquidity");
  setTabActive("tabFaucet", route === "faucet");

  setTabActive("tabSwap2", route === "swap");
  setTabActive("tabLiq2", route === "liquidity");
  setTabActive("tabFaucet2", route === "faucet");

  setTabActive("tabSwap3", route === "swap");
  setTabActive("tabLiq3", route === "liquidity");
  setTabActive("tabFaucet3", route === "faucet");

  const wa = $("workArea");
  if (wa) wa.scrollTo({ top: 0 });
}

function initRouter() {
  showView((location.hash || "#swap").replace("#", ""));
  window.addEventListener("hashchange", () => {
    showView((location.hash || "#swap").replace("#", ""));
  });
}

// ===============================
// LOAD STATE + METRICS
// ===============================
async function loadState() {
  const r = await fetch(`${API}/api/state`, { cache: "no-store" });
  const s = await r.json();
  if (!r.ok) throw new Error(s?.message || `HTTP ${r.status}`);

  STATE.mirrorBase = String(s?.mirrorBase || STATE.mirrorBase);
  STATE.tokens = { hUSD: String(s?.tokens?.hUSD || ""), hEUR: String(s?.tokens?.hEUR || "") };

  const d = Number(s?.tokens?.decimals ?? 6);
  STATE.decimals = { hUSD: d, hEUR: d };

  STATE.pool = {
    accountId: String(s?.pool?.accountId || ""),
    feeBps: Number(s?.pool?.feeBps ?? 30),
  };

  POOL.feeBps = STATE.pool.feeBps;
}

async function loadPoolSnapshot() {
  const r = await fetch(`${API}/api/metrics`, { cache: "no-store" });
  const m = await r.json();
  if (!r.ok) throw new Error(m?.message || `HTTP ${r.status}`);

  const reserves = m?.tvl?.byPool?.[0]?.reserves || {};
  POOL.reserveHUSD = Number(reserves.hUSD || 0);
  POOL.reserveHEUR = Number(reserves.hEUR || 0);

  const ratio =
    POOL.reserveHUSD > 0 && POOL.reserveHEUR > 0
      ? `${(POOL.reserveHUSD / POOL.reserveHEUR).toFixed(6)} hUSD per hEUR`
      : "—";
  const el = $("poolRatio");
  if (el) el.textContent = ratio;
}

// ===============================
// QUOTE (frontend XYK, matching backend logic)
// ===============================
function quoteXYK_js({ reserveIn, reserveOut, amountIn, feeBps }) {
  const x = Number(reserveIn);
  const y = Number(reserveOut);
  const dx = Number(amountIn);
  if (!(x > 0) || !(y > 0) || !(dx > 0)) return 0;

  const fee = 1 - (Number(feeBps || 0) / 10000);
  const dxNet = dx * fee;
  const out = (y * dxNet) / (x + dxNet);
  return out > 0 ? out : 0;
}

function updateSwapQuoteUI() {
  const from = $("swapFrom")?.value || "hUSD";
  const to = $("swapTo")?.value || "hEUR";
  const amountIn = toNum($("swapAmountIn")?.value);

  if (!amountIn || amountIn <= 0 || from === to) {
    if ($("swapAmountOut")) $("swapAmountOut").value = "0";
    if ($("rateHint")) $("rateHint").textContent = "—";
    if ($("swapQuoteInfo")) $("swapQuoteInfo").textContent = "—";
    return;
  }

  const reserveIn = from === "hUSD" ? POOL.reserveHUSD : POOL.reserveHEUR;
  const reserveOut = to === "hEUR" ? POOL.reserveHEUR : POOL.reserveHUSD;

  const out = quoteXYK_js({ reserveIn, reserveOut, amountIn, feeBps: POOL.feeBps });
  if ($("swapAmountOut")) $("swapAmountOut").value = out ? out.toFixed(6) : "0";

  const oneOut = quoteXYK_js({ reserveIn, reserveOut, amountIn: 1, feeBps: POOL.feeBps });
  if ($("rateHint")) $("rateHint").textContent = oneOut ? `1 ${from} ≈ ${oneOut.toFixed(6)} ${to}` : "—";

  if ($("swapQuoteInfo"))
    $("swapQuoteInfo").textContent = `fee: ${POOL.feeBps} bps • reserves: ${reserveIn.toFixed(0)} / ${reserveOut.toFixed(0)}`;
}

// ===============================
// BALANCES (via backend /api/balances)
// ===============================
async function loadWalletBalances() {
  if (!accountId) return { hUSD: 0, hEUR: 0 };

  const url = `${API}/api/balances?accountId=${encodeURIComponent(accountId)}`;
  const r = await fetch(url, { cache: "no-store" });
  const b = await r.json();
  if (!r.ok) throw new Error(b?.message || b?.error || `HTTP ${r.status}`);

  return { hUSD: Number(b?.hUSD || 0), hEUR: Number(b?.hEUR || 0) };
}

async function refreshBalancesUI() {
  if (!accountId) return;

  const b = await loadWalletBalances();
  const husd = Number(b?.hUSD || 0);
  const heur = Number(b?.hEUR || 0);

  const mini = $("miniBalances");
  if (mini) mini.textContent = `hUSD: ${husd} | hEUR: ${heur}`;

  const from = $("swapFrom")?.value || "hUSD";
  const to = $("swapTo")?.value || "hEUR";

  const balFrom = from === "hUSD" ? husd : heur;
  const balTo = to === "hUSD" ? husd : heur;

  if ($("balFrom")) $("balFrom").textContent = String(balFrom);
  if ($("balTo")) $("balTo").textContent = String(balTo);

  if ($("balLiqHUSD")) $("balLiqHUSD").textContent = String(husd);
  if ($("balLiqHEUR")) $("balLiqHEUR").textContent = String(heur);
}

// ===============================
// DEPOSITS (backend ledger)
// ===============================
async function loadUserDeposits() {
  if (!accountId) return { hUSD: 0, hEUR: 0 };

  const r = await fetch(`${API}/api/liquidity/user?accountId=${encodeURIComponent(accountId)}`, { cache: "no-store" });
  const d = await r.json();
  if (!r.ok) throw new Error(d?.message || d?.error || `HTTP ${r.status}`);

  return { hUSD: Number(d?.hUSD || 0), hEUR: Number(d?.hEUR || 0) };
}

function updateRemovePreview() {
  const pctBps = Number($("liqRemovePct")?.value || 1000);
  const h = (Number(USER_DEPOSITS.hUSD || 0) * pctBps) / 10000;
  const e = (Number(USER_DEPOSITS.hEUR || 0) * pctBps) / 10000;

  if ($("liqRemovePreview")) {
    $("liqRemovePreview").textContent = (h > 0 || e > 0)
      ? `hUSD ${h.toFixed(6)} + hEUR ${e.toFixed(6)}`
      : "—";
  }
}

async function refreshDepositsUI() {
  if (!accountId) {
    if ($("liqUserTotals")) $("liqUserTotals").textContent = "—";
    if ($("liqRemovePreview")) $("liqRemovePreview").textContent = "—";
    return;
  }

  USER_DEPOSITS = await loadUserDeposits();
  if ($("liqUserTotals")) $("liqUserTotals").textContent = `hUSD ${USER_DEPOSITS.hUSD} • hEUR ${USER_DEPOSITS.hEUR}`;
  updateRemovePreview();
}

// ===============================
// LIQUIDITY AUTO-FILL
// ===============================
let LIQ_EDIT = "HUSD";

function updateLiquidityAutoFill() {
  const husd = toNum($("liqAddHUSD")?.value);
  const heur = toNum($("liqAddHEUR")?.value);

  if (!(POOL.reserveHUSD > 0 && POOL.reserveHEUR > 0)) {
    if ($("willAdd")) $("willAdd").textContent = (husd > 0 || heur > 0) ? `hUSD ${husd} + hEUR ${heur}` : "—";
    return;
  }

  const r = POOL.reserveHUSD / POOL.reserveHEUR; // husd/heur

  if (LIQ_EDIT === "HUSD") {
    const v = husd / r;
    if ($("liqAddHEUR")) $("liqAddHEUR").value = husd > 0 ? v.toFixed(6) : "";
  } else {
    const v = heur * r;
    if ($("liqAddHUSD")) $("liqAddHUSD").value = heur > 0 ? v.toFixed(6) : "";
  }

  const hh = toNum($("liqAddHUSD")?.value);
  const ee = toNum($("liqAddHEUR")?.value);
  if ($("willAdd")) $("willAdd").textContent = (hh > 0 && ee > 0) ? `hUSD ${hh} + hEUR ${ee}` : "—";
}

// ===============================
// WALLET CONNECT
// ===============================
async function ensureConnector() {
  if (dAppConnector) return dAppConnector;

  const metadata = {
    name: "HashSwap",
    description: "HashSwap Testnet",
    url: window.location.origin,
    icons: [],
  };

  dAppConnector = new DAppConnector(
    metadata,
    LedgerId.TESTNET,
    PROJECT_ID,
    Object.values(HederaJsonRpcMethod),
    [HederaSessionEvent.ChainChanged, HederaSessionEvent.AccountsChanged],
    [HederaChainId.Testnet]
  );

  await dAppConnector.init({ logger: "error" });
  return dAppConnector;
}

async function connectWallet() {
  try {
    setConnectButton("Connecting…", true);

    const c = await ensureConnector();
    await c.openModal();

    const signer = c.signers?.[0];
    if (!signer) throw new Error("No signer found");

    currentSigner = signer;
    accountId = signer.getAccountId().toString();

    setPillAccount(accountId);
    enableApp();
    setConnectButton("Connected", true);
    if ($("miniStatus")) $("miniStatus").textContent = "Connected";

    await refreshBalancesUI();
    await refreshDepositsUI();
    updateSwapQuoteUI();
    updateLiquidityAutoFill();

  } catch (err) {
    alert(err.message);
    setConnectButton("Connect HashPack", false);
  }
}

// ===============================
// SIGN TX helpers
// ===============================
function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToBase64(u8) {
  return btoa(String.fromCharCode(...u8));
}

async function signTxBytesBase64(txBytesBase64) {
  const txBytes = base64ToBytes(txBytesBase64);
  const tx = Transaction.fromBytes(txBytes);
  const signed = await currentSigner.signTransaction(tx);
  return bytesToBase64(signed.toBytes());
}

// ===============================
// SWAP FLOW
// ===============================
async function swapFlow() {
  if (!accountId) return alert("Connect wallet first");

  setStatusPill("swapStatus", "Building swap...", true);
  setBtnDisabled("btnSwap", true);

  try {
    const from = $("swapFrom").value;
    const to = $("swapTo").value;
    const amountIn = toNum($("swapAmountIn").value);

    const slipSel = $("swapSlippage")?.value || "auto";
    const slippageBps = slipSel === "auto" ? 50 : Number(slipSel);

    const built = await fetch(`${API}/api/swap/build`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userAccountId: accountId, from, to, amountIn, slippageBps })
    }).then((r) => r.json());

    if (!built?.txBytesBase64) throw new Error(built?.message || "Missing txBytesBase64");

    const signed = await signTxBytesBase64(built.txBytesBase64);

    const submit = await fetch(`${API}/api/tx/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ signedTxBytesBase64: signed })
    }).then((r) => r.json());

    if (submit?.scheduleId) {
      await fetch(`${API}/api/swap/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduleId: submit.scheduleId })
      }).then((r) => r.json());
    }

    setStatusPill("swapStatus", "✅ Swap successful", true);

    await loadPoolSnapshot().catch(() => {});
    await refreshBalancesUI().catch(() => {});
    updateSwapQuoteUI();

  } catch (e) {
    setStatusPill("swapStatus", "❌ " + (e?.message || String(e)), true);
  } finally {
    setBtnDisabled("btnSwap", false);
  }
}

// ===============================
// LIQUIDITY ADD FLOW
// ===============================
async function liquidityAddFlow() {
  if (!accountId) return alert("Connect wallet first");

  setStatusPill("liqStatus", "Building liquidity...", true);
  setBtnDisabled("btnLiquidityAdd", true);

  try {
    const amountHUSD = toNum($("liqAddHUSD").value);
    const amountHEUR = toNum($("liqAddHEUR").value);

    const built = await fetch(`${API}/api/liquidity/add/build`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userAccountId: accountId, amountHUSD, amountHEUR })
    }).then((r) => r.json());

    if (!built?.txBytesBase64) throw new Error(built?.message || "Missing txBytesBase64");

    const signed = await signTxBytesBase64(built.txBytesBase64);

    const submit = await fetch(`${API}/api/tx/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ signedTxBytesBase64: signed })
    }).then((r) => r.json());

    if (!submit?.status) throw new Error("Submit failed");

    // record ledger (deposit)
    await fetch(`${API}/api/liquidity/record`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId, deltaHUSD: amountHUSD, deltaHEUR: amountHEUR })
    }).catch(() => {});

    setStatusPill("liqStatus", "✅ Liquidity added", true);

    await loadPoolSnapshot().catch(() => {});
    await refreshBalancesUI().catch(() => {});
    await refreshDepositsUI().catch(() => {});
    updateLiquidityAutoFill();

  } catch (e) {
    setStatusPill("liqStatus", "❌ " + (e?.message || String(e)), true);
  } finally {
    setBtnDisabled("btnLiquidityAdd", false);
  }
}

// ===============================
// LIQUIDITY REMOVE FLOW (by % of ledger)
// ===============================
async function liquidityRemoveFlow() {
  if (!accountId) return alert("Connect wallet first");

  const percentBps = Number($("liqRemovePct")?.value || 1000);

  setStatusPill("liqStatus", "Building remove...", true);
  setBtnDisabled("btnLiquidityRemove", true);

  try {
    const built = await fetch(`${API}/api/liquidity/remove/build`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userAccountId: accountId, percentBps })
    }).then((r) => r.json());

    if (!built?.txBytesBase64) throw new Error(built?.message || built?.error || "Missing txBytesBase64");

    const signed = await signTxBytesBase64(built.txBytesBase64);

    const submit = await fetch(`${API}/api/tx/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ signedTxBytesBase64: signed })
    }).then((r) => r.json());

    if (!submit?.scheduleId) throw new Error("Missing scheduleId");

    await fetch(`${API}/api/liquidity/remove/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scheduleId: submit.scheduleId })
    }).then((r) => r.json());

    // subtract ledger using backend computed amounts
    const amountHUSD = Number(built.amountHUSD || 0);
    const amountHEUR = Number(built.amountHEUR || 0);

    await fetch(`${API}/api/liquidity/record`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId, deltaHUSD: -amountHUSD, deltaHEUR: -amountHEUR })
    }).catch(() => {});

    setStatusPill("liqStatus", "✅ Removed", true);

    await loadPoolSnapshot().catch(() => {});
    await refreshBalancesUI().catch(() => {});
    await refreshDepositsUI().catch(() => {});
    updateLiquidityAutoFill();

  } catch (e) {
    setStatusPill("liqStatus", "❌ " + (e?.message || String(e)), true);
  } finally {
    setBtnDisabled("btnLiquidityRemove", false);
  }
}

// ===============================
// FAUCET FLOW (build -> sign -> submit -> execute)
// ===============================
async function faucetFlow(tokenSymbol) {
  if (!accountId) return alert("Connect wallet first");

  const amtId = tokenSymbol === "hUSD" ? "faucetAmtHUSD" : "faucetAmtHEUR";
  const amount = toNum($(amtId)?.value);

  setStatusPill("faucetStatus", `Building faucet ${tokenSymbol}...`, true);
  setBtnDisabled("btnFaucetHUSD", true);
  setBtnDisabled("btnFaucetHEUR", true);

  try {
    const built = await fetch(`${API}/api/faucet/build`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: tokenSymbol, userAccountId: accountId, amount })
    }).then((r) => r.json());

    if (!built?.txBytesBase64) throw new Error(built?.message || "Missing txBytesBase64");

    const signed = await signTxBytesBase64(built.txBytesBase64);

    const submit = await fetch(`${API}/api/tx/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ signedTxBytesBase64: signed })
    }).then((r) => r.json());

    if (!submit?.scheduleId) throw new Error("Missing scheduleId from submit");

    const exec = await fetch(`${API}/api/faucet/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scheduleId: submit.scheduleId, userAccountId: accountId, tokenSymbol })
    }).then((r) => r.json());

    if (exec?.error) throw new Error(exec?.error);

    setStatusPill("faucetStatus", `✅ Faucet ${tokenSymbol} done`, true);

    await refreshBalancesUI().catch(() => {});

  } catch (e) {
    setStatusPill("faucetStatus", "❌ " + (e?.message || String(e)), true);
  } finally {
    setBtnDisabled("btnFaucetHUSD", false);
    setBtnDisabled("btnFaucetHEUR", false);
  }
}

// ===============================
// INIT
// ===============================
document.addEventListener("DOMContentLoaded", async () => {
  disableApp();
  initRouter();
  setConnectButton("Connect HashPack", false);

  // preload state + pool snapshot
  try { await loadState(); } catch {}
  try { await loadPoolSnapshot(); } catch {}
  updateSwapQuoteUI();
  updateLiquidityAutoFill();

  // periodic refresh pool snapshot
  setInterval(() => loadPoolSnapshot().then(() => {
    updateSwapQuoteUI();
    updateLiquidityAutoFill();
  }).catch(() => {}), 15000);

  // connect
  $("btnConnect")?.addEventListener("click", connectWallet);

  // swap
  $("btnSwap")?.addEventListener("click", swapFlow);
  $("btnFlip")?.addEventListener("click", () => {
    const a = $("swapFrom").value;
    $("swapFrom").value = $("swapTo").value;
    $("swapTo").value = a;
    refreshBalancesUI().catch(() => {});
    updateSwapQuoteUI();
  });
  $("swapAmountIn")?.addEventListener("input", () => updateSwapQuoteUI());
  $("swapFrom")?.addEventListener("change", () => { refreshBalancesUI().catch(() => {}); updateSwapQuoteUI(); });
  $("swapTo")?.addEventListener("change", () => { refreshBalancesUI().catch(() => {}); updateSwapQuoteUI(); });
  $("swapSlippage")?.addEventListener("change", () => updateSwapQuoteUI());

  // liquidity
  $("btnLiquidityAdd")?.addEventListener("click", liquidityAddFlow);
  $("btnLiquidityRefresh")?.addEventListener("click", () => refreshDepositsUI().catch(() => {}));
  $("btnLiquidityRemove")?.addEventListener("click", liquidityRemoveFlow);
  $("liqRemovePct")?.addEventListener("change", updateRemovePreview);

  $("liqAddHUSD")?.addEventListener("input", () => { LIQ_EDIT = "HUSD"; updateLiquidityAutoFill(); });
  $("liqAddHEUR")?.addEventListener("input", () => { LIQ_EDIT = "HEUR"; updateLiquidityAutoFill(); });

  // faucet
  $("btnFaucetHUSD")?.addEventListener("click", () => faucetFlow("hUSD"));
  $("btnFaucetHEUR")?.addEventListener("click", () => faucetFlow("hEUR"));

  // reset
  $("btnResetUi")?.addEventListener("click", () => {
    if ($("swapAmountIn")) $("swapAmountIn").value = "";
    if ($("swapAmountOut")) $("swapAmountOut").value = "";
    if ($("liqAddHUSD")) $("liqAddHUSD").value = "";
    if ($("liqAddHEUR")) $("liqAddHEUR").value = "";
    setStatusPill("swapStatus", "", false);
    setStatusPill("liqStatus", "", false);
    setStatusPill("faucetStatus", "", false);
    updateSwapQuoteUI();
    updateLiquidityAutoFill();
  });
});