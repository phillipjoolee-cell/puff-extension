from __future__ import annotations

import logging
import math
import time
from collections import defaultdict
from datetime import datetime, timezone
from typing import List, Optional, Dict, Tuple, Any, Literal
from uuid import uuid4

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

# import request/response schemas
from schemas import (
    RawLeg,
    NormalizedLeg,
    UserSettings,
    IngestRequest,
    IngestResponse,
    Parlay,
    SuggestRequest,
    SuggestResponse,
    OddsFormat,
)

from portfolio import (
    generate_portfolio,
    PortfolioSettings as PortfolioEngineSettings,
    Leg as PortfolioLeg,
    build_portfolio_result,
    Slip as EngineSlip,
)

import json
import os
from datetime import datetime
from pathlib import Path

DEBUG_DUMP_INPUTS = True  # set to False later in production

DEBUG_DIR = Path("debug_inputs")
DEBUG_DIR.mkdir(exist_ok=True)

API_VERSION = "1.0"
# Single-leg EV above this (percent) is treated as bad data and dropped before generation.
MAX_SINGLE_LEG_EV = 30.0
# Post-filter defaults when the client omits slider thresholds (fractions).
DEFAULT_MIN_HIT = 0.12
DEFAULT_MIN_PEV = 0.20

# Merge legs under a single canonical book name per parent / skin (most recognizable brand).
BOOK_ALIASES = {
    "Bovada": "Bodog",
    "Borgata": "BetMGM",
    "Sports Interaction": "BetMGM",
    "Rizk": "Betsafe",
    "Betsson": "Betsafe",
}

app = FastAPI(title="Parlay Builder API", version="0.1.0")

# configure logging so we can diagnose usage without personal details
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

# Enable CORS for Chrome extension
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all origins for now (secure later if needed)
    allow_credentials=True,
    allow_methods=["*"],  # Allow all HTTP methods
    allow_headers=["*"],  # Allow all headers
)


# models have been moved to schemas.py to keep main.py focused on routing logic
# the necessary classes are imported above


# -------------------------
# Helpers
# -------------------------

def dump_legs_for_testing(legs):
    if not DEBUG_DUMP_INPUTS:
        return

    timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S_%f")
    filepath = DEBUG_DIR / f"{timestamp}.json"

    with open(filepath, "w") as f:
        json.dump(legs, f, indent=2)

def american_to_decimal(american: int) -> float:
    if american == 0:
        raise ValueError("american odds cannot be 0")
    if american > 0:
        return 1.0 + (american / 100.0)
    return 1.0 + (100.0 / abs(american))


def decimal_to_american(decimal: float) -> int:
    if decimal <= 1.0:
        raise ValueError("decimal odds must be > 1.0")
    # Convert
    if decimal >= 2.0:
        return int(round((decimal - 1.0) * 100))
    return int(round(-100.0 / (decimal - 1.0)))


def normalize_odds_to_american(odds: float, odds_format: OddsFormat) -> int:
    if odds_format == "american":
        return int(round(odds))
    # decimal
    return decimal_to_american(float(odds))


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def normalize_leg(raw: RawLeg) -> NormalizedLeg:
    odds_am = normalize_odds_to_american(raw.odds, raw.odds_format)
    fair_am = None
    if raw.fair_odds is not None:
        # assume same format as odds unless user passes fair_odds_american later
        fair_am = normalize_odds_to_american(raw.fair_odds, raw.odds_format)

    captured = raw.captured_at or now_utc()
    if captured.tzinfo is None:
        captured = captured.replace(tzinfo=timezone.utc)

    ev_raw = raw.event.strip() if raw.event else None
    gk_raw = raw.game_key.strip() if raw.game_key else None
    return NormalizedLeg(
        id=str(uuid4())[:8],
        source=raw.source.strip() if raw.source else "unknown",
        book=raw.book.strip(),
        sport=(raw.sport.strip() if raw.sport else None),
        league=(raw.league.strip() if raw.league else None),
        market=raw.market.strip(),
        participant=raw.participant.strip(),
        side=raw.side,
        line=raw.line,
        odds_american=odds_am,
        ev_pct=raw.ev_pct,
        hit_prob_pct=raw.hit_prob_pct,
        fair_odds_american=fair_am,
        event=ev_raw,
        game_key=gk_raw,
        url=raw.url,
        captured_at=captured,
    )


def is_stale(leg: NormalizedLeg, stale_minutes: int) -> bool:
    age = (now_utc() - leg.captured_at).total_seconds() / 60.0
    return age > stale_minutes


def correlation_key(leg: NormalizedLeg) -> Tuple[str, str]:
    # super simple: participant + market (prevents same player/market twice)
    return (leg.participant.lower(), leg.market.lower())


def _extract_game_key(participant: str) -> Optional[str]:
    """Extract game matchup key from participant (e.g. 'Player - Team' -> sorted key)."""
    if " - " not in participant:
        return None
    parts = participant.split(" - ", 1)
    if len(parts) == 2:
        return " - ".join(sorted([p.strip() for p in parts]))
    return None


def _implied_prob_from_american(odds: int) -> float:
    """Implied probability from American odds."""
    dec = american_to_decimal(odds)
    return 1.0 / dec if dec > 0 else 0.0


def _parlay_estimated_prob(parlay: Parlay) -> float:
    """Product of leg hit probabilities for a parlay."""
    prob = 1.0
    for leg in parlay.legs:
        p = (leg.hit_prob_pct / 100.0) if leg.hit_prob_pct is not None else _implied_prob_from_american(leg.odds_american)
        prob *= max(0.01, min(0.99, p))
    return prob


def _filter_slips_by_hit_ev(
    slips: List[EngineSlip],
    min_hit: float,
    min_parlay_ev: float,
) -> List[EngineSlip]:
    """Keep slips whose combined model hit prob and parlay EV meet slider thresholds."""
    filtered: List[EngineSlip] = []
    for slip in slips:
        hit = 1.0
        payout = 1.0
        for sl in slip.legs:
            hit *= sl.p_model
            payout *= sl.decimal_odds
        parlay_ev = hit * payout - 1
        if hit >= min_hit and parlay_ev >= min_parlay_ev:
            filtered.append(slip)
    return filtered


def _parlay_diversification_penalty(parlays: List[Parlay]) -> float:
    """Compute diversification penalty for correlation/independence (Section 2A)."""
    if not parlays:
        return 0.0
    total = len(parlays)
    player_counts: Dict[str, int] = {}
    game_counts: Dict[str, int] = {}
    market_side_counts: Dict[Tuple[str, str], int] = {}
    for p in parlays:
        seen_players = set()
        seen_games = set()
        seen_ms = set()
        for leg in p.legs:
            seen_players.add(leg.participant)
            gk = _extract_game_key(leg.participant)
            if gk:
                seen_games.add(gk)
            seen_ms.add((leg.market, leg.side))
        for x in seen_players:
            player_counts[x] = player_counts.get(x, 0) + 1
        for x in seen_games:
            game_counts[x] = game_counts.get(x, 0) + 1
        for x in seen_ms:
            market_side_counts[x] = market_side_counts.get(x, 0) + 1
    t_p, t_g, t_m = 0.30, 0.40, 0.50
    w_p, w_g, w_m = 8.0, 6.0, 3.0
    pen_p = sum(max(0.0, (c / total) - t_p) ** 2 for c in player_counts.values()) * w_p
    pen_g = sum(max(0.0, (c / total) - t_g) ** 2 for c in game_counts.values()) * w_g
    pen_m = sum(max(0.0, (c / total) - t_m) ** 2 for c in market_side_counts.values()) * w_m
    return pen_p + pen_g + pen_m


def _parlay_correlation_warnings(parlays: List[Parlay]) -> List[str]:
    """Warn when player >50% or game >40% of slips (Section 2D)."""
    if not parlays:
        return []
    total = len(parlays)
    player_counts: Dict[str, int] = {}
    game_counts: Dict[str, int] = {}
    for p in parlays:
        seen_players = set()
        seen_games = set()
        for leg in p.legs:
            seen_players.add(leg.participant)
            gk = _extract_game_key(leg.participant)
            if gk:
                seen_games.add(gk)
        for x in seen_players:
            player_counts[x] = player_counts.get(x, 0) + 1
        for x in seen_games:
            game_counts[x] = game_counts.get(x, 0) + 1
    warnings: List[str] = []
    for player, c in player_counts.items():
        if c / total > 0.50:
            warnings.append(f"Player concentration: {player} appears in {int(round(c / total * 100))}% of slips")
    for game, c in game_counts.items():
        if c / total > 0.40:
            slip_word = "slip" if c == 1 else "slips"
            warnings.append(f"Game concentration: {game} appears in {c} {slip_word}")
    return warnings


def compute_portfolio_survival_probability(
    parlays: List[Parlay], correlation_penalty: float
) -> float:
    """
    Portfolio survival: P(at least one slip wins).

    P(full loss) = ∏_i (1 - p_slip_i) where p_slip_i = _parlay_estimated_prob(slip_i)
    (per-slip parlay win probability, product of leg probabilities).

    adjusted_survival = max(0, raw_survival - correlation_penalty).

    With 2+ slips, correlation_penalty is capped so adjusted survival stays strictly
    above every individual slip win probability (independent-slips bound).
    """
    if not parlays:
        return 0.0
    p_full_loss = 1.0
    slip_probs: List[float] = []
    for p in parlays:
        p_slip = float(_parlay_estimated_prob(p))
        p_slip = max(1e-6, min(1.0 - 1e-6, p_slip))
        slip_probs.append(p_slip)
        p_full_loss *= 1.0 - p_slip
    raw_survival = 1.0 - p_full_loss
    corr = max(0.0, float(correlation_penalty))
    if len(slip_probs) >= 2:
        max_slip = max(slip_probs)
        max_allowed_penalty = max(0.0, raw_survival - max_slip - 1e-5)
        corr = min(corr, max_allowed_penalty)
    return max(0.0, raw_survival - corr)


def _parlay_portfolio_metrics(parlays: List[Parlay]) -> Dict[str, Any]:
    """survival_probability (0–1), diversification_score, warnings for API summary."""
    if not parlays:
        return {"survival_probability": None, "diversification_score": None, "warnings": []}
    penalty = _parlay_diversification_penalty(parlays)
    correlation_penalty = min(0.15, penalty * 0.02)
    survival = compute_portfolio_survival_probability(parlays, correlation_penalty)
    diversification_score = round(max(0.0, 100.0 - penalty * 20.0), 1)
    warnings = _parlay_correlation_warnings(parlays)
    return {
        "survival_probability": round(survival, 4),
        "diversification_score": diversification_score,
        "warnings": warnings,
    }


def score_leg(leg: NormalizedLeg) -> float:
    # MVP scoring: trust optimizer EV if provided, else small baseline
    return float(leg.ev_pct) if leg.ev_pct is not None else 0.25


def parlay_time_sensitivity(legs: List[NormalizedLeg], stale_minutes: int) -> Literal["low", 
"medium", "high"]:
    # If any leg is near-stale or recently captured, mark higher sensitivity.
    ages = [(now_utc() - l.captured_at).total_seconds() / 60.0 for l in legs]
    mx = max(ages) if ages else 0
    mn = min(ages) if ages else 0
    # fresh lines can move quickly; very old legs are risky
    if mn <= 2 or mx >= stale_minutes * 0.8:
        return "high"
    if mn <= 8:
        return "medium"
    return "low"


def build_parlays(legs: List[NormalizedLeg], settings: UserSettings) -> List[Parlay]:
    # 1) filter
    filtered: List[NormalizedLeg] = []
    for leg in legs:
        if settings.allowed_books and leg.book not in settings.allowed_books:
            continue
        if leg.ev_pct is not None and leg.ev_pct < settings.min_ev_pct:
            continue
        if is_stale(leg, settings.stale_minutes):
            continue
        filtered.append(leg)

    # 2) sort by leg score descending
    filtered.sort(key=score_leg, reverse=True)

    # 3) greedy build: create parlays from top legs while avoiding simple correlation
    results: List[Parlay] = []
    used_pairs: set[Tuple[str, str]] = set()
    # Track legs already used in previous parlays so portfolios are disjoint.
    used_leg_ids: set[str] = set()

    # Try building parlays starting from every filtered leg (no cap on start indices or count)
    min_legs = settings.parlay_legs_min
    max_legs = settings.parlay_legs_max

    for start_idx, start_leg in enumerate(filtered):
        # Skip legs that have already been consumed by previous parlays
        if getattr(start_leg, "id", None) in used_leg_ids:
            continue

        parlay_legs = [start_leg]
        seen_corr = {correlation_key(start_leg)}

        # Vary target leg count so Stable (2-3) produces 2-leg and 3-leg slips; Growth (3-3) stays 3-leg; Upside (3-4) gets 3 and 4
        if min_legs < max_legs:
            target_n = min_legs if (start_idx % 2 == 0) else max_legs
        else:
            target_n = max_legs

        for cand in filtered:
            if len(parlay_legs) >= target_n:
                break
            # Never reuse a leg that has already been committed to a previous parlay
            if getattr(cand, "id", None) in used_leg_ids:
                continue
            ck = correlation_key(cand)
            if ck in seen_corr:
                continue
            # avoid reusing same exact (participant, market) combos across parlays too aggressively
            if ck in used_pairs:
                continue
            parlay_legs.append(cand)
            seen_corr.add(ck)

        if len(parlay_legs) < settings.parlay_legs_min:
            continue

        # score the parlay
        base = sum(score_leg(l) for l in parlay_legs)

        # correlation penalty: if same sport/league repeats a lot (very rough)
        league_counts: Dict[str, int] = {}
        for l in parlay_legs:
            k = (l.league or l.sport or "unknown").lower()
            league_counts[k] = league_counts.get(k, 0) + 1
        penalty = 0.0
        for _, c in league_counts.items():
            if c >= 3:
                penalty += 0.75

        est_ev_score = round(base - penalty, 3)

        # risk score heuristic: more legs => more variance; older legs => more risk
        avg_age = (sum((now_utc() - l.captured_at).total_seconds() / 60.0 for l in 
parlay_legs) 
/ len(parlay_legs))
        risk = 3 + (len(parlay_legs) - 2) * 2
        if avg_age > settings.stale_minutes * 0.5:
            risk += 2
        risk = max(1, min(10, risk))

        notes = []
        notes.append(f"Built from top EV legs (min EV ≥ {settings.min_ev_pct}%).")
        if penalty > 0:
            notes.append("Applied correlation penalty (many legs from same league).")
        notes.append("User should confirm lines and odds before submitting.")

        parlay_id = str(uuid4())[:8]

        results.append(
            Parlay(
                id=parlay_id,
                legs=parlay_legs,
                num_legs=len(parlay_legs),
                est_ev_score=est_ev_score,
                risk_score=risk,
                time_sensitivity=parlay_time_sensitivity(parlay_legs, settings.stale_minutes),
                notes=notes,
            )
        )

        # mark pairs and legs used so future parlays are built from remaining legs only
        for l in parlay_legs:
            used_pairs.add(correlation_key(l))
            if getattr(l, "id", None) is not None:
                used_leg_ids.add(l.id)

    # Order slips best to worst — same tiers as extension slip quality (green / yellow / red)
    SLIP_HIT_GOOD, SLIP_HIT_OK = 15.0, 8.0
    SLIP_EV_GOOD, SLIP_EV_OK = 3.0, 1.0

    def quality_rank(p: Parlay) -> int:
        hit_pct = _parlay_estimated_prob(p) * 100.0
        ev_score = getattr(p, "est_ev_score", None) or 0.0
        if hit_pct <= 0:
            return 0
        if hit_pct >= SLIP_HIT_GOOD and ev_score >= SLIP_EV_GOOD:
            return 2  # good
        if hit_pct >= SLIP_HIT_OK and ev_score >= SLIP_EV_OK:
            return 1  # ok
        return 0  # bad

    results.sort(key=quality_rank, reverse=True)
    return results


def slip_quality(slip_legs, legs_norm):
    """Quick quality check matching frontend getSlipQuality logic."""
    matched = []
    for sl in slip_legs:
        match = next(
            (
                nl
                for nl in legs_norm
                if nl.participant == sl.leg.participant and nl.market == sl.leg.market
            ),
            None,
        )
        if match:
            matched.append(match)
    if not matched:
        return "bad"
    avg_ev = sum(l.ev_pct or 0 for l in matched) / len(matched)
    combined = 1.0
    for l in matched:
        combined *= (l.hit_prob_pct or 50) / 100
    combined *= 100
    if avg_ev >= 5 and combined >= 15:
        return "good"
    if avg_ev >= 2 and combined >= 8:
        return "ok"
    return "bad"


# -------------------------
# Routes
# -------------------------

@app.get("/health")
def health():
    return {"ok": True, "ts": now_utc().isoformat()}


@app.post("/v1/legs/ingest", response_model=IngestResponse)
def ingest(req: IngestRequest):
    normalized = [normalize_leg(r) for r in req.legs]
    return IngestResponse(normalized=normalized)


@app.post("/v1/parlays/suggest", response_model=SuggestResponse)
def suggest(req: SuggestRequest):
    # verify license if keys configured (read dynamically so tests can patch env)
    valid = set(os.getenv("VALID_LICENSE_KEYS", "").split(",")) if os.getenv("VALID_LICENSE_KEYS") else set()
    if valid and (not req.license_key or req.license_key not in valid):
        raise HTTPException(status_code=402, detail="Payment required or invalid license key")

    legs_norm: List[NormalizedLeg] = []
    if len(req.legs) == 0:
        return SuggestResponse(parlays=[])

    first = req.legs[0]
    if isinstance(first, dict):
        raw_legs = [RawLeg.model_validate(x) for x in req.legs]  # type: ignore
        legs_norm = [normalize_leg(r) for r in raw_legs]
    elif isinstance(first, NormalizedLeg):
        legs_norm = list(req.legs)
    else:
        raw_legs = [RawLeg.model_validate(x) for x in req.legs]  # type: ignore
        legs_norm = [normalize_leg(r) for r in raw_legs]

    logger.info("suggest called legs=%d", len(legs_norm))

    # still dump raw legs for offline debugging if DEBUG_DUMP_INPUTS enabled
    dump_legs_for_testing([l.model_dump(mode="json") for l in legs_norm])

    settings = req.settings or UserSettings()
    logger.info(
        "leg counts: min=%s max=%s",
        settings.parlay_legs_min,
        settings.parlay_legs_max,
    )

    # Remove legs with suspiciously high EV (likely bad/stale lines).
    legs_norm = [l for l in legs_norm if (l.ev_pct or 0) <= MAX_SINGLE_LEG_EV]
    logger.info("After EV sanity filter: %d legs", len(legs_norm))

    for leg in legs_norm:
        b = (leg.book or "").strip()
        if b in BOOK_ALIASES:
            leg.book = BOOK_ALIASES[b]

    # Group legs by sportsbook so the engine never mixes books on one run (avoids cross-book slips).
    legs_by_book: Dict[str, List[NormalizedLeg]] = defaultdict(list)
    for nl in legs_norm:
        bk = (nl.book or "").strip() or "Unknown"
        legs_by_book[bk].append(nl)

    start = time.perf_counter()
    port_result = None
    try:
        parlays: List[Parlay] = []
        all_filtered_slips: List[EngineSlip] = []
        min_hit = settings.min_hit_prob if settings.min_hit_prob is not None else DEFAULT_MIN_HIT
        min_pev = settings.min_parlay_ev if settings.min_parlay_ev is not None else DEFAULT_MIN_PEV

        if legs_by_book:
            engine_mode = "balanced"
            max_exp = settings.max_player_exposure if settings.max_player_exposure is not None else 0.4
            rpc = getattr(settings, "risk_per_session_pct", None)
            if rpc is None:
                rpc = 0.08

            for book_name, norms_in_bucket in sorted(legs_by_book.items(), key=lambda x: x[0].lower()):
                book_norm_legs = [
                    nl
                    for nl in norms_in_bucket
                    if ((getattr(nl, "book", None) or "").strip() or "Unknown") == book_name
                ]
                if not book_norm_legs:
                    continue

                book_portfolio_legs: List[PortfolioLeg] = []
                for nl in book_norm_legs:
                    try:
                        book_portfolio_legs.append(
                            PortfolioLeg(
                                id=nl.id,
                                participant=nl.participant,
                                market=nl.market,
                                side=str(nl.side) if nl.side is not None else "other",
                                line=nl.line,
                                odds_american=float(nl.odds_american),
                                ev_pct=nl.ev_pct,
                                hit_prob_pct=nl.hit_prob_pct,
                                book=nl.book,
                                league=nl.league,
                                sport=nl.sport,
                                event=nl.event,
                                game_key=nl.game_key,
                            )
                        )
                    except Exception as leg_err:
                        logger.warning("Skipping leg conversion error: %s", leg_err)
                        continue

                if not book_portfolio_legs:
                    continue

                n_book = len(book_portfolio_legs)
                # Upper bound on distinct 3-leg subsets (independent of UI leg count for this cap).
                max_unique = math.comb(n_book, 3) if n_book >= 3 else 0
                if max_unique < 3:
                    logger.info(
                        "book=%s skipping: only %d unique combinations possible",
                        book_name,
                        max_unique,
                    )
                    continue
                num_slips_effective = min(25, max(3, max_unique))
                port_settings = PortfolioEngineSettings(
                    mode=engine_mode,
                    num_slips=num_slips_effective,
                    min_parlay_ev=0.02,
                    legs_per_slip=settings.parlay_legs_max,
                    max_player_exposure=max_exp,
                    bankroll=getattr(settings, "bankroll", None),
                    risk_per_slate=getattr(settings, "risk_per_slate", 0.1),
                    risk_per_session_pct=rpc,
                )
                logger.info(
                    "book=%s unified engine num_slips=%d legs=%d max_unique_3leg=%d legs_per_slip=%d",
                    book_name,
                    num_slips_effective,
                    n_book,
                    max_unique,
                    settings.parlay_legs_max,
                )
                pr = generate_portfolio(book_portfolio_legs, port_settings)
                filtered_slips = _filter_slips_by_hit_ev(pr.slips, min_hit, min_pev)
                if len(filtered_slips) < 5:
                    logger.info(
                        "book=%s skipping: only %d slips after filter (min 5 required)",
                        book_name,
                        len(filtered_slips),
                    )
                    continue
                all_filtered_slips.extend(filtered_slips)
                logger.info(
                    "book=%s post-filter slips=%d (min_hit=%.3f min_parlay_ev=%.3f)",
                    book_name,
                    len(filtered_slips),
                    min_hit,
                    min_pev,
                )

                for slip in filtered_slips:
                    slip_legs = []
                    for slip_leg in slip.legs:
                        matched = next(
                            (
                                nl
                                for nl in book_norm_legs
                                if nl.participant == slip_leg.leg.participant
                                and nl.market == slip_leg.leg.market
                                and (nl.book or "").strip() == (slip_leg.leg.book or "").strip()
                            ),
                            None,
                        )
                        if matched:
                            slip_legs.append(matched)
                    if len(slip_legs) >= settings.parlay_legs_min:
                        parlays.append(
                            Parlay(
                                id=str(uuid4())[:8],
                                legs=slip_legs,
                                num_legs=len(slip_legs),
                                est_ev_score=round(slip.score, 3),
                                risk_score=max(1, min(10, 3 + (len(slip_legs) - 2) * 2)),
                                time_sensitivity="medium",
                                notes=["Built from top EV legs.", "Confirm lines before submitting."],
                            )
                        )

            if not all_filtered_slips:
                logger.info(
                    "post-filter: zero slips (min_hit=%.3f min_parlay_ev=%.3f); returning no_results",
                    min_hit,
                    min_pev,
                )
                return SuggestResponse(
                    api_version=API_VERSION,
                    parlays=[],
                    summary={
                        "num_parlays": 0,
                        "no_results": True,
                        "message": "No slips matched your filters. Try lowering the Min Hit Prob or Min Parlay EV sliders.",
                    },
                    book_sections=[],
                    errors=None,
                )

            merged_slip_count = len(all_filtered_slips)
            port_result = build_portfolio_result(
                all_filtered_slips,
                PortfolioEngineSettings(
                    mode=engine_mode,
                    num_slips=max(3, merged_slip_count),
                    min_parlay_ev=0.02,
                    legs_per_slip=settings.parlay_legs_max,
                    max_player_exposure=max_exp,
                    bankroll=getattr(settings, "bankroll", None),
                    risk_per_slate=getattr(settings, "risk_per_slate", 0.1),
                    risk_per_session_pct=rpc,
                ),
            )
            logger.info(
                "post-filter total slips=%d across %d books (min_hit=%.3f min_parlay_ev=%.3f)",
                len(all_filtered_slips),
                len(legs_by_book),
                min_hit,
                min_pev,
            )
        duration_ms = (time.perf_counter() - start) * 1000
        if parlays:
            logger.info("generation succeeded count=%d latency_ms=%.1f", len(parlays), duration_ms)
        else:
            logger.warning("generation produced zero parlays latency_ms=%.1f", duration_ms)
    except Exception:
        duration_ms = (time.perf_counter() - start) * 1000
        logger.exception("generation failed latency_ms=%.1f", duration_ms)
        raise

    # build minimal summary info so the frontend can display breakdowns
    summary: Dict[str, Any] = {"num_parlays": len(parlays)}

    # player exposure: fraction of parlays containing each participant
    if parlays:
        counts: Dict[str, int] = {}
        for p in parlays:
            for leg in p.legs:
                counts[leg.participant] = counts.get(leg.participant, 0) + 1
        summary["player_exposure"] = {
            player: count / len(parlays) for player, count in counts.items()
        }
    else:
        summary["player_exposure"] = {}

    # suggest unit size & slate risk if bankroll provided (Section 2E: prefer risk_per_session_pct)
    bank = getattr(req.settings, "bankroll", None)
    riskpct = getattr(req.settings, "risk_per_session_pct", None) or getattr(req.settings, "risk_per_slate", 0.1)
    book_bs = getattr(req.settings, "book_bankrolls", None) or {}
    if isinstance(book_bs, dict):
        total_bankroll = sum(float(v) for v in book_bs.values() if v is not None and float(v) > 0)
    else:
        total_bankroll = 0.0
    if total_bankroll <= 0 and bank and bank > 0:
        total_bankroll = float(bank)

    if bank and bank > 0 and parlays:
        slate_risk_val = bank * riskpct
        unit = slate_risk_val / len(parlays)
        if total_bankroll > 0 and unit > total_bankroll * 0.20:
            unit = round(total_bankroll * 0.20, 2)
            logger.warning("unit_size capped at 20%% of risk budget: $%.2f", unit)
        summary["unit_size"] = unit
        summary["slate_risk"] = slate_risk_val
    else:
        summary["unit_size"] = None
        summary["slate_risk"] = None

    # Sections 2B–2D: survival, diversification, warnings, projected EV (from portfolio engine when available)
    if port_result is not None:
        summary["survival_probability"] = port_result.survival_probability
        summary["diversification_score"] = round(port_result.diversification_score, 1) if port_result.diversification_score is not None else None
        summary["warnings"] = port_result.warnings or []
        ev_scores = [p.est_ev_score for p in parlays if getattr(p, "est_ev_score", None) is not None]
        summary["projected_ev"] = round(sum(ev_scores) / len(ev_scores), 2) if ev_scores else None
    else:
        summary["survival_probability"] = None
        summary["diversification_score"] = None
        summary["warnings"] = []
        summary["projected_ev"] = None

    # If engine omitted metrics (e.g. empty portfolio edge case), derive from returned parlays
    if parlays:
        pm = _parlay_portfolio_metrics(parlays)
        if summary.get("diversification_score") is None:
            summary["diversification_score"] = pm.get("diversification_score")
        if summary.get("survival_probability") is None:
            summary["survival_probability"] = pm.get("survival_probability")
        if not summary.get("warnings"):
            summary["warnings"] = pm.get("warnings") or []

    book_sections: Optional[List[Dict[str, Any]]] = None
    if parlays:
        by_book: Dict[str, List[Parlay]] = {}
        for p in parlays:
            bk = "Unknown Book"
            if p.legs:
                leg_book = (getattr(p.legs[0], "book", None) or "").strip()
                if leg_book:
                    bk = leg_book
            by_book.setdefault(bk, []).append(p)
        book_sections = [
            {"book": bk, "num_slips": len(slips), "slips": [sl.model_dump(mode="json") for sl in slips]}
            for bk, slips in sorted(by_book.items(), key=lambda x: x[0].lower())
        ]

    return SuggestResponse(
        api_version=API_VERSION,
        parlays=parlays,
        summary=summary,
        book_sections=book_sections,
    )

