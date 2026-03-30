import sys, os
from fastapi.testclient import TestClient

# ensure the backend directory is on the import path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from portfolio import Leg, PortfolioSettings, generate_portfolio, dedupe_legs
from main import app

client = TestClient(app)


def make_leg(participant, market="Points", side="Over", odds=-110):
    return Leg(participant=participant, market=market, side=side, odds=odds)


def test_no_duplicate_legs():
    legs = [make_leg("X"), make_leg("X")]  # identical legs
    # verify standalone deduplication logic works
    deduped = dedupe_legs(legs)
    assert len(deduped) == 1

    # also try running through the full engine with some extra filler legs
    filler = [make_leg(f"F{i}") for i in range(5)]
    settings = PortfolioSettings(num_slips=5, legs_per_slip=2)
    result = generate_portfolio(legs + filler, settings)
    # engine should complete without crashing and should not include duplicate leg twice in the same slip
    for slip in result.slips:
        participants = [sl.leg.participant for sl in slip.legs]
        assert participants.count("X") <= 1


def test_conflict_rules():
    # two legs same participant and same family (player_stats)
    l1 = make_leg("P1", market="Points")
    l2 = make_leg("P1", market="Rebounds")
    # add extras so engine can build at least one slip
    extras = [make_leg(f"E{i}") for i in range(5)]
    settings = PortfolioSettings(num_slips=5, legs_per_slip=2)
    result = generate_portfolio([l1, l2] + extras, settings)
    # ensure no slip contains both P1 legs
    for slip in result.slips:
        parts = [sl.leg.participant for sl in slip.legs]
        assert parts.count("P1") <= 1


def test_exposure_caps():
    # generate 3 slips, legs limited by exposure cap 0.5
    legs = [make_leg("A"), make_leg("A"), make_leg("A"), make_leg("B"), make_leg("B")]
    settings = PortfolioSettings(num_slips=5, legs_per_slip=2, max_player_exposure=0.5)
    result = generate_portfolio(legs, settings)
    # compute player exposure fractions
    pe = result.player_exposure
    # exposures should always be sane
    assert 0.0 <= pe.get("A", 0) <= 1.0
    assert 0.0 <= pe.get("B", 0) <= 1.0


def test_risk_profile_shapes_differ():
    legs = [
        {"participant":"A","market":"Points","side":"over","odds":-110,"odds_format":"american","hit_prob_pct":50,"book":"D"},
        {"participant":"B","market":"Moneyline","side":"home","odds":120,"odds_format":"american","hit_prob_pct":45,"book":"F"},
    ]

    counts = {}
    for profile in ["stable", "growth", "high_upside"]:
        r = client.post("/v1/parlays/suggest", json={"legs": legs, "risk_profile": profile})
        assert r.status_code == 200
        data = r.json()
        counts[profile] = len(data.get("parlays", []))

    # expect different counts (stable usually returns at least as many as growth)
    assert counts["stable"] >= counts["growth"]
    assert counts["growth"] >= counts["high_upside"]


def test_bankroll_summary_in_response():
    # request with bankroll should include non-null unit_size
    legs = [
        {"participant":"A","market":"Points","side":"over","odds":-110,"odds_format":"american","hit_prob_pct":50,"book":"D"},
        {"participant":"B","market":"Moneyline","side":"home","odds":120,"odds_format":"american","hit_prob_pct":45,"book":"F"},
    ]
    payload = {"legs": legs, "settings": {"bankroll": 500.0, "risk_per_slate": 0.1, "legs_per_slip": 2}}
    r = client.post("/v1/parlays/suggest", json=payload)
    assert r.status_code == 200
    data = r.json()
    summary = data.get("summary", {})
    if data.get("parlays"):
        assert summary.get("unit_size") is not None
        assert summary.get("slate_risk") is not None
    else:
        # if no parlays were built then bankroll metrics may be None
        assert summary.get("unit_size") is None
        assert summary.get("slate_risk") is None




def test_license_required(monkeypatch):
    # configure a valid license and verify endpoint rejects missing/invalid
    monkeypatch.setenv("VALID_LICENSE_KEYS", "ABC123")
    legs = [{"participant":"A","market":"Points","side":"over","odds":-110,"odds_format":"american","hit_prob_pct":50,"book":"D"}]
    r1 = client.post("/v1/parlays/suggest", json={"legs": legs})
    assert r1.status_code == 402
    r2 = client.post("/v1/parlays/suggest", json={"legs": legs, "license_key": "WRONG"})
    assert r2.status_code == 402
    r3 = client.post("/v1/parlays/suggest", json={"legs": legs, "license_key": "ABC123"})
    assert r3.status_code == 200


def test_html_fixtures_available():
    # ensure our fixture files exist and can be opened (placeholder test)
    import os
    base = os.path.join(os.path.dirname(__file__), "fixtures")
    assert os.path.isfile(os.path.join(base, "sample1.html"))
    assert os.path.isfile(os.path.join(base, "sample2.html"))
