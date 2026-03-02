(() => {
  const isLocal =
    location.hostname === "localhost" ||
    location.hostname === "127.0.0.1";

  const apiBase = isLocal
    ? "http://127.0.0.1:8787"
    : "https://hashswap.onrender.com";

  // Support all config names used across pages/scripts
  window.HASHSWAP_CONFIG = Object.assign(window.HASHSWAP_CONFIG || {}, { apiBase });
  window.HASHSWAP_METRICS = Object.assign(window.HASHSWAP_METRICS || {}, { apiBase });

  // Optional: also expose a simple alias if any script uses it later
  window.HASHSWAP_API_BASE = apiBase;
})();