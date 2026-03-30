// PUFF Options Page — Section 11
// Persists to chrome.storage.local; popup reads from same storage.
// Per-book bankrolls: legs come from puff_cachedLegs (content script); see loadBankrolls().

const STATE = {
  /** @type {Array<{ book?: string }>} mirrors popup cached legs from storage */
  cachedLegs: [],
  /** @type {Record<string, number>} */
  bookBankrolls: {},
};

const KEYS = {
  bankroll: "puff_bankroll",
  riskPct: "puff_risk_per_session",
  backendUrl: "puff_backend_url",
  minOdds: "puff_min_odds",
  maxOdds: "puff_max_odds",
  minEdge: "puff_min_edge",
  devigMethod: "puff_devig_method",
  warnSameGame: "puff_warn_same_game",
  warnConflicting: "puff_warn_conflicting",
  warnPreviouslyUsed: "puff_warn_previously_used",
};

const $ = (id) => document.getElementById(id);

function escAttr(s) {
  return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function escHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
}

function renderBankrollBookList() {
  const legs = STATE.cachedLegs || [];
  const books = [...new Set(legs.map((l) => l.book).filter((b) => b && b !== "Unknown Book"))].sort();
  const saved = STATE.bookBankrolls || {};

  const container = document.getElementById("bankrollBookList");
  if (!container) return;

  if (books.length === 0) {
    container.innerHTML = '<p class="settingsHint">Capture legs first to see available sportsbooks.</p>';
    updateBankrollTotal();
    return;
  }

  container.innerHTML = books
    .map((book) => {
      const a = escAttr(book);
      const h = escHtml(book);
      const checked = saved[book] != null ? "checked" : "";
      const hidden = saved[book] == null ? "hidden" : "";
      const val = saved[book] != null && saved[book] !== "" ? String(saved[book]) : "";
      return `
    <div class="bankrollBookRow">
      <label class="bankrollBookLabel">
        <input type="checkbox" class="bankrollBookCheck" data-book="${a}" ${checked}>
        <span class="bankrollBookName">${h}</span>
      </label>
      <div class="bankrollInputWrapper ${hidden}">
        <span class="bankrollDollar">$</span>
        <input type="number" class="bankrollInput" data-book="${a}"
          min="0" step="1" placeholder="0"
          value="${val}">
      </div>
    </div>`;
    })
    .join("");

  container.querySelectorAll(".bankrollBookCheck").forEach((cb) => {
    cb.addEventListener("change", () => {
      const row = cb.closest(".bankrollBookRow");
      const wrapper = row && row.querySelector(".bankrollInputWrapper");
      if (wrapper) wrapper.classList.toggle("hidden", !cb.checked);
      saveBankrolls();
      updateBankrollTotal();
    });
  });

  container.querySelectorAll(".bankrollInput").forEach((input) => {
    input.addEventListener("input", () => {
      saveBankrolls();
      updateBankrollTotal();
    });
  });

  updateBankrollTotal();
}

function hideBankrollExpiryNotice() {
  const notice = $("bankrollExpiryNotice");
  if (notice) {
    notice.textContent = "";
    notice.classList.add("hidden");
  }
}

function saveBankrolls() {
  const result = {};
  document.querySelectorAll(".bankrollBookCheck:checked").forEach((cb) => {
    const book = cb.dataset.book;
    if (!book) return;
    const input = cb.closest(".bankrollBookRow")?.querySelector(".bankrollInput");
    const val = parseFloat(input && input.value);
    if (!Number.isNaN(val) && val > 0) result[book] = val;
  });
  STATE.bookBankrolls = result;

  const midnight = new Date();
  midnight.setHours(24, 0, 0, 0);
  chrome.storage.local.set(
    {
      puff_bookBankrolls: result,
      puff_bankrollExpiry: midnight.getTime(),
    },
    () => hideBankrollExpiryNotice()
  );
}

function updateBankrollTotal() {
  const total = Object.values(STATE.bookBankrolls || {}).reduce((s, v) => s + v, 0);
  const el = document.getElementById("bankrollTotalAmount");
  if (el) el.textContent = `$${total.toFixed(0)}`;
}

function loadBankrolls() {
  chrome.storage.local.get(["puff_cachedLegs", "puff_bookBankrolls", "puff_bankrollExpiry"], (res) => {
    STATE.cachedLegs = res.puff_cachedLegs || [];
    const expiry = res.puff_bankrollExpiry || 0;
    const notice = $("bankrollExpiryNotice");
    if (expiry > 0 && Date.now() > expiry) {
      STATE.bookBankrolls = {};
      chrome.storage.local.remove(["puff_bookBankrolls", "puff_bankrollExpiry"], () => {
        if (notice) {
          notice.textContent =
            "Your saved balances expired at midnight. Re-enter your sportsbook amounts below.";
          notice.classList.remove("hidden");
        }
      });
    } else {
      STATE.bookBankrolls = res.puff_bookBankrolls || {};
      if (notice) notice.classList.add("hidden");
    }
    renderBankrollBookList();
  });
}

async function load() {
  const out = await chrome.storage.local.get(Object.values(KEYS));
  $("optCapital").value = out[KEYS.bankroll] ?? "";
  $("optRiskPct").value = out[KEYS.riskPct] ?? "8";
  $("optMinOdds").value = out[KEYS.minOdds] ?? "";
  $("optMaxOdds").value = out[KEYS.maxOdds] ?? "";
  $("optMinEdge").value = out[KEYS.minEdge] ?? "";
  $("optDevig").value = out[KEYS.devigMethod] ?? "power";
  $("optWarnSameGame").checked = out[KEYS.warnSameGame] !== "0";
  $("optWarnConflicting").checked = out[KEYS.warnConflicting] !== "0";
  $("optWarnPreviouslyUsed").checked = out[KEYS.warnPreviouslyUsed] !== "0";
  $("optBackendUrl").value = out[KEYS.backendUrl] ?? "http://127.0.0.1:8000";
}

async function save() {
  const bankroll = $("optCapital").value.trim();
  const riskPct = $("optRiskPct").value.trim();
  const minOdds = $("optMinOdds").value.trim();
  const maxOdds = $("optMaxOdds").value.trim();
  const minEdge = $("optMinEdge").value.trim();
  const devig = $("optDevig").value;
  const backendUrl = $("optBackendUrl").value.trim();

  const data = {
    [KEYS.bankroll]: bankroll ? parseFloat(bankroll) : null,
    [KEYS.riskPct]: riskPct ? parseFloat(riskPct) : 8,
    [KEYS.minOdds]: minOdds ? parseFloat(minOdds) : null,
    [KEYS.maxOdds]: maxOdds ? parseFloat(maxOdds) : null,
    [KEYS.minEdge]: minEdge ? parseFloat(minEdge) : null,
    [KEYS.devigMethod]: devig || "power",
    [KEYS.warnSameGame]: $("optWarnSameGame").checked ? "1" : "0",
    [KEYS.warnConflicting]: $("optWarnConflicting").checked ? "1" : "0",
    [KEYS.warnPreviouslyUsed]: $("optWarnPreviouslyUsed").checked ? "1" : "0",
    [KEYS.backendUrl]: backendUrl || "http://127.0.0.1:8000",
  };

  await chrome.storage.local.set(data);
  const status = $("optStatus");
  status.textContent = "Saved.";
  status.style.color = "rgba(120, 180, 120, 0.9)";
  setTimeout(() => { status.textContent = ""; }, 2000);
}

document.addEventListener("DOMContentLoaded", () => {
  load();
  $("optSave").addEventListener("click", save);
  loadBankrolls();

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") loadBankrolls();
  });
  window.addEventListener("pageshow", () => loadBankrolls());
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  // Only react to new captured legs; avoid re-render on each puff_bookBankrolls keystroke.
  if (changes.puff_cachedLegs) loadBankrolls();
});
