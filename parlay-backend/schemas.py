from __future__ import annotations

from datetime import datetime, timezone
from typing import List, Literal, Optional, Dict, Any
from uuid import uuid4

from pydantic import BaseModel, Field, ConfigDict, field_validator

Side = Literal["over", "under", "yes", "no", "home", "away", "other"]
OddsFormat = Literal["american", "decimal"]


class LegIn(BaseModel):
    # kept for backwards compatibility/testing though not used elsewhere
    ev_pct: Optional[float] = None
    hit_prob_pct: Optional[float] = None


class RawLeg(BaseModel):
    """
    What the extension sends (min fields).
    Keep it flexible: you can add fields later without breaking.
    """
    model_config = ConfigDict(extra="allow")

    source: str = Field(default="unknown", examples=["oddsjam"])
    book: str = Field(..., examples=["DraftKings", "FanDuel"])
    sport: Optional[str] = Field(default=None, examples=["NBA"])
    league: Optional[str] = Field(default=None, examples=["NBA"])
    market: str = Field(..., examples=["Points"])
    participant: str = Field(..., examples=["LeBron James"])
    side: Side = Field(default="other")
    line: Optional[float] = Field(default=None, examples=[27.5])
    odds: float = Field(..., examples=[-110, 1.91])
    odds_format: OddsFormat = Field(default="american")
    ev_pct: Optional[float] = Field(default=None, examples=[3.2])
    hit_prob_pct: Optional[float] = Field(default=None, examples=[67.43])
    fair_odds: Optional[float] = Field(default=None, examples=[-125])
    url: Optional[str] = Field(default=None, description="Optional deep link to the offer")
    captured_at: Optional[datetime] = Field(default=None)
    event: Optional[str] = Field(default=None, description="Raw event / matchup text from capture")
    game_key: Optional[str] = Field(default=None, description="Canonical same-game id from extension")


class NormalizedLeg(BaseModel):
    """
    What *your backend* uses internally and returns to the extension.
    """
    id: str
    source: str
    book: str
    sport: Optional[str]
    league: Optional[str]
    market: str
    participant: str
    side: Side
    line: Optional[float]
    odds_american: int
    ev_pct: Optional[float]
    hit_prob_pct: Optional[float]
    fair_odds_american: Optional[int]
    url: Optional[str]
    captured_at: datetime
    event: Optional[str] = None
    game_key: Optional[str] = None

    @field_validator("captured_at", mode="before")
    @classmethod
    def _ensure_dt(cls, v):
        if v is None:
            return datetime.now(timezone.utc)
        if isinstance(v, datetime):
            return v if v.tzinfo else v.replace(tzinfo=timezone.utc)
        return v


class UserSettings(BaseModel):
    unit_size: float = Field(default=10.0, ge=0)
    max_units_per_play: float = Field(default=2.0, ge=0)
    min_ev_pct: float = Field(default=1.0)
    allowed_books: Optional[List[str]] = Field(default=None)
    parlay_legs_min: int = Field(default=2, ge=2, le=15, description="Section 6: User chooses leg count; metrics discourage unrealistic parlays")
    parlay_legs_max: int = Field(default=3, ge=2, le=15)
    max_results: int = Field(default=9999, ge=1, le=9999)
    # Optional exposure cap per player (fraction of bankroll or units)
    max_player_exposure: Optional[float] = Field(default=None, ge=0)
    stale_minutes: int = Field(default=20, ge=1, le=240)

    # bankroll/risk settings for sizing recommendations
    bankroll: Optional[float] = Field(default=None, ge=0)
    # Per-sportsbook risk budgets (extension); sum used for per-slip unit cap vs total budget
    book_bankrolls: Optional[Dict[str, float]] = Field(default=None)
    risk_per_slate: float = Field(default=0.1, ge=0.0, le=1.0)
    # Section 2E: risk per session as % of capital (e.g. 0.08 = 8%). Preferred over risk_per_slate.
    risk_per_session_pct: Optional[float] = Field(default=0.08, ge=0.01, le=0.50)
    # Post-generation filters (fractions, e.g. 0.05 = 5% min combined hit prob)
    min_hit_prob: Optional[float] = Field(default=None, ge=0.0, le=1.0)
    min_parlay_ev: Optional[float] = Field(default=None, ge=-1.0, le=5.0)

    @field_validator("min_hit_prob", mode="before")
    @classmethod
    def _coerce_min_hit_prob_fraction(cls, v):
        """Accept 0.12 or 12 (percent points); engine compares to combined hit in 0–1."""
        if v is None:
            return None
        try:
            x = float(v)
        except (TypeError, ValueError):
            return v
        if x > 1.0:
            x = x / 100.0
        return max(0.0, min(1.0, x))

    @field_validator("min_parlay_ev", mode="before")
    @classmethod
    def _coerce_min_parlay_ev_fraction(cls, v):
        """If a client sends slider-style percent (e.g. 20 for 20%), convert to 0.20."""
        if v is None:
            return None
        try:
            x = float(v)
        except (TypeError, ValueError):
            return v
        if x > 1.0 and 5.0 <= x <= 200.0:
            x = x / 100.0
        return x

    @field_validator("parlay_legs_max")
    @classmethod
    def _max_ge_min(cls, v, info):
        mn = info.data.get("parlay_legs_min", 2)
        if v < mn:
            raise ValueError("parlay_legs_max must be >= parlay_legs_min")
        return v


class IngestRequest(BaseModel):
    legs: List[RawLeg]


class IngestResponse(BaseModel):
    normalized: List[NormalizedLeg]


class Parlay(BaseModel):
    id: str
    legs: List[NormalizedLeg]
    num_legs: int
    est_ev_score: float
    risk_score: int  # 1..10
    time_sensitivity: Literal["low", "medium", "high"]
    notes: List[str]


class SuggestRequest(BaseModel):
    legs: List[RawLeg] | List[NormalizedLeg]
    settings: Optional[UserSettings] = Field(default_factory=UserSettings)
    risk_profile: Literal["stable", "growth", "high_upside"] = Field(default="growth")
    license_key: Optional[str] = Field(default=None, description="Customer license or payment token")


class SuggestResponse(BaseModel):
    api_version: str = Field(default="1.0")
    parlays: List[Parlay]
    summary: Optional[Dict[str, Any]] = None
    errors: Optional[List[str]] = None
    # Optional grouping for extension UI: [{ "book", "num_slips", "slips": [...] }, ...]
    book_sections: Optional[List[Dict[str, Any]]] = Field(default=None)

    class Config:
        extra = "allow"  # allow older consumers to read unit_size etc at top level


# Section 5: Slip editor - replace leg suggestion
class ReplaceLegRequest(BaseModel):
    current_slip_legs: List[Any] = Field(default_factory=list)
    empty_slot_index: int = 0
    all_legs: List[Any] = Field(default_factory=list)
    other_parlays: List[Any] = Field(default_factory=list)


class ReplaceLegResponse(BaseModel):
    replacement: Optional[Dict[str, Any]] = None  # { participant, market, line, ev_impact }
    no_replacement: bool = False
    portfolio_ev: Optional[float] = None


# Section 5: Replace-leg (slip editor re-optimization)
class ReplaceLegRequest(BaseModel):
    current_slip_legs: List[Any] = Field(default_factory=list)
    empty_slot_index: int = 0
    all_legs: List[Any] = Field(default_factory=list)
    other_parlays: List[Any] = Field(default_factory=list)


class ReplaceLegResponse(BaseModel):
    replacement: Optional[Dict[str, Any]] = None  # {leg, ev_impact} or None
    no_replacement: Optional[bool] = None
    portfolio_ev: Optional[float] = None


# Section 5: Slip editor — replace-leg request/response
class ReplaceLegRequest(BaseModel):
    current_slip_legs: List[Any]  # legs to keep (RawLeg or dict)
    empty_slot_index: int
    all_legs: List[Any]
    other_parlays: List[Any]


class ReplaceLegResponse(BaseModel):
    replacement: Optional[Dict[str, Any]] = None  # { participant, market, line, ev_impact }
    no_replacement: Optional[bool] = None
    portfolio_ev: Optional[float] = None


# Section 5: Slip editing — replace leg
class ReplaceLegRequest(BaseModel):
    current_slip_legs: List[RawLeg] | List[Dict[str, Any]]
    empty_slot_index: int
    all_legs: List[RawLeg] | List[Dict[str, Any]]
    other_parlays: List[Dict[str, Any]] = Field(default_factory=list)

    class Config:
        extra = "allow"


class ReplaceLegResponse(BaseModel):
    replacement: Optional[Dict[str, Any]] = None  # { participant, market, line, ev_impact }
    no_replacement: bool = False
    portfolio_ev: Optional[float] = None

    class Config:
        extra = "allow"


# Section 5: Slip editor - replace leg
class ReplaceLegRequest(BaseModel):
    """Request to suggest a replacement for a removed leg in a slip."""
    current_slip_legs: List[Any]  # Legs remaining in slip (RawLeg or NormalizedLeg format)
    empty_slot_index: int = Field(ge=0)
    all_legs: List[Any]  # All available props
    other_parlays: List[Any]  # Other slips in portfolio


class ReplaceLegResponse(BaseModel):
    """Either a replacement candidate or no-recommendation."""
    replacement: Optional[Dict[str, Any]] = None  # { participant, market, line, ev_impact, ... }
    no_replacement: Optional[bool] = False
    portfolio_ev: Optional[float] = None
