"""Portfolio generation module for parlay slip optimization."""

import math
import random
import re
from typing import Optional
from pydantic import BaseModel, Field, model_validator



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
    num_slips: int = Field(default=20, ge=5, le=200)
    legs_per_slip: int = Field(default=3, ge=2, le=15, description="Section 6: Allow 2–15 legs; metrics discourage unrealistic parlays")
    max_player_exposure: float = Field(default=0.3, ge=0.05, le=1.0)
    max_game_exposure: Optional[float] = Field(default=None, ge=0.2, le=1.0)
    bankroll: Optional[float] = Field(default=None, gt=0)
    risk_per_slate: float = Field(default=0.1, ge=0.05, le=0.15)
    # Section 2E: risk per session as % of capital (e.g. 0.08 = 8%). Preferred over fixed sizing.
    risk_per_session_pct: float = Field(default=0.08, ge=0.01, le=0.50)
    sizing_mode: str = Field(default="equal", pattern="equal|weighted")


# ============================================================================
# Portfolio Generation
# ============================================================================


def _compute_leg_score(slip_leg: SlipLeg, mode: str, legs_per_slip: int = 3) -> float:
    p = slip_leg.p_model
    edge = slip_leg.edge
    p_safe = max(p, 0.01)

    if mode == "conservative" and legs_per_slip >= 4:
        # For conservative mode with higher leg counts, we need more legs available
        # Reduce the probability penalty slightly so 4th legs can be found
        return (p_safe**1.5) * 8.0 + edge * 0.5

    if mode == "conservative":
        # Stable: reward high hit probability HEAVILY (p²) — no hard exclusions
        return (p_safe**2) * 10.0 + edge * 0.5

    elif mode == "aggressive":
        # Upside: reward EV and payout potential
        payout = slip_leg.decimal_odds
        return edge * 3.0 + math.log(max(payout, 1.01)) * 1.0

    else:  # balanced/growth
        # Growth: equal weight on both
        return edge * 2.0 + p_safe * 3.0


def _compute_slip_score(slip_legs: list[SlipLeg], mode: str, legs_per_slip: int = 3) -> float:
    """Compute overall score for a slip.
    
    Args:
        slip_legs: Legs in the slip
        mode: Portfolio mode
    
    Returns:
        Slip score
    """
    if not slip_legs:
        return -float('inf')
    
    # Sum individual leg scores
    leg_score = sum(_compute_leg_score(leg, mode, legs_per_slip) for leg in slip_legs)
    
    # Add bonus for joint probability (but mild to avoid explosive payouts)
    prob_product = 1.0
    for leg in slip_legs:
        prob_product *= leg.p_model
    
    if mode == "conservative":
        prob_bonus = math.log(max(prob_product, 0.01)) * 0.5
    else:
        prob_bonus = math.log(max(prob_product, 0.01)) * 0.3
    
    return leg_score + prob_bonus


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
    """Greedily build a single slip given available legs.
    
    Args:
        available_legs: Pool of legs to choose from
        legs_per_slip: Target number of legs per slip
        mode: Portfolio mode (conservative / balanced / aggressive)
        max_player_exposure: Max allowed exposure for any player
        max_game_exposure: Max allowed exposure for any game (or None to disable)
        player_counts: Current counts of slips with each player
        game_counts: Current counts of slips with each game
        num_slips_so_far: Number of slips built so far
    
    Returns:
        List of selected legs, or None if not enough valid legs
    """
    slip = []
    legs_in_slip = set()
    players_in_slip = set()
    games_in_slip = set()
    
    # conflict detection helpers
    def market_family(mkt: str) -> str:
        fam = mkt.lower()
        if "points" in fam or "pts" in fam or "reb" in fam or "ast" in fam:
            return "player_stats"
        if "total" in fam or "over" in fam or "under" in fam:
            return "game_total"
        if "moneyline" in fam or "spread" in fam or "line" in fam:
            return "game_side"
        return "other"

    def conflicts(existing: Leg, candidate: Leg) -> bool:
        if existing.participant != candidate.participant:
            return False
        fam1 = market_family(existing.market)
        fam2 = market_family(candidate.market)
        if fam1 != fam2:
            return False
        # opposite sides on same family
        if fam1 == "game_total":
            sval = existing.side.lower()
            cval = candidate.side.lower()
            if ("over" in sval and "under" in cval) or ("under" in sval and "over" in cval):
                return True
        # any additional leg in same family is also conflict
        return True
    
    # Sort available legs by score, applying a soft penalty for frequently-used legs
    leg_usage_count = leg_usage_count or {}

    # Penalty strength depends on portfolio mode: conservative -> strongest, aggressive -> weakest
    penalty_map = {
        "conservative": 0.35,
        "balanced": 0.15,
        "aggressive": 0.05,
    }
    penalty_strength = penalty_map.get(mode, 0.15)

    def _score_with_penalty(slip_leg: SlipLeg):
        base = _compute_leg_score(slip_leg, mode, legs_per_slip)
        leg = slip_leg.leg
        lk = (leg.participant, leg.market, leg.side, leg.line)
        leg_use = leg_usage_count.get(lk, 0)
        # Section 2F: Soft penalty for already-used props (exact leg) and players.
        # Strong EV can still win—this encourages diversification, not hard exclusion.
        player_use = player_counts.get(leg.participant, 0)
        player_penalty = 0.4 * penalty_strength  # milder than leg reuse
        return base - (leg_use * penalty_strength) - (player_use * player_penalty)

    # Sort using score with penalty
    sorted_legs = sorted(available_legs, key=lambda x: _score_with_penalty(x), reverse=True)
    
    for slip_leg in sorted_legs:
        if len(slip) >= legs_per_slip:
            break
        
        leg = slip_leg.leg
        
        # Check for exact duplicate in this slip
        leg_key = (leg.participant, leg.market, leg.side, leg.line)
        if leg_key in legs_in_slip:
            continue

        # conflict guard: skip if conflicts with existing chosen leg
        conflict_flag = False
        for chosen in slip:
            if conflicts(chosen.leg, leg):
                conflict_flag = True
                break
        if conflict_flag:
            continue
        
        # Check player exposure (same human/player once per slip; line embedded in participant OK)
        player_base = base_player_name(leg.participant or "")
        player_slip_key = player_base if player_base else (leg.participant or "")
        if player_slip_key in players_in_slip:
            continue  # No duplicate players in one slip

        if mode == "aggressive":
            is_top_ev = slip_leg.edge > 0.20  # 20%+ EV
            if is_top_ev:
                effective_exposure = min(0.5, max_player_exposure)
            else:
                effective_exposure = min(1.0, max_player_exposure * 2.5)
        else:
            effective_exposure = max_player_exposure

        max_allowed_slips = max(1, math.floor(effective_exposure * target_num_slips))
        if player_counts.get(leg.participant, 0) >= max_allowed_slips:
            continue

        # extract game identifier (used both for per-slip and portfolio caps)
        game_key = extract_game_key(leg.participant)
        # always avoid two legs from the same game in one slip (light guard)
        if game_key and game_key in games_in_slip:
            continue
        if max_game_exposure is not None and game_key:
            max_game_slips = max(1, math.ceil(max_game_exposure * (num_slips_so_far + 1)))
            if game_counts.get(game_key, 0) >= max_game_slips:
                continue
        
        # This leg is valid; add it
        slip.append(slip_leg)
        legs_in_slip.add(leg_key)
        players_in_slip.add(player_slip_key)
        if game_key:
            games_in_slip.add(game_key)

    # Return slip if it meets the target, or if it's at least 2 legs and we couldn't find more
    if len(slip) >= legs_per_slip:
        return slip
    if len(slip) >= 2:
        # Could not find enough legs — return what we have only if within 1 of target
        # This prevents 4-leg mode from silently returning 2-leg slips
        if legs_per_slip - len(slip) <= 1:
            return slip
        return None  # Too far from target, discard this slip attempt
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

    # For aggressive mode: sort by EV but limit top legs
    # to prevent 2-3 high-EV legs dominating all slips
    if settings.mode == "aggressive":
        legs = sorted(legs, key=lambda l: l.ev_pct or 0, reverse=True)
        top_leg_cap = max(2, int(settings.num_slips * 0.4))
        top_legs = {l.participant + l.market for l in legs[:5]}
        aggressive_exposure = settings.max_player_exposure
    else:
        aggressive_exposure = settings.max_player_exposure

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
                key=lambda x: _compute_leg_score(x, settings.mode, settings.legs_per_slip),
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
                break
            
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

            # Score slip based on risk profile — balancing EV, hit prob, and payout
            parlay_payout = 1.0
            parlay_hit_prob = 1.0
            for sl in slip:
                odds = sl.leg.odds_american or 0
                if odds > 0:
                    decimal = 1 + (odds / 100)
                elif odds < 0:
                    decimal = 1 + (100 / abs(odds))
                else:
                    decimal = 1.0
                parlay_payout *= decimal
                parlay_hit_prob *= sl.p_model

            true_parlay_ev = (parlay_hit_prob * parlay_payout) - 1

            if settings.mode == "conservative":
                # Stable: heavily weight hit probability, mild EV bonus
                slip_score = (parlay_hit_prob * 3.0) + (true_parlay_ev * 0.5)

            elif settings.mode == "aggressive":
                # High Upside: heavily weight EV and payout potential
                slip_score = (true_parlay_ev * 2.0) + (math.log(max(parlay_payout, 1.01)) * 0.5)

            else:
                # Balanced/Growth: equal weight on EV and hit probability
                slip_score = (true_parlay_ev * 1.2) + (parlay_hit_prob * 1.5)

            adjusted_score = slip_score - penalty

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
    
    # Compute exposures
    player_exposure = {}
    game_exposure = {}
    
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
    
    # Normalize to fractions
    for player in player_exposure:
        player_exposure[player] /= num_slips
    for game in game_exposure:
        game_exposure[game] /= num_slips
    
    # Compute unit sizing
    unit_size = None
    slate_risk = None
    
    if settings.bankroll and settings.bankroll > 0:
        # Section 2E: Size by % of capital. total_risk = capital * risk_per_session_pct
        risk_pct = getattr(settings, "risk_per_session_pct", None) or settings.risk_per_slate
        slate_risk = settings.bankroll * risk_pct
        
        if settings.sizing_mode == "equal":
            unit_size = slate_risk / num_slips
        else:  # weighted
            # Allocate proportionally to slip score, with caps
            total_score = sum(slip.score for slip in slips)
            base_unit = slate_risk / num_slips
            
            # For simplicity in weighted mode, we compute allocations but
            # return unit_size as the base; in practice, the caller can
            # use slip.score to scale each unit.
            # For now, return equal unit but note this could be enhanced.
            unit_size = base_unit

    # Section 2B: Survival probability (with correlation haircut)
    p_full_loss = 1.0
    for slip in slips:
        p_full_loss *= 1.0 - slip.estimated_prob
    raw_survival = 1.0 - p_full_loss
    penalty = compute_diversification_penalty(slips)
    correlation_penalty = min(0.15, penalty * 0.02)
    survival_probability = max(0.001, raw_survival - correlation_penalty)

    # Section 2C: Diversification score 0–100
    diversification_score = max(0.0, 100.0 - penalty * 20.0)

    # Section 2D: Correlation warnings
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
