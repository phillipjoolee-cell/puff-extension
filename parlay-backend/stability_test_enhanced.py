"""Stability test harness with configurable settings - enhanced for A/B demonstration."""

import json
import os
import csv
from pathlib import Path
from typing import Optional, List, Dict, Tuple
from dataclasses import dataclass
import statistics

from portfolio import (
    Leg,
    PortfolioSettings,
    generate_portfolio,
)


@dataclass
class SlipMetrics:
    """Metrics for a single slip."""
    num_legs: int
    ev_pct: Optional[float]  # Average EV if available
    hit_prob_pct: Optional[float]  # Average hit probability if available
    decimal_odds: float


@dataclass
class PortfolioMetrics:
    """Metrics aggregated for a whole portfolio."""
    dataset_name: str
    num_slips: int
    num_legs_total: int
    
    # Slip EV statistics
    avg_slip_ev: Optional[float]
    median_slip_ev: Optional[float]
    min_slip_ev: Optional[float]
    max_slip_ev: Optional[float]
    
    # Slip hit probability statistics
    avg_slip_hit_prob: Optional[float]
    median_slip_hit_prob: Optional[float]
    min_slip_hit_prob: Optional[float]
    max_slip_hit_prob: Optional[float]
    
    # Overlap metrics
    avg_pairwise_overlap: float  # 0.0 to 1.0
    
    # Exposure metrics
    max_player_exposure_ratio: float
    top_5_players: List[Tuple[str, int]]  # List of (player, count)
    
    # Constraint validation
    has_duplicate_slips: bool
    has_exposure_violations: bool
    
    # Portfolio-level score (from greedy optimization)
    portfolio_score: float


def compute_slip_ev(slip_legs) -> Optional[float]:
    """Compute average EV percentage from slip legs."""
    ev_values = [leg.edge * 100.0 for leg in slip_legs if leg.edge is not None]
    if not ev_values:
        return None
    return statistics.mean(ev_values)


def compute_slip_hit_prob(slip_legs) -> Optional[float]:
    """Compute average hit probability from slip legs."""
    hit_probs = [leg.leg.hit_prob_pct for leg in slip_legs if leg.leg.hit_prob_pct is not None]
    if not hit_probs:
        return None
    return statistics.mean(hit_probs)


def compute_pairwise_overlap(slips) -> float:
    """Compute average pairwise overlap between slips."""
    if len(slips) < 2:
        return 0.0
    
    overlaps = []
    for i, slip_i in enumerate(slips):
        legs_i = set(
            (leg.leg.participant, leg.leg.market, leg.leg.side, leg.leg.line)
            for leg in slip_i.legs
        )
        
        for slip_j in slips[i+1:]:
            legs_j = set(
                (leg.leg.participant, leg.leg.market, leg.leg.side, leg.leg.line)
                for leg in slip_j.legs
            )
            
            shared = len(legs_i & legs_j)
            slip_size = len(legs_i)
            if slip_size > 0:
                overlap_ratio = shared / slip_size
                overlaps.append(overlap_ratio)
    
    if not overlaps:
        return 0.0
    return statistics.mean(overlaps)


def check_duplicate_slips(slips) -> bool:
    """Check if any two slips are identical."""
    seen = set()
    for slip in slips:
        slip_key = frozenset(
            (leg.leg.participant, leg.leg.market, leg.leg.side, leg.leg.line)
            for leg in slip.legs
        )
        if slip_key in seen:
            return True
        seen.add(slip_key)
    return False


def compute_player_exposure(slips, max_exposure: float) -> Tuple[float, bool, List[Tuple[str, int]]]:
    """Compute player exposure metrics and check for violations."""
    if not slips:
        return 0.0, False, []
    
    player_counts = {}
    for slip in slips:
        for leg in slip.legs:
            player = leg.leg.participant
            player_counts[player] = player_counts.get(player, 0) + 1
    
    num_slips = len(slips)
    max_allowed = max(1, int(max_exposure * num_slips))
    
    exposure_ratios = {player: count / num_slips for player, count in player_counts.items()}
    max_ratio = max(exposure_ratios.values()) if exposure_ratios else 0.0
    
    has_violations = any(count > max_allowed for count in player_counts.values())
    
    # Top 5 players
    top_5 = sorted(player_counts.items(), key=lambda x: x[1], reverse=True)[:5]
    
    return max_ratio, has_violations, top_5


def compute_portfolio_metrics(
    slips,
    dataset_name: str,
    max_player_exposure: float,
) -> PortfolioMetrics:
    """Compute all metrics for a portfolio."""
    if not slips:
        return PortfolioMetrics(
            dataset_name=dataset_name,
            num_slips=0,
            num_legs_total=0,
            avg_slip_ev=None,
            median_slip_ev=None,
            min_slip_ev=None,
            max_slip_ev=None,
            avg_slip_hit_prob=None,
            median_slip_hit_prob=None,
            min_slip_hit_prob=None,
            max_slip_hit_prob=None,
            avg_pairwise_overlap=0.0,
            max_player_exposure_ratio=0.0,
            top_5_players=[],
            has_duplicate_slips=False,
            has_exposure_violations=False,
            portfolio_score=0.0,
        )
    
    # Compute slip-level metrics
    slip_evs = []
    slip_hit_probs = []
    for slip in slips:
        ev = compute_slip_ev(slip.legs)
        if ev is not None:
            slip_evs.append(ev)
        
        hit_prob = compute_slip_hit_prob(slip.legs)
        if hit_prob is not None:
            slip_hit_probs.append(hit_prob)
    
    # EV statistics
    avg_slip_ev = statistics.mean(slip_evs) if slip_evs else None
    median_slip_ev = statistics.median(slip_evs) if slip_evs else None
    min_slip_ev = min(slip_evs) if slip_evs else None
    max_slip_ev = max(slip_evs) if slip_evs else None
    
    # Hit probability statistics
    avg_slip_hit_prob = statistics.mean(slip_hit_probs) if slip_hit_probs else None
    median_slip_hit_prob = statistics.median(slip_hit_probs) if slip_hit_probs else None
    min_slip_hit_prob = min(slip_hit_probs) if slip_hit_probs else None
    max_slip_hit_prob = max(slip_hit_probs) if slip_hit_probs else None
    
    # Overlap and exposure
    avg_overlap = compute_pairwise_overlap(slips)
    max_exposure_ratio, has_violations, top_5 = compute_player_exposure(slips, max_player_exposure)
    
    # Check for duplicates
    has_dupes = check_duplicate_slips(slips)
    
    # Total legs
    num_legs_total = sum(len(slip.legs) for slip in slips)
    
    # Portfolio score
    portfolio_score = sum(slip.score for slip in slips)
    
    return PortfolioMetrics(
        dataset_name=dataset_name,
        num_slips=len(slips),
        num_legs_total=num_legs_total,
        avg_slip_ev=avg_slip_ev,
        median_slip_ev=median_slip_ev,
        min_slip_ev=min_slip_ev,
        max_slip_ev=max_slip_ev,
        avg_slip_hit_prob=avg_slip_hit_prob,
        median_slip_hit_prob=median_slip_hit_prob,
        min_slip_hit_prob=min_slip_hit_prob,
        max_slip_hit_prob=max_slip_hit_prob,
        avg_pairwise_overlap=avg_overlap,
        max_player_exposure_ratio=max_exposure_ratio,
        top_5_players=top_5,
        has_duplicate_slips=has_dupes,
        has_exposure_violations=has_violations,
        portfolio_score=portfolio_score,
    )


def load_legs_from_json(filepath: str) -> List[Leg]:
    """Load legs from a JSON file."""
    with open(filepath, 'r') as f:
        data = json.load(f)
    
    # Support both direct list or {legs: [...]} structure
    if isinstance(data, dict) and 'legs' in data:
        leg_dicts = data['legs']
    else:
        leg_dicts = data
    
    legs = [Leg(**leg_dict) for leg_dict in leg_dicts]
    return legs


def run_ab_test(
    legs: List[Leg],
    dataset_name: str,
    settings: PortfolioSettings,
) -> Tuple[PortfolioMetrics, PortfolioMetrics]:
    """Run A/B test with different diversification weights."""
    import portfolio as portfolio_module
    
    # Generate with NO diversification (weights = 0)
    original_penalty_func = portfolio_module.score_diversification_penalty
    
    def penalty_zero(*args, **kwargs):
        return 0.0
    
    portfolio_module.score_diversification_penalty = penalty_zero
    result_a = generate_portfolio(legs, settings)
    metrics_a = compute_portfolio_metrics(
        result_a.slips,
        f"{dataset_name} (A: no diversification)",
        settings.max_player_exposure,
    )
    
    # Restore and generate WITH diversification (default weights)
    portfolio_module.score_diversification_penalty = original_penalty_func
    result_b = generate_portfolio(legs, settings)
    metrics_b = compute_portfolio_metrics(
        result_b.slips,
        f"{dataset_name} (B: with diversification)",
        settings.max_player_exposure,
    )
    
    return metrics_a, metrics_b


def print_metrics_summary(metrics: PortfolioMetrics) -> None:
    """Print a concise summary of portfolio metrics."""
    print(f"\n{metrics.dataset_name}")
    print("=" * 70)
    print(f"  Slips: {metrics.num_slips} | Total legs: {metrics.num_legs_total}")
    
    if metrics.avg_slip_ev is not None:
        print(f"  EV: avg={metrics.avg_slip_ev:.2f}% | median={metrics.median_slip_ev:.2f}% | "
              f"range=[{metrics.min_slip_ev:.2f}%, {metrics.max_slip_ev:.2f}%]")
    
    if metrics.avg_slip_hit_prob is not None:
        print(f"  Hit Prob: avg={metrics.avg_slip_hit_prob:.1f}% | median={metrics.median_slip_hit_prob:.1f}% | "
              f"range=[{metrics.min_slip_hit_prob:.1f}%, {metrics.max_slip_hit_prob:.1f}%]")
    
    print(f"  Overlap: avg pairwise={metrics.avg_pairwise_overlap:.3f}")
    print(f"  Player exposure: max ratio={metrics.max_player_exposure_ratio:.3f}")
    
    top_5_str = ", ".join(f"{p}({c})" for p, c in metrics.top_5_players)
    print(f"  Top 5 players: {top_5_str}")
    
    status = "✓" if (not metrics.has_duplicate_slips and not metrics.has_exposure_violations) else "✗"
    print(f"  Constraints: {status} (dups={metrics.has_duplicate_slips}, violations={metrics.has_exposure_violations})")
    
    print(f"  Portfolio score: {metrics.portfolio_score:.2f}")


def write_csv_report(all_metrics: List[PortfolioMetrics], output_path: str) -> None:
    """Write metrics to a CSV file."""
    fieldnames = [
        'dataset_name',
        'num_slips',
        'num_legs_total',
        'avg_slip_ev',
        'median_slip_ev',
        'min_slip_ev',
        'max_slip_ev',
        'avg_slip_hit_prob',
        'median_slip_hit_prob',
        'min_slip_hit_prob',
        'max_slip_hit_prob',
        'avg_pairwise_overlap',
        'max_player_exposure_ratio',
        'top_5_players',
        'has_duplicate_slips',
        'has_exposure_violations',
        'portfolio_score',
    ]
    
    with open(output_path, 'w', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        
        for metrics in all_metrics:
            row = {
                'dataset_name': metrics.dataset_name,
                'num_slips': metrics.num_slips,
                'num_legs_total': metrics.num_legs_total,
                'avg_slip_ev': f"{metrics.avg_slip_ev:.4f}" if metrics.avg_slip_ev is not None else '',
                'median_slip_ev': f"{metrics.median_slip_ev:.4f}" if metrics.median_slip_ev is not None else '',
                'min_slip_ev': f"{metrics.min_slip_ev:.4f}" if metrics.min_slip_ev is not None else '',
                'max_slip_ev': f"{metrics.max_slip_ev:.4f}" if metrics.max_slip_ev is not None else '',
                'avg_slip_hit_prob': f"{metrics.avg_slip_hit_prob:.2f}" if metrics.avg_slip_hit_prob is not None else '',
                'median_slip_hit_prob': f"{metrics.median_slip_hit_prob:.2f}" if metrics.median_slip_hit_prob is not None else '',
                'min_slip_hit_prob': f"{metrics.min_slip_hit_prob:.2f}" if metrics.min_slip_hit_prob is not None else '',
                'max_slip_hit_prob': f"{metrics.max_slip_hit_prob:.2f}" if metrics.max_slip_hit_prob is not None else '',
                'avg_pairwise_overlap': f"{metrics.avg_pairwise_overlap:.4f}",
                'max_player_exposure_ratio': f"{metrics.max_player_exposure_ratio:.4f}",
                'top_5_players': "; ".join(f"{p}({c})" for p, c in metrics.top_5_players),
                'has_duplicate_slips': metrics.has_duplicate_slips,
                'has_exposure_violations': metrics.has_exposure_violations,
                'portfolio_score': f"{metrics.portfolio_score:.4f}",
            }
            writer.writerow(row)
    
    print(f"\n✓ Results written to {output_path}")


def main():
    """Run the stability test harness."""
    import sys
    
    # Configuration
    input_dir = Path("debug_inputs")
    output_csv = "stability_test_results.csv"
    
    # Check for input directory
    if not input_dir.exists():
        print(f"Error: Input directory '{input_dir}' not found.")
        print(f"Create {input_dir} and populate with JSON test files.")
        sys.exit(1)
    
    # Load all JSON files
    json_files = sorted(input_dir.glob("*.json"))
    if not json_files:
        print(f"Error: No JSON files found in {input_dir}")
        sys.exit(1)
    
    print(f"Running stability tests on {len(json_files)} dataset(s)...\n")
    
    all_metrics = []
    
    for json_file in json_files:
        dataset_name = json_file.stem
        print(f"\nLoading {json_file.name}...", end=" ")
        
        try:
            legs = load_legs_from_json(str(json_file))
            print(f"({len(legs)} legs)")
        except Exception as e:
            print(f"ERROR: {e}")
            continue
        
        # Determine settings based on dataset size
        if len(legs) < 15:
            settings = PortfolioSettings(
                mode="balanced",
                num_slips=5,
                legs_per_slip=3,
                max_player_exposure=0.5,
                max_game_exposure=None,
                bankroll=None,
                risk_per_slate=0.1,
                sizing_mode="equal",
            )
        else:
            settings = PortfolioSettings(
                mode="balanced",
                num_slips=8,
                legs_per_slip=3,
                max_player_exposure=0.4,
                max_game_exposure=None,
                bankroll=None,
                risk_per_slate=0.1,
                sizing_mode="equal",
            )
        
        # Run A/B test
        metrics_a, metrics_b = run_ab_test(legs, dataset_name, settings)
        all_metrics.extend([metrics_a, metrics_b])
        
        # Print summaries
        print_metrics_summary(metrics_a)
        print_metrics_summary(metrics_b)
        
        # Comparison
        print(f"\nDifference (B - A):")
        print(f"  Overlap: {metrics_b.avg_pairwise_overlap - metrics_a.avg_pairwise_overlap:+.4f} (lower is better)")
        if metrics_a.avg_slip_ev is not None and metrics_b.avg_slip_ev is not None:
            print(f"  EV: {metrics_b.avg_slip_ev - metrics_a.avg_slip_ev:+.4f}%")
        print(f"  Portfolio Score: {metrics_b.portfolio_score - metrics_a.portfolio_score:+.4f}")
    
    # Write CSV report
    write_csv_report(all_metrics, output_csv)
    
    print("\n" + "=" * 70)
    print("Stability test complete!")


if __name__ == "__main__":
    main()
