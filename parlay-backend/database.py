import sqlite3

CREATE_BETS_TABLE = """
CREATE TABLE IF NOT EXISTS bets(
    id TEXT PRIMARY KEY, 
    sportsbook TEXT,
    payout REAL,
    hit_rate REAL,
    ev REAL,
    leg_count INTEGER,
    legs_json TEXT,
    kelly_suggest REAL,
    actual_payout REAL,
    place_time TEXT,
    status TEXT,
    -- "2026-04-06T18:30:00"
    settle_time TEXT,
    profit_loss REAL
);
"""


def get_connection():
    conn = sqlite3.connect("puff_bets.db")
    return conn

def init_db():
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(CREATE_BETS_TABLE)
    conn.commit()
    conn.close()

def insert_test_bet():
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
       INSERT or REPLACE INTO bets (id, sportsbook, payout, hit_rate, ev, leg_count, kelly_suggest, place_time,
            status, settle_time, profit_loss, legs_json
        )
        VALUES ("one", "22bet", 70.12, 24.13, 12.31, 3, 0.01, "2026-04-06T18:30:00",  "pending", "2026-04-06T18:30:00", 
            -5.00, '[{"participant": "Dallas Stars", "market": "Puck Line", "odds": -117}]'
        )
    """)
    conn.commit()
    conn.close()
    print("Bet inserted!")

def insert_bet(bet_id=None, sportsbook=None, stake=None, hit_rate=None, ev=None, 
               payout=None, leg_count=None, legs_json=None, kelly_suggest=None, place_time=None, status = "pending"):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        INSERT OR REPLACE INTO bets(id, sportsbook, stake, hit_rate, ev, payout, leg_count, legs_json, kelly_suggest, place_time, status)
        VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (bet_id, sportsbook, stake, hit_rate, ev, payout, leg_count, legs_json, kelly_suggest, place_time, status))
    conn.commit()
    conn.close()

def get_bets_by_book(sportsbook):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT * FROM bets WHERE sportsbook = ?
    """, (sportsbook,))
    rows = cursor.fetchall()
    conn.close()
    return rows

def update_bets_column(status, actual_payout, settle_time, profit_loss, bet_id):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(""" 
        UPDATE bets SET status = ?, actual_payout = ?, settle_time = ?,
        profit_loss = ?
        WHERE id = ?""", (status, actual_payout, settle_time, profit_loss, bet_id))
    conn.commit()
    conn.close()   

if __name__ == "__main__":
    init_db()
    insert_test_bet()
    update_bets_column("won", 350.00, "2026-04-07T17:41:00", 280.00, "one")
    add_stake_column()
    results = get_bets_by_book("22bet")
    print(results) 
