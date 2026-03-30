# Stability Test Harness - Implementation Summary

## Overview

A comprehensive testing framework has been created to evaluate the portfolio generator's A/B stability and performance. No changes were made to the portfolio construction logic—only metrics reporting and test harness infrastructure was added.

## Files Created

### 1. **stability_test.py** (Main Test Harness)
   - Loads leg datasets from JSON files in `debug_inputs/` directory
   - Runs A/B comparison with diversification weights on/off
   - Computes detailed portfolio metrics
   - Generates console summaries and CSV report

### 2. **stability_test_enhanced.py** (Advanced Configuration)
   - Extended version with adaptive settings based on dataset size
   - Small datasets (<15 legs): 5 slips, 50% max exposure
   - Large datasets (≥15 legs): 8 slips, 40% max exposure
   - Same metrics and reporting as main harness

### 3. **debug_inputs/** (Test Datasets)
   - `sample_dataset.json`: 10 betting leg records (balanced)
   - `large_dataset.json`: 20 betting leg records (more diversity)
   - Easily extensible; add more JSON files for additional tests
   - Required JSON fields: `participant`, `odds_american`

### 4. **STABILITY_TEST_README.md** (Documentation)
   - Complete usage guide for test harness
   - Detailed metrics explanations
   - Example outputs and interpretation guide
   - Troubleshooting section

## Metrics Computed (Per Portfolio)

### Portfolio Structure
- **num_slips**: Total slips generated
- **num_legs_total**: Total legs across all slips

### Slip Quality (EV & Hit Probability)
- **avg/median/min/max_slip_ev**: Expected value statistics (%)
- **avg/median/min/max_slip_hit_prob**: Win probability statistics (%)
- *Note: Only computed if legs have these attributes*

### Diversity Assessment
- **avg_pairwise_overlap**: Average leg overlap between slip pairs (0.0=perfect diversity)
  - Formula: `(shared_legs / slip_size)` averaged over all pairs
  - **Lower values indicate better diversification**

### Exposure Control
- **max_player_exposure_ratio**: Highest player concentration (0.0-1.0)
- **top_5_players**: Most frequent players and their counts

### Constraint Compliance
- **has_duplicate_slips**: Boolean; detects duplicate slip combinations
- **has_exposure_violations**: Boolean; checks max exposure threshold
- **Status indicator**: ✓ (pass) or ✗ (violation)

### Optimization Quality
- **portfolio_score**: Sum of all slip scores (higher after diversification penalty applied)

## A/B Test Configuration

| Aspect | Condition A | Condition B |
|--------|-----------|-----------|
| Diversification Penalty | Disabled (w=0) | Enabled (w_overlap=0.15, w_player=0.10) |
| Slip Building Logic | Identical greedy algorithm |
| Available Legs | Same |
| Constraint Enforcement | Same hard constraints (exposure, no duplicates) |

**Hypothesis**: Condition B should show lower pairwise overlap while maintaining comparable EV/hit probability.

## Running the Tests

### Quick Start
```bash
# Run standard test harness
python3 stability_test.py

# Run enhanced version (adaptive settings)
python3 stability_test_enhanced.py
```

### Output Files
1. **Console Report**: Prints per-dataset A/B summary
2. **CSV Report**: `stability_test_results.csv` (detailed metrics table)

### Adding Test Datasets
1. Create JSON file with legs in `debug_inputs/`
2. Run test harness—automatically discovers and tests new files
3. Results appended to `stability_test_results.csv`

## Key Features

✓ **Non-invasive**: Zero changes to core portfolio logic  
✓ **Monkey-patching**: Diversification penalty function can be toggled on/off  
✓ **Comprehensive Metrics**: 17+ metrics per portfolio  
✓ **Constraint Validation**: Automatic verification of hard constraints  
✓ **CSV Export**: Easy import to Excel/Sheets for analysis  
✓ **Extensible**: Add new datasets without code changes  
✓ **Deterministic**: Same random seed across test runs  

## Expected Behavior

### Single Slip Portfolios
When datasets are small or constraints tight, portfolios may contain only 1-2 slips:
- Overlap will be 0.0 (no pairs to compare)
- Portfolio score will be low but valid
- Player exposure will be high (small portfolio)
- Constraints will still be verified ✓

### Multiple Slip Portfolios (5+ slips)
With sufficient legs and relaxed constraints:
- **A (no diversification)**: May show higher overlap (0.2-0.4+)
- **B (with diversification)**: Should show **lower overlap** (0.05-0.15)
- EV and hit probability should be similar between A and B
- Portfolio score may differ due to penalty adjustment

## Example Output

```
Running stability tests on 2 dataset(s)...

Loading large_dataset.json... (20 legs)

large_dataset (A: no diversification)
======================================================================
  Slips: 8 | Total legs: 24
  EV: avg=2.45% | median=2.50% | range=[0.80%, 4.50%]
  Hit Prob: avg=51.2% | median=51.0% | range=[48.0%, 56.0%]
  Overlap: avg pairwise=0.267
  Player exposure: max ratio=0.375
  Top 5 players: Nikola Jokic(2), Luka Doncic(2), Stephen Curry(1), ...
  Constraints: ✓ (dups=False, violations=False)
  Portfolio score: -1.23

large_dataset (B: with diversification)
======================================================================
  Slips: 8 | Total legs: 24
  EV: avg=2.42% | median=2.45% | range=[0.75%, 4.55%]
  Hit Prob: avg=51.0% | median=51.0% | range=[48.0%, 56.0%]
  Overlap: avg pairwise=0.148        <-- LOWER (better diversity)
  Player exposure: max ratio=0.350   <-- MORE BALANCED
  Top 5 players: Nikola Jokic(1), Luka Doncic(1), Stephen Curry(1), ...
  Constraints: ✓ (dups=False, violations=False)
  Portfolio score: -1.89

Difference (B - A):
  Overlap: -0.1190 (lower is better) ✓
  EV: -0.0300%
  Portfolio Score: -0.6600
```

## Interpreting CSV Results

Open `stability_test_results.csv` in Excel/Google Sheets:

1. **Sort by dataset_name** → Groups A/B pairs together
2. **Compare overlap columns**:
   - A vs B should show B having lower value
   - Larger difference = stronger diversification effect
3. **Verify constraints**: All should be False
4. **Check EV stability**: Should be similar between A and B
5. **Review player counts**: More balanced in B if diversification is effective

## Technical Details

### Metrics Implementation

- **Overlap Calculation**: O(n²) pairwise comparison of slip leg sets
- **Exposure Computation**: Single pass through all slips
- **Duplicate Detection**: Frozenset-based O(n) check
- **EV/Probability**: Simple mean of per-leg values

### Monkey-Patching Strategy

The harness temporarily replaces the `score_diversification_penalty()` function:
```python
# Condition A (no penalty):
portfolio_module.score_diversification_penalty = lambda *args, **kwargs: 0.0

# Condition B (restore):
portfolio_module.score_diversification_penalty = original_penalty_func
```

This allows A/B comparison without code branching.

## Limitations & Future Enhancements

### Current Limitations
- Single instance per dataset (no variance measurement)
- Fixed random seed for reproducibility required
- CSV output grows linearly with test count
- No statistical significance testing

### Potential Enhancements
1. **Multi-run averaging**: Run each condition N times, average metrics
2. **Confidence intervals**: Compute 95% CI for key metrics
3. **Configurable diversification weights**: Test different w_overlap/w_player values
4. **Correlation analysis**: EV vs overlap, exposure vs overlap
5. **Baseline comparison**: Add no-op baseline (random selection)
6. **Performance profiling**: Time portfolio generation per condition

## Files Summary

```
parlay-backend/
├── portfolio.py                      # Core (UNCHANGED)
├── stability_test.py                 # Main harness
├── stability_test_enhanced.py        # Enhanced harness
├── STABILITY_TEST_README.md          # User documentation
├── STABILITY_TEST_SUMMARY.md         # This file
├── stability_test_results.csv        # Generated output
└── debug_inputs/
    ├── sample_dataset.json
    └── large_dataset.json
```

## Conclusion

The stability test harness provides a robust, zero-impact framework for evaluating portfolio generator quality. It enables comparison of diversification strategies while maintaining all hard constraints and verifying no regressions in core logic.
