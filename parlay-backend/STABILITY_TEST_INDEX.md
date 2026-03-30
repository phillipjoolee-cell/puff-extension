# Portfolio Generator Stability Test Harness

## 📋 Overview

A **non-invasive, comprehensive test framework** for the parlay portfolio generator that:

✓ Measures portfolio quality and diversity without changing core logic  
✓ Runs A/B comparison of diversification strategies  
✓ Validates constraint compliance (no duplicates, exposure caps)  
✓ Generates detailed metrics and CSV reports  
✓ Supports multiple test datasets with zero code changes  

## 📁 File Structure

```
parlay-backend/
├── portfolio.py                      # Core generator (UNCHANGED)
├── stability_test.py                 # Main test harness (~380 lines)
├── stability_test_enhanced.py        # Advanced version (~390 lines)
│
├── debug_inputs/                     # Test datasets
│   ├── sample_dataset.json           # 10 legs
│   └── large_dataset.json            # 20 legs
│
├── stability_test_results.csv        # Generated output (auto-updated)
│
└── Documentation/
    ├── STABILITY_TEST_QUICKSTART.md  # < 100 lines, essential info
    ├── STABILITY_TEST_README.md      # ~200 lines, full guide
    └── STABILITY_TEST_SUMMARY.md     # ~300 lines, technical details
```

## 🚀 Getting Started (30 seconds)

### Run the Test
```bash
cd parlay-backend
python3 stability_test.py
```

### View Results
```bash
cat stability_test_results.csv
```

That's it! Results are printed to console and saved to CSV.

## 📊 What Gets Measured

### Per Portfolio (16+ metrics):
- **Structure**: num_slips, num_legs_total
- **Quality**: EV (avg/median/min/max), Hit Probability (avg/median/min/max)
- **Diversity**: avg_pairwise_overlap (0.0 = perfect diversity)
- **Exposure**: max_player_exposure_ratio, top_5_players
- **Validity**: has_duplicate_slips, has_exposure_violations
- **Score**: portfolio_score (optimization objective)

### A/B Comparison:
| Aspect | Condition A | Condition B |
|--------|-----------|-----------|
| Diversification Penalty | Disabled | Enabled (w_overlap=0.15, w_player=0.10) |
| Slip Building | Greedy, same seed | Identical |
| Hard Constraints | Enforced | Enforced |
| **Expected Result** | Baseline overlap | **Lower overlap (better diversity)** |

## 📈 How It Works

```
Input: JSON leg files in debug_inputs/
    ↓
For each dataset:
    ├─ Run portfolios with Condition A (no diversification)
    │  ↓ compute_portfolio_metrics()
    │  ↓ print_metrics_summary()
    │
    ├─ Run portfolios with Condition B (with diversification)
    │  ↓ compute_portfolio_metrics()
    │  ↓ print_metrics_summary()
    │
    └─ Print A/B comparison (overlap difference, EV delta, score delta)
    
    └─ Accumulate results
        ↓
        Write CSV report (stability_test_results.csv)
```

**Key Design Point**: Only `score_diversification_penalty()` function is toggled. Greedy algorithm and all constraints remain identical.

## 🎯 Key Features

| Feature | Benefit |
|---------|---------|
| **Zero-Impact** | No changes to portfolio.py |
| **Monkey-Patching** | Toggle diversification on/off dynamically |
| **Extensible Datasets** | Add JSON files to debug_inputs/; auto-discovered |
| **Constraint Validation** | Automatic verification of hard constraints |
| **CSV Export** | Easy analysis in Excel/Sheets |
| **Adaptive Settings** | enhanced.py scales num_slips based on dataset size |
| **Metrics-Rich** | 16+ metrics per portfolio for comprehensive analysis |

## 📚 Documentation Guide

| Document | Purpose | Length | Best For |
|----------|---------|--------|----------|
| **QUICKSTART** | Essential info + commands | ~100 lines | First-time users |
| **README** | Complete usage guide | ~200 lines | Usage details + examples |
| **SUMMARY** | Technical architecture | ~300 lines | Understanding how it works |
| Docstrings | API documentation | In-file | Function-level details |

## 🔍 Interpreting Results

### Console Output (Per Dataset)
```
dataset_name (A: no diversification)
  Slips: 8 | Overlap: 0.267 | Max Exposure: 0.375
  EV: avg=2.45% | Hit Prob: avg=51.2%
  Constraints: ✓

dataset_name (B: with diversification)
  Slips: 8 | Overlap: 0.148 | Max Exposure: 0.350
  EV: avg=2.42% | Hit Prob: avg=51.0%
  Constraints: ✓

Difference (B - A):
  Overlap: -0.1190 (lower is better) ✓
  EV: -0.0300%
```

**Key Insights**:
- Lower overlap in B indicates diversification is working
- Similar EV suggests quality is maintained
- Both should have ✓ constraints

### CSV Report
Open `stability_test_results.csv` in Excel:
1. Sort by `dataset_name` to group A/B pairs
2. Compare `avg_pairwise_overlap` columns
3. Expected: B has lower value than A
4. Verify all constraint columns are False

## ✅ Validation Checklist

After running tests:

- [ ] Console output shows correct A/B pair counts
- [ ] No import or syntax errors
- [ ] `stability_test_results.csv` created with data
- [ ] Constraint columns all show False (no violations)
- [ ] B condition has lower or equal overlap vs A
- [ ] EV/hit probability similar between A and B
- [ ] Portfolio scores reasonable (typically negative due to margin factors)

## 🛠️ Customization

### Add New Test Dataset
1. Create JSON file in `debug_inputs/` with leg records
2. Run test harness—auto-discovers new files
3. Results appended to CSV

### Adjust Diversification Weights
Edit in `stability_test.py` line ~412:
```python
penalty = score_diversification_penalty(
    slip,
    portfolio,
    player_usage_count,
    leg_usage_count,
    settings.num_slips,
    w_overlap=0.15,    # ← Adjust here (default 0.15)
    w_player=0.10,     # ← Adjust here (default 0.10)
)
```
Higher values = stronger diversification preference

### Modify Portfolio Settings
Edit in `stability_test.py` `main()` function:
```python
settings = PortfolioSettings(
    mode="balanced",              # conservative|balanced|aggressive
    num_slips=10,                 # Change to 5, 15, 20, etc.
    legs_per_slip=3,              # Change to 2, 4, etc.
    max_player_exposure=0.3,      # Change to 0.2, 0.5, etc.
    ...
)
```

## 📦 What's Included

### Test Harnesses
- `stability_test.py` — Standard test (fixed settings)
- `stability_test_enhanced.py` — Adaptive (scales with dataset size)

### Sample Datasets
- `sample_dataset.json` — 10 player points overs (balanced)
- `large_dataset.json` — 20 legs (points + assists, overs + unders)

### Documentation
- `STABILITY_TEST_QUICKSTART.md` — 30-second guide
- `STABILITY_TEST_README.md` — Full user manual
- `STABILITY_TEST_SUMMARY.md` — Technical deep-dive

## 🔧 Troubleshooting

| Problem | Solution |
|---------|----------|
| `No JSON files found` | Create `debug_inputs/` dir with `.json` files |
| `ImportError: portfolio` | Ensure .py files in same directory |
| `Only 1 slip generated` | Dataset too small; add more legs to JSON |
| `No EV/hit prob metrics` | Legs don't have `ev_pct`/`hit_prob_pct` fields (optional) |
| `Constraint violations detected` | Rare; indicates bug in portfolio generation |

## 📊 Example Workflow

```bash
# 1. Run test on existing datasets
python3 stability_test.py

# 2. Review console output for A/B differences
# (Overlap should be lower in B)

# 3. Open CSV for detailed analysis
open stability_test_results.csv

# 4. Add your dataset
cp my_dataset.json debug_inputs/

# 5. Re-run with new dataset included
python3 stability_test.py

# 6. Compare results in updated CSV
```

## 🎓 Learning Path

1. **5 min**: Read QUICKSTART
2. **15 min**: Run `stability_test.py` and review output
3. **20 min**: Read README for metrics details
4. **30 min**: Read SUMMARY for architecture
5. **30 min+**: Experiment with custom datasets and settings

## 📝 Implementation Notes

### Non-Invasive Design
- Portfolio.py is completely unchanged
- Diversification penalty is a pure function (no side effects)
- Test harness uses monkey-patching to toggle behavior
- Each run is independent (no state carried forward)

### Metrics Computation
- **Overlap**: O(n²) pairwise comparison, but n typically ≤ 20
- **Exposure**: Single pass O(n)
- **Validation**: Linear O(n) for duplicate/violation checks
- Total runtime per condition: typically 1-5 seconds

### CSV Output
- One row per portfolio (2 rows per dataset in standard test)
- Easily sortable/filterable in Excel
- Includes all computed metrics for reproducibility

## 📞 Support

- **Quick question?** → See QUICKSTART
- **How to use?** → See README
- **Why is it designed this way?** → See SUMMARY
- **Code details?** → Check docstrings in .py files

---

**Status**: ✅ Complete and tested  
**Impact on Core Logic**: Zero  
**Files Modified**: Zero  
**Files Created**: 8 (2 harnesses, 2 datasets, 3 docs, 1 CSV)  
