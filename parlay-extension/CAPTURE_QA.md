# Capture Page / Leg Selection — Math & Data QA

## Leg data fields (content.js → toRawLeg)

When the user selects a leg on the capture page, the following attributes should be captured and sent to the backend. Use this checklist to verify each field is populated correctly for your optimizer layout:

| Field | Description | Used for |
|-------|-------------|----------|
| `participant` | Player/team name or identifier | Slip display, correlation, diversification |
| `market` | Prop type (e.g. Points, Rebounds, total) | Normalization, display |
| `side` | Over / Under / Yes / No / Home / Away | Leg definition |
| `line` | Numeric line (e.g. 27.5) | Leg definition |
| `odds` / `odds_american` | American odds (e.g. -110) | Implied prob, combined odds, EV |
| `hit_prob_pct` | Model hit probability % from optimizer | Hit probability (if 25–99%; else use implied from odds) |
| `ev_pct` | Expected value % from optimizer | Projected EV, leg scoring |
| `book` | Sportsbook name | Filtering |
| `source` | Optimizer source (e.g. oddsjam) | Logging |
| `sport` / `league` | Optional | Diversification, warnings |

**QA:** After selecting a region and capturing, inspect the payload sent to `/v1/parlays/suggest` (or use debug_inputs) and confirm every leg has `participant`, `market`, `side`, `line` (if applicable), `odds_american`, and when available `hit_prob_pct` and `ev_pct`. Values &lt; 25% in a “hit” context are often EV%, not hit prob — the popup uses a safeguard (see popup.js `computeSlipHitProb`).

## Metrics at leg level vs slip/portfolio level

| Metric | Leg level | Slip/portfolio level |
|--------|-----------|------------------------|
| **Projected EV** | Per-leg EV% exists; slip EV = combination of leg EVs (backend: sum of leg scores − penalty). | Portfolio projected EV = average of slip EVs. |
| **Hit probability** | Per-leg hit % (or implied from odds). | Slip hit = product of leg probs; portfolio hit = average of slip hit probs. |
| **Survival probability** | N/A (single outcome). | P(at least one slip hits) = 1 − ∏(1 − P(slip i hits)). |
| **Diversification score** | N/A. | From player/game/market concentration across slips. |
| **Capital allocation** | N/A. | Unit size = (bankroll × risk %) / num_slips; total risk = bankroll × risk %. |

So on the **capture page**, the only metrics that “compute” at the **individual leg** level are **EV%** and **hit probability** (from optimizer or implied from odds). The other three (Survival, Diversification, Capital) are defined only at slip or portfolio level. To validate leg-level data, ensure each captured leg has correct `ev_pct` and `hit_prob_pct` (or odds for implied prob) and that the backend normalizer does not drop or alter these fields.
