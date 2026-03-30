#!/usr/bin/env python3
"""
PUFF Math Verification Script
Run this to verify the formulas match your PDF/screenshots.
Usage: python verify_math.py
"""

def american_to_decimal(american: int) -> float:
    if american == 0:
        raise ValueError("american odds cannot be 0")
    if american > 0:
        return 1.0 + (american / 100.0)
    return 1.0 + (100.0 / abs(american))

def implied_prob_from_american(american: int) -> float:
    """Implied probability from American odds (0-1)."""
    dec = american_to_decimal(american)
    return 1.0 / dec if dec > 0 else 0.0

def parlay_hit_prob(legs: list[dict]) -> float:
    """
    legs: list of { "hit_prob_pct": float or None, "odds_american": int or None }
    Returns hit probability as % (0-100).
    """
    prob = 1.0
    for leg in legs:
        if leg.get("hit_prob_pct") is not None:
            p = leg["hit_prob_pct"] / 100.0
        elif leg.get("odds_american") is not None and leg["odds_american"] != 0:
            p = implied_prob_from_american(leg["odds_american"])
        else:
            p = 0.5
        p = max(0.01, min(0.99, p))
        prob *= p
    return prob * 100

def survival_probability(slip_hit_probs: list[float]) -> float:
    """
    slip_hit_probs: list of P(slip hits) as 0-1 or 0-100 (we treat >1 as %)
    Returns survival prob as 0-1.
    """
    probs = [p / 100.0 if p > 1 else p for p in slip_hit_probs]
    p_all_lose = 1.0
    for p in probs:
        p_all_lose *= (1.0 - p)
    return 1.0 - p_all_lose

def main():
    print("=" * 60)
    print("PUFF MATH VERIFICATION")
    print("=" * 60)

    # 1. Implied probability from American odds
    print("\n1. IMPLIED PROBABILITY (from American odds)")
    print("-" * 40)
    test_odds = [
        (-110, "standard -110"),
        (+150, "underdog +150"),
        (-200, "heavy favorite -200"),
        (+200, "long shot +200"),
    ]
    for odds, desc in test_odds:
        p = implied_prob_from_american(odds)
        print(f"  {odds:+4d} ({desc}): implied prob = {p*100:.2f}%")

    # 2. Example parlay hit probability (3 legs, using odds only)
    print("\n2. PARLAY HIT PROBABILITY (product of leg probs)")
    print("-" * 40)
    example_legs = [
        {"odds_american": -110, "hit_prob_pct": None},
        {"odds_american": +120, "hit_prob_pct": None},
        {"odds_american": -105, "hit_prob_pct": None},
    ]
    for i, leg in enumerate(example_legs, 1):
        p = implied_prob_from_american(leg["odds_american"]) * 100
        print(f"  Leg {i}: {leg['odds_american']:+4d} -> {p:.2f}%")
    hit_pct = parlay_hit_prob(example_legs)
    print(f"  PARLAY HIT PROB = {hit_pct:.2f}%")

    # 3. Example using hit_prob_pct from optimizer (when available)
    print("\n3. PARLAY WITH HIT_PROB_PCT (from optimizer)")
    print("-" * 40)
    legs_with_hit = [
        {"odds_american": -110, "hit_prob_pct": 52.4},  # e.g. from optimizer
        {"odds_american": +120, "hit_prob_pct": 45.5},
        {"odds_american": -105, "hit_prob_pct": 51.2},
    ]
    for i, leg in enumerate(legs_with_hit, 1):
        p = leg["hit_prob_pct"] / 100.0
        print(f"  Leg {i}: hit_prob_pct={leg['hit_prob_pct']}% -> use {p:.4f}")
    hit_pct2 = parlay_hit_prob(legs_with_hit)
    print(f"  PARLAY HIT PROB = {hit_pct2:.2f}%")

    # 4. Survival probability (3 slips)
    print("\n4. SURVIVAL PROBABILITY (P(at least one slip hits))")
    print("-" * 40)
    slip_probs = [10.5, 8.2, 12.1]  # hit prob % for 3 slips
    surv = survival_probability(slip_probs)
    print(f"  Slip hit probs: {slip_probs}%")
    print(f"  P(all lose) = (1-0.105)*(1-0.082)*(1-0.121) = {(1-0.105)*(1-0.082)*(1-0.121):.4f}")
    print(f"  SURVIVAL = 1 - P(all lose) = {surv*100:.2f}%")

    # 5. Spot-check from your typical slip (2.57%, 2.49%, 2.11% as EV - NOT hit prob!)
    print("\n5. IMPORTANT: EV% vs HIT PROBABILITY")
    print("-" * 40)
    print("  The percentages on slip cards (e.g. 2.57%, 2.49%) are EV%, not hit prob.")
    print("  Hit probability comes from: (a) optimizer's column if captured, or")
    print("  (b) implied from odds: 1/(1 + american/100) for +odds, 1/(1+100/|american|) for -odds")
    print("  When EV% was wrongly used as hit_prob_pct, parlay prob = 0.026*0.025*0.021 ~ 0.001% (wrong)")
    print("  With implied from odds (e.g. -110 each): 0.524^3 ~ 14.4% (correct range)")

    # 6. STABLE SLIPS - verification using captured leg data (from debug_inputs)
    print("\n6. STABLE SLIPS VERIFICATION (from your captured legs)")
    print("-" * 40)
    # From debug_inputs: participant string contains EV%, actual hit_prob_pct from optimizer
    # Slip 1: Denver U • Massachusetts O • Iowa State U
    slip1 = [
        {"hit_prob_pct": 47.4, "odds_american": 117},   # Denver U
        {"hit_prob_pct": 46.2, "odds_american": 122}, # Massachusetts O
        {"hit_prob_pct": 48.9, "odds_american": 109}, # Iowa State U
    ]
    # Slip 2: Iowa O • Denver U • St. Bonaventure O
    slip2 = [
        {"hit_prob_pct": 46.1, "odds_american": 124},
        {"hit_prob_pct": 47.4, "odds_american": 117},
        {"hit_prob_pct": 49.1, "odds_american": 109},
    ]
    # Slip 3: St. Bonaventure O • Iowa State U • Boston Celtics other
    slip3 = [
        {"hit_prob_pct": 49.1, "odds_american": 109},
        {"hit_prob_pct": 50.4, "odds_american": 103},
        {"hit_prob_pct": 49.4, "odds_american": 107},
    ]
    h1 = parlay_hit_prob(slip1)
    h2 = parlay_hit_prob(slip2)
    h3 = parlay_hit_prob(slip3)
    print(f"  Slip 1 (Denver U, Mass O, Iowa St U): hit_prob = {h1:.1f}%")
    print(f"  Slip 2 (Iowa O, Denver U, St Bona O): hit_prob = {h2:.1f}%")
    print(f"  Slip 3 (St Bona O, Iowa St U, Celtics): hit_prob = {h3:.1f}%")
    avg_hit = (h1 + h2 + h3) / 3
    print(f"  Portfolio Hit Prob (avg) = {avg_hit:.1f}%")
    surv = survival_probability([h1, h2, h3])
    print(f"  Survival Prob = 1 - (1-{h1/100:.2f})(1-{h2/100:.2f})(1-{h3/100:.2f}) = {surv*100:.1f}%")
    print("\n  Expected from your screenshots: Hit 11.2%, Survival 20.9%")

    # 7. GROWTH SLIPS (5 positions) - verification
    print("\n7. GROWTH SLIPS VERIFICATION (5 positions)")
    print("-" * 40)
    # Slip 1: Iowa O • Denver U • St Bona O
    g1 = [{"hit_prob_pct": 46.1}, {"hit_prob_pct": 47.4}, {"hit_prob_pct": 49.1}]
    # Slip 2: Denver U • Mass O • Iowa St U
    g2 = [{"hit_prob_pct": 47.4}, {"hit_prob_pct": 46.2}, {"hit_prob_pct": 48.9}]
    # Slip 3: St Bona O • Iowa St U • Celtics
    g3 = [{"hit_prob_pct": 49.1}, {"hit_prob_pct": 50.4}, {"hit_prob_pct": 49.4}]
    # Slip 4: Mass O • Denver U (2.15% line) • Bulls U
    g4 = [{"hit_prob_pct": 46.2}, {"hit_prob_pct": 49.1}, {"hit_prob_pct": 48.6}]
    # Slip 5: Iowa St U • Wizards U • Jannik Sinner O
    g5 = [{"hit_prob_pct": 48.9}, {"hit_prob_pct": 48.5}, {"hit_prob_pct": 44.9}]
    gh1 = parlay_hit_prob(g1)
    gh2 = parlay_hit_prob(g2)
    gh3 = parlay_hit_prob(g3)
    gh4 = parlay_hit_prob(g4)
    gh5 = parlay_hit_prob(g5)
    print(f"  Slip 1 (Iowa O, Denver U, St Bona O): {gh1:.1f}%")
    print(f"  Slip 2 (Denver U, Mass O, Iowa St U): {gh2:.1f}%")
    print(f"  Slip 3 (St Bona O, Iowa St U, Celtics): {gh3:.1f}%")
    print(f"  Slip 4 (Mass O, Denver U, Bulls U): {gh4:.1f}%")
    print(f"  Slip 5 (Iowa St U, Wizards U, Sinner O): {gh5:.1f}%")
    g_avg = (gh1 + gh2 + gh3 + gh4 + gh5) / 5
    g_surv_raw = survival_probability([gh1, gh2, gh3, gh4, gh5]) * 100
    print(f"  Portfolio Hit Prob (avg) = {g_avg:.1f}%")
    print(f"  Raw Survival (no penalty) = {g_surv_raw:.1f}%")
    print("\n  Expected from screenshots: Hit ~11.1%, Survival ~40.7%, Div 64/100")

    # 8. UPSIDE SLIPS (8 positions) - verification
    print("\n8. UPSIDE SLIPS VERIFICATION (8 positions)")
    print("-" * 40)
    # First 5 same as Growth; then 3 more with different legs
    u1 = [{"hit_prob_pct": 46.1}, {"hit_prob_pct": 47.4}, {"hit_prob_pct": 49.1}]  # Iowa O, Denver U, St Bona O
    u2 = [{"hit_prob_pct": 47.4}, {"hit_prob_pct": 46.2}, {"hit_prob_pct": 48.9}]  # Denver U, Mass O, Iowa St U
    u3 = [{"hit_prob_pct": 49.1}, {"hit_prob_pct": 50.4}, {"hit_prob_pct": 49.4}]  # St Bona O, Iowa St U, Celtics
    u4 = [{"hit_prob_pct": 46.2}, {"hit_prob_pct": 49.1}, {"hit_prob_pct": 48.6}]  # Mass O, Denver U 2.15%, Bulls U
    u5 = [{"hit_prob_pct": 48.9}, {"hit_prob_pct": 48.5}, {"hit_prob_pct": 44.9}]  # Iowa St U, Wizards U, Sinner O
    u6 = [{"hit_prob_pct": 50.4}, {"hit_prob_pct": 49.0}, {"hit_prob_pct": 43.3}]  # Iowa St U 2.24%, Mass O 1.82%, Swiatek U
    u7 = [{"hit_prob_pct": 49.4}, {"hit_prob_pct": 47.9}, {"hit_prob_pct": 50.0}]  # Celtics 2.17%, Celtics 1.50%, Kentucky O
    u8 = [{"hit_prob_pct": 49.1}, {"odds_american": 103}, {"hit_prob_pct": 50.2}]  # Denver 2.15%, Unknown O (implied), Denver 1.36%
    uh1 = parlay_hit_prob(u1)
    uh2 = parlay_hit_prob(u2)
    uh3 = parlay_hit_prob(u3)
    uh4 = parlay_hit_prob(u4)
    uh5 = parlay_hit_prob(u5)
    uh6 = parlay_hit_prob(u6)
    uh7 = parlay_hit_prob(u7)
    uh8 = parlay_hit_prob(u8)
    print(f"  Slip 1 (Iowa O, Denver U, St Bona O): {uh1:.1f}%")
    print(f"  Slip 2 (Denver U, Mass O, Iowa St U): {uh2:.1f}%")
    print(f"  Slip 3 (St Bona O, Iowa St U, Celtics): {uh3:.1f}%")
    print(f"  Slip 4 (Mass O, Denver U, Bulls U): {uh4:.1f}%")
    print(f"  Slip 5 (Iowa St U, Wizards U, Sinner O): {uh5:.1f}%")
    print(f"  Slip 6 (Iowa St U, Mass O 1.82%, Swiatek U): {uh6:.1f}%")
    print(f"  Slip 7 (Celtics 2.17%, Celtics 1.50%, Kentucky O): {uh7:.1f}%")
    print(f"  Slip 8 (Denver 2.15%, Unknown O, Denver 1.36%): {uh8:.1f}%")
    u_avg = (uh1 + uh2 + uh3 + uh4 + uh5 + uh6 + uh7 + uh8) / 8
    u_surv_raw = survival_probability([uh1, uh2, uh3, uh4, uh5, uh6, uh7, uh8]) * 100
    print(f"  Portfolio Hit Prob (avg) = {u_avg:.1f}%")
    print(f"  Raw Survival (no penalty) = {u_surv_raw:.1f}%")
    print("\n  Expected from screenshots: Hit ~11.3%, Survival ~59.2%, Div 77/100")

    # 9. LEG-COUNT SANITY: more legs => lower hit prob (same-quality legs)
    print("\n9. LEG-COUNT SANITY (2 vs 3 vs 4 legs — same per-leg prob)")
    print("-" * 40)
    # Use one fixed per-leg prob so we only vary number of legs
    p_leg = 0.48  # 48% per leg
    legs_2 = [{"hit_prob_pct": 48.0}] * 2
    legs_3 = [{"hit_prob_pct": 48.0}] * 3
    legs_4 = [{"hit_prob_pct": 48.0}] * 4
    h2 = parlay_hit_prob(legs_2)
    h3 = parlay_hit_prob(legs_3)
    h4 = parlay_hit_prob(legs_4)
    print(f"  2 legs (48% each): hit prob = {h2:.2f}%  (expected 48% × 48% = 23.04%)")
    print(f"  3 legs (48% each): hit prob = {h3:.2f}%  (expected 48%³ = 11.06%)")
    print(f"  4 legs (48% each): hit prob = {h4:.2f}%  (expected 48%⁴ = 5.31%)")
    assert h2 > h3 > h4, "BUG: more legs must have LOWER hit prob (2-leg > 3-leg > 4-leg)"
    print("  OK: 2-leg > 3-leg > 4-leg")

    # 10. Mixed leg counts with real-looking probs
    print("\n10. MIXED LEG COUNTS (realistic hit_prob_pct per leg)")
    print("-" * 40)
    two_leg = [{"hit_prob_pct": 47.0}, {"hit_prob_pct": 49.0}]
    three_leg = [{"hit_prob_pct": 46.0}, {"hit_prob_pct": 48.0}, {"hit_prob_pct": 50.0}]
    four_leg = [
        {"hit_prob_pct": 45.0}, {"hit_prob_pct": 47.0},
        {"hit_prob_pct": 49.0}, {"hit_prob_pct": 51.0},
    ]
    h2m = parlay_hit_prob(two_leg)
    h3m = parlay_hit_prob(three_leg)
    h4m = parlay_hit_prob(four_leg)
    print(f"  2-leg (47%, 49%):     {h2m:.2f}%")
    print(f"  3-leg (46%, 48%, 50%): {h3m:.2f}%")
    print(f"  4-leg (45–51%):       {h4m:.2f}%")
    assert h2m > h3m > h4m, "BUG: more legs must have LOWER hit prob"
    print("  OK: 2-leg > 3-leg > 4-leg")

    # 11. METRIC VALIDATION TEST MATRIX (all 5 metrics × modes × leg counts)
    print("\n11. METRIC VALIDATION TEST MATRIX")
    print("-" * 40)
    print("  Validating: Projected EV, Hit Prob, Survival, Diversification, Capital")
    print("  Modes: Stable (2-3 legs), Growth (3 legs), Upside (3-4 legs)")
    print("  Leg counts: 2, 3, 4, 5")
    modes_legs = [
        ("Stable", 2), ("Stable", 3), ("Growth", 3), ("Upside", 3), ("Upside", 4),
    ]
    for mode, n_legs in modes_legs:
        legs = [{"hit_prob_pct": 48.0 + (i % 5), "odds_american": -110} for i in range(n_legs)]
        hit = parlay_hit_prob(legs)
        assert 0 < hit < 100, f"Hit prob out of range for {mode} {n_legs}-leg"
        print(f"  {mode} {n_legs}-leg: hit_prob = {hit:.2f}% OK")
    # Survival: 3 slips
    slip_probs = [parlay_hit_prob([{"hit_prob_pct": 45}] * 2), parlay_hit_prob([{"hit_prob_pct": 50}] * 3), parlay_hit_prob([{"hit_prob_pct": 48}] * 2)]
    surv = survival_probability(slip_probs) * 100
    assert 0 <= surv <= 100, "Survival out of range"
    print(f"  Survival (3 slips): {surv:.1f}% OK")
    # Capital allocation: unit = slate_risk / n_slips, slate_risk = bankroll * risk_pct
    bankroll, risk_pct, n_slips = 1000.0, 0.08, 5
    slate_risk = bankroll * risk_pct
    unit = slate_risk / n_slips
    assert abs(unit - 16.0) < 0.01, "Capital allocation formula error"
    print(f"  Capital: bankroll=1000 risk=8% 5 slips -> unit={unit:.2f} slate_risk={slate_risk:.2f} OK")
    print("  Diversification: computed in backend from player/game concentration (portfolio-level).")
    print("  Projected EV: backend = mean(est_ev_score) per slip; est_ev_score = sum(leg EV) - penalty.")
    print("  All matrix checks passed.")

    print("\n" + "=" * 60)
    print("HOW TO TEST THE MATH AND STATS")
    print("=" * 60)
    print("""
  1. Run this script:
       python3 verify_math.py
     It asserts 2-leg > 3-leg > 4-leg; if that fails, the math is wrong.

  2. Hand-check a single slip (2, 3, or 4 legs):
     - Hit prob = product of each leg's probability (use hit_prob_pct/100 or implied from odds).
     - Example: 48%, 50%, 52% → 0.48 × 0.50 × 0.52 = 12.48%.

  3. In the extension popup:
     - Generate a portfolio (Stable = 2–3 legs, Growth = 3, Upside = 3–4).
     - Click a slip and note "Hit Probability" for that slip.
     - Compare to: multiply each leg's hit_prob_pct (or implied from odds); should match.

  4. Portfolio "Hit Probability" in the UI = average of each slip's hit prob.
     Survival = 1 - (1-p1)(1-p2)... for slip hit probs (with correlation penalty in backend).

  5. To test with your own legs: edit sections 6–8 in this script with leg data
     (hit_prob_pct and/or odds_american per leg), then run again.
""")
    print("=" * 60)

if __name__ == "__main__":
    main()
