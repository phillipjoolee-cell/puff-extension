# Stability Test Harness Documentation

## Overview

The stability test harness (`stability_test.py`) performs A/B comparison of the portfolio generator with different diversification weights to evaluate portfolio quality, diversity, and constraint compliance.

## What it Does

### A/B Test Configuration

- **Condition A**: Diversification penalty disabled (`w_overlap=0, w_player=0`)
- **Condition B**: Diversification penalty enabled (default: `w_overlap=0.15, w_player=0.10`)

Both conditions run on the same input dataset and generate portfolios using the same greedy algorithm, differing only in the scoring penalty applied.

### Input

Test datasets should be JSON files in `debug_inputs/` directory with the following structure:

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
  },
  ...
]
```

**Required fields**: `participant`, `market`, `side`, `odds_american`  
**Optional fields**: `line`, `hit_prob_pct`, `ev_pct`, `book`, `league`, `sport`, `id`

### Output

Two outputs are generated:

1. **Console Report**: Concise per-dataset summary with key metrics
2. **CSV Report** (`stability_test_results.csv`): Detailed metrics for all test runs

## Metrics Computed

### Portfolio-Level Metrics

| Metric | Description |
|--------|-------------|
| `num_slips` | Total number of slips in portfolio |
| `num_legs_total` | Total legs across all slips |
| `portfolio_score` | Sum of all slip scores |

### Slip Quality Metrics (EV & Hit Probability)

| Metric | Description |
|--------|-------------|
| `avg_slip_ev` | Average expected value across slips (%) |
| `median_slip_ev` | Median EV (%) |
| `min_slip_ev`, `max_slip_ev` | Range of EV values (%) |
| `avg_slip_hit_prob` | Average hit probability across slips (%) |
| `median_slip_hit_prob` | Median hit probability (%) |
| `min_slip_hit_prob`, `max_slip_hit_prob` | Range of hit probability (%) |

*Note: EV and hit probability metrics are only computed if legs have these attributes.*

### Diversity Metrics

| Metric | Description |
|--------|-------------|
| `avg_pairwise_overlap` | Average overlap ratio between slip pairs |
|  | Computed as: (shared legs / slip size) averaged over all pairs |
|  | **Lower is better** (0.0 = max diversity) |

### Exposure Metrics

| Metric | Description |
|--------|-------------|
| `max_player_exposure_ratio` | Highest player exposure as fraction of portfolio |
|  | Range: 0.0 to 1.0 |
| `top_5_players` | Top 5 most frequent players and their counts |

### Constraint Validation

| Metric | Description |
|--------|-------------|
| `has_duplicate_slips` | Boolean; True if any two slips are identical (violation) |
| `has_exposure_violations` | Boolean; True if max player exposure exceeded (violation) |

**Status indicator**: ✓ (all constraints met) or ✗ (violations detected)

## Running the Test

### Basic Usage

```bash
python3 stability_test.py
```

This automatically:
1. Discovers all JSON files in `debug_inputs/`
2. Runs A/B test for each dataset
3. Prints console summaries
4. Writes `stability_test_results.csv`

### Customizing Settings

Edit the `settings` object in `main()`:

```python
settings = PortfolioSettings(
    mode="balanced",              # conservative|balanced|aggressive
    num_slips=10,                 # Target number of slips
    legs_per_slip=3,              # Legs per slip
    max_player_exposure=0.3,      # 30% max player exposure
    max_game_exposure=None,       # None to disable game exposure check
    bankroll=None,
    risk_per_slate=0.1,
    sizing_mode="equal",
)
```

## Interpreting Results

### A/B Comparison

Compare metrics between A and B for each dataset:

- **Overlap difference**: If B shows lower overlap than A, diversification is working
- **EV difference**: Small differences are expected; same legs are available to both
- **Hit probability**: Should be stable between A and B
- **Player exposure**: May vary due to slip selection differences
- **Constraint compliance**: Both should always show ✓ (hard constraints are enforced)

### CSV Analysis

Open `stability_test_results.csv` in Excel/Google Sheets for comparison:

1. Sort by `dataset_name` to group A/B pairs
2. Compare `avg_pairwise_overlap` in each pair
3. Check `portfolio_score` differences (B should maintain quality)
4. Verify constraint columns are all False

## Example Output

```
sample_dataset (A: no diversification)
======================================================================
  Slips: 5 | Total legs: 15
  EV: avg=2.45% | median=2.50% | range=[0.80%, 4.00%]
  Hit Prob: avg=51.2% | median=51.0% | range=[48.0%, 56.0%]
  Overlap: avg pairwise=0.267
  Player exposure: max ratio=0.400
  Top 5 players: Luka Doncic - Mavericks(2), LeBron James - Lakers(2), Joel Embiid(1), ...
  Constraints: ✓ (dups=False, violations=False)
  Portfolio score: -1.23

sample_dataset (B: with diversification)
======================================================================
  Slips: 5 | Total legs: 15
  EV: avg=2.42% | median=2.45% | range=[0.75%, 4.05%]
  Hit Prob: avg=51.0% | median=51.0% | range=[48.0%, 56.0%]
  Overlap: avg pairwise=0.133       [<-- Lower = Better]
  Player exposure: max ratio=0.380   [<-- More balanced]
  Top 5 players: Luka Doncic(1), LeBron James(1), Joel Embiid(1), ...
  Constraints: ✓ (dups=False, violations=False)
  Portfolio score: -1.45

Difference (B - A):
  Overlap: -0.1340 (lower is better)
  EV: -0.0300%
```

## File Structure

```
parlay-backend/
├── stability_test.py          # Main test harness
├── portfolio.py               # Portfolio generator (unchanged)
├── stability_test_results.csv # Output results (generated)
├── debug_inputs/              # Input datasets
│   ├── sample_dataset.json
│   └── large_dataset.json
└── STABILITY_TEST_README.md   # This file
```

## Troubleshooting

### No JSON files found
Ensure you have JSON files in the `debug_inputs/` directory.

### Import errors
Make sure `stability_test.py` is in the same directory as `portfolio.py`.

### Unexpected metrics
- Check that JSON files have required fields (`participant`, `odds_american`)
- EV/hit probability metrics only appear if legs have those fields
- Overlap is 0 for 1-slip portfolios

## Future Enhancements

- Command-line arguments for settings
- Support for custom diversification weights in test
- Trend analysis across multiple test runs
- Statistical significance testing for A/B differences
