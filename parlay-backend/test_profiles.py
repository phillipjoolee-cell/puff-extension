from fastapi.testclient import TestClient
from main import app

client = TestClient(app)
legs = [
    {"participant":"A","market":"Points","side":"over","line":10,"odds":-110,"odds_format":"american","hit_prob_pct":50,"book":"DraftKings"},
    {"participant":"B","market":"Moneyline","side":"home","line":None,"odds":120,"odds_format":"american","hit_prob_pct":45,"book":"FanDuel"},
]

for profile in ["stable","growth","high_upside"]:
    payload = {"legs": legs, "risk_profile": profile,
               "settings": {"bankroll": 1000.0, "risk_per_slate": 0.05}}
    r = client.post("/v1/parlays/suggest", json=payload)
    print(profile, r.status_code, len(r.json().get("parlays", [])))
    print(r.json())
