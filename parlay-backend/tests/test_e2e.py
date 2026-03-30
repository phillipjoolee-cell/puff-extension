from fastapi.testclient import TestClient
from main import app
from bs4 import BeautifulSoup
import os

client = TestClient(app)


def parse_table_html_to_legs(html: str):
    """Simple parser mimicking extension's generic extractor for our fixtures."""
    soup = BeautifulSoup(html, "html.parser")
    legs = []
    for tr in soup.find_all("tr"):
        tds = [td.get_text(strip=True) for td in tr.find_all("td")]
        if len(tds) < 4:
            continue
        participant, market, side_line, odds = tds[:4]
        # crude split of side/line
        side = None
        line = None
        sl_parts = side_line.split()
        if sl_parts:
            side = sl_parts[0]
            if len(sl_parts) > 1:
                try:
                    line = float(sl_parts[1])
                except ValueError:
                    line = None
        # normalize representation to match RawLeg expectations
        leg = {
            "source": "fixture",
            "book": "Sample",
            "sport": None,
            "league": None,
            "market": market,
            "participant": participant,
            "side": (side or "").lower(),
            "line": line,
            "odds": float(odds.replace("+", "")) if odds else 0.0,
            "odds_format": "american",
            "ev_pct": None,
            "hit_prob_pct": None,
            "fair_odds": None,
            "url": None,
            "captured_at": None,
        }
        legs.append(leg)
    return legs


def test_extension_flow_on_fixture():
    # load simple HTML fixture that resembles what the content script would capture
    base = os.path.join(os.path.dirname(__file__), "fixtures")
    path = os.path.join(base, "sample1.html")
    with open(path, "r") as f:
        html = f.read()

    legs = parse_table_html_to_legs(html)
    assert legs, "parser should extract at least one leg"

    payload = {"legs": legs, "risk_profile": "growth"}
    r = client.post("/v1/parlays/suggest", json=payload)
    assert r.status_code == 200
    data = r.json()
    # expect parlays returned (although may be zero if algorithm pruning is aggressive)
    assert isinstance(data.get("parlays"), list)
    # and summary should at least include num_parlays key
    assert "summary" in data and "num_parlays" in data["summary"]
