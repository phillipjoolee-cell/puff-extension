// ============================================================
// PUFF POPUP STATE & CONFIG
// ============================================================

const STATE = {
  legs: [],
  legsPerSlip: 3,
  bankroll: null,
  /** Per-sportsbook balances from options (puff_bookBankrolls); drives bettable filter & allocation. */
  bookBankrolls: {},
  /** Books from puff_cachedLegs (storage) when popup needs titles beyond current STATE.legs */
  cachedLegs: [],
  riskPerSession: 8, // Section 7: % of capital to risk per session
  backendUrl: "http://127.0.0.1:8000",
  captureMode: "area", // or "whole"
  builderLegs: [], // Section 4: Parlay Builder legs
  // Section 5: Slip editor
  parlays: [],
  /** When set, Generated Slips UI groups by book (from API `book_sections`). */
  bookSections: null,
  summary: null,
  editingSlipIndex: null,
  editingSlipLegs: [], // Array of leg | null — null = ghost slot
  replacementSuggestion: null,
  selectedSlipIndex: null, // When set, metrics show this slip's values; null = portfolio view
};

/** Per-book bankroll strings while typing — no storage/re-render until blur/change or Save. */
const pendingBankrolls = {};

/** Sportsbooks user enabled for bankroll (survives re-render; not tied to saved $ amount). */
const selectedBooks = new Set();

const $ = (id) => document.getElementById(id);

// ============================================================
// HELPERS
// ============================================================

function money(val) {
  if (val === null || val === undefined) return "$0.00";
  return "$" + Number(val).toFixed(2);
}

function pct(val) {
  if (val === null || val === undefined) return "+0.0%";
  const sign = val >= 0 ? "+" : "";
  return sign + Number(val).toFixed(1) + "%";
}

function showToast(message) {
  document.querySelector(".puffToast")?.remove();
  const t = document.createElement("div");
  t.className = "puffToast";
  t.textContent = message;
  t.setAttribute("role", "status");
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add("puffToast--visible"));
  setTimeout(() => {
    t.classList.remove("puffToast--visible");
    setTimeout(() => t.remove(), 200);
  }, 2400);
}

function slipTitleFromLegs(legs) {
  // Compact title: strip line/side from participant, then truncate (avoid "Cole Young O")
  if (!legs || !legs.length) return "Slip";
  return legs
    .map((leg) => {
      const shortName =
        (leg.participant || "")
          .replace(/\s+(over|under|[+-]?\d[\d.]*)\s*.*$/i, "")
          .substring(0, 14)
          .trim() || "?";
      return shortName;
    })
    .join(" · ");
}

// ============================================================
// CORE UI RENDERERS
// ============================================================

// Color coding: muted green (good), orange (moderate), red (bad)
function evColorClass(evPct) {
  if (evPct == null) return "";
  if (evPct >= 1.5) return "metricGood";
  if (evPct >= 0) return "metricModerate";
  return "metricBad";
}
function hitProbColorClass(pct) {
  if (pct == null) return "";
  if (pct >= 25) return "metricGood";
  if (pct >= 15) return "metricModerate";
  return "metricBad";
}

// Builder suggestion thresholds (avg leg EV / combined hit messaging)
const SLIP_QUALITY_HIT_OK = 8;
const SLIP_QUALITY_EV_OK = 2;

function getEvTier(slip) {
  const legs = slip.legs || [];
  const combinedHit = legs.reduce((p, l) => p * ((l.hit_prob_pct || l.hit_prob || 50) / 100), 1);
  const payout = legs.reduce((p, l) => {
    const o = l.odds_american || l.odds || 0;
    if (!o) return p;
    return p * (o > 0 ? 1 + o / 100 : 1 + 100 / Math.abs(o));
  }, 1);
  const parlayEv = (combinedHit * payout - 1) * 100;
  if (parlayEv >= 20) return "strong";
  if (parlayEv >= 8) return "moderate";
  return "low";
}

function getRiskTier(slip) {
  const legs = slip.legs || [];
  const combinedHit =
    legs.reduce((p, l) => p * ((l.hit_prob_pct || l.hit_prob || 50) / 100), 1) * 100;
  if (combinedHit >= 15) return "safe";
  if (combinedHit >= 7) return "risky";
  return "longshot";
}

function buildSlipIndicators(slip) {
  const evTier = getEvTier(slip);
  const riskTier = getRiskTier(slip);
  const evLabels = { strong: "+EV", moderate: "EV+", low: "EV" };
  const riskTitles = {
    safe: "Safe — likely to hit",
    risky: "Risky — coin flip",
    longshot: "Longshot — moon shot",
  };
  const rt = riskTitles[riskTier];
  const evTxt = evLabels[evTier];
  const fullLabel = `${evTxt} — ${rt}`.replace(/"/g, "&quot;");
  return `<span class="slipQualityBadge slipQ-ev-${evTier} slipQ-risk-${riskTier}" title="${fullLabel}" role="img" aria-label="${fullLabel}">${evTxt}</span>`;
}

// Compute hit probability for a single parlay (product of leg probs, as %)
// Implied prob from American: 1/(1 + (pos ? american/100 : 100/|american|))
// IMPORTANT: Values < 25% are EV%, not hit probability. Reject them to avoid 3-leg > 2-leg bug.
function computeSlipHitProb(slip) {
  if (!slip?.legs?.length) return null;
  let prob = 1;
  for (const leg of slip.legs) {
    let pLeg;
    const rawHit = leg.hit_prob_pct;
    // Hit prob for a single bet is typically 40-70%. Values < 25% are almost certainly EV%, not hit prob.
    if (rawHit != null && rawHit >= 25 && rawHit <= 99) {
      pLeg = rawHit / 100;
    } else if (leg.odds_american != null && leg.odds_american !== 0) {
      const am = leg.odds_american;
      pLeg = 1 / (1 + (am > 0 ? am / 100 : 100 / Math.abs(am)));
    } else {
      pLeg = 0.5;
    }
    prob *= Math.max(0.01, Math.min(0.99, pLeg));
  }
  return prob * 100;
}

/** Combined parlay EV % for sorting and metrics; empty slip → −Infinity (metrics layer maps to null). */
function parlayEv(slip) {
  const legs = slip.legs || [];
  if (legs.length === 0) return -Infinity;

  let parlayPayout = 1.0;
  let parlayHitProb = 1.0;

  for (const leg of legs) {
    const odds = leg.odds_american || leg.odds || 0;
    if (!odds) continue;

    const decimal = odds > 0 ? 1 + odds / 100 : 1 + 100 / Math.abs(odds);

    const hitProb = (leg.hit_prob_pct || leg.hit_prob || 50) / 100;

    parlayPayout *= decimal;
    parlayHitProb *= hitProb;
  }

  const ev = (parlayHitProb * parlayPayout - 1) * 100;
  return Math.round(ev * 10) / 10;
}

/** True parlay EV for display: same as parlayEv, but empty slip → null. */
function computeParlayEv(slip) {
  const v = parlayEv(slip);
  return v === -Infinity ? null : v;
}

function getSlipBooks(slip) {
  return [...new Set((slip.legs || []).map((l) => l.book).filter(Boolean))];
}

function isSlipBettable(slip) {
  const bankrolls = STATE.bookBankrolls || {};
  if (Object.keys(bankrolls).length === 0) return true;
  const books = getSlipBooks(slip);
  return books.every((book) => (bankrolls[book] || 0) > 0);
}

function getSlipCapitalAllocation(slip) {
  const bankrolls = STATE.bookBankrolls || {};
  if (Object.keys(bankrolls).length === 0) return null;

  const books = getSlipBooks(slip);
  const allParlays = STATE.parlays || [];

  const allocations = books
    .map((book) => {
      const balance = bankrolls[book] || 0;
      if (!balance) return null;
      const slipsUsingBook = allParlays.filter((p) => getSlipBooks(p).includes(book)).length;
      if (!slipsUsingBook) return null;
      return { book, amount: balance / slipsUsingBook, slipsUsingBook, balance };
    })
    .filter(Boolean);

  if (allocations.length === 0) return null;

  const min = allocations.reduce((m, a) => (a.amount < m.amount ? a : m));
  return `$${min.amount.toFixed(2)} · ${min.book} ($${min.balance} across ${min.slipsUsingBook} slips)`;
}

function renderMetrics(summary, parlays, selectedSlipIndex = null) {
  const evEl = $("metricEv");
  const hitEl = $("metricHitProb");
  const survEl = $("metricSurvival");
  const divEl = $("metricDiversification");
  const capEl = $("metricCapital");
  const metricsSection = document.querySelector(".metrics");
  const viewAllHint = $("metricsViewAllHint");
  if (!evEl || !hitEl) return;

  const isSingleSlip = selectedSlipIndex != null && parlays?.[selectedSlipIndex];
  const slip = isSingleSlip ? parlays[selectedSlipIndex] : null;

  // Show/hide "View all slips" hint when viewing a single slip
  if (viewAllHint) {
    viewAllHint.classList.toggle("hidden", !isSingleSlip);
  }

  if (isSingleSlip && slip) {
    // --- Per-slip metrics ---
    const singleSlipEv = computeParlayEv(slip);
    evEl.textContent = singleSlipEv != null ? pct(singleSlipEv) : "+0.0%";
    evEl.className = "metricValue " + evColorClass(singleSlipEv);

    // Single slip combined hit probability
    const singleSlipHitProb = (() => {
      const legs = slip.legs || [];
      return legs.reduce((prod, l) => {
        const p = (l.hit_prob_pct || l.hit_prob || 50) / 100;
        return prod * p;
      }, 1.0) * 100;
    })();
    hitEl.textContent = singleSlipHitProb != null ? singleSlipHitProb.toFixed(1) + "%" : "—";
    hitEl.className = "metricValue " + hitProbColorClass(singleSlipHitProb);

    // Survival is always portfolio-level (P at least one slip wins), not this slip's hit %
    const survPort = summary?.survival_probability;
    survEl.textContent = survPort != null ? (survPort * 100).toFixed(1) + "%" : "—";
    survEl.className = "metricValue";

    // Diversification: N/A for single slip
    divEl.textContent = "—";
    divEl.className = "metricValue";
    if (divEl.closest(".metricCard")) divEl.closest(".metricCard").title = "Diversification applies to portfolio";

    // Risk per slip — per-book split when configured; else backend unit; else prompt
    const perBookCap = getSlipCapitalAllocation(slip);
    const unit = summary?.unit_size;
    if (perBookCap != null) {
      capEl.textContent = perBookCap;
      capEl.className = "metricValue metricCapital--perBook";
      capEl.style.fontSize = "10px";
      capEl.style.color = "";
      capEl.title = perBookCap;
    } else if (unit != null) {
      capEl.textContent = `$${Number(unit).toFixed(2)} / slip`;
      capEl.className = "metricValue";
      capEl.style.fontSize = "";
      capEl.style.color = "";
      capEl.title = "";
    } else {
      capEl.textContent = "Set risk budget in Settings";
      capEl.className = "metricValue";
      capEl.style.fontSize = "11px";
      capEl.style.color = "var(--textMuted)";
      capEl.title = "";
    }
  } else {
    // --- Portfolio-level metrics (default) ---
    // Projected EV: average of ev_pct across every leg in every slip (not slip est_ev_score)
    const allLegEvs = (parlays || [])
      .flatMap((slip) => (slip.legs || []).map((leg) => leg.ev_pct || leg.ev || 0))
      .filter((v) => Number.isFinite(v));
    const evPct =
      allLegEvs.length > 0
        ? allLegEvs.reduce((a, b) => a + b, 0) / allLegEvs.length
        : summary?.projected_ev ?? null;
    evEl.textContent = evPct != null ? pct(evPct) : "+0.0%";
    evEl.className = "metricValue " + evColorClass(evPct);

    let hitPct = null;
    if (parlays?.length) {
      const probs = parlays.map((p) => computeSlipHitProb(p)).filter((p) => p != null);
      hitPct = probs.length ? probs.reduce((a, b) => a + b, 0) / probs.length : null;
    }
    hitEl.textContent = hitPct != null ? hitPct.toFixed(1) + "%" : "—";
    hitEl.className = "metricValue " + hitProbColorClass(hitPct);

    const surv = summary?.survival_probability;
    survEl.textContent = surv != null ? (surv * 100).toFixed(1) + "%" : "—";
    survEl.className = "metricValue";

    const divScore = summary?.diversification_score ?? summary?.diversificationScore;
    divEl.textContent = divScore != null ? `${Math.round(divScore)} / 100` : "—";
    divEl.className = "metricValue";
    const divCard = divEl.closest(".metricCard");
    if (divCard) divCard.title = "";

    const unit = summary?.unit_size;
    const risk = summary?.slate_risk;
    if (unit != null) {
      capEl.className = "metricValue";
      capEl.style.fontSize = "";
      capEl.style.color = "";
      capEl.title = "";
      if (risk != null && parlays?.length) {
        capEl.textContent = `${money(unit)} × ${parlays.length} slips = ${money(risk)}`;
      } else {
        capEl.textContent = `$${Number(unit).toFixed(2)} / slip`;
      }
    } else {
      capEl.textContent = "Set risk budget";
      capEl.className = "metricValue";
      capEl.style.fontSize = "11px";
      capEl.style.color = "var(--textMuted)";
      capEl.title = "";
    }
  }
}

// Initialize multi-select filter chips and inputs
function initBuilderFilters() {
  // Sportsbook chips
  const sbRoot = $("builderFilterSportsbookChips");
  if (sbRoot) {
    sbRoot.innerHTML = "";
    BUILDER_SPORTSBOOKS.forEach((name) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "filterChip";
      chip.dataset.filter = "sportsbook";
      chip.dataset.value = name;
      chip.innerHTML = `<span class="filterChipLogo" aria-hidden="true"></span><span>${name}</span>`;
      chip.addEventListener("click", () => {
        if (BUILDER_FILTER_STATE.sportsbooks.has(name)) {
          BUILDER_FILTER_STATE.sportsbooks.delete(name);
          chip.classList.remove("selected");
        } else {
          BUILDER_FILTER_STATE.sportsbooks.add(name);
          chip.classList.add("selected");
        }
        renderBuilderPool();
      });
      sbRoot.appendChild(chip);
    });
  }

  // League chips
  const leagueRoot = $("builderFilterLeagueChips");
  if (leagueRoot) {
    leagueRoot.innerHTML = "";
    BUILDER_LEAGUES.forEach((name) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "filterChip";
      chip.dataset.filter = "league";
      chip.dataset.value = name;
      chip.textContent = name;
      chip.addEventListener("click", () => {
        if (BUILDER_FILTER_STATE.leagues.has(name)) {
          BUILDER_FILTER_STATE.leagues.delete(name);
          chip.classList.remove("selected");
        } else {
          BUILDER_FILTER_STATE.leagues.add(name);
          chip.classList.add("selected");
        }
        renderBuilderPool();
      });
      leagueRoot.appendChild(chip);
    });
  }

  // Market type chips
  const mtRoot = $("builderFilterMarketTypeChips");
  if (mtRoot) {
    mtRoot.innerHTML = "";
    BUILDER_MARKET_TYPES.forEach((name) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "filterChip";
      chip.dataset.filter = "marketType";
      chip.dataset.value = name;
      chip.textContent = name;
      chip.addEventListener("click", () => {
        if (BUILDER_FILTER_STATE.marketTypes.has(name)) {
          BUILDER_FILTER_STATE.marketTypes.delete(name);
          chip.classList.remove("selected");
        } else {
          BUILDER_FILTER_STATE.marketTypes.add(name);
          chip.classList.add("selected");
        }
        renderBuilderPool();
      });
      mtRoot.appendChild(chip);
    });
  }

  // Bet warnings chips
  const bwRoot = $("builderFilterBetWarningsChips");
  if (bwRoot) {
    bwRoot.innerHTML = "";
    const opts = [
      { id: "any", label: "Any" },
      { id: "hide", label: "Hide Warned" },
      { id: "only", label: "Only Warned" },
    ];
    opts.forEach(({ id, label }) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "filterChip" + (BUILDER_FILTER_STATE.betWarnings === id ? " selected" : "");
      chip.dataset.filter = "betWarnings";
      chip.dataset.value = id;
      chip.textContent = label;
      chip.addEventListener("click", () => {
        BUILDER_FILTER_STATE.betWarnings = id;
        bwRoot.querySelectorAll(".filterChip").forEach((c) => c.classList.remove("selected"));
        chip.classList.add("selected");
        renderBuilderPool();
      });
      bwRoot.appendChild(chip);
    });
  }

  // Select All / Clear buttons for chips
  document.querySelectorAll(".filterActionBtn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const filter = btn.dataset.filter;
      const action = btn.dataset.action;
      if (!filter || !action) return;
      if (filter === "sportsbook") {
        if (action === "selectAll") {
          BUILDER_FILTER_STATE.sportsbooks = new Set(BUILDER_SPORTSBOOKS);
        } else {
          BUILDER_FILTER_STATE.sportsbooks.clear();
        }
        document.querySelectorAll("#builderFilterSportsbookChips .filterChip").forEach((chip) => {
          chip.classList.toggle("selected", action === "selectAll");
        });
      } else if (filter === "league") {
        if (action === "selectAll") {
          BUILDER_FILTER_STATE.leagues = new Set(BUILDER_LEAGUES);
        } else {
          BUILDER_FILTER_STATE.leagues.clear();
        }
        document.querySelectorAll("#builderFilterLeagueChips .filterChip").forEach((chip) => {
          chip.classList.toggle("selected", action === "selectAll");
        });
      } else if (filter === "marketType") {
        if (action === "selectAll") {
          BUILDER_FILTER_STATE.marketTypes = new Set(BUILDER_MARKET_TYPES);
        } else {
          BUILDER_FILTER_STATE.marketTypes.clear();
        }
        document.querySelectorAll("#builderFilterMarketTypeChips .filterChip").forEach((chip) => {
          chip.classList.toggle("selected", action === "selectAll");
        });
      }
      renderBuilderPool();
    });
  });

  // Odds / EV / date / game / market width inputs
  const minOddsInput = $("builderFilterMinOdds");
  const maxOddsInput = $("builderFilterMaxOdds");
  const minEvInput = $("builderFilterMinEv");
  const dateFromInput = $("builderFilterDateFrom");
  const dateToInput = $("builderFilterDateTo");
  const gameInput = $("builderFilterGame");
  const mwInput = $("builderFilterMarketWidth");
  if (minOddsInput) minOddsInput.addEventListener("input", () => { BUILDER_FILTER_STATE.minOdds = minOddsInput.value === "" ? null : parseFloat(minOddsInput.value); renderBuilderPool(); });
  if (maxOddsInput) maxOddsInput.addEventListener("input", () => { BUILDER_FILTER_STATE.maxOdds = maxOddsInput.value === "" ? null : parseFloat(maxOddsInput.value); renderBuilderPool(); });
  if (minEvInput) minEvInput.addEventListener("input", () => { BUILDER_FILTER_STATE.minEv = minEvInput.value === "" ? null : parseFloat(minEvInput.value); renderBuilderPool(); });
  if (dateFromInput) dateFromInput.addEventListener("change", () => { BUILDER_FILTER_STATE.dateFrom = dateFromInput.value || null; renderBuilderPool(); });
  if (dateToInput) dateToInput.addEventListener("change", () => { BUILDER_FILTER_STATE.dateTo = dateToInput.value || null; renderBuilderPool(); });
  if (gameInput) gameInput.addEventListener("input", () => { BUILDER_FILTER_STATE.game = gameInput.value || ""; renderBuilderPool(); });
  if (mwInput) mwInput.addEventListener("input", () => { BUILDER_FILTER_STATE.marketWidth = mwInput.value; renderBuilderPool(); });

  // Devig radios
  document.querySelectorAll("input[name='devigBook']").forEach((input) => {
    input.addEventListener("change", () => {
      BUILDER_FILTER_STATE.devigBookMode = input.value;
      const sel = $("builderFilterDevigBookSelect");
      if (sel) sel.disabled = BUILDER_FILTER_STATE.devigBookMode !== "specific";
    });
  });
  const devigBookSelect = $("builderFilterDevigBookSelect");
  if (devigBookSelect) {
    devigBookSelect.addEventListener("change", () => {
      BUILDER_FILTER_STATE.devigBook = devigBookSelect.value || null;
    });
  }
  document.querySelectorAll("input[name='devigMethod']").forEach((input) => {
    input.addEventListener("change", () => {
      BUILDER_FILTER_STATE.devigMethod = input.value;
    });
  });
}
function renderWarnings(warnings) {
  const section = $("warningsSection");
  const list = $("warningsList");
  if (!section || !list) return;
  if (!warnings || !warnings.length) {
    section.classList.add("hidden");
    return;
  }
  list.innerHTML = warnings.map((w) => `<div class="warningItem">${w.replace(/^Player concentration: /i, "⚠ Player Concentration — ").replace(/^Game concentration: /i, "⚠ Game Concentration — ")}</div>`).join("");
  section.classList.remove("hidden");
}

function slipLegsIdentityKey(slip) {
  const legs = slip?.legs || [];
  return JSON.stringify(
    legs.map((l) => [String(l.participant || ""), String(l.market || ""), l.line, l.odds ?? l.odds_american])
  );
}

/** Index of `slip` in canonical `portfolio` (stable after UI sort order changes). */
function slipIndexInPortfolio(portfolio, slip) {
  if (!portfolio || !slip) return -1;
  let i = portfolio.indexOf(slip);
  if (i >= 0) return i;
  if (slip.id != null) {
    i = portfolio.findIndex((p) => p && p.id === slip.id);
    if (i >= 0) return i;
  }
  const key = slipLegsIdentityKey(slip);
  return portfolio.findIndex((p) => slipLegsIdentityKey(p) === key);
}

function sortSlipsByEv(slips) {
  const evOrder = { strong: 0, moderate: 1, low: 2 };
  return slips.slice().sort((a, b) => {
    const ea = evOrder[getEvTier(a)] ?? 2;
    const eb = evOrder[getEvTier(b)] ?? 2;
    if (ea !== eb) return ea - eb;
    return parlayEv(b) - parlayEv(a);
  });
}

function buildSlipCard(slip, slipIndex, parlays) {
  const card = document.createElement("div");
  const evTier = getEvTier(slip);
  const riskTier = getRiskTier(slip);
  const borderQuality = evTier === "strong" ? "good" : evTier === "moderate" ? "ok" : "bad";
  const bettable = isSlipBettable(slip);
  card.className =
    "slipCard slipQuality-" + borderQuality + (bettable ? "" : " slipCard--notBettable");
  card.dataset.slipIndex = String(slipIndex);
  card.title = `EV tier: ${evTier}; risk: ${riskTier}`;

  const title = slipTitleFromLegs(slip.legs);
  const odds = slip.est_odds || slip.odds || "-";

  const header = document.createElement("div");
  header.className = "slipCardHeader";
  const warnPrefix = bettable ? "" : '<span class="slipCardWarn" aria-hidden="true">⚠️ </span>';
  header.innerHTML = `
      <div class="slipCardQuality" aria-label="EV ${evTier}, risk ${riskTier}">
        ${warnPrefix}
        ${buildSlipIndicators(slip)}
      </div>
      <div class="slipCardTitle">${title}</div>
      <div class="slipCardOdds">${odds}</div>
      <div class="slipCardActions">
        <button class="slipCardEditBtn" data-slip-index="${slipIndex}" title="Edit slip">Edit</button>
      <button class="slipCardCopyBtn" data-slip="${JSON.stringify(slip).replace(/"/g, "&quot;")}">📋</button>
      </div>
    `;

  const legsHtml = (slip.legs || [])
    .map(
      (leg) => `
  <div class="slipLeg">
    <span class="slipLegMarket">${escHtmlBankroll(leg.market || "")}</span>
    <span class="slipLegDetail">${escHtmlBankroll(leg.participant || "")}</span>
  </div>`
    )
    .join("");
  const legs = document.createElement("div");
  legs.className = "slipCardLegs";
  legs.innerHTML = legsHtml;

  const capAlloc = getSlipCapitalAllocation(slip);
  const capRow = document.createElement("div");
  capRow.className = "slipCardCapital";
  const capLabel = document.createElement("div");
  capLabel.className = "slipCardCapitalLabel";
  capLabel.textContent = "Risk per slip";
  const capVal = document.createElement("div");
  capVal.className = "slipCardCapitalValue";
  capVal.textContent = capAlloc != null ? capAlloc : "Set risk budget in Settings";
  capRow.appendChild(capLabel);
  capRow.appendChild(capVal);

  const recommended = document.createElement("div");
  recommended.className = "slipRecommended";
  recommended.textContent = "Recommended";

  card.appendChild(header);
  card.appendChild(legs);
  card.appendChild(capRow);
  card.appendChild(recommended);

  const placeBetBtn = document.createElement("button");
  placeBetBtn.type = "button";
  placeBetBtn.className = "btnPlaceBet";
  placeBetBtn.textContent = "+ Place Bet";
  placeBetBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    void openPlaceBetModal(slip);
  });
  card.appendChild(placeBetBtn);

  card.querySelector(".slipCardCopyBtn").addEventListener("click", (e) => {
    const btn = e.target;
    const text = slip.legs
      .map((l) => {
        const sideLabel = l.side && l.side !== "other" ? ` ${l.side}` : "";
        return `${l.participant}${sideLabel} @ ${l.odds_american ?? l.odds ?? "?"}`;
      })
      .join("\n");
    navigator.clipboard.writeText(text);
    btn.textContent = "✓";
    btn.classList.add("copied");
    setTimeout(() => {
      btn.textContent = "📋";
      btn.classList.remove("copied");
    }, 1500);
  });

  card.querySelector(".slipCardEditBtn")?.addEventListener("click", (e) => {
    e.stopPropagation();
    openSlipEditor(slipIndex);
  });

  card.addEventListener("click", (e) => {
    if (e.target.closest(".slipCardEditBtn, .slipCardCopyBtn, .btnPlaceBet")) return;
    const isSelected = STATE.selectedSlipIndex === slipIndex;
    STATE.selectedSlipIndex = isSelected ? null : slipIndex;
    document.querySelectorAll(".slipCard.isSelected").forEach((c) => c.classList.remove("isSelected"));
    if (STATE.selectedSlipIndex != null) card.classList.add("isSelected");
    renderMetrics(STATE.summary, parlays, STATE.selectedSlipIndex);
  });

  return card;
}

function renderSlipsSharedFooter(root, parlays, visibleCount, bettableOnly) {
  if (visibleCount === 0 && parlays.length > 0) {
    root.innerHTML =
      '<div style="text-align:center;color:var(--textMuted);font-size:11px;">No bettable slips match your sportsbook risk budgets. Turn off the filter or add risk budgets in Settings.</div>';
  }

  if (STATE.selectedSlipIndex != null) {
    const sel = root.querySelector(`[data-slip-index="${STATE.selectedSlipIndex}"]`);
    if (sel) sel.classList.add("isSelected");
  }

  const hintEl = $("bettableFilterHint");
  if (hintEl) {
    if (bettableOnly && parlays.length > 0) {
      hintEl.textContent = `Showing ${visibleCount} of ${parlays.length} slips`;
    } else {
      hintEl.textContent = "";
    }
  }

  const metaLabel =
    bettableOnly && visibleCount < parlays.length
      ? `${visibleCount} of ${parlays.length} positions`
      : `${parlays.length} positions`;
  const meta = $("slipsMeta");
  if (meta) meta.textContent = `${metaLabel} · ${getSlipFiltersMetaSuffix()}`;
}

function renderSlipsFlat(parlays) {
  const root = $("slipsList");
  root.innerHTML = "";

  if (!parlays || !parlays.length) {
    root.innerHTML = '<div style="text-align:center;color:var(--textMuted);font-size:11px;">No slips generated.</div>';
    const hint = $("bettableFilterHint");
    if (hint) hint.textContent = "";
    const meta = $("slipsMeta");
    if (meta) meta.textContent = `0 positions · ${getSlipFiltersMetaSuffix()}`;
    return;
  }

  const bettableOnly = $("bettableOnlyToggle")?.checked;
  if (bettableOnly && STATE.selectedSlipIndex != null) {
    const selSlip = parlays[STATE.selectedSlipIndex];
    if (selSlip && !isSlipBettable(selSlip)) {
      STATE.selectedSlipIndex = null;
      renderMetrics(STATE.summary, parlays, null);
    }
  }

  const sorted = sortSlipsByEv(parlays);
  let visibleCount = 0;
  sorted.forEach((slip) => {
    if (bettableOnly && !isSlipBettable(slip)) return;
    const slipIndex = slipIndexInPortfolio(parlays, slip);
    if (slipIndex < 0) return;
    visibleCount++;
    root.appendChild(buildSlipCard(slip, slipIndex, parlays));
  });

  renderSlipsSharedFooter(root, parlays, visibleCount, bettableOnly);
}

function renderBookSections(sections, parlays) {
  const container = $("slipsList");
  container.innerHTML = "";

  if (!parlays || !parlays.length) {
    container.innerHTML =
      '<div style="text-align:center;color:var(--textMuted);font-size:11px;">No slips generated.</div>';
    const hint = $("bettableFilterHint");
    if (hint) hint.textContent = "";
    const meta = $("slipsMeta");
    if (meta) meta.textContent = `0 positions · ${getSlipFiltersMetaSuffix()}`;
    return;
  }

  const bettableOnly = $("bettableOnlyToggle")?.checked;
  if (bettableOnly && STATE.selectedSlipIndex != null) {
    const selSlip = parlays[STATE.selectedSlipIndex];
    if (selSlip && !isSlipBettable(selSlip)) {
      STATE.selectedSlipIndex = null;
      renderMetrics(STATE.summary, parlays, null);
    }
  }

  let visibleCount = 0;
  sections.forEach((section, secIdx) => {
    const slips = Array.isArray(section.slips) ? section.slips : [];
    const visibleSlips = slips.filter((slip) => !bettableOnly || isSlipBettable(slip));
    const sortedSection = sortSlipsByEv(visibleSlips);

    const header = document.createElement("div");
    header.className = "bookSectionHeader";
    const nameEl = document.createElement("span");
    nameEl.className = "bookSectionName";
    nameEl.textContent = section.book != null ? String(section.book) : "Unknown Book";
    const countEl = document.createElement("span");
    countEl.className = "bookSectionCount";
    const totalInSection = section.num_slips != null ? section.num_slips : slips.length;
    if (bettableOnly && visibleSlips.length !== slips.length) {
      countEl.textContent = `${sortedSection.length} of ${totalInSection} slips`;
    } else {
      countEl.textContent = `${sortedSection.length} slip${sortedSection.length === 1 ? "" : "s"}`;
    }
    header.appendChild(nameEl);
    header.appendChild(countEl);
    container.appendChild(header);

    sortedSection.forEach((slip) => {
      const slipIndex = slipIndexInPortfolio(parlays, slip);
      if (slipIndex < 0) return;
      visibleCount++;
      container.appendChild(buildSlipCard(slip, slipIndex, parlays));
    });

    if (secIdx < sections.length - 1) {
      const divider = document.createElement("div");
      divider.className = "bookSectionDivider";
      container.appendChild(divider);
    }
  });

  renderSlipsSharedFooter(container, parlays, visibleCount, bettableOnly);
}

function renderSlips(parlays) {
  const root = $("slipsList");
  if (!root) return;

  const noResults = STATE.summary?.no_results === true;
  const noResultsMsg =
    STATE.summary?.message || "Try lowering the Min Hit Prob or Min Parlay EV sliders.";

  if (noResults || !parlays?.length) {
    STATE.bookSections = null;
    root.innerHTML = `
      <div class="emptyState">
        <div class="emptyStateIcon">📭</div>
        <div class="emptyStateTitle">No slips found</div>
        <div class="emptyStateMsg"></div>
        <div class="emptyStateHint">Recommended defaults: Min Hit Prob 12% · Min Parlay EV 20%</div>
      </div>
    `;
    const msgEl = root.querySelector(".emptyStateMsg");
    if (msgEl) msgEl.textContent = noResultsMsg;
    const hint = $("bettableFilterHint");
    if (hint) hint.textContent = "";
    const meta = $("slipsMeta");
    if (meta) meta.textContent = `0 positions · ${getSlipFiltersMetaSuffix()}`;
    return;
  }

  root.innerHTML = "";

  if (STATE.bookSections && STATE.bookSections.length > 0) {
    renderBookSections(STATE.bookSections, parlays);
    return;
  }

  renderSlipsFlat(parlays);
}

// ============================================================
// BACKEND WIRING
// ============================================================

/** Read optional risk budget from #portfolioRiskBudgetInput into STATE (API sizing). */
function syncBankrollFromInput() {
  const el = $("portfolioRiskBudgetInput");
  if (!el) return;
  const raw = String(el.value ?? "").trim();
  if (raw === "") {
    STATE.bankroll = null;
    return;
  }
  const n = parseFloat(raw);
  STATE.bankroll = Number.isFinite(n) && n >= 0 ? n : null;
}

/** Leg count from #legCount (2–15); falls back to STATE if input missing/invalid. */
function getLegCountFromUi() {
  const el = $("legCount");
  const raw = el != null ? String(el.value ?? "").trim() : "";
  const n = parseInt(raw, 10);
  let legCount;
  if (!Number.isNaN(n)) {
    legCount = Math.max(2, Math.min(15, n));
  } else {
    legCount = Math.max(2, Math.min(15, STATE.legsPerSlip || 3));
  }
  return legCount;
}

/** Recommended baseline for slip filter sliders (matches HTML defaults). */
const SLIDER_RECOMMENDED_HIT = 12;
const SLIDER_RECOMMENDED_PARLAY_EV = 20;
const SLIDER_MIN_HIT_MAX = 40;
const SLIDER_MIN_PARLAY_EV_MAX = 150;

/** Shown next to slip counts — reflects Min Hit Prob / Min Parlay EV sliders. */
function getSlipFiltersMetaSuffix() {
  const h = $("minHitProb");
  const e = $("minParlayEv");
  const hp =
    h && !Number.isNaN(parseInt(String(h.value), 10))
      ? parseInt(String(h.value), 10)
      : SLIDER_RECOMMENDED_HIT;
  const ev =
    e && !Number.isNaN(parseInt(String(e.value), 10))
      ? parseInt(String(e.value), 10)
      : SLIDER_RECOMMENDED_PARLAY_EV;
  return `${hp}% min hit · ${ev}% min EV`;
}

function buildGenerationSettings() {
  const legCount = getLegCountFromUi();
  STATE.legsPerSlip = legCount;
  const minHitEl = $("minHitProb");
  const minEvEl = $("minParlayEv");
  const minHitPct = minHitEl
    ? Math.max(1, Math.min(SLIDER_MIN_HIT_MAX, parseInt(String(minHitEl.value), 10) || SLIDER_RECOMMENDED_HIT))
    : SLIDER_RECOMMENDED_HIT;
  const minEvPct = minEvEl
    ? Math.max(
        5,
        Math.min(SLIDER_MIN_PARLAY_EV_MAX, parseInt(String(minEvEl.value), 10) || SLIDER_RECOMMENDED_PARLAY_EV),
      )
    : SLIDER_RECOMMENDED_PARLAY_EV;
  const bookBankrolls = STATE.bookBankrolls || {};
  return {
    min_ev_pct: 1.0,
    max_staleness_mins: 20,
    parlay_legs_min: legCount,
    parlay_legs_max: legCount,
    min_hit_prob: minHitPct / 100,
    min_parlay_ev: minEvPct / 100,
    bankroll: STATE.bankroll,
    risk_per_session_pct: (STATE.riskPerSession != null ? STATE.riskPerSession : 8) / 100,
    ...(Object.keys(bookBankrolls).length > 0 ? { book_bankrolls: { ...bookBankrolls } } : {}),
  };
}

/** Keep in sync with content.js normalizeRawLegDefaults + isRawLegValidForBackend. */
function normalizeRawLegDefaults(leg) {
  if (!leg || typeof leg !== "object") return;
  if (leg.line == null || !Number.isFinite(Number(leg.line))) leg.line = 0;
  const evRaw = leg.ev_pct != null ? leg.ev_pct : leg.ev;
  if (evRaw == null || !Number.isFinite(Number(evRaw))) {
    leg.ev_pct = 0;
    leg.ev = 0;
  } else {
    const v = Number(evRaw);
    leg.ev_pct = v;
    leg.ev = v;
  }
  const hitRaw = leg.hit_prob_pct != null ? leg.hit_prob_pct : leg.hit_prob;
  if (hitRaw == null || !Number.isFinite(Number(hitRaw))) {
    leg.hit_prob_pct = 0;
    leg.hit_prob = 0;
  } else {
    const v = Number(hitRaw);
    leg.hit_prob_pct = v;
    leg.hit_prob = v;
  }
  const book = leg.book != null ? String(leg.book).trim() : "";
  if (!book) leg.book = "Unknown Book";
  const market = leg.market != null ? String(leg.market).trim() : "";
  if (!market) leg.market = "Prop";
}

/** Participant + at least one non-zero finite odds (odds or odds_american); then normalize for API. */
function isLegValidForBackend(leg) {
  if (!leg || typeof leg !== "object") return false;
  const p = leg.participant != null ? String(leg.participant).trim() : "";
  if (!p) return false;
  // Allow "Unknown participant" through if odds are valid — backend can still use it
  const oddsVal =
    leg.odds != null && Number.isFinite(Number(leg.odds)) && Number(leg.odds) !== 0
      ? Number(leg.odds)
      : leg.odds_american != null &&
          Number.isFinite(Number(leg.odds_american)) &&
          Number(leg.odds_american) !== 0
        ? Number(leg.odds_american)
        : null;
  if (oddsVal == null) return false;
  leg.odds = oddsVal;
  normalizeRawLegDefaults(leg);
  return true;
}

async function onGenerate() {
  const hintEl = $("generateHint");
  if (STATE.legs.length === 0) {
    console.log("[PUFF] Legs after capture:", 0, []);
    alert("Capture legs first.");
    return;
  }

  const btn = $("btnGenerate");
  const overlay = $("loadingOverlay");
  btn.disabled = true;
  btn.textContent = "Generating…";
  if (overlay) overlay.classList.remove("hidden");

  try {
    console.log("[PUFF] Legs after capture:", STATE.legs.length, STATE.legs);
    syncBankrollFromInput();
    if (!saveBankrolls(false)) {
      hintEl.textContent = "Enter valid sportsbook risk budget amounts (or leave blank / Save after fixing).";
      hintEl.classList.add("hint--warn");
      btn.disabled = false;
      btn.textContent = "+ Generate Portfolio";
      if (overlay) overlay.classList.add("hidden");
      return;
    }
    Object.keys(pendingBankrolls).forEach((k) => delete pendingBankrolls[k]);
    const settings = buildGenerationSettings();
    const legs = (STATE.legs || []).map((leg) => {
      const side = (leg.side || "other").toString().toLowerCase();
      const validSide = ["over", "under", "yes", "no", "home", "away"].includes(side) ? side : "other";
      const out = { ...leg };
      out.side = validSide;
      if (out.odds_american != null && out.odds_american !== 0 && (out.odds == null || out.odds === 0)) {
        out.odds = out.odds_american;
      }
      if (out.odds != null && out.odds !== 0 && (out.odds_american == null || out.odds_american === 0)) {
        out.odds_american = out.odds;
      }
      delete out.fair_odds_american;
      return out;
    });
    const validLegs = legs.filter(isLegValidForBackend);
    console.log("[PUFF] Legs after validation filter:", validLegs.length);

    if (validLegs.length === 0) {
      console.warn("[PUFF] All legs failed validation; skipping backend call.");
      hintEl.textContent =
        "No slips could be generated from the captured legs. Try capturing more legs or loosening Min Hit Prob / Min Parlay EV.";
      hintEl.classList.add("hint--warn");
      STATE.parlays = [];
      window.__puffLastParlays = [];
      STATE.summary = null;
      STATE.selectedSlipIndex = null;
      renderSlips([]);
      renderMetrics(null, [], null);
      renderWarnings(null);
      return;
    }

    const payload = {
      legs: validLegs,
      settings,
    };
    const resp = await fetch(`${STATE.backendUrl}/v1/parlays/suggest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      const text = await resp.text();
      const err = new Error(`HTTP ${resp.status}: ${text}`);
      console.error("[PUFF] Generate Portfolio error:", err);
      alert(`Backend error: ${resp.status} ${text}`);
      return;
    }

    const response = await resp.json();
    console.log("[PUFF] Backend response:", response);
    const allParlays = Array.isArray(response.parlays) ? response.parlays : [];
    const rawBookSections = response.book_sections;
    STATE.bookSections =
      allParlays.length > 0 && Array.isArray(rawBookSections) && rawBookSections.length > 0
        ? rawBookSections
        : null;
    if (!allParlays.length) {
      STATE.bookSections = null;
      console.warn("[PUFF] Backend returned empty portfolio");
      const emptyMsg =
        response.summary?.no_results === true
          ? response.summary?.message ||
            "Try lowering the Min Hit Prob or Min Parlay EV sliders."
          : "No slips could be generated from the captured legs. Try capturing more legs or loosening Min Hit Prob / Min Parlay EV.";
      hintEl.textContent = emptyMsg;
      hintEl.classList.add("hint--warn");
    } else {
      hintEl.classList.remove("hint--warn");
      hintEl.textContent = `Generated ${allParlays.length} slips.`;
    }

    STATE.parlays = allParlays;
    // Log Stats / exports: full flat list from API — not derived from book_sections.
    window.__puffLastParlays = allParlays;
    STATE.summary = response.summary || null;
    STATE.selectedSlipIndex = null;

    chrome.storage.local.set({
      puff_lastPortfolio: {
        parlays: allParlays,
        book_sections: STATE.bookSections,
        generatedAt: Date.now(),
        minHitProb: parseFloat(String($("minHitProb")?.value ?? String(SLIDER_RECOMMENDED_HIT))),
        minParlayEv: parseFloat(String($("minParlayEv")?.value ?? String(SLIDER_RECOMMENDED_PARLAY_EV))),
      },
    });

    renderSlips(allParlays);
    renderMetrics(response.summary, allParlays, null);
    renderWarnings(response.summary?.warnings);
  } catch (err) {
    console.error("[PUFF] Generate Portfolio error:", err);

    STATE.parlays = [];
    window.__puffLastParlays = [];
    STATE.bookSections = null;
    STATE.summary = null;
    STATE.selectedSlipIndex = null;
    if (hintEl) {
      hintEl.classList.add("hint--warn");
      hintEl.textContent = `Generation failed — ${String(err?.message || err)}`;
    }
    const bettableHint = $("bettableFilterHint");
    if (bettableHint) bettableHint.textContent = "";
    const meta = $("slipsMeta");
    if (meta) meta.textContent = `0 positions · ${getSlipFiltersMetaSuffix()}`;

    const container = document.getElementById("slipsList");
    if (container) {
      container.innerHTML = `
      <div class="emptyState">
        <div class="emptyStateIcon">⚠️</div>
        <div class="emptyStateTitle">Generation failed</div>
        <div class="emptyStateMsg">Try lowering the Min Hit Prob or Min Parlay EV sliders, or capture more legs.</div>
        <div class="emptyStateHint">Recommended defaults: Min Hit Prob 12% · Min Parlay EV 20%</div>
      </div>
    `;
    }
    renderMetrics(null, [], null);
    renderWarnings(null);
  } finally {
    btn.disabled = false;
    btn.textContent = "+ Generate Portfolio";
    const overlay2 = $("loadingOverlay");
    if (overlay2) overlay2.classList.add("hidden");
  }
}

// ============================================================
// CAPTURE WORKFLOW
// ============================================================

async function ensureContentScript(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"],
    });
  } catch (err) {
    console.error("Failed to inject content script", err);
    throw err;
  }
}

async function waitForContentScriptReady(tabId, timeoutMs = 2000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      // Must use ISOLATED world (default) - content script sets __puff_contentScriptReady there
      const [res] = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => !!window.__puff_contentScriptReady,
      });
      if (res?.result) return true;
    } catch (e) {
      // ignore
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return false;
}

function canInjectScript(url) {
  if (!url || typeof url !== "string") return false;
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

async function sendMessageWithInject(tabId, message, retries = 3) {
  // Ensure content script is loaded first
    await ensureContentScript(tabId);
  await new Promise((r) => setTimeout(r, 100));

  // Try direct executeScript first (runs in content script's isolated world)
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: "ISOLATED",
      func: async (msg) => {
        if (
          msg?.type === "CAPTURE_WHOLE_PAGE" &&
          typeof globalThis.__puff_handleCaptureWholePageAsync === "function"
        ) {
          return await globalThis.__puff_handleCaptureWholePageAsync();
        }
        if (typeof globalThis.__puff_handleMessage === "function") {
          return globalThis.__puff_handleMessage(msg);
        }
        return { ok: false, error: "Content script not loaded. Reload the OddsJam page (F5), then try again." };
      },
      args: [message],
    });
    if (Array.isArray(results) && results.length > 0 && results[0].result !== undefined) {
      return results[0].result;
    }
  } catch (e) {
    console.warn("executeScript path failed", e);
  }

  // Fallback: try standard messaging
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const resp = await chrome.tabs.sendMessage(tabId, message);
      if (resp !== undefined) return resp;
    } catch (err) {
      const errMsg = String(err?.message || err);
      if (!errMsg.includes("Could not establish connection")) throw err;
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  throw new Error("Unable to contact content script. Try reloading the page.");
}

async function getActiveTab() {
  // Try lastFocusedWindow first (works when popup is open), then currentWindow as fallback
  let [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab) {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  }
  return tab || null;
}

function isInjectableTab(tab) {
  if (!tab?.url) return false;
  const u = tab.url.toLowerCase();
  return u.startsWith("http://") || u.startsWith("https://") || u.startsWith("file://");
}

async function onSelectArea() {
  const tab = await getActiveTab();
  if (!tab?.id) {
    updateCaptureStatus("No active tab.");
    return;
  }
  if (!canInjectScript(tab.url)) {
    updateCaptureStatus("Open an optimizer page (http/https) first.");
    return;
  }

  updateCaptureStatus("Entering selection mode…");
  try {
    await ensureContentScript(tab.id);
    // Brief delay for script to initialize before messaging
    await new Promise((r) => setTimeout(r, 150));
    const resp = await sendMessageWithInject(tab.id, { type: "SELECT_AREA" });
    console.debug("onSelectArea response", resp);
    if (resp?.ok) {
      updateCaptureStatus("Check the legs you want, then click Done on the page.");
    } else {
      updateCaptureStatus(`Failed: ${resp?.error || "Unknown error"}`);
    }
  } catch (e) {
    console.error("onSelectArea error", e);
    updateCaptureStatus("Failed to enter selection mode: " + String(e));
  }
}

async function onCapture() {
  const tab = await getActiveTab();
  if (!tab?.id) {
    updateCaptureStatus("No active tab.");
    return;
  }
  if (!canInjectScript(tab.url)) {
    updateCaptureStatus("Open an optimizer page (http/https) first.");
      return;
    }

  updateCaptureStatus("Capturing…");
  try {
    await ensureContentScript(tab.id);
    await new Promise((r) => setTimeout(r, 150));
    const resp = await sendMessageWithInject(tab.id, { type: "CAPTURE_WHOLE_PAGE" });
    if (!resp || !resp.ok) {
      updateCaptureStatus(resp?.error || "Capture failed.");
      return;
    }

    STATE.legs = resp.legs || [];
    STATE.cachedLegs = STATE.legs.slice();
    console.log("[PUFF] Legs after capture:", STATE.legs.length, STATE.legs);
    updateCaptureStatus(`Captured ${STATE.legs.length} legs.`);
    renderBankrollBookList();
  } catch (e) {
    updateCaptureStatus("Capture failed: " + String(e));
  }
}

async function refreshCapturedLegsFromPage() {
  const tab = await getActiveTab();
  if (!tab?.id) return;

  // Ensure content script is present and ready.
  await ensureContentScript(tab.id);

  try {
    const [ready] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => !!window.__puff_contentScriptReady,
    });
    if (!ready?.result) {
      updateCaptureStatus("Content script not loaded (no handler). Click Select Area to initialize.");
      return;
    }
  } catch (e) {
    // ignore
  }

  try {
    const resp = await sendMessageWithInject(tab.id, { type: "GET_LEGS" });
    if (!resp || !resp.ok) {
      updateCaptureStatus("No captured legs available.");
      return;
    }

    STATE.legs = resp.legs || [];
    STATE.cachedLegs = STATE.legs.slice();
    console.log("[PUFF] Legs after capture:", STATE.legs.length, STATE.legs);
    updateCaptureStatus(`Captured ${STATE.legs.length} legs.`);
    renderBankrollBookList();
  } catch (e) {
    // ignore failures; this is best-effort
    console.debug("refreshCapturedLegsFromPage failed:", e);
  }
}

function updateCaptureStatus(msg) {
  $("captureStatus").textContent = msg;
}

// ============================================================
// SECTION 4: PARLAY BUILDER
// ============================================================

function americanToDecimal(american) {
  const a = Number(american);
  if (a === 0) return 1;
  if (a > 0) return 1 + a / 100;
  return 1 + 100 / Math.abs(a);
}

function decimalToAmerican(decimal) {
  const d = Number(decimal);
  if (d <= 1) return 0;
  const ratio = d - 1;
  return ratio >= 1 ? Math.round(ratio * 100) : Math.round(-100 / ratio);
}

function impliedProbFromAmerican(american) {
  const dec = americanToDecimal(american);
  return dec > 0 ? 1 / dec : 0;
}

function computeBuilderParlay(legs) {
  if (!legs || !legs.length) return { combinedOddsAmerican: null, combinedDecimal: null, hitProbability: null, evPct: null };
  const slip = { legs };
  const hitProbability = computeSlipHitProb(slip);
  let combinedDecimal = 1;
  for (const leg of legs) {
    const am = leg.odds_american != null ? leg.odds_american : leg.odds;
    if (am == null) continue;
    combinedDecimal *= americanToDecimal(Number(am));
  }
  const combinedAmerican = combinedDecimal > 0 ? decimalToAmerican(combinedDecimal) : null;
  const evPct = hitProbability != null && combinedDecimal > 0 ? ((hitProbability / 100) * combinedDecimal - 1) * 100 : null;
  return { combinedOddsAmerican: combinedAmerican, combinedDecimal, hitProbability, evPct };
}

// --------------------------- BUILDER FILTER STATE ---------------------------

const BUILDER_SPORTSBOOKS = [
  "FanDuel","DraftKings","BetMGM","Caesars","BetRivers","Fanatics","Polymarket","Polymarket (USA)","Novig","Pinny",
  "crypto.com","Betr Picks","bet365","betPARX","BetOpenly","4Cx","Sportzino","Fliff","Kalshi","Onyx Odds","Thrillzz",
  "PrizePicks","PrizePicks (5 or 6 Pick Flex)","Prophet X","Rebet","Rebet Props City","Robinhood","SugarHouse","theScore",
  "Underdog Fantasy (2 Pick)","Props Builder","888sport","Bally Bet","bet105","BET99","Betano","Betfair",
  "Betfair Exchange (Australia)","betJACK","Betr","betr (Australia)","Betr Picks (All)","Betsson","BetVictor","Betway",
  "Betway (Alaska)","Boomers","Boom Fantasy (5 Pick Insured)","Borgata","bwin","Casumo","Circa Sports","Circa Vegas",
  "Coolbet","Dabble (3 or 5 Pick)","Dabble (Australia)","Desert Diamond","DraftKings (Pick 3)","DraftKings Predictions",
  "Fanatics Markets","FireKeepers","Four Winds","Hard Rock","iBet","Jackpot.bet","Ladbrokes","Ladbrokes (Australia)",
  "LeoVegas","Midnite","Mise-o-jeu","Neds","Ninja Casino","NorthStar Bets","OwnersBox","OwnersBox (6 Pick Insured)",
  "ParlayPlay","partypoker","Picklebet","Play Alberta","Play Eagle","PlayNow","PointsBet (Australia)","PointsBet (Ontario)",
  "Prime Sports","Proline","Rivalry","Rizk","Sleeper","Sportsbet","Sports Interaction","Sporttrade","Stake","STN Sports",
  "SX Bet","TAB","TAB (New Zealand)","TABtouch","TonyBet","TwinSpires","Unibet","Unibet (Australia)","William Hill",
  "Winpot","Underdog Predictions"
];

const BUILDER_LEAGUES = [
  "Football","Baseball","Basketball","Hockey","Soccer","Athletics","Aussie Rules","Boxing","Cricket","Curling","Cycling",
  "Darts","Entertainment","eSports","Golf","Lacrosse","MMA","Motorsports","Olympics","Politics","Rugby League","Rugby Union",
  "Snooker","Surfing","Swimming","Table Tennis","Tennis","Volleyball","Water Polo","Wrestling"
];

const BUILDER_MARKET_TYPES = ["Main Market", "Player Prop", "Alternate Market"];

const BUILDER_FILTER_STATE = {
  sportsbooks: new Set(),
  leagues: new Set(),
  marketTypes: new Set(),
  minOdds: null,
  maxOdds: null,
  minEv: null,
  devigBookMode: "recommended", // "recommended" | "specific"
  devigBook: null, // specific sportsbook name when devigBookMode === "specific"
  devigMethod: "power", // multiplicative | additive | power | worst | best
  dateFrom: null,
  dateTo: null,
  game: "",
  marketWidth: null,
  betWarnings: "any", // any | hide | only
};

function getFilteredPoolLegs() {
  let legs = STATE.legs || [];
  // Sportsbook multi-select
  if (BUILDER_FILTER_STATE.sportsbooks.size > 0) {
    legs = legs.filter((l) => BUILDER_FILTER_STATE.sportsbooks.has(l.book));
  }

  // League / sport multi-select
  if (BUILDER_FILTER_STATE.leagues.size > 0) {
    legs = legs.filter((l) => {
      const league = (l.league || l.sport || "").toLowerCase();
      for (const name of BUILDER_FILTER_STATE.leagues) {
        if (league.includes(String(name).toLowerCase())) return true;
      }
      return false;
    });
  }

  // Market type multi-select (very rough: infer from market_type / market)
  if (BUILDER_FILTER_STATE.marketTypes.size > 0) {
    legs = legs.filter((l) => {
      const mt = (l.market_type || l.market || "").toLowerCase();
      const hasMain = BUILDER_FILTER_STATE.marketTypes.has("Main Market");
      const hasPlayer = BUILDER_FILTER_STATE.marketTypes.has("Player Prop");
      const hasAlt = BUILDER_FILTER_STATE.marketTypes.has("Alternate Market");
      if (hasPlayer && (mt.includes("player") || mt.includes("prop"))) return true;
      if (hasMain && (mt.includes("moneyline") || mt.includes("spread") || mt.includes("total"))) return true;
      if (hasAlt && !mt.includes("player") && !mt.includes("prop") && !mt.includes("moneyline") && !mt.includes("spread")) return true;
      return false;
    });
  }

  // Odds range
  const minOdds = BUILDER_FILTER_STATE.minOdds;
  const maxOdds = BUILDER_FILTER_STATE.maxOdds;
  if (minOdds != null) {
    legs = legs.filter((l) => {
      const am = l.odds_american != null ? l.odds_american : l.odds;
      return am == null ? true : am >= minOdds;
    });
  }
  if (maxOdds != null) {
    legs = legs.filter((l) => {
      const am = l.odds_american != null ? l.odds_american : l.odds;
      return am == null ? true : am <= maxOdds;
    });
  }

  // Min EV%
  const minEv = BUILDER_FILTER_STATE.minEv;
  if (minEv != null && !isNaN(minEv) && minEv > 0) {
    legs = legs.filter((l) => l.ev_pct != null && l.ev_pct >= minEv);
  }

  // Date range
  const dateFrom = BUILDER_FILTER_STATE.dateFrom;
  const dateTo = BUILDER_FILTER_STATE.dateTo;
  if (dateFrom || dateTo) {
    legs = legs.filter((l) => {
      const d = l.captured_at || l.capturedAt;
      if (!d) return true;
      const dateStr = typeof d === "string" ? d.slice(0, 10) : "";
      if (dateFrom && dateStr < dateFrom) return false;
      if (dateTo && dateStr > dateTo) return false;
      return true;
    });
  }

  // Game text search
  const game = (BUILDER_FILTER_STATE.game || "").toLowerCase();
  if (game) {
    legs = legs.filter((l) => {
      const name = (l.participant || l.player || "").toLowerCase();
      return name.includes(game);
    });
  }

  // Market width
  const marketWidth = BUILDER_FILTER_STATE.marketWidth;
  if (marketWidth != null && marketWidth !== "") {
    legs = legs.filter((l) => (l.market_width != null ? String(l.market_width) : "") === String(marketWidth));
  }

  // Bet warnings
  if (BUILDER_FILTER_STATE.betWarnings === "hide") {
    legs = legs.filter((l) => !l.bet_warning && !l.warning);
  } else if (BUILDER_FILTER_STATE.betWarnings === "only") {
    legs = legs.filter((l) => !!l.bet_warning || !!l.warning);
  }

  return legs;
}

function refreshBuilderSportsbookOptions() {
  // Populate Devig-specific sportsbook select with the same sportsbook list
  const sel = $("builderFilterDevigBookSelect");
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = '<option value="">Choose sportsbook…</option>';
  BUILDER_SPORTSBOOKS.forEach((name) => {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    sel.appendChild(opt);
  });
  if (current) sel.value = current;
}

function legToBuilderLeg(leg) {
  const am = leg.odds_american != null ? leg.odds_american : leg.odds;
  return {
    participant: leg.participant,
    market: leg.market,
    market_type: leg.market_type,
    side: leg.side,
    line: leg.line,
    odds: am,
    odds_american: am,
    hit_prob_pct: leg.hit_prob_pct,
    ev_pct: leg.ev_pct,
    book: leg.book,
    stake: leg.stake ?? leg.stake_amount,
  };
}

/** Format for leg cards: EV% | Market | Participant | Odds | Sportsbook (side/line omitted — still on leg for API) */
function formatLegCardLabel(leg) {
  const evPct = leg.ev_pct != null ? Number(leg.ev_pct).toFixed(2) + "%" : "—";
  const marketType = leg.market_type || leg.market || "—";
  const participant = leg.participant || "?";
  const am = leg.odds_american != null ? leg.odds_american : leg.odds;
  const oddsStr = am != null ? (am >= 0 ? "+" : "") + am : "—";
  const book = (leg.book && leg.book !== "Unknown") ? leg.book : (leg.book === "Unknown Book" ? "Unknown Book" : (leg.book || "—"));
  return `${evPct} | ${marketType} | ${participant} | ${oddsStr} | ${book}`;
}

function renderBuilderPool() {
  const root = $("builderPoolList");
  if (!root) return;
  const filtered = getFilteredPoolLegs();
  root.innerHTML = "";
  filtered.forEach((leg, i) => {
    const card = document.createElement("div");
    card.className = "builderLegCard";
    card.draggable = true;
    card.dataset.poolIndex = String(i);
    const legPayload = legToBuilderLeg(leg);
    const label = formatLegCardLabel(legPayload);
    card.innerHTML = `<span class="builderLegCardText">${escapeHtml(label)}</span><button type="button" class="builderLegAddBtn" title="Add to parlay">+ Add</button>`;
    const payloadStr = JSON.stringify(legPayload);
    let didDrag = false;
    card.querySelector(".builderLegAddBtn").addEventListener("click", (e) => {
      e.stopPropagation();
      STATE.builderLegs = STATE.builderLegs || [];
      STATE.builderLegs.push(legPayload);
      renderBuilder();
    });
    card.addEventListener("click", (e) => {
      if (e.target.closest(".builderLegAddBtn")) return;
      if (didDrag) return;
      STATE.builderLegs = STATE.builderLegs || [];
      STATE.builderLegs.push(legPayload);
      renderBuilder();
    });
    card.addEventListener("dragstart", (e) => {
      didDrag = true;
      e.dataTransfer.effectAllowed = "copy";
      e.dataTransfer.setData("text/plain", payloadStr);
      try { e.dataTransfer.setData("application/json", payloadStr); } catch (_) {}
      card.classList.add("dragging");
      const ghost = document.createElement("div");
      ghost.className = "builderLegGhost";
      ghost.setAttribute("data-drag-ghost", "1");
      card.parentNode.insertBefore(ghost, card);
      card.style.visibility = "hidden";
    });
    card.addEventListener("dragend", (e) => {
      card.classList.remove("dragging");
      card.style.visibility = "";
      const ghost = root.querySelector("[data-drag-ghost]");
      if (ghost) ghost.remove();
      setTimeout(() => { didDrag = false; }, 0);
    });
    root.appendChild(card);
  });
}

function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

function setupBuilderDropZone() {
  const list = $("builderLegsList");
  if (!list || list.dataset.dropZoneSetup === "1") return;
  list.dataset.dropZoneSetup = "1";
  list.addEventListener("dragover", (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; list.classList.add("dragOver"); });
  list.addEventListener("dragleave", () => list.classList.remove("dragOver"));
  list.addEventListener("drop", (e) => {
    e.preventDefault();
    list.classList.remove("dragOver");
    let raw = e.dataTransfer.getData("text/plain") || e.dataTransfer.getData("application/json");
    if (!raw) return;
    try {
      const data = JSON.parse(raw);
      if (data.builderIndex != null) return;
      const leg = data;
      if (leg && (leg.participant != null || leg.market != null)) {
        STATE.builderLegs = STATE.builderLegs || [];
        STATE.builderLegs.push(leg);
        renderBuilder();
      }
    } catch (_) {}
  });
}

function renderBuilderWorkspace() {
  const list = $("builderLegsList");
  if (!list) return;
  setupBuilderDropZone();
  list.innerHTML = "";
  const legs = STATE.builderLegs || [];
  legs.forEach((leg, i) => {
    const card = document.createElement("div");
    card.className = "builderLegCard builderLegRow";
    card.draggable = true;
    card.dataset.builderIndex = String(i);
    const label = formatLegCardLabel(leg);
    card.innerHTML = `<span class="builderLegLabel">${escapeHtml(label)}</span><button class="builderLegRemove" data-index="${i}" aria-label="Remove">×</button>`;
    card.querySelector(".builderLegRemove").addEventListener("click", (e) => { e.stopPropagation(); removeBuilderLeg(i); });
    card.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("application/json", JSON.stringify({ builderIndex: i }));
      e.dataTransfer.effectAllowed = "move";
      card.classList.add("dragging");
      const ghost = document.createElement("div");
      ghost.className = "builderLegGhost";
      ghost.setAttribute("data-drag-ghost", "1");
      list.insertBefore(ghost, card);
      card.style.visibility = "hidden";
    });
    card.addEventListener("dragend", (e) => {
      card.classList.remove("dragging");
      card.style.visibility = "";
      const ghost = list.querySelector("[data-drag-ghost]");
      if (ghost) ghost.remove();
    });
    list.appendChild(card);
  });
}

function renderBuilderMetrics() {
  const legs = STATE.builderLegs || [];
  const stats = computeBuilderParlay(legs);
  const hitPct = stats.hitProbability;
  const evPct = stats.evPct;
  const oddsEl = $("builderCombinedOdds");
  const evEl = $("builderProjectedEv");
  const hitEl = $("builderHitProb");
  const survEl = $("builderSurvival");
  const divEl = $("builderDiversification");
  const capEl = $("builderCapital");
  if (oddsEl) {
    const am = stats.combinedOddsAmerican;
    oddsEl.textContent = am != null ? (am >= 0 ? "+" : "") + am : "—";
  }
  if (evEl) {
    evEl.textContent = evPct != null ? pct(evPct) : "—";
    evEl.className = "builderMetricValue " + evColorClass(evPct);
  }
  if (hitEl) {
    hitEl.textContent = hitPct != null ? hitPct.toFixed(1) + "%" : "—";
    hitEl.className = "builderMetricValue " + hitProbColorClass(hitPct);
  }
  if (survEl) {
    survEl.textContent = hitPct != null ? hitPct.toFixed(1) + "%" : "—";
    survEl.title = "For a single parlay, survival = hit probability";
  }
  if (divEl) divEl.textContent = legs.length <= 1 ? "—" : "—";
  if (capEl) {
    capEl.textContent = "—";
    chrome.storage.sync.get(["bankroll", "riskPerSession"], (st) => {
      const bank = st.bankroll != null ? parseFloat(st.bankroll) : null;
      const risk = st.riskPerSession != null ? parseFloat(st.riskPerSession) / 100 : 0.08;
      if (bank && bank > 0 && legs.length > 0) {
        const unit = (bank * risk) / 1;
        capEl.textContent = money(unit) + " (1 slip)";
      } else {
        capEl.textContent = "—";
      }
    });
  }
}

function renderBuilderSuggestion() {
  const legs = STATE.builderLegs || [];
  const section = $("builderSuggestionSection");
  const textEl = $("builderSuggestionText");
  if (!section || !textEl) return;
  if (legs.length === 0) { section.classList.add("hidden"); return; }
  const slip = { legs, est_ev_score: computeBuilderParlay(legs).evPct };
  if (getEvTier(slip) !== "low") {
    section.classList.add("hidden");
    return;
  }
  section.classList.remove("hidden");
  const hitPct = computeSlipHitProb(slip);
  const evScore = slip.est_ev_score != null ? slip.est_ev_score : 0;
  const needEv = Math.max(0, SLIP_QUALITY_EV_OK - evScore);
  const needHit = Math.max(0, SLIP_QUALITY_HIT_OK - (hitPct || 0));
  const pool = getFilteredPoolLegs();
  let suggestion = "";
  if (pool.length > 0) {
    const better = pool.filter((l) => (l.ev_pct != null && l.ev_pct >= needEv + evScore) || (l.hit_prob_pct != null && l.hit_prob_pct >= 25 && l.hit_prob_pct >= (hitPct || 0) + needHit));
    if (better.length > 0) {
      const leg = better[0];
      suggestion = `Try adding "${leg.participant || "?"}" (${leg.market || "?"}) from the pool — higher EV or hit % may improve this slip.`;
    }
  }
  if (!suggestion) suggestion = `To reach OK quality: aim for at least ${SLIP_QUALITY_HIT_OK}% hit probability and ${SLIP_QUALITY_EV_OK}% projected EV. Consider adding a leg from the pool or capturing legs with ≥ ${(needEv + evScore).toFixed(1)}% EV and ≥ ${(needHit + (hitPct || 0)).toFixed(1)}% hit probability.`;
  textEl.textContent = suggestion;
}

function renderBuilder() {
  renderBuilderPool();
  renderBuilderWorkspace();
  renderBuilderMetrics();
  renderBuilderSuggestion();
}

function removeBuilderLeg(index) {
  STATE.builderLegs.splice(index, 1);
  renderBuilder();
}

// ============================================================
// SECTION 5: SLIP EDITING
// ============================================================

// Normalize leg for prop matching (participant+market+side+line)
function legKey(leg) {
  if (!leg) return "";
  const p = (leg.participant || "").trim().toLowerCase();
  const m = (leg.market || "").trim().toLowerCase();
  const s = (leg.side || "").trim().toLowerCase();
  const l = leg.line != null ? String(leg.line) : "";
  return `${p}|${m}|${s}|${l}`;
}

// Props used in other slips (excluding current editing slip)
function getPropsUsedInOtherSlips(editingIndex) {
  const used = new Set();
  (STATE.parlays || []).forEach((slip, idx) => {
    if (idx === editingIndex) return;
    (slip.legs || []).forEach((l) => used.add(legKey(l)));
  });
  return used;
}

// Slip titles for double-dip warning
function getSlipsContainingPlayer(playerName) {
  const name = (playerName || "").trim().toLowerCase();
  const titles = [];
  (STATE.parlays || []).forEach((slip, idx) => {
    if (idx === STATE.editingSlipIndex) return;
    const has = (slip.legs || []).some((l) => (l.participant || "").toLowerCase() === name);
    if (has) titles.push(slipTitleFromLegs(slip.legs) || `Slip ${idx + 1}`);
  });
  return titles;
}

function openSlipEditor(slipIndex) {
  const parlays = STATE.parlays || [];
  if (slipIndex < 0 || slipIndex >= parlays.length) return;
  const slip = parlays[slipIndex];
  const legs = slip.legs || [];

  STATE.editingSlipIndex = slipIndex;
  STATE.editingSlipLegs = legs.map((l) => ({ ...l })); // Copy legs
  STATE.replacementSuggestion = null;

  // Ensure we have exactly legsPerSlip slots (pad with null for ghost)
  const target = STATE.legsPerSlip || 3;
  while (STATE.editingSlipLegs.length < target) {
    STATE.editingSlipLegs.push(null);
  }
  if (STATE.editingSlipLegs.length > target) {
    STATE.editingSlipLegs = STATE.editingSlipLegs.slice(0, target);
  }

  // Hide tab bar and other panels, show slip editor
  const tabBar = document.querySelector(".tabBar");
  if (tabBar) tabBar.classList.add("hidden");
  const panelPortfolio = $("panelPortfolio");
  const panelBuilder = $("panelBuilder");
  const panelMyBets = $("panelMyBets");
  const panelAnalytics = $("panelAnalytics");
  if (panelPortfolio) panelPortfolio.classList.add("hidden");
  if (panelBuilder) panelBuilder.classList.add("hidden");
  if (panelMyBets) panelMyBets.classList.add("hidden");
  if (panelAnalytics) panelAnalytics.classList.add("hidden");
  const panelSlip = $("panelSlipEditor");
  if (panelSlip) panelSlip.classList.remove("hidden");

  renderSlipEditor();
}

function closeSlipEditor() {
  STATE.editingSlipIndex = null;
  STATE.editingSlipLegs = [];
  STATE.replacementSuggestion = null;

  const tabBar = document.querySelector(".tabBar");
  if (tabBar) tabBar.classList.remove("hidden");
  const panelSlip = $("panelSlipEditor");
  const panelPortfolio = $("panelPortfolio");
  if (panelSlip) panelSlip.classList.add("hidden");
  if (panelPortfolio) panelPortfolio.classList.remove("hidden");
}

async function fetchReplacementSuggestion(emptySlotIndex) {
  const legs = STATE.editingSlipLegs || [];
  const currentLegs = legs.filter((l) => l != null);
  const allLegs = STATE.legs || [];
  const otherParlays = (STATE.parlays || []).filter((_, i) => i !== STATE.editingSlipIndex);

  try {
    const resp = await fetch(`${STATE.backendUrl}/v1/parlays/replace-leg`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        current_slip_legs: currentLegs,
        empty_slot_index: emptySlotIndex,
        all_legs: allLegs,
        other_parlays: otherParlays,
      }),
    });
    if (!resp.ok) return;
    const data = await resp.json();
    STATE.replacementSuggestion = data;
    renderSlipEditor();
  } catch (e) {
    console.warn("Replace-leg request failed:", e);
  }
}

function removeSlipEditorLeg(slotIndex) {
  if (STATE.editingSlipIndex == null) return;
  STATE.editingSlipLegs[slotIndex] = null;
  STATE.replacementSuggestion = null;
  fetchReplacementSuggestion(slotIndex);
  renderSlipEditor();
}

function addSlipEditorLeg(leg, slotIndex) {
  if (STATE.editingSlipIndex == null) return;
  const player = leg?.participant;
  const inOtherSlips = getSlipsContainingPlayer(player);
  if (inOtherSlips.length > 0) {
    const msg = `${player} is already in the following slips: ${inOtherSlips.join(", ")}. Are you sure you want to add them? This creates concentration risk.`;
    if (!confirm(msg)) return;
  }
  const copy = { ...leg };
  STATE.editingSlipLegs[slotIndex] = copy;
  STATE.replacementSuggestion = null;
  renderSlipEditor();
}

function renderSlipEditor() {
  const legsEl = $("slipEditorLegs");
  const replacementEl = $("slipEditorReplacement");
  const propsListEl = $("slipEditorPropsList");
  if (!legsEl || !propsListEl) return;

  const legs = STATE.editingSlipLegs || [];
  const usedInOther = getPropsUsedInOtherSlips(STATE.editingSlipIndex);
  const availableLegs = STATE.legs || [];
  const seen = new Set();
  const allProps = availableLegs.filter((leg) => {
    const key = `${leg.participant}|${leg.market}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Render leg pills + ghost slots
  legsEl.innerHTML = "";
  legs.forEach((leg, i) => {
    const pill = document.createElement("div");
    pill.className = leg ? "slipEditorLegPill" : "slipEditorLegPill slipEditorGhostPill";
    if (leg) {
      const sideLabel = leg.side && leg.side !== "other" ? ` ${leg.side}` : "";
      const label = `${leg.participant || "?"} ${leg.market || "?"}${sideLabel}${leg.line != null ? " " + leg.line : ""} @ ${leg.odds_american ?? leg.odds ?? "?"}`;
      pill.innerHTML = `<label class="slipEditorLegPick"><input type="checkbox" class="slipEditorLegRemoveCb" data-slot="${i}" title="Remove leg from slip" aria-label="Remove leg from slip" /><span class="slipEditorLegLabel">${escapeHtml(label)}</span></label>`;
      const cb = pill.querySelector(".slipEditorLegRemoveCb");
      cb.addEventListener("change", () => {
        if (cb.checked) removeSlipEditorLeg(i);
      });
    } else {
      pill.innerHTML = `<span class="slipEditorGhostLabel">Empty slot</span>`;
    }
    legsEl.appendChild(pill);
  });

  // Replacement suggestion
  const sugg = STATE.replacementSuggestion;
  if (replacementEl) {
    if (sugg?.replacement) {
      const r = sugg.replacement;
      const evStr = r.ev_impact != null ? ` — EV impact: ${r.ev_impact >= 0 ? "+" : ""}${r.ev_impact}%` : "";
      replacementEl.innerHTML = `Replacement candidate: ${r.participant || "?"} ${r.market || "?"} O${r.line != null ? r.line : ""}${evStr}`;
      replacementEl.classList.remove("hidden");
    } else if (sugg?.no_replacement) {
      const evStr = sugg.portfolio_ev != null ? ` Portfolio EV drops to ${sugg.portfolio_ev}%` : "";
      replacementEl.textContent = `No replacement recommended.${evStr}`;
      replacementEl.classList.remove("hidden");
    } else {
      replacementEl.classList.add("hidden");
      replacementEl.textContent = "";
    }
  }

  // Props list
  propsListEl.innerHTML = "";
  const firstEmpty = legs.findIndex((l) => l == null);
  allProps.forEach((prop) => {
    const card = document.createElement("div");
    const isUsed = usedInOther.has(legKey(prop));
    const evVal = prop.ev_pct != null ? prop.ev_pct : (prop.ev != null ? prop.ev : null);
    const hitVal = prop.hit_prob_pct != null ? prop.hit_prob_pct : null;
    const oddsVal = prop.odds_american ?? prop.odds ?? "?";
    const propSideLabel = prop.side && prop.side !== "other" ? ` ${prop.side}` : "";
    card.className = "slipEditorPropCard" + (isUsed ? " slipEditorPropUsed" : "");
    card.innerHTML = `
      <div class="slipEditorPropMain">${prop.participant || "?"} · ${prop.market || "?"}${propSideLabel}${prop.line != null ? " " + prop.line : ""}</div>
      <div class="slipEditorPropMeta">Odds ${oddsVal} · EV ${evVal != null ? pct(evVal) : "—"} · Hit ${hitVal != null ? hitVal.toFixed(1) + "%" : "—"}</div>
      ${isUsed ? '<span class="slipEditorPropTag">Already Used</span>' : ""}
    `;
    if (firstEmpty >= 0 && !legs.some((l) => l && legKey(l) === legKey(prop))) {
      card.classList.add("slipEditorPropClickable");
      card.addEventListener("click", () => addSlipEditorLeg(prop, firstEmpty));
    }
    propsListEl.appendChild(card);
  });
}

// ============================================================
// SECTION 9: ONBOARDING TOUR
// ============================================================

const ONBOARDING_STEPS = [
  { target: "portfolioSection", text: "1. Capture — Open an optimizer page (e.g. OddsJam), then click Capture to scan props.", arrow: "top" },
  { target: "sliderSection", text: "2. Slip filters — Set minimum combined hit probability and parlay EV; Generate applies them after the engine runs.", arrow: "top" },
  { target: "btnGenerate", text: "3. Generate — Click to build optimized parlays from your captured legs.", arrow: "top" },
  { target: "slipsSection", text: "4. Results — Review slips, metrics, and click Edit to refine any slip.", arrow: "top" },
];

function startOnboardingIfFirstTime() {
  if (localStorage.getItem("puff_onboardingComplete") === "1") return;
  startOnboardingTour();
}

function startOnboardingTour() {
  const overlay = $("onboardingOverlay");
  if (!overlay) return;
  overlay.classList.remove("hidden");
  document.body.classList.add("onboardingActive");
  STATE.onboardingStep = 0;
  renderOnboardingStep();
}

function endOnboardingTour() {
  localStorage.setItem("puff_onboardingComplete", "1");
  const overlay = $("onboardingOverlay");
  if (overlay) overlay.classList.add("hidden");
  document.body.classList.remove("onboardingActive");
}

function renderOnboardingStep() {
  const step = STATE.onboardingStep ?? 0;
  const config = ONBOARDING_STEPS[step];
  const textEl = $("onboardingStepText");
  const cardEl = $("onboardingCard");
  const spotlightEl = $("onboardingSpotlight");
  const prevBtn = $("onboardingPrev");
  const nextBtn = $("onboardingNext");

  if (!config) {
    endOnboardingTour();
    return;
  }

  if (textEl) textEl.textContent = config.text;
  if (prevBtn) prevBtn.disabled = step === 0;
  if (nextBtn) nextBtn.textContent = step === ONBOARDING_STEPS.length - 1 ? "Got it" : "Next →";

  const target = $(config.target);
  if (target && spotlightEl) {
    const rect = target.getBoundingClientRect();
    spotlightEl.style.top = rect.top + "px";
    spotlightEl.style.left = rect.left + "px";
    spotlightEl.style.width = rect.width + "px";
    spotlightEl.style.height = rect.height + "px";
    spotlightEl.style.display = "block";
  } else if (spotlightEl) spotlightEl.style.display = "none";
}

function onboardingNext() {
  if (STATE.onboardingStep >= ONBOARDING_STEPS.length - 1) {
    endOnboardingTour();
    return;
  }
  STATE.onboardingStep = (STATE.onboardingStep ?? 0) + 1;
  renderOnboardingStep();
}

function onboardingPrev() {
  if (STATE.onboardingStep <= 0) return;
  STATE.onboardingStep--;
  renderOnboardingStep();
}

// ============================================================
// SECTION 8: LINE MOVEMENT ALERTS
// ============================================================

function showLineMoveAlert(detail) {
  const panelSlip = $("panelSlipEditor");
  const isOnSlipEditor = panelSlip && !panelSlip.classList.contains("hidden");

  if (isOnSlipEditor) {
    let el = $("slipEditorLineMoveAlert");
    if (!el) {
      el = document.createElement("div");
      el.id = "slipEditorLineMoveAlert";
      el.className = "lineMoveAlert lineMoveAlertInline";
      const slipCurrent = $("slipEditorCurrent");
      if (slipCurrent) slipCurrent.insertBefore(el, slipCurrent.firstChild);
    }
    const msg = detail?.message || `Line moved: ${detail?.player || "?"} ${detail?.change || ""} | EV change: ${detail?.evChange != null ? (detail.evChange >= 0 ? "+" : "") + detail.evChange + "%" : "—"}`;
    el.textContent = msg;
    el.classList.remove("hidden");
  } else {
    const existing = document.querySelector(".lineMoveAlertToast");
    if (existing) existing.remove();
    const toast = document.createElement("div");
    toast.className = "lineMoveAlert lineMoveAlertToast";
    const msg = detail?.message || `Line moved: ${detail?.player || "?"} ${detail?.change || ""} | EV change: ${detail?.evChange != null ? (detail.evChange >= 0 ? "+" : "") + detail.evChange + "%" : "—"}`;
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 6000);
  }
}

// ============================================================
// INIT & EVENT BINDING
// ============================================================

const STORAGE_KEYS = {
  bankroll: "puff_bankroll",
  riskPct: "puff_risk_per_session",
  backendUrl: "puff_backend_url",
};

// My Bets tab — do not use puff_bankroll here; STORAGE_KEYS.bankroll is the Portfolio risk budget for generation.
const MY_BETS_BANKROLL_KEY = "puff_my_bets_bankroll";
const BETS_KEY = "puff_bets";

async function loadMyBetsBankroll() {
  return new Promise((resolve) => {
    chrome.storage.local.get([MY_BETS_BANKROLL_KEY], (result) => {
      const v = result[MY_BETS_BANKROLL_KEY];
      const n = v != null ? Number(v) : 0;
      resolve(Number.isFinite(n) && n >= 0 ? n : 0);
    });
  });
}

async function saveMyBetsBankroll(amount) {
  const n = Number(amount);
  const safe = Number.isFinite(n) && n >= 0 ? n : 0;
  return new Promise((resolve) => {
    chrome.storage.local.set({ [MY_BETS_BANKROLL_KEY]: safe }, resolve);
  });
}

async function loadBets() {
  return new Promise((resolve) => {
    chrome.storage.local.get([BETS_KEY], (result) => {
      const raw = result[BETS_KEY];
      resolve(Array.isArray(raw) ? raw : []);
    });
  });
}

async function saveBets(bets) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [BETS_KEY]: Array.isArray(bets) ? bets : [] }, resolve);
  });
}

async function renderMyBetsTab() {
  const bankroll = await loadMyBetsBankroll();
  const bets = await loadBets();

  const bankrollAmountEl = $("bankrollAmount");
  if (bankrollAmountEl) bankrollAmountEl.textContent = `$${bankroll.toFixed(2)}`;

  const settled = bets.filter((b) => b.status === "won" || b.status === "lost");
  const wins = settled.filter((b) => b.status === "won").length;
  const losses = settled.filter((b) => b.status === "lost").length;
  const totalWagered = settled.reduce((s, b) => s + (Number(b.stake) || 0), 0);
  const totalReturn = settled
    .filter((b) => b.status === "won")
    .reduce((s, b) => s + (Number(b.payout) || 0), 0);
  const roi =
    totalWagered > 0 ? (((totalReturn - totalWagered) / totalWagered) * 100).toFixed(1) : "0.0";

  const statWins = $("statWins");
  const statLosses = $("statLosses");
  const statROI = $("statROI");
  if (statWins) statWins.textContent = String(wins);
  if (statLosses) statLosses.textContent = String(losses);
  if (statROI) statROI.textContent = `${roi}%`;

  const active = bets.filter((b) => b.status === "pending");
  const activeBetsList = $("activeBetsList");
  if (activeBetsList) {
    if (active.length === 0) {
      activeBetsList.innerHTML = `
      <div class="emptyState" id="activeBetsEmpty">
        <div class="emptyStateIcon">🎯</div>
        <div class="emptyStateTitle">No active bets</div>
        <div class="emptyStateMsg">Place a slip from the Portfolio tab to track it here.</div>
      </div>`;
    } else {
      activeBetsList.innerHTML = "";
      active.forEach((bet) => {
        activeBetsList.appendChild(renderBetCard(bet));
      });
    }
  }

  const settledBetsCard = $("settledBetsCard");
  const settledBetsList = $("settledBetsList");
  if (settled.length > 0) {
    if (settledBetsCard) settledBetsCard.style.display = "";
    if (settledBetsList) {
      settledBetsList.innerHTML = "";
      [...settled].reverse().forEach((bet) => {
        settledBetsList.appendChild(renderBetCard(bet));
      });
    }
  } else {
    if (settledBetsCard) settledBetsCard.style.display = "none";
    if (settledBetsList) settledBetsList.innerHTML = "";
  }
}

// ── Analytics ────────────────────────────────────────────
let _chartBankroll = null;
let _chartWL = null;
let _chartBooks = null;

function destroyAnalyticsCharts() {
  [_chartBankroll, _chartWL, _chartBooks].forEach((c) => {
    if (c && typeof c.destroy === "function") {
      c.destroy();
    }
  });
  _chartBankroll = null;
  _chartWL = null;
  _chartBooks = null;
}

async function renderAnalyticsTab() {
  const bets = await loadBets();
  const settled = bets.filter((b) => b.status === "won" || b.status === "lost");
  const initialBankroll = await loadMyBetsBankroll();

  const wins = settled.filter((b) => b.status === "won");
  const losses = settled.filter((b) => b.status === "lost");
  const totalWagered = settled.reduce((s, b) => s + (Number(b.stake) || 0), 0);
  const totalReturn = wins.reduce((s, b) => s + (Number(b.payout) || 0), 0);
  const roi = totalWagered > 0 ? (((totalReturn - totalWagered) / totalWagered) * 100).toFixed(1) : null;
  const actualHitRate =
    settled.length > 0 ? ((wins.length / settled.length) * 100).toFixed(1) : null;
  const expectedHitRate =
    settled.length > 0
      ? (
          (settled.reduce((s, b) => s + (Number(b.combined_hit_prob) || 0), 0) / settled.length) *
          100
        ).toFixed(1)
      : null;
  const edge =
    actualHitRate != null && expectedHitRate != null
      ? (parseFloat(actualHitRate) - parseFloat(expectedHitRate)).toFixed(1)
      : null;

  const roiEl = $("aStatROI");
  if (roiEl) {
    roiEl.textContent = roi != null ? `${roi}%` : "—";
    roiEl.style.color = roi
      ? parseFloat(roi) >= 0
        ? "rgba(80,220,120,.9)"
        : "rgba(255,80,80,.9)"
      : "rgba(255,255,255,.5)";
  }
  const wrEl = $("aStatWinRate");
  if (wrEl) wrEl.textContent = actualHitRate != null ? `${actualHitRate}%` : "—";
  const exEl = $("aStatExpected");
  if (exEl) exEl.textContent = expectedHitRate != null ? `${expectedHitRate}%` : "—";
  const edEl = $("aStatEdge");
  if (edEl) {
    edEl.textContent = edge != null ? `${parseFloat(edge) > 0 ? "+" : ""}${edge}%` : "—";
    edEl.style.color = edge
      ? parseFloat(edge) >= 0
        ? "rgba(80,220,120,.9)"
        : "rgba(255,80,80,.9)"
      : "rgba(255,255,255,.5)";
  }

  destroyAnalyticsCharts();

  if (typeof Chart === "undefined") {
    const bankrollEmpty = $("bankrollEmpty");
    const wlEmpty = $("wlEmpty");
    const booksEmpty = $("booksEmpty");
    const cB = $("chartBankroll");
    const cW = $("chartWL");
    const cBk = $("chartBooks");
    if (bankrollEmpty) {
      bankrollEmpty.style.display = "";
      const msg = bankrollEmpty.querySelector(".emptyStateMsg");
      if (msg)
        msg.textContent =
          "Chart.js could not load. Check your connection and extension permissions.";
    }
    if (wlEmpty) wlEmpty.style.display = "";
    if (booksEmpty) booksEmpty.style.display = "";
    if (cB) cB.style.display = "none";
    if (cW) cW.style.display = "none";
    if (cBk) cBk.style.display = "none";
    return;
  }

  const sortedSettled = [...settled].sort(
    (a, b) => (Number(a.settledAt) || 0) - (Number(b.settledAt) || 0)
  );
  const bankrollEmpty = $("bankrollEmpty");
  const canvasB = $("chartBankroll");

  if (sortedSettled.length < 2) {
    if (bankrollEmpty) bankrollEmpty.style.display = "";
    if (canvasB) canvasB.style.display = "none";
  } else {
    if (bankrollEmpty) bankrollEmpty.style.display = "none";
    if (canvasB) canvasB.style.display = "";

    let running = initialBankroll;
    settled.forEach((b) => {
      const stake = Number(b.stake) || 0;
      const payout = Number(b.payout) || 0;
      if (b.status === "won") running -= payout - stake;
      if (b.status === "lost") running += stake;
    });

    const bankrollPoints = [{ x: "Start", y: parseFloat(running.toFixed(2)) }];
    sortedSettled.forEach((b) => {
      const stake = Number(b.stake) || 0;
      const payout = Number(b.payout) || 0;
      if (b.status === "won") running += payout - stake;
      if (b.status === "lost") running -= stake;
      const date = new Date(Number(b.settledAt) || Date.now());
      const label = `${date.getMonth() + 1}/${date.getDate()}`;
      bankrollPoints.push({ x: label, y: parseFloat(running.toFixed(2)) });
    });

    const ctxB = canvasB?.getContext?.("2d");
    if (ctxB) {
      _chartBankroll = new Chart(ctxB, {
        type: "line",
        data: {
          labels: bankrollPoints.map((p) => p.x),
          datasets: [
            {
              data: bankrollPoints.map((p) => p.y),
              borderColor: "rgba(185,190,255,.8)",
              backgroundColor: "rgba(185,190,255,.08)",
              borderWidth: 2,
              pointRadius: 3,
              pointBackgroundColor: "rgba(185,190,255,.9)",
              fill: true,
              tension: 0.3,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: {
              ticks: { color: "rgba(255,255,255,.35)", font: { size: 10 } },
              grid: { color: "rgba(255,255,255,.05)" },
            },
            y: {
              ticks: {
                color: "rgba(255,255,255,.35)",
                font: { size: 10 },
                callback: (v) => `$${v}`,
              },
              grid: { color: "rgba(255,255,255,.05)" },
            },
          },
        },
      });
    }
  }

  const wlEmpty = $("wlEmpty");
  const canvasW = $("chartWL");
  if (settled.length === 0) {
    if (wlEmpty) wlEmpty.style.display = "";
    if (canvasW) canvasW.style.display = "none";
  } else {
    if (wlEmpty) wlEmpty.style.display = "none";
    if (canvasW) canvasW.style.display = "";
    const ctxW = canvasW?.getContext?.("2d");
    if (ctxW) {
      _chartWL = new Chart(ctxW, {
        type: "doughnut",
        data: {
          labels: ["Won", "Lost"],
          datasets: [
            {
              data: [wins.length, losses.length],
              backgroundColor: ["rgba(80,220,120,.7)", "rgba(255,80,80,.6)"],
              borderColor: ["rgba(80,220,120,.3)", "rgba(255,80,80,.3)"],
              borderWidth: 1,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: "65%",
          plugins: {
            legend: {
              position: "bottom",
              labels: { color: "rgba(255,255,255,.5)", font: { size: 10 }, padding: 10 },
            },
          },
        },
      });
    }
  }

  const aeActual = $("aeActual");
  const aeExpected = $("aeExpected");
  const aeDiff = $("aeDiff");
  const aeNote = $("aeNote");
  if (aeActual) aeActual.textContent = actualHitRate != null ? `${actualHitRate}%` : "—";
  if (aeExpected) aeExpected.textContent = expectedHitRate != null ? `${expectedHitRate}%` : "—";
  if (edge != null && aeDiff && aeNote) {
    const edgeNum = parseFloat(edge);
    aeDiff.textContent = `${edgeNum >= 0 ? "+" : ""}${edge}%`;
    aeDiff.style.color = edgeNum >= 0 ? "rgba(80,220,120,.9)" : "rgba(255,80,80,.9)";
    aeNote.textContent =
      edgeNum >= 0 ? "Hitting above expectation 🔥" : "Hitting below expectation — normal variance";
  } else {
    if (aeDiff) {
      aeDiff.textContent = "—";
      aeDiff.style.color = "";
    }
    if (aeNote) aeNote.textContent = "Settle bets to see your edge.";
  }

  const booksEmpty = $("booksEmpty");
  const canvasBk = $("chartBooks");
  const bookStats = {};
  settled.forEach((b) => {
    const bk = String(b.book || "Unknown").trim() || "Unknown";
    if (!bookStats[bk]) bookStats[bk] = { wagered: 0, returned: 0 };
    bookStats[bk].wagered += Number(b.stake) || 0;
    if (b.status === "won") bookStats[bk].returned += Number(b.payout) || 0;
  });

  const bookNames = Object.keys(bookStats);
  if (bookNames.length === 0) {
    if (booksEmpty) booksEmpty.style.display = "";
    if (canvasBk) canvasBk.style.display = "none";
  } else {
    if (booksEmpty) booksEmpty.style.display = "none";
    if (canvasBk) canvasBk.style.display = "";
    const bookROIs = bookNames.map((book) => {
      const { wagered, returned } = bookStats[book];
      return wagered > 0 ? parseFloat((((returned - wagered) / wagered) * 100).toFixed(1)) : 0;
    });

    const ctxBk = canvasBk?.getContext?.("2d");
    if (ctxBk) {
      _chartBooks = new Chart(ctxBk, {
        type: "bar",
        data: {
          labels: bookNames,
          datasets: [
            {
              data: bookROIs,
              backgroundColor: bookROIs.map((r) =>
                r >= 0 ? "rgba(80,220,120,.6)" : "rgba(255,80,80,.5)"
              ),
              borderColor: bookROIs.map((r) =>
                r >= 0 ? "rgba(80,220,120,.3)" : "rgba(255,80,80,.3)"
              ),
              borderWidth: 1,
              borderRadius: 4,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: {
              ticks: { color: "rgba(255,255,255,.35)", font: { size: 9 } },
              grid: { display: false },
            },
            y: {
              ticks: {
                color: "rgba(255,255,255,.35)",
                font: { size: 10 },
                callback: (v) => `${v}%`,
              },
              grid: { color: "rgba(255,255,255,.05)", borderDash: [3, 3] },
            },
          },
        },
      });
    }
  }
}

function renderBetCard(bet) {
  const card = document.createElement("div");
  const st = bet.status || "pending";
  card.className = `betCard betCard--${st}`;
  if (bet.id != null) card.dataset.betId = String(bet.id);

  const statusEmoji = st === "pending" ? "⏳" : st === "won" ? "✅" : "❌";
  const stakeNum = Number(bet.stake);
  const stakeDisplay = Number.isFinite(stakeNum) && stakeNum > 0 ? `$${stakeNum.toFixed(2)}` : "—";
  const payoutNum = Number(bet.payout);
  const payoutDisplay =
    st === "won" && Number.isFinite(payoutNum) && payoutNum > 0 ? `+$${payoutNum.toFixed(2)}` : "";

  const bookLabel = escHtmlBankroll(bet.book || "—");
  const legsHtml = (bet.legs || [])
    .map(
      (l) =>
        `<div class="betCardLeg">${escHtmlBankroll(l.participant || "—")} · ${escHtmlBankroll(l.market || "—")}</div>`
    )
    .join("");

  const idAttr = bet.id != null ? escAttrBankroll(String(bet.id)) : "";

  card.innerHTML = `
    <div class="betCardHeader">
      <span class="betCardBook">${bookLabel}</span>
      <span class="betCardStatus">${statusEmoji} ${String(st).toUpperCase()}</span>
    </div>
    <div class="betCardLegs">
      ${legsHtml}
    </div>
    <div class="betCardFooter">
      <span class="betCardStake">Stake: ${stakeDisplay}</span>
      ${payoutDisplay ? `<span class="betCardPayout">${payoutDisplay}</span>` : ""}
      ${
        st === "pending" && idAttr
          ? `
        <button type="button" class="btnWon btnSecondary" data-id="${idAttr}">Won</button>
        <button type="button" class="btnLost btnSecondary" data-id="${idAttr}">Lost</button>
      `
          : ""
      }
    </div>
  `;

  if (st === "pending" && bet.id != null) {
    card.querySelector(".btnWon")?.addEventListener("click", () => settleBet(bet.id, "won"));
    card.querySelector(".btnLost")?.addEventListener("click", () => settleBet(bet.id, "lost"));
  }

  if (bet.id != null) {
    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "btnDeleteBet";
    deleteBtn.textContent = "🗑";
    deleteBtn.title = "Delete bet";
    deleteBtn.setAttribute("aria-label", "Delete bet");
    deleteBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      openDeleteConfirm(bet.id);
    });
    card.querySelector(".betCardHeader")?.appendChild(deleteBtn);
  }

  return card;
}

async function settleBet(betId, result) {
  const bets = await loadBets();
  const bet = bets.find((b) => String(b.id) === String(betId));
  if (!bet) return;

  bet.status = result;
  bet.settledAt = Date.now();

  if (result === "won") {
    const payout = Number(bet.payout);
    if (Number.isFinite(payout) && payout > 0) {
      const bankroll = await loadMyBetsBankroll();
      await saveMyBetsBankroll(bankroll + payout);
    }
  }

  await saveBets(bets);
  await renderMyBetsTab();
}

function switchTab(name) {
  const panelPortfolio = $("panelPortfolio");
  const panelBuilder = $("panelBuilder");
  const panelMyBets = $("panelMyBets");
  const panelAnalytics = $("panelAnalytics");
  document.querySelectorAll(".tabBtn").forEach((b) => b.classList.remove("isActive"));

  if (name === "portfolio") {
    $("tabPortfolioBtn")?.classList.add("isActive");
    if (panelPortfolio) panelPortfolio.classList.remove("hidden");
    if (panelBuilder) panelBuilder.classList.add("hidden");
    if (panelMyBets) panelMyBets.classList.add("hidden");
    if (panelAnalytics) panelAnalytics.classList.add("hidden");
    renderBankrollBookList();
  } else if (name === "builder") {
    $("tabBuilderBtn")?.classList.add("isActive");
    if (panelPortfolio) panelPortfolio.classList.add("hidden");
    if (panelBuilder) panelBuilder.classList.remove("hidden");
    if (panelMyBets) panelMyBets.classList.add("hidden");
    if (panelAnalytics) panelAnalytics.classList.add("hidden");
    refreshBuilderSportsbookOptions();
    renderBuilder();
  } else if (name === "mybets") {
    $("tabMyBetsBtn")?.classList.add("isActive");
    if (panelPortfolio) panelPortfolio.classList.add("hidden");
    if (panelBuilder) panelBuilder.classList.add("hidden");
    if (panelMyBets) panelMyBets.classList.remove("hidden");
    if (panelAnalytics) panelAnalytics.classList.add("hidden");
    void renderMyBetsTab();
  } else if (name === "analytics") {
    $("tabAnalyticsBtn")?.classList.add("isActive");
    if (panelPortfolio) panelPortfolio.classList.add("hidden");
    if (panelBuilder) panelBuilder.classList.add("hidden");
    if (panelMyBets) panelMyBets.classList.add("hidden");
    if (panelAnalytics) panelAnalytics.classList.remove("hidden");
    void renderAnalyticsTab();
  }
}

function escAttrBankroll(s) {
  return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function escHtmlBankroll(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
}

let _modalSlip = null;
let _deleteBetId = null;

function openDeleteConfirm(betId) {
  _deleteBetId = betId;
  const el = $("deleteBetModal");
  if (el) {
    el.classList.remove("hidden");
    el.setAttribute("aria-hidden", "false");
  }
}

function closeDeleteBetModal() {
  const el = $("deleteBetModal");
  if (el) {
    el.classList.add("hidden");
    el.setAttribute("aria-hidden", "true");
  }
  _deleteBetId = null;
}

function slipBookDisplay(slip) {
  if (slip?.book != null && String(slip.book).trim()) return String(slip.book);
  const books = getSlipBooks(slip);
  return books.length ? books.join(" · ") : "—";
}

function slipDecimalPayoutMultiplier(slip) {
  if (slip?.expected_payout != null && Number.isFinite(Number(slip.expected_payout))) {
    return Number(slip.expected_payout);
  }
  const legs = slip?.legs || [];
  let m = 1;
  for (const leg of legs) {
    const odds = leg.odds_american || leg.odds || 0;
    if (!odds) continue;
    m *= odds > 0 ? 1 + odds / 100 : 1 + 100 / Math.abs(odds);
  }
  return m;
}

function slipParlayEvAsFraction(slip) {
  if (slip?.parlay_ev != null && Number.isFinite(Number(slip.parlay_ev))) {
    return Number(slip.parlay_ev);
  }
  const p = computeParlayEv(slip);
  return p != null ? p / 100 : 0;
}

function slipCombinedHitAsFraction(slip) {
  if (slip?.combined_hit_prob != null && Number.isFinite(Number(slip.combined_hit_prob))) {
    return Number(slip.combined_hit_prob);
  }
  const h = computeSlipHitProb(slip);
  return h != null ? h / 100 : 0;
}

function resetPlaceBetConflictUi() {
  const warningEl = $("modalWarning");
  const confirmBtn = $("btnConfirmBet");
  const proceedBtn = $("btnWarningProceed");
  const cancelBtn = $("btnWarningCancel");
  const bodyEl = $("modalWarningBody");
  if (warningEl) warningEl.style.display = "none";
  if (confirmBtn) confirmBtn.style.display = "";
  if (bodyEl) bodyEl.innerHTML = "";
  if (proceedBtn) proceedBtn.onclick = null;
  if (cancelBtn) cancelBtn.onclick = null;
}

async function finalizeBet() {
  if (!_modalSlip) return;

  const stakeIn = $("modalStakeInput");
  const stakeVal = parseFloat(String(stakeIn?.value ?? ""));
  if (isNaN(stakeVal) || stakeVal <= 0) {
    if (stakeIn) stakeIn.style.borderColor = "rgba(255,80,80,.6)";
    return;
  }
  if (stakeIn) stakeIn.style.borderColor = "";

  const mult = slipDecimalPayoutMultiplier(_modalSlip);
  const payout = stakeVal * (Number.isFinite(mult) && mult > 0 ? mult : 1);

  const newBet = {
    id: `bet_${Date.now()}`,
    book: slipBookDisplay(_modalSlip),
    legs: _modalSlip.legs || [],
    stake: stakeVal,
    payout: payout,
    parlay_ev: slipParlayEvAsFraction(_modalSlip),
    combined_hit_prob: slipCombinedHitAsFraction(_modalSlip),
    expected_payout: mult,
    status: "pending",
    placedAt: Date.now(),
  };

  const bankroll = await loadMyBetsBankroll();
  if (bankroll > 0) {
    await saveMyBetsBankroll(Math.max(0, bankroll - stakeVal));
  }

  const bets = await loadBets();
  bets.push(newBet);
  await saveBets(bets);

  closePlaceBetModal();
  showToast("Bet placed ✓");
}

async function openPlaceBetModal(slip) {
  _modalSlip = slip;
  const modal = $("placeBetModal");
  const bookEl = $("modalBook");
  const legsEl = $("modalLegs");
  const statsEl = $("modalStats");
  const stakeIn = $("modalStakeInput");
  if (!modal || !bookEl || !legsEl || !statsEl) return;

  resetPlaceBetConflictUi();

  bookEl.textContent = slipBookDisplay(slip);
  legsEl.innerHTML = (slip.legs || [])
    .map(
      (l) =>
        `<div class="betCardLeg">${escHtmlBankroll(l.participant || "—")} · ${escHtmlBankroll(l.market || "—")}</div>`
    )
    .join("");

  const pev = slipParlayEvAsFraction(slip);
  const ch = slipCombinedHitAsFraction(slip);
  const mult = slipDecimalPayoutMultiplier(slip);
  statsEl.innerHTML = `<span class="modalStat">ParlayEV ${(pev * 100).toFixed(1)}%</span>
     <span class="modalStatDivider">·</span>
     <span class="modalStat">Hit ${(ch * 100).toFixed(1)}%</span>
     <span class="modalStatDivider">·</span>
     <span class="modalStat">Payout ${mult.toFixed(1)}x</span>`;

  const kellyHintEl = $("modalKellyHint");
  if (stakeIn) {
    stakeIn.style.borderColor = "";
    const bankroll = await loadMyBetsBankroll();
    let suggested = 10.0;
    let hintText =
      "Default $10.00 — set your bankroll in My Bets to size stakes with ⅓ Kelly.";

    if (bankroll > 0 && slip) {
      const hitProb = ch;
      const decimalPayout = Number.isFinite(mult) && mult > 0 ? mult : 1;

      const impliedProb = 1 / decimalPayout;
      const edge = hitProb - impliedProb;

      if (edge > 0) {
        const fullKelly = edge / decimalPayout;
        const fractionalKelly = fullKelly * 0.33;
        const raw = bankroll * fractionalKelly;
        suggested = Math.max(1, Math.min(raw, bankroll * 0.05));
        const kellyPct = ((suggested / bankroll) * 100).toFixed(1);
        hintText = `Kelly suggests ${kellyPct}% of bankroll based on this slip's edge`;
      } else {
        suggested = 1.0;
        hintText = "Negative or flat edge — $1 minimum suggestion.";
      }
    }

    stakeIn.value = suggested.toFixed(2);
    if (kellyHintEl) kellyHintEl.textContent = hintText;
  } else if (kellyHintEl) {
    kellyHintEl.textContent = "";
  }

  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
}

function closePlaceBetModal() {
  resetPlaceBetConflictUi();
  const modal = $("placeBetModal");
  if (modal) {
    modal.classList.add("hidden");
    modal.setAttribute("aria-hidden", "true");
  }
  _modalSlip = null;
}

function attachBankrollIntegerInputHandlers(input) {
  if (!input) return;
  input.type = "number";
  input.min = "0";
  input.step = "1";
  input.addEventListener("keydown", (e) => {
    if (["-", "+", ".", "e", "E"].includes(e.key)) {
      e.preventDefault();
    }
  });
}

function rebuildSelectedBooksFromStorage(res) {
  selectedBooks.clear();
  const list = res?.puff_bankrollSelectedBooks;
  if (Array.isArray(list) && list.length) {
    list.forEach((b) => selectedBooks.add(b));
  } else {
    Object.keys(STATE.bookBankrolls || {}).forEach((b) => selectedBooks.add(b));
  }
}

function renderBankrollBookList() {
  const legs = STATE.cachedLegs || [];
  const books = [
    ...new Set(legs.map((l) => l.book).filter((b) => b && b !== "Unknown Book" && b !== "Unknown")),
  ].sort();
  const saved = STATE.bookBankrolls || {};
  const container = document.getElementById("bankrollBookList");
  if (!container) return;

  if (books.length === 0) {
    container.innerHTML = '<p class="settingsHint">Capture legs first to see available books.</p>';
    updateBankrollTotal();
    return;
  }

  Array.from(selectedBooks).forEach((b) => {
    if (!books.includes(b)) selectedBooks.delete(b);
  });

  container.innerHTML = books
    .map((book) => {
      const a = escAttrBankroll(book);
      const h = escHtmlBankroll(book);
      const isSel = selectedBooks.has(book);
      const checked = isSel ? "checked" : "";
      const hidden = isSel ? "" : "hidden";
      const rowSel = isSel ? " selected" : "";
      const val =
        Object.prototype.hasOwnProperty.call(pendingBankrolls, book)
          ? String(pendingBankrolls[book])
          : saved[book] != null && saved[book] !== ""
            ? String(saved[book])
            : "";
      return `
    <div class="bankrollBookRow${rowSel}" data-book="${a}">
      <label class="bankrollBookLabel">
        <input type="checkbox" class="bankrollBookCheck" data-book="${a}" ${checked}>
        <span class="bankrollBookName">${h}</span>
      </label>
      <div class="bankrollBookRight">
        <div class="bankrollInputWrapper ${hidden}">
          <span class="bankrollDollar">$</span>
          <input type="number" class="bankrollInput" data-book="${a}"
            min="0" step="1" placeholder="0" value="${val}">
        </div>
      </div>
    </div>`;
    })
    .join("");

  const firstRight = container.querySelector(".bankrollBookRight");
  if (firstRight) {
    const hint = document.createElement("div");
    hint.style.cssText = "font-size:10px;color:rgba(255,255,255,0.35);margin-top:3px;";
    hint.textContent = "How much you want to risk across your slips this session";
    firstRight.appendChild(hint);
  }

  container.querySelectorAll(".bankrollBookCheck").forEach((cb) => {
    cb.addEventListener("change", () => {
      const book = cb.dataset.book;
      const row = cb.closest(".bankrollBookRow");
      const wrapper = row?.querySelector(".bankrollInputWrapper");
      if (book) {
        if (cb.checked) selectedBooks.add(book);
        else {
          selectedBooks.delete(book);
          STATE.bookBankrolls = STATE.bookBankrolls || {};
          delete STATE.bookBankrolls[book];
          delete pendingBankrolls[book];
        }
      }
      if (row) row.classList.toggle("selected", !!cb.checked);
      if (wrapper) wrapper.classList.toggle("hidden", !cb.checked);
      saveBankrolls(true);
      updateBankrollTotal();
    });
  });

  container.querySelectorAll(".bankrollInput").forEach((input) => {
    const book = input.dataset.book;
    if (!book) return;
    attachBankrollIntegerInputHandlers(input);
    input.addEventListener("input", () => {
      const digits = input.value.replace(/[^0-9]/g, "");
      input.value = digits;
      if (digits === "") {
        delete pendingBankrolls[book];
      } else {
        pendingBankrolls[book] = parseInt(digits, 10) || 0;
      }
      input.style.borderColor = "";
      input.parentElement?.querySelector(".bankrollError")?.remove();
      updateBankrollTotal();
    });
    const persistBookBankroll = () => {
      saveBankrolls(true);
      delete pendingBankrolls[book];
    };
    input.addEventListener("change", persistBookBankroll);
    input.addEventListener("blur", persistBookBankroll);
  });

  updateBankrollTotal();
}

function validateBankrollInputs() {
  const inputs = document.querySelectorAll("#bankrollBookList .bankrollInput");
  let valid = true;

  inputs.forEach((inp) => {
    const val = inp.value.trim();
    const num = parseFloat(val);

    inp.style.borderColor = "";
    const wrapper = inp.parentElement;
    const existingError = wrapper?.querySelector(".bankrollError");
    if (existingError) existingError.remove();

    if (val === "" || val === "0") return;

    if (Number.isNaN(num) || num < 0) {
      inp.style.borderColor = "rgba(255,80,80,0.8)";
      const error = document.createElement("span");
      error.className = "bankrollError";
      error.style.cssText = "color:rgba(255,100,100,0.9);font-size:10px;margin-left:6px;";
      error.textContent = "Enter a valid amount";
      if (wrapper) wrapper.appendChild(error);
      valid = false;
    }
  });

  return valid;
}

/** @param {boolean} [skipValidation=true] Set false for Save / generate so invalid amounts block persist. */
function saveBankrolls(skipValidation = true) {
  if (!skipValidation && !validateBankrollInputs()) return false;

  const result = {};
  document.querySelectorAll("#bankrollBookList .bankrollBookCheck:checked").forEach((cb) => {
    const book = cb.dataset.book;
    if (!book) return;
    const input = cb.closest(".bankrollBookRow")?.querySelector(".bankrollInput");
    const val = parseFloat(input && input.value);
    if (!Number.isNaN(val) && val > 0) result[book] = val;
  });
  STATE.bookBankrolls = result;

  if (!skipValidation) {
    const warning = document.getElementById("bankrollWarning");
    if (warning) {
      const highBudget = Object.values(result).some((v) => v > 500);
      if (highBudget) {
        warning.textContent = "⚠️ Large risk budget — make sure this is intentional.";
        warning.style.display = "block";
      } else {
        warning.style.display = "none";
      }
    }
  }

  const midnight = new Date();
  midnight.setHours(24, 0, 0, 0);
  chrome.storage.local.set({
    puff_bookBankrolls: result,
    puff_bankrollSelectedBooks: Array.from(selectedBooks),
    puff_bankrollExpiry: midnight.getTime(),
  });
  return true;
}

function updateBankrollTotal() {
  let total = 0;
  document.querySelectorAll("#bankrollBookList .bankrollBookCheck:checked").forEach((cb) => {
    const inp = cb.closest(".bankrollBookRow")?.querySelector(".bankrollInput");
    if (!inp) return;
    const val = parseFloat(inp.value) || 0;
    if (val > 0) total += val;
  });
  const el = document.getElementById("bankrollTotalAmount");
  if (el) el.textContent = `$${total.toFixed(0)}`;
}

function loadBankrolls() {
  return new Promise((resolve) => {
    chrome.storage.local.get(
      ["puff_bookBankrolls", "puff_bankrollExpiry", "puff_cachedLegs", "puff_bankrollSelectedBooks"],
      (res) => {
        STATE.cachedLegs = res.puff_cachedLegs || [];
        const expiry = res.puff_bankrollExpiry || 0;
        if (expiry > 0 && Date.now() > expiry) {
          STATE.bookBankrolls = {};
          selectedBooks.clear();
          Object.keys(pendingBankrolls).forEach((k) => delete pendingBankrolls[k]);
          chrome.storage.local.remove(
            ["puff_bookBankrolls", "puff_bankrollExpiry", "puff_bankrollSelectedBooks"],
            () => {
              renderBankrollBookList();
              updateBankrollTotal();
              resolve();
            }
          );
        } else {
          STATE.bookBankrolls = res.puff_bookBankrolls || {};
          rebuildSelectedBooksFromStorage(res);
          Object.keys(pendingBankrolls).forEach((k) => delete pendingBankrolls[k]);
          renderBankrollBookList();
          updateBankrollTotal();
          resolve();
        }
      }
    );
  });
}

async function refreshBookBankrollsFromStorage() {
  await loadBankrolls();
  if (STATE.parlays && STATE.parlays.length) {
    renderSlips(STATE.parlays);
    renderMetrics(STATE.summary, STATE.parlays, STATE.selectedSlipIndex);
  }
}

function initExportSlipStatsButton() {
  const label = document.querySelector("#slipsSection .slipsHeader .label");
  if (!label || document.getElementById("btnExportSlipStats")) return;
  const exportBtn = document.createElement("button");
  exportBtn.id = "btnExportSlipStats";
  exportBtn.type = "button";
  exportBtn.textContent = "📊 Log Stats";
  exportBtn.style.cssText =
    "font-size:11px;padding:3px 8px;background:rgba(124,99,255,0.3);color:#fff;border:none;border-radius:4px;cursor:pointer;margin-left:8px;";
  exportBtn.onclick = () => {
    const parlays =
      Array.isArray(window.__puffLastParlays) && window.__puffLastParlays.length > 0
        ? window.__puffLastParlays
        : Array.isArray(STATE.parlays)
          ? STATE.parlays
          : [];
    const byBook = {};
    parlays.forEach((slip) => {
      const book = slip.legs?.[0]?.book || "Unknown";
      if (!byBook[book]) byBook[book] = [];
      byBook[book].push(slip);
    });

    console.log(
      `\n=== PUFF Portfolio Stats (${parlays.length} slips across ${Object.keys(byBook).length} books) ===`
    );

    let globalSlipNum = 0;
    Object.entries(byBook).forEach(([book, bookSlips]) => {
      // After per-book generation, each slip here should match the section book (no ⚠️ MIXED on lines below).
      console.log(`\n📚 ${book} (${bookSlips.length} slips)`);
      bookSlips.forEach((slip) => {
        globalSlipNum += 1;
        const legs = slip.legs || [];
        const primaryBook = legs[0]?.book || "Unknown";
        const uniqueBooks = [...new Set(legs.map((l) => l.book).filter(Boolean))];
        const bookDisplay =
          uniqueBooks.length <= 1 ? uniqueBooks[0] || primaryBook : `⚠️ MIXED(${uniqueBooks.join("+")})`;
        const avgEv =
          legs.length > 0 ? legs.reduce((s, l) => s + (l.ev_pct || l.ev || 0), 0) / legs.length : 0;
        const combinedHit =
          legs.reduce((p, l) => p * ((l.hit_prob_pct || l.hit_prob || 50) / 100), 1) * 100;
        const odds = legs.reduce((p, l) => {
          const o = l.odds_american || l.odds || 0;
          if (!o) return p;
          return p * (o > 0 ? 1 + o / 100 : 1 + 100 / Math.abs(o));
        }, 1);
        const parlayEvPct = ((combinedHit / 100) * odds - 1) * 100;
        const evTier = getEvTier(slip);
        const riskTier = getRiskTier(slip);
        const tierIcon = evTier === "strong" ? "🟢" : evTier === "moderate" ? "🟡" : "🔴";
        console.log(
          `${tierIcon} #${globalSlipNum} [${evTier}/${riskTier}] AvgEV=${avgEv.toFixed(1)}% Hit=${combinedHit.toFixed(1)}% ParlayEV=${parlayEvPct.toFixed(1)}% Payout=${odds.toFixed(1)}x | ${bookDisplay} | ${legs.map((l) => (l.participant || "").substring(0, 12)).join(" · ")}`
        );
      });
    });
  };
  label.after(exportBtn);
}

document.addEventListener("DOMContentLoaded", async () => {
  // Section 11: Load settings from chrome.storage.local (options page persists here)
  const stored = await chrome.storage.local.get([STORAGE_KEYS.bankroll, STORAGE_KEYS.riskPct, STORAGE_KEYS.backendUrl]);
  if (STORAGE_KEYS.bankroll in stored) {
    STATE.bankroll = stored[STORAGE_KEYS.bankroll];
  } else {
    const v = localStorage.getItem("puff_bankroll");
    STATE.bankroll = v ? parseFloat(v) : null;
  }
  if (STORAGE_KEYS.riskPct in stored) {
    STATE.riskPerSession = stored[STORAGE_KEYS.riskPct] ?? 8;
  } else {
    STATE.riskPerSession = parseFloat(localStorage.getItem("puff_risk_per_session")) || 8;
  }
  if (STORAGE_KEYS.backendUrl in stored) {
    STATE.backendUrl = stored[STORAGE_KEYS.backendUrl] || "http://127.0.0.1:8000";
  } else {
    STATE.backendUrl = localStorage.getItem("puff_backendUrl") || "http://127.0.0.1:8000";
  }

  await loadBankrolls();

  const bankrollListEl = document.getElementById("bankrollBookList");
  if (bankrollListEl && !bankrollListEl.dataset.puffRowClickBound) {
    bankrollListEl.dataset.puffRowClickBound = "1";
    bankrollListEl.addEventListener("click", (e) => {
      const row = e.target.closest(".bankrollBookRow");
      if (!row || !bankrollListEl.contains(row)) return;
      const book = row.dataset.book;
      if (!book) return;
      if (e.target.tagName === "INPUT") return;
      if (e.target.closest(".bankrollBookLabel")) return;
      const cb = row.querySelector(".bankrollBookCheck");
      if (!cb) return;
      cb.checked = !cb.checked;
      cb.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  $("btnSaveBankrolls")?.addEventListener("click", () => {
    if (!saveBankrolls(false)) return;
    Object.keys(pendingBankrolls).forEach((k) => delete pendingBankrolls[k]);
  });

  const portfolioRiskBudgetInput = $("portfolioRiskBudgetInput");
  if (portfolioRiskBudgetInput) {
    attachBankrollIntegerInputHandlers(portfolioRiskBudgetInput);
    if (STATE.bankroll != null && Number.isFinite(Number(STATE.bankroll))) {
      portfolioRiskBudgetInput.value = String(STATE.bankroll);
    }
    const persistBankroll = () => {
      syncBankrollFromInput();
      chrome.storage.local.set({ [STORAGE_KEYS.bankroll]: STATE.bankroll });
    };
    portfolioRiskBudgetInput.addEventListener("change", persistBankroll);
    portfolioRiskBudgetInput.addEventListener("blur", persistBankroll);
  }

  // Buttons
  $("btnSelectArea").addEventListener("click", onSelectArea);
  $("btnCapture").addEventListener("click", onCapture);

  // Listen for selection completion from content script
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "CAPTURE_RESULT") {
      if (msg.error) updateCaptureStatus(msg.error);
      STATE.legs = Array.isArray(msg.legs) ? msg.legs : [];
      STATE.cachedLegs = STATE.legs.slice();
      renderBankrollBookList();
      return;
    }
    if (msg?.type === "AREA_SELECTED") {
      // Legs were auto-captured; refresh to show count (popup may have reopened)
      getActiveTab().then((tab) => {
        if (tab?.id && canInjectScript(tab.url)) {
          sendMessageWithInject(tab.id, { type: "GET_LEGS" }).then((resp) => {
            if (resp?.ok && resp.legs?.length) {
              STATE.legs = resp.legs;
              STATE.cachedLegs = STATE.legs.slice();
              console.log("[PUFF] Legs after capture:", STATE.legs.length, STATE.legs);
              updateCaptureStatus(`Captured ${STATE.legs.length} legs.`);
              renderBankrollBookList();
            } else {
              updateCaptureStatus(`Captured ${STATE.legs?.length || 0} legs.`);
            }
          }).catch(() => {});
        } else {
          updateCaptureStatus("Area selected.");
        }
      });
    }
  });

  const minHitProbEl = $("minHitProb");
  const minHitProbValEl = $("minHitProbVal");
  if (minHitProbEl && minHitProbValEl) {
    minHitProbEl.value = String(SLIDER_RECOMMENDED_HIT);
    minHitProbValEl.textContent = `${SLIDER_RECOMMENDED_HIT}%`;
    minHitProbEl.addEventListener("input", (e) => {
      minHitProbValEl.textContent = `${e.target.value}%`;
    });
  }
  const minParlayEvEl = $("minParlayEv");
  const minParlayEvValEl = $("minParlayEvVal");
  if (minParlayEvEl && minParlayEvValEl) {
    minParlayEvEl.value = String(SLIDER_RECOMMENDED_PARLAY_EV);
    minParlayEvValEl.textContent = `${SLIDER_RECOMMENDED_PARLAY_EV}%`;
    minParlayEvEl.addEventListener("input", (e) => {
      minParlayEvValEl.textContent = `${e.target.value}%`;
    });
  }

  const sliderSectionEl = $("sliderSection");
  if (sliderSectionEl && !sliderSectionEl.querySelector(".sliderReset")) {
    const resetLink = document.createElement("div");
    resetLink.className = "sliderReset";
    resetLink.textContent = "Reset to recommended";
    resetLink.setAttribute("role", "button");
    resetLink.tabIndex = 0;
    const applyRecommendedSliders = () => {
      const hp = $("minHitProb");
      const hVal = $("minHitProbVal");
      const ev = $("minParlayEv");
      const evVal = $("minParlayEvVal");
      if (hp && hVal) {
        hp.value = String(SLIDER_RECOMMENDED_HIT);
        hVal.textContent = `${SLIDER_RECOMMENDED_HIT}%`;
      }
      if (ev && evVal) {
        ev.value = String(SLIDER_RECOMMENDED_PARLAY_EV);
        evVal.textContent = `${SLIDER_RECOMMENDED_PARLAY_EV}%`;
      }
    };
    resetLink.addEventListener("click", applyRecommendedSliders);
    resetLink.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        applyRecommendedSliders();
      }
    });
    sliderSectionEl.appendChild(resetLink);
  }

  // Leg Count input (Section 6: no hard cap, 2–15)
  $("legCount").addEventListener("input", (e) => {
    let val = parseInt(e.target.value, 10);
    if (!isNaN(val)) {
      val = Math.max(2, Math.min(15, val));
      STATE.legsPerSlip = val;
      e.target.value = val;
    }
  });
  $("legCount").addEventListener("change", (e) => {
    let val = parseInt(e.target.value, 10);
    if (isNaN(val) || val < 2) val = 2;
    if (val > 15) val = 15;
    STATE.legsPerSlip = val;
    e.target.value = val;
  });

  // Generate button
  $("btnGenerate").addEventListener("click", onGenerate);

  initExportSlipStatsButton();

  // Section 4: Tab switching (Portfolio | Builder | My Bets)
  $("tabPortfolioBtn")?.addEventListener("click", () => switchTab("portfolio"));
  $("tabBuilderBtn")?.addEventListener("click", () => switchTab("builder"));
  $("tabMyBetsBtn")?.addEventListener("click", () => switchTab("mybets"));
  $("tabAnalyticsBtn")?.addEventListener("click", () => {
    switchTab("analytics");
    void renderAnalyticsTab();
  });

  const bankrollEditRow = $("bankrollEditRow");
  const myBetsBankrollInput = $("bankrollInput");
  $("btnEditBankroll")?.addEventListener("click", async () => {
    if (bankrollEditRow) bankrollEditRow.style.display = "";
    const b = await loadMyBetsBankroll();
    if (myBetsBankrollInput) myBetsBankrollInput.value = String(b);
    myBetsBankrollInput?.focus();
  });
  $("btnCancelBankroll")?.addEventListener("click", () => {
    if (bankrollEditRow) bankrollEditRow.style.display = "none";
  });
  $("btnSaveBankroll")?.addEventListener("click", async () => {
    const val = parseFloat(String(myBetsBankrollInput?.value ?? ""));
    if (!isNaN(val) && val >= 0) {
      await saveMyBetsBankroll(val);
      if (bankrollEditRow) bankrollEditRow.style.display = "none";
      await renderMyBetsTab();
    }
  });

  // Place Bet modal
  $("btnCloseModal")?.addEventListener("click", closePlaceBetModal);
  $("btnCancelModal")?.addEventListener("click", closePlaceBetModal);
  $("placeBetModal")?.addEventListener("click", (e) => {
    if (e.target === $("placeBetModal")) closePlaceBetModal();
  });
  $("deleteBetModal")?.addEventListener("click", (e) => {
    if (e.target === $("deleteBetModal")) closeDeleteBetModal();
  });
  $("btnCancelDelete")?.addEventListener("click", closeDeleteBetModal);
  $("btnConfirmDelete")?.addEventListener("click", async () => {
    if (_deleteBetId == null) return;

    const bets = await loadBets();
    const bet = bets.find((b) => String(b.id) === String(_deleteBetId));

    if (bet && bet.status === "pending") {
      const stake = Number(bet.stake);
      if (Number.isFinite(stake) && stake > 0) {
        const bankroll = await loadMyBetsBankroll();
        await saveMyBetsBankroll(bankroll + stake);
      }
    }

    const updatedBets = bets.filter((b) => String(b.id) !== String(_deleteBetId));
    await saveBets(updatedBets);

    closeDeleteBetModal();
    await renderMyBetsTab();
    showToast("Bet deleted");
  });

  $("btnConfirmBet")?.addEventListener("click", async () => {
    if (!_modalSlip) return;

    const stakeIn = $("modalStakeInput");
    const stakeVal = parseFloat(String(stakeIn?.value ?? ""));
    if (isNaN(stakeVal) || stakeVal <= 0) {
      if (stakeIn) stakeIn.style.borderColor = "rgba(255,80,80,.6)";
      return;
    }
    if (stakeIn) stakeIn.style.borderColor = "";

    const existingBets = await loadBets();
    const pendingBets = existingBets.filter((b) => b.status === "pending");
    const pendingLegs = pendingBets.flatMap((b) => b.legs || []);

    const newLegs = _modalSlip.legs || [];
    const sameGameConflict = newLegs.some((newLeg) =>
      pendingLegs.some(
        (existing) =>
          existing.game_key && newLeg.game_key && existing.game_key === newLeg.game_key
      )
    );

    if (sameGameConflict) {
      const conflictLines = newLegs
        .filter((newLeg) =>
          pendingLegs.some(
            (existing) =>
              existing.game_key && newLeg.game_key && existing.game_key === newLeg.game_key
          )
        )
        .map((leg) => {
          const conflictingBet = pendingBets.find((b) =>
            b.legs?.some((el) => el.game_key && leg.game_key && el.game_key === leg.game_key)
          );
          const bookLabel = conflictingBet?.book
            ? escHtmlBankroll(String(conflictingBet.book))
            : "existing";
          return `• ${escHtmlBankroll(leg.participant || "?")} (${escHtmlBankroll(leg.market || "?")}) conflicts with your ${bookLabel} bet`;
        });

      const bodyEl = $("modalWarningBody");
      const warningEl = $("modalWarning");
      const confirmBtn = $("btnConfirmBet");
      const proceedBtn = $("btnWarningProceed");
      const cancelBtn = $("btnWarningCancel");

      if (bodyEl) bodyEl.innerHTML = conflictLines.join("<br>");
      if (warningEl) warningEl.style.display = "";
      if (confirmBtn) confirmBtn.style.display = "none";

      if (proceedBtn) {
        proceedBtn.onclick = async () => {
          if (warningEl) warningEl.style.display = "none";
          if (confirmBtn) confirmBtn.style.display = "";
          await finalizeBet();
        };
      }
      if (cancelBtn) {
        cancelBtn.onclick = () => {
          if (warningEl) warningEl.style.display = "none";
          if (confirmBtn) confirmBtn.style.display = "";
        };
      }
      return;
    }

    await finalizeBet();
  });

  // Section 4: Parlay Builder — all filters update pool list
  initBuilderFilters();

  // Section 5: Slip editor - Back button
  $("btnSlipEditorBack")?.addEventListener("click", closeSlipEditor);

  // Section 11: Settings button opens options page (landing page)
  $("btnSettings").addEventListener("click", () => {
    renderBankrollBookList();
    chrome.runtime.openOptionsPage();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      loadBankrolls();
    }
  });

  $("bettableOnlyToggle")?.addEventListener("change", () => {
    if (STATE.parlays && STATE.parlays.length) renderSlips(STATE.parlays);
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (
      changes.puff_bookBankrolls ||
      changes.puff_bankrollExpiry ||
      changes.puff_cachedLegs ||
      changes.puff_bankrollSelectedBooks
    ) {
      refreshBookBankrollsFromStorage();
    }
    if (changes[MY_BETS_BANKROLL_KEY] || changes[BETS_KEY]) {
      if ($("tabMyBetsBtn")?.classList.contains("isActive")) void renderMyBetsTab();
      if ($("tabAnalyticsBtn")?.classList.contains("isActive")) void renderAnalyticsTab();
    }
  });

  // View all slips (return to portfolio metrics when viewing single slip)
  $("btnMetricsViewAll")?.addEventListener("click", () => {
    STATE.selectedSlipIndex = null;
    document.querySelectorAll(".slipCard.isSelected").forEach((c) => c.classList.remove("isSelected"));
    renderMetrics(STATE.summary, STATE.parlays, null);
    const hint = $("metricsViewAllHint");
    if (hint) hint.classList.add("hidden");
  });

  // View full breakdown (if implemented)
  const btnBreakdown = $("btnBreakdown");
  if (btnBreakdown) {
    btnBreakdown.addEventListener("click", () => {
      alert("Full portfolio breakdown coming soon.");
    });
  }

  // Detect tab reloads while the popup is open and refresh captured legs.
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === "complete") {
      getActiveTab().then((activeTab) => {
        if (activeTab && activeTab.id === tabId) {
          refreshCapturedLegsFromPage();
        }
      });
    }
  });

  // Initialize UI state
  const legInput = $("legCount");
  if (legInput) {
    const v = parseInt(legInput.value, 10);
    if (!isNaN(v)) STATE.legsPerSlip = Math.max(2, Math.min(15, v));
  }
  await refreshCapturedLegsFromPage();
  if (!STATE.legs || STATE.legs.length === 0) {
    updateCaptureStatus("No legs captured.");
  }
  STATE.cachedLegs = (STATE.legs || []).slice();
  renderBankrollBookList();
  renderMetrics({}, []);
  renderWarnings([]);
  renderSlips([]);
  renderBuilder();
});
