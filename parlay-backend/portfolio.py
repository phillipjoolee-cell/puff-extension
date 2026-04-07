"""Portfolio generation module for parlay slip optimization."""

import logging
import math
import random
import re
from typing import Optional
from pydantic import BaseModel, Field, model_validator


logger = logging.getLogger(__name__)


# ============================================================================
# Helper Functions
# ============================================================================


def base_player_name(participant: str) -> str:
    """Strip trailing over/under/spread from participant for duplicate detection."""
    if participant is None:
        return ""
    return re.sub(
        r"\s+(over|under|[+-]\d[\d.]*)\s*.*$",
        "",
        str(participant),
        flags=re.IGNORECASE,
    ).strip()


def american_to_decimal(odds_american: float) -> float:
    """Convert American odds to decimal odds.
    
    Args:
        odds_american: American format odds (e.g., -110, +200)
    
    Returns:
        Decimal odds (e.g., 1.909, 3.0)
    """
    if odds_american == 0:
        return 1.0
    if odds_american > 0:
        return 1 + (odds_american / 100)
    else:  # negative odds
        return 1 + (100 / abs(odds_american))


def decimal_to_american(odds_decimal: float) -> float:
    """Convert decimal odds to American odds.
    
    Args:
        odds_decimal: Decimal format odds (e.g., 1.909, 3.0)
    
    Returns:
        American format odds
    """
    if odds_decimal <= 1:
        return 0.0
    if odds_decimal == 1:
        return 0.0
    payout_ratio = odds_decimal - 1
    if payout_ratio >= 1:
        return payout_ratio * 100
    else:
        return -100 / payout_ratio


def implied_prob_from_american(odds_american: float) -> float:
    """Calculate implied probability from American odds.
    
    Args:
        odds_american: American format odds
    
    Returns:
        Implied probability (0.0 to 1.0)
    """
    decimal = american_to_decimal(odds_american)
    if decimal <= 0:
        return 0.0
    return 1.0 / decimal


def extract_game_key(participant: str) -> Optional[str]:
    """Extract game matchup key from participant string.
    
    Expects format like "Player A - Player B" or "Team A - Team B".
    Extracts both sides and returns a sorted key for consistent identification.
    
    Args:
        participant: Participant string (e.g., "LeBron James - Lakers")
    
    Returns:
        Sorted game key or None if format doesn't match
    """
    if " - " not in participant:
        return None
    parts = participant.split(" - ")
    if len(parts) == 2:
        side1 = parts[0].strip()
        side2 = parts[1].strip()
        # Return a canonical key with sides sorted
        return " - ".join(sorted([side1, side2]))
    return None


def dedupe_legs(legs: list["Leg"]) -> list["Leg"]:
    """Remove duplicate legs based on participant, market, side, and line.
    
    Keeps the first occurrence of each unique leg.
    
    Args:
        legs: List of legs
    
    Returns:
        Deduplicated list of legs
    """
    seen = set()
    result = []
    for leg in legs:
        key = (leg.participant, leg.market, leg.side, leg.line)
        if key not in seen:
            seen.add(key)
            result.append(leg)
    return result


# ============================================================================
# Pydantic Models
# ============================================================================


class Leg(BaseModel):
    """A single betting leg."""
    id: Optional[str] = None

    participant: str
    market: str
    side: str
    line: Optional[float] = None

    # Accept extension payload:
    odds: Optional[float] = None                 # e.g. -220 or 1.91
    odds_format: Optional[str] = "american"      # "american" | "decimal"

    # Internal normalized odds:
    odds_american: Optional[float] = None        # always american after normalization

    ev_pct: Optional[float] = None               # percent (e.g., 5.2)
    hit_prob_pct: Optional[float] = None         # percent (e.g., 66.32)
    book: Optional[str] = None
    league: Optional[str] = None
    sport: Optional[str] = None
    # Optional same-game identity (preferred over parsing participant).
    game_key: Optional[str] = None
    event: Optional[str] = None

    @model_validator(mode="after")
    def _normalize_odds(self):
        # If odds_american already provided, keep it
        if self.odds_american is not None:
            return self

        # Otherwise normalize from odds + odds_format
        if self.odds is None:
            return self

        fmt = (self.odds_format or "american").lower().strip()

        if fmt == "american":
            self.odds_american = float(self.odds)
            return self

        if fmt == "decimal":
            dec = float(self.odds)
            self.odds_american = float(decimal_to_american(dec))
            return self

        # Unknown format, leave unset
        return self


class SlipLeg(BaseModel):
    """A leg within a slip, including derived probabilities."""
    leg: Leg
    p_model: float  # Model probability (0.0 to 1.0)
    p_implied: float  # Implied probability from odds
    edge: float  # Edge proxy (can be negative)
    decimal_odds: float


class Slip(BaseModel):
    """A parlay slip with multiple legs."""
    legs: list[SlipLeg]
    score: float  # Score for this slip
    estimated_prob: float  # Product of all leg probabilities
    estimated_odds_american: float  # American odds for the parlay
    estimated_payout: float  # Decimal odds for the parlay


class PortfolioResult(BaseModel):
    """Result of portfolio generation."""
    slips: list[Slip]
    unit_size: Optional[float] = None  # Unit stake per slip, or None if no bankroll
    slate_risk: Optional[float] = None  # Total risk across portfolio
    player_exposure: dict[str, float] = Field(default_factory=dict)  # Player -> fraction of slips containing
    game_exposure: Optional[dict[str, float]] = None  # Game key -> fraction
    # Section 2B: survival probability (with correlation haircut)
    survival_probability: Optional[float] = None  # 0–1, estimate; label as such in UI
    # Section 2C: diversification score 0–100
    diversification_score: Optional[float] = None
    # Section 2D: correlation/concentration warnings
    warnings: list[str] = Field(default_factory=list)


class PortfolioSettings(BaseModel):
    """Settings for portfolio generation."""
    mode: str = Field(default="balanced", pattern="conservative|balanced|aggressive")
    num_slips: int = Field(default=20, ge=1, le=200)
    legs_per_slip: int = Field(default=3, ge=2, le=15, description="Section 6: Allow 2–15 legs; metrics discourage unrealistic parlays")
    max_player_exposure: float = Field(default=0.3, ge=0.05, le=1.0)
    max_game_exposure: Optional[float] = Field(default=None, ge=0.2, le=1.0)
    bankroll: Optional[float] = Field(default=None, gt=0)
    risk_per_slate: float = Field(default=0.1, ge=0.05, le=0.15)
    # Section 2E: risk per session as % of capital (e.g. 0.08 = 8%). Preferred over fixed sizing.
    risk_per_session_pct: float = Field(default=0.08, ge=0.01, le=0.50)
    sizing_mode: str = Field(default="equal", pattern="equal|weighted")
    # If set, overrides mode-based default for the minimum parlay EV gate in _build_portfolio
    min_parlay_ev: Optional[float] = Field(default=None, ge=0.0, le=1.0)


# ============================================================================
# Portfolio Generation
# ============================================================================


def _compute_leg_score(slip_leg: SlipLeg, _legs_per_slip: int = 3) -> float:
    p = slip_leg.p_model
    edge = slip_leg.edge
    p_safe = max(p, 0.01)
    return edge * 2.0 + p_safe * 3.0


def _compute_slip_score(slip_legs: list[SlipLeg], mode: str = "balanced", legs_per_slip: int = 3) -> float:
    return _score_slip_holistically(slip_legs)


def score_diversification_penalty(
    candidate_slip: list[SlipLeg],
    selected_slips: list[Slip],
    player_usage_count: dict[str, int],
    leg_usage_count: dict[tuple, int],
    target_num_slips: int,
    w_overlap: float = 0.15,
    w_player: float = 0.10,
) -> float:
    """Compute a soft diversification penalty for a candidate slip.
    
    Penalizes slips that overlap with already-selected slips or concentrate
    frequently-used players. This is a SOFT constraint that adjusts scoring,
    not a hard constraint that blocks slips.
    
    Args:
        candidate_slip: Candidate slip legs to evaluate
        selected_slips: Already-selected slips in current portfolio
        player_usage_count: Count of slips containing each player
        leg_usage_count: Count of slips containing each leg
        target_num_slips: Target number of slips for normalization
        w_overlap: Weight for overlap penalty (default 0.15)
        w_player: Weight for player concentration penalty (default 0.10)
    
    Returns:
        Penalty value (typically 0.0 to ~0.25) subtracted from base score
    """
    if not candidate_slip or target_num_slips <= 0:
        return 0.0
    
    slip_size = len(candidate_slip)
    
    # Compute overlap penalty: average fraction of legs overlapping with selected slips
    if selected_slips:
        candidate_leg_keys = set(
            (leg.leg.participant, leg.leg.market, leg.leg.side, leg.leg.line)
            for leg in candidate_slip
        )
        
        total_overlap = 0
        for selected_slip in selected_slips:
            selected_leg_keys = set(
                (leg.leg.participant, leg.leg.market, leg.leg.side, leg.leg.line)
                for leg in selected_slip.legs
            )
            overlap = len(candidate_leg_keys & selected_leg_keys)
            total_overlap += overlap
        
        # Normalize by slip size and number of already-selected slips
        overlap_ratio = total_overlap / (slip_size * len(selected_slips))
    else:
        overlap_ratio = 0.0
    
    # Compute player concentration penalty: average usage of players in slip
    player_concentration = 0.0
    for leg in candidate_slip:
        player = leg.leg.participant
        usage = player_usage_count.get(player, 0)
        normalized_usage = usage / target_num_slips
        player_concentration += normalized_usage
    player_concentration /= slip_size
    
    # Compute penalty
    penalty = w_overlap * overlap_ratio + w_player * player_concentration
    return penalty


def compute_diversification_penalty(slips: list[Slip]) -> float:
    """Compute portfolio-level diversification penalty for correlation/independence.

    Portfolios with heavy player, game, or market-side overlap are scored lower.
    Uses squared terms so small overlap is tolerated but heavy overlap is punished hard.
    Addresses the false assumption that slips are statistically independent.

    Args:
        slips: List of slips in the portfolio

    Returns:
        Penalty value to subtract from portfolio score
    """
    if not slips:
        return 0.0

    total_slips = len(slips)
    player_counts: dict[str, int] = {}
    game_counts: dict[str, int] = {}
    market_side_counts: dict[tuple[str, str], int] = {}

    for slip in slips:
        seen_players: set[str] = set()
        seen_games: set[str] = set()
        seen_market_sides: set[tuple[str, str]] = set()

        for slip_leg in slip.legs:
            leg = slip_leg.leg
            seen_players.add(leg.participant)
            game_key = extract_game_key(leg.participant)
            if game_key:
                seen_games.add(game_key)
            seen_market_sides.add((leg.market, leg.side))

        for player in seen_players:
            player_counts[player] = player_counts.get(player, 0) + 1
        for game in seen_games:
            game_counts[game] = game_counts.get(game, 0) + 1
        for ms in seen_market_sides:
            market_side_counts[ms] = market_side_counts.get(ms, 0) + 1

    target_player_exposure = 0.30
    target_game_exposure = 0.40
    target_market_exposure = 0.50
    player_penalty_weight = 8.0
    game_penalty_weight = 6.0
    market_penalty_weight = 3.0

    player_penalty = sum(
        max(0.0, (count / total_slips) - target_player_exposure) ** 2
        for count in player_counts.values()
    ) * player_penalty_weight

    game_penalty = sum(
        max(0.0, (count / total_slips) - target_game_exposure) ** 2
        for count in game_counts.values()
    ) * game_penalty_weight

    market_penalty = sum(
        max(0.0, (count / total_slips) - target_market_exposure) ** 2
        for count in market_side_counts.values()
    ) * market_penalty_weight

    return player_penalty + game_penalty + market_penalty


def _compute_correlation_warnings(slips: list[Slip]) -> list[str]:
    """Detect player and game concentration; return user-facing warnings.

    Warns when any player appears in >50% of slips, or any game in >40%.
    """
    if not slips:
        return []

    total_slips = len(slips)
    player_counts: dict[str, int] = {}
    game_counts: dict[str, int] = {}

    for slip in slips:
        seen_players: set[str] = set()
        seen_games: set[str] = set()
        for slip_leg in slip.legs:
            leg = slip_leg.leg
            seen_players.add(leg.participant)
            gk = extract_game_key(leg.participant)
            if gk:
                seen_games.add(gk)
        for p in seen_players:
            player_counts[p] = player_counts.get(p, 0) + 1
        for g in seen_games:
            game_counts[g] = game_counts.get(g, 0) + 1

    warnings: list[str] = []
    for player, count in player_counts.items():
        pct = count / total_slips
        if pct > 0.50:
            warnings.append(f"Player concentration: {player} appears in {int(round(pct * 100))}% of slips")
    for game, count in game_counts.items():
        pct = count / total_slips
        if pct > 0.40:
            s = "slip" if count == 1 else "slips"
            warnings.append(f"Game concentration: {game} appears in {count} {s}")
    return warnings


def _score_slip_holistically(slip_legs: list[SlipLeg]) -> float:
    """Risk-adjusted EV: rewards parlay EV but dampens low hit rate via sqrt(hit_prob).

    High EV with a very low combined hit scores below naive EV*diversification,
    so the engine favors slips a bettor can more realistically realize.
    """
    if not slip_legs:
        return -float("inf")

    combined_hit = 1.0
    parlay_payout = 1.0
    for sl in slip_legs:
        combined_hit *= sl.p_model
        parlay_payout *= sl.decimal_odds

    parlay_ev = combined_hit * parlay_payout - 1

    if combined_hit <= 0 or parlay_ev <= 0:
        return 0.0

    hit_factor = math.sqrt(combined_hit)

    sports = len({sl.leg.sport for sl in slip_legs if sl.leg.sport})
    markets = len({sl.leg.market for sl in slip_legs if sl.leg.market})
    div_bonus = 1.0 + (sports * 0.05) + (markets * 0.03)

    return parlay_ev * hit_factor * div_bonus


def _leg_game_key(leg: Leg) -> Optional[str]:
    gk = getattr(leg, "game_key", None)
    if gk:
        return gk
    ev = (getattr(leg, "event", None) or "").strip()
    if ev:
        return ev
    return extract_game_key(leg.participant or "")


def _same_game(leg_a: Leg, leg_b: Leg) -> bool:
    key_a = getattr(leg_a, "game_key", None)
    key_b = getattr(leg_b, "game_key", None)
    if key_a and key_b:
        return key_a == key_b
    if key_a or key_b:
        return False
    event_a = (getattr(leg_a, "event", None) or "").strip().lower()
    event_b = (getattr(leg_b, "event", None) or "").strip().lower()
    if not event_a or not event_b:
        return False
    words_a = " ".join(event_a.split()[:3])
    words_b = " ".join(event_b.split()[:3])
    return words_a == words_b


def _build_slip(
    available_legs: list[SlipLeg],
    target_num_slips: int,
    legs_per_slip: int,
    mode: str,
    max_player_exposure: float,
    max_game_exposure: Optional[float],
    player_counts: dict[str, int],
    game_counts: dict[str, int],
    num_slips_so_far: int,
    leg_usage_count: Optional[dict[tuple, int]] = None,
) -> Optional[list[SlipLeg]]:
    """Build a single slip using holistic greedy search.

    At each step, picks the next leg that maximizes the slip's
    holistic score rather than the leg's individual score.
    This ensures we optimize for actual parlay quality, not
    just the sum of individual leg qualities.
    """
    slip: list[SlipLeg] = []
    legs_in_slip: set[tuple] = set()
    players_in_slip: set[str] = set()
    games_in_slip: set[str] = set()
    leg_usage_count = leg_usage_count or {}

    def market_family(mkt: str) -> str:
        fam = mkt.lower()
        if any(x in fam for x in ("points", "pts", "reb", "ast", "hits", "runs", "goals", "assists")):
            return "player_stats"
        if any(x in fam for x in ("total", "over", "under")):
            return "game_total"
        if any(x in fam for x in ("moneyline", "spread", "line", "puck")):
            return "game_side"
        return "other"

    def conflicts(existing: Leg, candidate: Leg) -> bool:
        if existing.participant != candidate.participant:
            return False
        fam1 = market_family(existing.market or "")
        fam2 = market_family(candidate.market or "")
        if fam1 != fam2:
            return False
        if fam1 == "game_total":
            s1 = (existing.side or "").lower()
            s2 = (candidate.side or "").lower()
            if ("over" in s1 and "under" in s2) or ("under" in s1 and "over" in s2):
                return True
        return True

    def is_valid_candidate(sl: SlipLeg) -> bool:
        leg = sl.leg
        leg_key = (leg.participant, leg.market, leg.side, leg.line)

        if leg_key in legs_in_slip:
            return False

        for chosen in slip:
            if conflicts(chosen.leg, leg):
                return False

        for chosen in slip:
            if _same_game(leg, chosen.leg):
                return False

        player_base_name = base_player_name(leg.participant or "")
        player_key = player_base_name if player_base_name else (leg.participant or "")
        if player_key in players_in_slip:
            return False

        effective_exposure = max_player_exposure
        max_allowed = max(1, math.floor(effective_exposure * target_num_slips))
        if player_counts.get(leg.participant, 0) >= max_allowed:
            return False

        game_key = _leg_game_key(leg)
        if max_game_exposure is not None and game_key:
            max_game_slips = max(1, math.ceil(max_game_exposure * (num_slips_so_far + 1)))
            if game_counts.get(game_key, 0) >= max_game_slips:
                return False

        return True

    def candidate_score_fast(sl: SlipLeg, current_hit: float, current_payout: float) -> float:
        """Marginal score for slip + sl; matches _score_slip_holistically up to O(1) work."""
        new_hit = current_hit * sl.p_model
        new_payout = current_payout * sl.decimal_odds
        parlay_ev = new_hit * new_payout - 1

        if new_hit <= 0 or parlay_ev <= 0:
            base = 0.0
        else:
            ns = {s for s in sports_so_far if s}
            if sl.leg.sport:
                ns.add(sl.leg.sport)
            nm = {m for m in markets_so_far if m}
            if sl.leg.market:
                nm.add(sl.leg.market)
            div_bonus = 1.0 + (len(ns) * 0.05) + (len(nm) * 0.03)
            base = parlay_ev * math.sqrt(new_hit) * div_bonus

        leg = sl.leg
        leg_key = (leg.participant, leg.market, leg.side, leg.line)
        leg_use = leg_usage_count.get(leg_key, 0)
        player_use = player_counts.get(leg.participant, 0)
        penalty_strength = 0.15
        penalty = (leg_use * penalty_strength) + (player_use * 0.4 * penalty_strength)
        return base - penalty

    # Greedy holistic assembly — at each step pick the leg that
    # maximizes the slip's holistic score
    for _ in range(legs_per_slip):
        valid_candidates = [sl for sl in available_legs if is_valid_candidate(sl)]
        if not valid_candidates:
            break

        current_hit = 1.0
        current_payout = 1.0
        sports_so_far: set[str] = set()
        markets_so_far: set[str] = set()
        for existing in slip:
            current_hit *= existing.p_model
            current_payout *= existing.decimal_odds
            lg = existing.leg
            if lg.sport:
                sports_so_far.add(lg.sport)
            if lg.market:
                markets_so_far.add(lg.market)

        best = max(
            valid_candidates,
            key=lambda sl: candidate_score_fast(sl, current_hit, current_payout),
        )
        leg = best.leg
        leg_key = (leg.participant, leg.market, leg.side, leg.line)

        slip.append(best)
        legs_in_slip.add(leg_key)

        player_base = base_player_name(leg.participant or "")
        players_in_slip.add(player_base if player_base else (leg.participant or ""))

        gk = _leg_game_key(leg)
        if gk:
            games_in_slip.add(gk)

    # Enforce minimum viable slip length
    if len(slip) >= legs_per_slip:
        return slip
    if len(slip) >= 2 and legs_per_slip - len(slip) <= 1:
        return slip
    return None


def _build_portfolio(
    legs: list[Leg],
    settings: PortfolioSettings,
) -> list[Slip]:
    """Build a portfolio of slips using greedy + random restarts.
    
    Args:
        legs: List of available legs
        settings: Portfolio settings
    
    Returns:
        List of slips
    """
    # Deduplicate and validate legs
    legs = dedupe_legs(legs)
    legs = [leg for leg in legs if leg.odds_american is not None and leg.odds_american != 0]
    
    if not legs:
        return []

    # Convert legs to SlipLeg with probabilities
    slip_legs = []
    for leg in legs:
        p_implied = implied_prob_from_american(leg.odds_american)
        
        # Model probability
        if leg.hit_prob_pct is not None:
            p_model = leg.hit_prob_pct / 100.0
        else:
            p_model = p_implied
        
        # Edge
        if leg.ev_pct is not None:
            edge = leg.ev_pct / 100.0
        else:
            edge = p_model - p_implied
        
        decimal_odds = american_to_decimal(leg.odds_american)
        
        slip_leg = SlipLeg(
            leg=leg,
            p_model=p_model,
            p_implied=p_implied,
            edge=edge,
            decimal_odds=decimal_odds,
        )
        slip_legs.append(slip_leg)
    
    best_portfolio = []
    best_score = -float('inf')
    
    # Try multiple random restarts
    num_restarts = 20
    for attempt in range(num_restarts):
        portfolio = []
        player_counts = {}
        game_counts = {}
        used_slip_keys = set()  # Track slip combinations to prevent duplicates
        player_usage_count = {}  # Track how many slips contain each player (for soft diversification)
        leg_usage_count = {}  # Track how many slips contain each leg (for soft diversification)
        available_legs = slip_legs[:]
        
        # Optionally shuffle top candidates for randomness (except first attempt)
        if attempt > 0:
            available_legs = sorted(
                available_legs,
                key=lambda x: _compute_leg_score(x, settings.legs_per_slip),
                reverse=True
            )
            if len(available_legs) > settings.legs_per_slip + 2:
                top_k = min(len(available_legs), settings.legs_per_slip + 5)
                top = available_legs[:top_k]
                rest = available_legs[top_k:]
                random.shuffle(top)
                available_legs = top + rest
        
        # Build slips greedily
        for slip_idx in range(settings.num_slips):
            # Attempt to build a non-duplicate slip up to N times
            slip = None
            per_slip_attempts = 6
            for s_attempt in range(per_slip_attempts):
                # create a small randomized ordering to encourage variety on retries
                temp_available = available_legs[:]
                if s_attempt > 0 and len(temp_available) > settings.legs_per_slip + 2:
                    top_k = min(len(temp_available), settings.legs_per_slip + 5)
                    top = temp_available[:top_k]
                    rest = temp_available[top_k:]
                    random.shuffle(top)
                    temp_available = top + rest

                slip = _build_slip(
                    temp_available,
                    settings.num_slips,
                    settings.legs_per_slip,
                    settings.mode,
                    settings.max_player_exposure,
                    settings.max_game_exposure,
                    player_counts,
                    game_counts,
                    len(portfolio),
                    leg_usage_count,
                )

                if slip is None:
                    # Can't build a slip from this ordering; stop trying
                    break

                # Compute slip key from legs
                slip_key_try = frozenset(
                    (leg.leg.participant, leg.leg.market, leg.leg.side, leg.leg.line)
                    for leg in slip
                )
                if slip_key_try in used_slip_keys:
                    # duplicate slip; retry with different ordering
                    slip = None
                    continue
                # found a non-duplicate slip
                break

            if slip is None:
                continue

            # Minimum parlay EV gate — discard slips with near-zero or negative parlay EV
            combined_hit = 1.0
            parlay_payout = 1.0
            for sl in slip:
                combined_hit *= sl.p_model
                parlay_payout *= sl.decimal_odds
            slip_parlay_ev = combined_hit * parlay_payout - 1

            if settings.min_parlay_ev is not None:
                min_ev = settings.min_parlay_ev
            else:
                min_ev = 0.02
            logger.info(
                "slip parlay_ev=%.3f min_ev=%.3f accepted=%s",
                slip_parlay_ev,
                min_ev,
                slip_parlay_ev >= min_ev,
            )
            if slip_parlay_ev < min_ev:
                continue

            # Compute slip key from legs
            slip_key = frozenset(
                (leg.leg.participant, leg.leg.market, leg.leg.side, leg.leg.line)
                for leg in slip
            )
            
            # slip_key already checked during build-retries; still guard
            if slip_key in used_slip_keys:
                continue
            
            # Update hard constraint counts (player exposure, game exposure)
            for leg in slip:
                player_counts[leg.leg.participant] = player_counts.get(leg.leg.participant, 0) + 1
                game_key = extract_game_key(leg.leg.participant)
                if game_key:
                    game_counts[game_key] = game_counts.get(game_key, 0) + 1
            
            # Compute diversification penalty (SOFT constraint)
            penalty = score_diversification_penalty(
                slip,
                portfolio,
                player_usage_count,
                leg_usage_count,
                settings.num_slips,
                w_overlap=0.15,
                w_player=0.10,
            )
            
            # Create Slip object
            est_prob = 1.0
            est_decimal = 1.0
            for leg in slip:
                est_prob *= leg.p_model
                est_decimal *= leg.decimal_odds
            
            est_american = decimal_to_american(est_decimal)

            slip_holistic = _score_slip_holistically(slip)
            adjusted_score = slip_holistic - penalty

            portfolio.append(
                Slip(
                    legs=slip,
                    score=adjusted_score,
                    estimated_prob=est_prob,
                    estimated_odds_american=est_american,
                    estimated_payout=est_decimal,
                )
            )
            
            # Update usage counts for diversification tracking (after accepting slip)
            for leg in slip:
                player = leg.leg.participant
                player_usage_count[player] = player_usage_count.get(player, 0) + 1
                
                leg_key = (leg.leg.participant, leg.leg.market, leg.leg.side, leg.leg.line)
                leg_usage_count[leg_key] = leg_usage_count.get(leg_key, 0) + 1
            
            # Mark slip as used (HARD constraint)
            used_slip_keys.add(slip_key)
        
        # Score this portfolio (subtract diversification penalty for correlation)
        portfolio_score = sum(slip.score for slip in portfolio) - compute_diversification_penalty(portfolio)
        if portfolio_score > best_score:
            best_score = portfolio_score
            best_portfolio = portfolio
    
    return best_portfolio


def build_portfolio_result(slips: list[Slip], settings: PortfolioSettings) -> PortfolioResult:
    """Compute exposures, sizing, survival, and warnings for a finished slip list."""
    player_exposure: dict[str, float] = {}
    game_exposure: dict[str, float] = {}

    num_slips = len(slips)
    if num_slips == 0:
        return PortfolioResult(
            slips=[],
            unit_size=None,
            slate_risk=None,
            player_exposure={},
            game_exposure=None,
        )

    for slip in slips:
        for slip_leg in slip.legs:
            player = slip_leg.leg.participant
            player_exposure[player] = player_exposure.get(player, 0) + 1

            game_key = extract_game_key(player)
            if game_key:
                game_exposure[game_key] = game_exposure.get(game_key, 0) + 1

    for player in player_exposure:
        player_exposure[player] /= num_slips
    for game in game_exposure:
        game_exposure[game] /= num_slips

    unit_size = None
    slate_risk = None

    if settings.bankroll and settings.bankroll > 0:
        risk_pct = getattr(settings, "risk_per_session_pct", None) or settings.risk_per_slate
        slate_risk = settings.bankroll * risk_pct

        if settings.sizing_mode == "equal":
            unit_size = slate_risk / num_slips
        else:
            base_unit = slate_risk / num_slips
            unit_size = base_unit

    p_full_loss = 1.0
    for slip in slips:
        p_full_loss *= 1.0 - slip.estimated_prob
    raw_survival = 1.0 - p_full_loss
    penalty = compute_diversification_penalty(slips)
    correlation_penalty = min(0.15, penalty * 0.02)
    survival_probability = max(0.001, raw_survival - correlation_penalty)

    diversification_score = max(0.0, 100.0 - penalty * 20.0)
    warnings = _compute_correlation_warnings(slips)

    return PortfolioResult(
        slips=slips,
        unit_size=unit_size,
        slate_risk=slate_risk,
        player_exposure=player_exposure,
        game_exposure=game_exposure if game_exposure else None,
        survival_probability=round(survival_probability, 4),
        diversification_score=round(diversification_score, 1),
        warnings=warnings,
    )


def generate_portfolio(
    legs: list[Leg],
    settings: PortfolioSettings,
) -> PortfolioResult:
    """Generate an optimized portfolio of parlay slips.

    Args:
        legs: List of betting legs
        settings: Portfolio generation settings

    Returns:
        PortfolioResult with slips, sizing, and exposures
    """
    slips = _build_portfolio(legs, settings)
    return build_portfolio_result(slips, settings)


# ============================================================================
# Demo / Testing
# ============================================================================


if __name__ == "__main__":
    # Sample legs for demonstration
    sample_legs = [
        Leg(
            id="1",
            participant="LeBron James - Lakers",
            market="Points",
            side="Over",
            line=25.5,
            odds_american=-110,
            hit_prob_pct=52.0,
            ev_pct=2.5,
        ),
        Leg(
            id="2",
            participant="Giannis Antetokounmpo - Bucks",
            market="Points",
            side="Over",
            line=27.5,
            odds_american=-110,
            hit_prob_pct=48.0,
            ev_pct=0.0,
        ),
        Leg(
            id="3",
            participant="Luka Doncic - Mavericks",
            market="Points",
            side="Over",
            line=28.5,
            odds_american=-110,
            hit_prob_pct=55.0,
            ev_pct=4.0,
        ),
        Leg(
            id="4",
            participant="Kevin Durant - Suns",
            market="Points",
            side="Over",
            line=26.5,
            odds_american=-110,
            hit_prob_pct=50.0,
            ev_pct=1.0,
        ),
        Leg(
            id="5",
            participant="Jayson Tatum - Celtics",
            market="Points",
            side="Over",
            line=27.0,
            odds_american=-120,
            hit_prob_pct=51.0,
            ev_pct=1.5,
        ),
    ]
    
    settings = PortfolioSettings(
        mode="balanced",
        num_slips=5,
        legs_per_slip=3,
        max_player_exposure=0.8,
        max_game_exposure=None,
        bankroll=1000.0,
        risk_per_slate=0.1,
        sizing_mode="equal",
    )
    
    result = generate_portfolio(sample_legs, settings)
    
    print("Portfolio Generation Result")
    print("=" * 60)
    print(f"Number of slips: {len(result.slips)}")
    print(f"Unit size: ${result.unit_size:.2f}" if result.unit_size else "No unit size")
    print(f"Slate risk: ${result.slate_risk:.2f}" if result.slate_risk else "No slate risk")
    print()
    
    for i, slip in enumerate(result.slips, 1):
        print(f"Slip {i}:")
        print(f"  Legs: {len(slip.legs)}")
        print(f"  Estimated Probability: {slip.estimated_prob:.4f}")
        print(f"  Estimated Odds (American): {slip.estimated_odds_american:.0f}")
        print(f"  Estimated Payout (Decimal): {slip.estimated_payout:.2f}")
        print(f"  Score: {slip.score:.2f}")
        for leg in slip.legs:
            print(f"    - {leg.leg.participant} {leg.leg.side} {leg.leg.line} @ {leg.leg.odds_american}")
        print()
    
    print("Exposures:")
    print(f"  Players: {result.player_exposure}")
    if result.game_exposure:
        print(f"  Games: {result.game_exposure}")
