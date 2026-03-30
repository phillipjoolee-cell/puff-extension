// ============================================================
// PUFF POPUP STATE & CONFIG
// ============================================================

const STATE = {
  legs: [],
  profile: "stable",
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
  summary: null,
  editingSlipIndex: null,
  editingSlipLegs: [], // Array of leg | null — null = ghost slot
  replacementSuggestion: null,
  selectedSlipIndex: null, // When set, metrics show this slip's values; null = portfolio view
};

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

// Slip quality: avg leg EV % and combined hit probability (product of leg hit %). See QUALITY_THRESHOLDS.md.
const SLIP_QUALITY_HIT_OK = 8;
const SLIP_QUALITY_EV_OK = 2;
function getSlipQuality(slip) {
  const legs = slip.legs || [];
  const avgEv =
    legs.length > 0
      ? legs.reduce((sum, l) => sum + (l.ev_pct || l.ev || 0), 0) / legs.length
      : 0;
  const combinedHitProb =
    legs.reduce((prod, l) => {
      const p = (l.hit_prob_pct || l.hit_prob || 50) / 100;
      return prod * p;
    }, 1.0) * 100;
  if (avgEv >= 5 && combinedHitProb >= 15) return "good";
  if (avgEv >= 2 && combinedHitProb >= 8) return "ok";
  return "bad";
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

    // Capital Allocation — per-book split when configured; else backend unit; else prompt
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
      capEl.textContent = "Set bankroll in Settings";
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
      capEl.textContent = "Set bankroll";
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

function renderSlips(parlays) {
  const root = $("slipsList");
  root.innerHTML = "";

  if (!parlays || !parlays.length) {
    root.innerHTML = '<div style="text-align:center;color:var(--textMuted);font-size:11px;">No slips generated.</div>';
    const hint = $("bettableFilterHint");
    if (hint) hint.textContent = "";
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

  // Sort slips: green first, then yellow, then red; within each tier by parlay EV descending
  const qualityOrder = { good: 0, ok: 1, bad: 2 };
  parlays.sort((a, b) => {
    const qa = qualityOrder[getSlipQuality(a)] ?? 2;
    const qb = qualityOrder[getSlipQuality(b)] ?? 2;
    if (qa !== qb) return qa - qb;
    return parlayEv(b) - parlayEv(a);
  });

  let visibleCount = 0;
  parlays.forEach((slip, slipIndex) => {
    if (bettableOnly && !isSlipBettable(slip)) return;
    visibleCount++;

    const card = document.createElement("div");
    const quality = getSlipQuality(slip);
    const bettable = isSlipBettable(slip);
    card.className = "slipCard slipQuality-" + quality + (bettable ? "" : " slipCard--notBettable");
    card.dataset.slipIndex = String(slipIndex);
    card.title = "Quality: " + (quality === "good" ? "Good" : quality === "ok" ? "OK" : "Bad");

    const title = slipTitleFromLegs(slip.legs);
    const odds = slip.est_odds || slip.odds || "-";

    const header = document.createElement("div");
    header.className = "slipCardHeader";
    const qualityIcon = quality === "good" ? "🟢" : quality === "ok" ? "🟡" : "🔴";
    const warnPrefix = bettable ? "" : '<span class="slipCardWarn" aria-hidden="true">⚠️ </span>';
    header.innerHTML = `
      <div class="slipCardQuality" aria-label="Slip quality: ${quality}">${warnPrefix}${qualityIcon}</div>
      <div class="slipCardTitle">${title}</div>
      <div class="slipCardOdds">${odds}</div>
      <div class="slipCardActions">
        <button class="slipCardEditBtn" data-slip-index="${slipIndex}" title="Edit slip">Edit</button>
      <button class="slipCardCopyBtn" data-slip="${JSON.stringify(slip).replace(/"/g, "&quot;")}">📋</button>
      </div>
    `;

    // Legs as comma-separated list (Market: Participant)
    const legsText = slip.legs
      .map((l) => {
        const legLabel = `${l.market}: ${l.participant}`;
        return legLabel;
      })
      .join(", ");
    const legs = document.createElement("div");
    legs.className = "slipCardLegs";
    legs.textContent = legsText;

    const capAlloc = getSlipCapitalAllocation(slip);
    const capRow = document.createElement("div");
    capRow.className = "slipCardCapital";
    capRow.textContent = capAlloc != null ? capAlloc : "Set bankroll in Settings";

    // Section 3: "Recommended" label for engine-generated slips
    const recommended = document.createElement("div");
    recommended.className = "slipRecommended";
    recommended.textContent = "Recommended";

    card.appendChild(header);
    card.appendChild(legs);
    card.appendChild(capRow);
    card.appendChild(recommended);

    // Copy button handler
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

    // Section 5: Edit button
    card.querySelector(".slipCardEditBtn")?.addEventListener("click", (e) => {
      e.stopPropagation();
      openSlipEditor(slipIndex);
    });

    // Click card to view this slip's individual metrics (Edit/Copy don't trigger)
    card.addEventListener("click", (e) => {
      if (e.target.closest(".slipCardEditBtn, .slipCardCopyBtn")) return;
      const isSelected = STATE.selectedSlipIndex === slipIndex;
      STATE.selectedSlipIndex = isSelected ? null : slipIndex;
      document.querySelectorAll(".slipCard.isSelected").forEach((c) => c.classList.remove("isSelected"));
      if (STATE.selectedSlipIndex != null) card.classList.add("isSelected");
      renderMetrics(STATE.summary, parlays, STATE.selectedSlipIndex);
    });

    root.appendChild(card);
  });

  if (visibleCount === 0 && parlays.length > 0) {
    root.innerHTML =
      '<div style="text-align:center;color:var(--textMuted);font-size:11px;">No bettable slips match your sportsbook bankrolls. Turn off the filter or add balances in Settings.</div>';
  }

  // Restore selection highlight if one was selected
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

  // Update slips meta
  const profile = STATE.profile;
  const metaLabel =
    bettableOnly && visibleCount < parlays.length
      ? `${visibleCount} of ${parlays.length} positions`
      : `${parlays.length} positions`;
  const meta = $("slipsMeta");
  if (meta) meta.textContent = `${metaLabel} · ${profile.charAt(0).toUpperCase() + profile.slice(1)}`;
}

// ============================================================
// BACKEND WIRING
// ============================================================

/** Read bankroll from #bankrollInput into STATE (optional sizing for API). */
function syncBankrollFromInput() {
  const el = $("bankrollInput");
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
  console.log("legCount from UI:", legCount);
  return legCount;
}

function profileToSettings(profile) {
  // Map risk_profile string to UserSettings object (backend schema)
  // Leg count comes from #legCount (not hardcoded); stable allows min = legCount - 1 for a small range
  const legCount = getLegCountFromUi();
  STATE.legsPerSlip = legCount;
  const parlay_legs_max = legCount;
  const parlay_legs_min = profile === "stable" ? Math.max(2, legCount - 1) : legCount;
  const settings = {
    min_ev_pct: 1.0,
    max_staleness_mins: 20,
    num_slips: 5,
    legs_per_slip: legCount,
    parlay_legs_min,
    parlay_legs_max,
    bankroll: STATE.bankroll,
    risk_per_session_pct: (STATE.riskPerSession != null ? STATE.riskPerSession : 8) / 100,
  };

  // Adjust by risk profile (example configurations)
  if (profile === "stable") {
    settings.num_slips = 3;
    settings.min_ev_pct = 1.5;
  } else if (profile === "growth") {
    settings.num_slips = 5;
    settings.min_ev_pct = 1.0;
  } else if (profile === "upside") {
    settings.num_slips = 8;
    settings.min_ev_pct = 0.5;
  }

  console.log("profileToSettings output:", JSON.stringify(settings));
  return settings;
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
    const profile = STATE.profile;
    const settings = profileToSettings(profile);
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
        "No slips could be generated from the captured legs. Try capturing more legs or adjusting your risk profile.";
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

    const risk_profile = profile === "upside" ? "high_upside" : profile;
    const payload = {
      legs: validLegs,
      risk_profile,
      settings,
    };
    console.log("[PUFF] Sending to backend:", payload);
    console.log("sending to backend:", JSON.stringify(payload));

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
    const parlays = response.parlays || [];
    if (!parlays.length) {
      console.warn("[PUFF] Backend returned empty portfolio");
      hintEl.textContent =
        "No slips could be generated from the captured legs. Try capturing more legs or adjusting your risk profile.";
      hintEl.classList.add("hint--warn");
    } else {
      hintEl.classList.remove("hint--warn");
      hintEl.textContent = `Generated ${parlays.length} slips.`;
    }

    STATE.parlays = parlays;
    window.__puffLastParlays = parlays;
    STATE.summary = response.summary || null;
    STATE.selectedSlipIndex = null;

    chrome.storage.local.set({
      puff_lastPortfolio: {
        parlays,
        generatedAt: Date.now(),
        profile,
      },
    });

    renderSlips(parlays);
    renderMetrics(response.summary, parlays, null);
    renderWarnings(response.summary?.warnings);
  } catch (e) {
    console.error("[PUFF] Generate Portfolio error:", e);
    alert(`Failed to generate: ${String(e)}\nBackend URL: ${STATE.backendUrl}\nMake sure the backend is running and reachable.`);
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
      updateCaptureStatus(`Failed: ${resp?.error || ""}`);
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
  const quality = getSlipQuality(slip);
  if (quality !== "bad") { section.classList.add("hidden"); return; }
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
  if (panelPortfolio) panelPortfolio.classList.add("hidden");
  if (panelBuilder) panelBuilder.classList.add("hidden");
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
  const allProps = STATE.legs || [];

  // Render leg pills + ghost slots
  legsEl.innerHTML = "";
  legs.forEach((leg, i) => {
    const pill = document.createElement("div");
    pill.className = leg ? "slipEditorLegPill" : "slipEditorLegPill slipEditorGhostPill";
    if (leg) {
      const sideLabel = leg.side && leg.side !== "other" ? ` ${leg.side}` : "";
      const label = `${leg.participant || "?"} ${leg.market || "?"}${sideLabel}${leg.line != null ? " " + leg.line : ""} @ ${leg.odds_american ?? leg.odds ?? "?"}`;
      pill.innerHTML = `<span class="slipEditorLegLabel">${label}</span><button class="slipEditorLegRemove" data-slot="${i}" aria-label="Remove">×</button>`;
      pill.querySelector(".slipEditorLegRemove").addEventListener("click", () => removeSlipEditorLeg(i));
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
  { target: "riskSegment", text: "2. Risk Profile — Pick Stable, Growth, or Upside to tune how aggressive the portfolio is.", arrow: "top" },
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

function escAttrBankroll(s) {
  return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function escHtmlBankroll(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
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

  container.innerHTML = books
    .map((book) => {
      const a = escAttrBankroll(book);
      const h = escHtmlBankroll(book);
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
          min="0" step="1" placeholder="0" value="${val}">
      </div>
    </div>`;
    })
    .join("");

  container.querySelectorAll(".bankrollBookCheck").forEach((cb) => {
    cb.addEventListener("change", () => {
      const wrapper = cb.closest(".bankrollBookRow")?.querySelector(".bankrollInputWrapper");
      if (wrapper) wrapper.classList.toggle("hidden", !cb.checked);
      if (!cb.checked) {
        const book = cb.dataset.book;
        if (book) {
          STATE.bookBankrolls = STATE.bookBankrolls || {};
          delete STATE.bookBankrolls[book];
        }
      }
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

function saveBankrolls() {
  const result = {};
  document.querySelectorAll("#bankrollBookList .bankrollBookCheck:checked").forEach((cb) => {
    const book = cb.dataset.book;
    if (!book) return;
    const input = cb.closest(".bankrollBookRow")?.querySelector(".bankrollInput");
    const val = parseFloat(input && input.value);
    if (!Number.isNaN(val) && val > 0) result[book] = val;
  });
  STATE.bookBankrolls = result;

  const midnight = new Date();
  midnight.setHours(24, 0, 0, 0);
  chrome.storage.local.set({
    puff_bookBankrolls: result,
    puff_bankrollExpiry: midnight.getTime(),
  });
}

function updateBankrollTotal() {
  const total = Object.values(STATE.bookBankrolls || {}).reduce((s, v) => s + v, 0);
  const el = document.getElementById("bankrollTotalAmount");
  if (el) el.textContent = `$${total.toFixed(0)}`;
}

function loadBankrolls() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["puff_bookBankrolls", "puff_bankrollExpiry", "puff_cachedLegs"], (res) => {
      STATE.cachedLegs = res.puff_cachedLegs || [];
      const expiry = res.puff_bankrollExpiry || 0;
      if (expiry > 0 && Date.now() > expiry) {
        STATE.bookBankrolls = {};
        chrome.storage.local.remove(["puff_bookBankrolls", "puff_bankrollExpiry"], () => {
          renderBankrollBookList();
          updateBankrollTotal();
          resolve();
        });
      } else {
        STATE.bookBankrolls = res.puff_bookBankrolls || {};
        renderBankrollBookList();
        updateBankrollTotal();
        resolve();
      }
    });
  });
}

async function refreshBookBankrollsFromStorage() {
  await loadBankrolls();
  if (STATE.parlays && STATE.parlays.length) {
    renderSlips(STATE.parlays);
    renderMetrics(STATE.summary, STATE.parlays, STATE.selectedSlipIndex);
  }
}

/** Temporary: log slip quality stats to console (uses window.__puffLastParlays). */
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
    const parlays = window.__puffLastParlays || [];
    console.log(`=== PUFF Portfolio Stats (${parlays.length} slips) ===`);
    parlays.forEach((slip, i) => {
      const legs = slip.legs || [];
      const avgEv =
        legs.length > 0 ? legs.reduce((s, l) => s + (l.ev_pct || l.ev || 0), 0) / legs.length : 0;
      const combinedHit =
        legs.reduce((p, l) => p * ((l.hit_prob_pct || l.hit_prob || 50) / 100), 1) * 100;
      const odds = legs.reduce((p, l) => {
        const o = l.odds_american || l.odds || 0;
        if (!o) return p;
        return p * (o > 0 ? 1 + o / 100 : 1 + 100 / Math.abs(o));
      }, 1);
      const parlayEv = (combinedHit / 100) * odds - 1;
      const parlayEvPct = parlayEv * 100;
      const q = avgEv >= 5 && combinedHit >= 15 ? "🟢" : avgEv >= 2 && combinedHit >= 8 ? "🟡" : "🔴";
      console.log(
        `${q} #${i + 1} AvgEV=${avgEv.toFixed(1)}% Hit=${combinedHit.toFixed(1)}% ParlayEV=${parlayEvPct.toFixed(1)}% Payout=${odds.toFixed(1)}x | ${legs.map((l) => (l.participant || "").substring(0, 12)).join(" · ")}`
      );
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

  const bankrollInput = $("bankrollInput");
  if (bankrollInput) {
    if (STATE.bankroll != null && Number.isFinite(Number(STATE.bankroll))) {
      bankrollInput.value = String(STATE.bankroll);
    }
    const persistBankroll = () => {
      syncBankrollFromInput();
      chrome.storage.local.set({ [STORAGE_KEYS.bankroll]: STATE.bankroll });
    };
    bankrollInput.addEventListener("change", persistBankroll);
    bankrollInput.addEventListener("blur", persistBankroll);
  }

  // Buttons
  $("btnSelectArea").addEventListener("click", onSelectArea);
  $("btnCapture").addEventListener("click", onCapture);

  // Listen for selection completion from content script
  chrome.runtime.onMessage.addListener((msg) => {
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

  // Risk Profile pills — switching mode triggers fresh portfolio generation and full UI refresh
  document.querySelectorAll(".segBtn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const newProfile = btn.getAttribute("data-profile");
      if (STATE.profile === newProfile) return;
      document.querySelectorAll(".segBtn").forEach((b) => b.classList.remove("isActive"));
      btn.classList.add("isActive");
      STATE.profile = newProfile;
      if (STATE.legs && STATE.legs.length > 0) onGenerate();
    });
  });

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

  // Section 4: Tab switching (Portfolio | Builder)
  const panelPortfolio = $("panelPortfolio");
  const panelBuilder = $("panelBuilder");
  $("tabPortfolioBtn")?.addEventListener("click", () => {
    document.querySelectorAll(".tabBtn").forEach((b) => b.classList.remove("isActive"));
    $("tabPortfolioBtn")?.classList.add("isActive");
    if (panelPortfolio) panelPortfolio.classList.remove("hidden");
    if (panelBuilder) panelBuilder.classList.add("hidden");
    renderBankrollBookList();
  });
  $("tabBuilderBtn")?.addEventListener("click", () => {
    document.querySelectorAll(".tabBtn").forEach((b) => b.classList.remove("isActive"));
    $("tabBuilderBtn")?.classList.add("isActive");
    if (panelPortfolio) panelPortfolio.classList.add("hidden");
    if (panelBuilder) panelBuilder.classList.remove("hidden");
    refreshBuilderSportsbookOptions();
    renderBuilder();
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
    if (changes.puff_bookBankrolls || changes.puff_bankrollExpiry || changes.puff_cachedLegs) {
      refreshBookBankrollsFromStorage();
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
