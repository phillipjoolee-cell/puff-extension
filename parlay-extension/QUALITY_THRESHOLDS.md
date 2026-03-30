# Slip Quality Rating Thresholds (Red / Yellow / Green)

**TODO (needs AI/product review):** The exact thresholds below are initial defaults. Tune based on user feedback and edge-case testing.

## Rating Logic

Each generated slip is assigned a quality: **Bad** (red), **OK** (yellow), or **Good** (green) based on:

1. **Hit probability** (parlay hit %) — higher is generally better for "safe" slips.
2. **Projected EV** (estimated edge) — higher is better; negative or near-zero is bad.

## Default Thresholds (implementation reference)

| Rating | Hit probability (min) | Projected EV (min) | Notes |
|--------|-------------------------|---------------------|--------|
| **Good** (green) | ≥ 15% | ≥ 3% | Strong slip on both dimensions. |
| **OK** (yellow) | ≥ 8% | ≥ 1% | Below green; still acceptable. |
| **Bad** (red) | — | — | Below yellow **or** hit % is 0 / null (always red). |

**Combined rule (current code):**

- **Good:** `hitProb >= 15 && evScore >= 3`
- **OK:** `hitProb >= 8 && evScore >= 1` (and not Good)
- **Bad:** `hitProb == null || hitProb <= 0` **or** below OK thresholds

These thresholds are defined in `popup.js` as `SLIP_QUALITY_*` constants so they can be adjusted without changing logic.

## Per-mode considerations (for future tuning)

- **Stable:** May want stricter hit-prob floor (e.g. 15%+) and lower EV floor.
- **Growth:** Balanced; current defaults are aimed here.
- **Upside:** May allow lower hit prob (e.g. 6%) if EV is high (e.g. 2%+).

## Suggestion feature (bad slips)

When a slip is **Bad**, the UI can:

- **Option A:** Suggest a specific leg from the captured pool that would improve the slip (e.g. higher EV or hit prob).
- **Option B:** Prompt the user to find a leg with at least X% EV and Y% hit probability (values derived from the gap to reach OK or Good).

Thresholds for Option B can be computed as: e.g. `minEvNeeded = 0.5 - currentSlipEv`, `minHitNeeded = 8 - currentSlipHitProb` (simplified; exact formula may use product of leg probs).
