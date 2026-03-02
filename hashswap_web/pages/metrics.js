const CFG = window.HASHSWAP_METRICS || {};
const API = String(CFG.apiBase || "http://127.0.0.1:8787").replace(/\/$/, "");

const $ = (id) => document.getElementById(id);

const fmtNum = (n, dp = 0) => {
  const x = Number(n);
  if (!Number.isFinite(x)) return "—";
  return x.toLocaleString("en-US", { maximumFractionDigits: dp });
};
const fmtUsd = (n, dp = 0) => "$" + fmtNum(n, dp);

const esc = (s) =>
  String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(String(text));
    return true;
  } catch {
    return false;
  }
}

function markOk() {
  window.HASHSWAP_METRICS_MARK_OK && window.HASHSWAP_METRICS_MARK_OK();
}
function markErr() {
  window.HASHSWAP_METRICS_MARK_ERR && window.HASHSWAP_METRICS_MARK_ERR();
}

// Build Mirror Node helper links from mirrorBase + pool account id
function buildPoolLinks(mirrorBase, poolId) {
  if (!mirrorBase || !poolId) return { balances: "", txs: "" };
  const base = String(mirrorBase).replace(/\/$/, "");
  const id = encodeURIComponent(String(poolId));
  return {
    balances: `${base}/api/v1/balances?account.id=${id}&limit=200`,
    txs: `${base}/api/v1/transactions?account.id=${id}&order=desc&limit=25`,
  };
}

function renderLinksBox(linksObj) {
  const box = $("linksBox");
  if (!box) return;

  const entries = Object.entries(linksObj || {}).filter(
    ([, v]) => typeof v === "string" && v.startsWith("http")
  );

  if (!entries.length) {
    box.textContent = "—";
    return;
  }

  box.innerHTML = entries
    .map(([k, v]) => {
      const key = esc(k);
      const url = esc(v);
      return `
        <div class="row" style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
          <span class="key" style="min-width:160px;"><b>${key}:</b></span>
          <a href="${url}" target="_blank" rel="noreferrer" style="word-break:break-all;">${url}</a>
          <button class="btn btn--ghost" type="button" data-copy="${url}" style="padding:6px 10px;">Copy</button>
        </div>
      `;
    })
    .join("");

  // bind copy buttons
  box.querySelectorAll("button[data-copy]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const t = btn.getAttribute("data-copy") || "";
      const ok = await copyToClipboard(t);
      btn.textContent = ok ? "Copied" : "Copy failed";
      setTimeout(() => (btn.textContent = "Copy"), 900);
    });
  });
}

async function loadMetrics() {
  try {
    const r = await fetch(`${API}/api/metrics`, { cache: "no-store" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const m = await r.json();

    // KPIs
    const tvlTotal = Number(m?.tvl?.totalUsdApprox ?? 0);
    const elTvl = $("kpiTvl");
    if (elTvl) elTvl.textContent = fmtUsd(tvlTotal, 0);

    const vol24 = Number(m?.volume?.["24h"] ?? 0);
    const elVol = $("kpiVol24");
    if (elVol) elVol.textContent = fmtUsd(vol24, 0);

    const elUsers = $("kpiUsers");
    if (elUsers) elUsers.textContent = String(m?.uniqueWallets24h ?? 0);

    const elTx = $("kpiTx");
    if (elTx) elTx.textContent = String(m?.txCount24h ?? 0);

    // Pools table
    const pools = Array.isArray(m?.tvl?.byPool) ? m.tvl.byPool : [];
    const body = $("poolsRows");

    // Mirror base (prefer backend links.mirrorBase)
    const mirrorBase =
      (typeof m?.links?.mirrorBase === "string" && m.links.mirrorBase) ||
      "https://testnet.mirrornode.hedera.com";

    if (body) {
      if (!pools.length) {
        body.innerHTML = `<tr><td colspan="5">—</td></tr>`;
      } else {
        body.innerHTML = pools
          .map((p) => {
            const rsv = p?.reserves || {};
            const husd = Number(rsv.hUSD ?? 0);
            const heur = Number(rsv.hEUR ?? 0);
            const tvl = Number(p?.tvlUsdApprox ?? (husd + heur) ?? 0);

            const pair = esc(p?.pair || "hUSD/hEUR");
            const poolId = esc(p?.poolAccountId || "—");

            const links = buildPoolLinks(mirrorBase, p?.poolAccountId);
            const balUrl = links.balances ? esc(links.balances) : "";
            const txUrl = links.txs ? esc(links.txs) : "";

            // Pool Account cell includes quick verify links
            const poolCell =
              poolId === "—"
                ? "—"
                : `
                  <div style="display:flex; flex-direction:column; gap:6px;">
                    <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
                      <span>${poolId}</span>
                      <button class="btn btn--ghost" type="button" data-copy="${poolId}" style="padding:6px 10px;">Copy</button>
                    </div>
                    <div class="muted" style="display:flex; gap:10px; flex-wrap:wrap;">
                      ${balUrl ? `<a href="${balUrl}" target="_blank" rel="noreferrer">balances</a>` : ""}
                      ${txUrl ? `<a href="${txUrl}" target="_blank" rel="noreferrer">transactions</a>` : ""}
                    </div>
                  </div>
                `;

            return `
              <tr>
                <td>${pair}</td>
                <td>${poolCell}</td>
                <td>${fmtNum(husd, 0)}</td>
                <td>${fmtNum(heur, 0)}</td>
                <td>${fmtUsd(tvl, 0)}</td>
              </tr>
            `;
          })
          .join("");

        // bind copy buttons in table
        body.querySelectorAll("button[data-copy]").forEach((btn) => {
          btn.addEventListener("click", async () => {
            const t = btn.getAttribute("data-copy") || "";
            const ok = await copyToClipboard(t);
            btn.textContent = ok ? "Copied" : "Copy failed";
            setTimeout(() => (btn.textContent = "Copy"), 900);
          });
        });
      }
    }

    // Links
    renderLinksBox(m?.links || {});

    markOk();
  } catch (e) {
    console.error("[metrics] load failed:", e);

    const body = $("poolsRows");
    if (body)
      body.innerHTML = `<tr><td colspan="5">Error: ${esc(e?.message || e)}</td></tr>`;

    const links = $("linksBox");
    if (links) links.textContent = "—";

    markErr();
  }
}

document.addEventListener("DOMContentLoaded", () => {
  loadMetrics();
  setInterval(loadMetrics, 15000);
});