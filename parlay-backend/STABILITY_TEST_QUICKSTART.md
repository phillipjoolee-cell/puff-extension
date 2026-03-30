# Stability Test Harness - Quick Start

## What Was Created

A **non-invasive testing framework** that measures portfolio generator quality without modifying core logic:

### Files Created
1. **stability_test.py** — Main test harness
2. **stability_test_enhanced.py** — Advanced version with adaptive settings
3. **debug_inputs/sample_dataset.json** — 10-leg test dataset
4. **debug_inputs/large_dataset.json** — 20-leg test dataset
5. **STABILITY_TEST_README.md** — Full documentation
6. **STABILITY_TEST_SUMMARY.md** — Implementation details

## Quick Commands

### Run Standard Test
```bash
python3 stability_test.py
```

### Run Enhanced Test (Auto-scales settings)
```bash
python3 stability_test_enhanced.py
```

### View Results
```bash
cat stability_test_results.csv
```

## What It Does

Runs **A/B comparison** of two conditions:

| Condition | Diversification | Expected Result |
|-----------|-----------------|-----------------|
| **A** | OFF (penalty=0) | Baseline: higher overlap |
| **B** | ON (default weights) | Improved diversity, lower overlap |

## Metrics Reported (Per Portfolio)

| Category | Metrics |
|----------|---------|
| **Slips** | num_slips, num_legs_total |
| **Quality** | avg/median/min/max EV, hit probability |
| **Diversity** | avg_pairwise_overlap (0.0=perfect, lower is better) |
| **Exposure** | max_player_exposure_ratio, top_5_players |
| **Validity** | has_duplicate_slips, has_exposure_violations |

## Key Feature: Zero Code Changes

Portfolio construction logic is **completely unchanged**:
- Greedy algorithm: ✓ Unchanged
- Exposure constraints: ✓ Hard constraints enforced
- No-duplicate-slips: ✓ Hard constraint enforced
- Diversification: Only affects scoring (soft constraint)

## Adding New Datasets

1. Create JSON file with legs in `debug_inputs/` (any name)
2. Run test harness—automatically discovers new files
3. Results appended to `stability_test_results.csv`

### JSON Format
```json
[
  {
    "participant": "Player Name - Team",
    "market": "Points",
    "side": "Over",
    "line": 25.5,
    "odds_american": -110,
    "hit_prob_pct": 52.0,
    "ev_pct": 2.5
  }
]
```

## Expected Results

### Small Portfolios (1-3 slips)
- Overlap ≈ 0.0 (insufficient pairs)
- Player exposure high (few players)
- Both A/B similar

### Larger Portfolios (5+ slips)
- **A**: Overlap 0.2-0.4 (higher overlap)
- **B**: Overlap 0.05-0.15 (lower, better)
- EV/hit_prob similar between A/B
- Portfolio_score may increase slightly in B

## Output Locations

- **Console**: Printed to stdout
- **CSV Report**: `stability_test_results.csv`
  - One row per portfolio (A/B pair)
  - 17+ columns of metrics
  - Easily imported to Excel/Sheets

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "No JSON files found" | Create `debug_inputs/` with `.json` files |
| "Import errors" | Ensure `stability_test.py` in same dir as `portfolio.py` |
| "No metrics for EV" | Legs don't have `ev_pct` field (optional) |
| "Only 1 slip generated" | Dataset too small or constraints too tight |

## Documentation

- **Full Guide**: See `STABILITY_TEST_README.md`
- **Implementation**: See `STABILITY_TEST_SUMMARY.md`
- **API Docs**: See docstrings in `stability_test.py`

## Architecture

```
Test Harness (Non-invasive)
    ↓
Load Legs from JSON
    ↓
Condition A (Penalty=0)  + Condition B (Default Weights)
    ↓                              ↓
generate_portfolio()        generate_portfolio()
    ↓                              ↓
compute_portfolio_metrics() compute_portfolio_metrics()
    ↓                              ↓
Compare & Report Results ← ———— ←→
```

**Key**: Only the `score_diversification_penalty()` function is toggled. Portfolio generation is identical.

## Next Steps

1. Run `python3 stability_test.py` to generate baseline
2. Open `stability_test_results.csv` to review metrics
3. Add your own datasets to `debug_inputs/`
4. Re-run to compare different scenarios
5. Adjust diversification weights if needed:
   - In `stability_test.py`, line 412: `w_overlap=0.15, w_player=0.10`
   - Edit values and re-run for custom testing
