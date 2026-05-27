import sqlite3
import os
from datetime import datetime

DB_PATH = os.path.join(os.path.dirname(__file__), '..', 'data.db')

def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn

def insert_price_history(conn, competitor_id: int, price: int, occupancy_rate: float = 0.6):
    conn.execute(
        'INSERT INTO price_history (competitor_id, price, occupancy_rate) VALUES (?,?,?)',
        (competitor_id, price, occupancy_rate)
    )

def update_competitor_price(conn, competitor_id: int, current_price: int, previous_price: int, occupancy_rate: float = 0.6):
    conn.execute(
        'UPDATE competitors SET current_price=?, previous_price=?, occupancy_rate=?, last_crawled_at=? WHERE id=?',
        (current_price, previous_price, occupancy_rate, datetime.now().isoformat(), competitor_id)
    )

def get_all_competitors(conn):
    return conn.execute('SELECT * FROM competitors ORDER BY id').fetchall()

def get_competitor_by_id(conn, competitor_id: int):
    return conn.execute('SELECT * FROM competitors WHERE id=?', (competitor_id,)).fetchone()

def get_competitors_for_refresh(conn):
    return conn.execute(
        "SELECT * FROM competitors WHERE source='tujia' AND unit_id IS NOT NULL ORDER BY last_crawled_at ASC"
    ).fetchall()

def create_crawl_task(conn, platform: str, city: str = None, status: str = 'pending') -> int:
    cur = conn.execute(
        'INSERT INTO crawl_tasks (platform, city, status) VALUES (?,?,?)',
        (platform, city, status)
    )
    return cur.lastrowid

def update_crawl_task(conn, task_id: int, status: str, result: str = None):
    conn.execute(
        "UPDATE crawl_tasks SET status=?, result=?, finished_at=datetime('now','localtime') WHERE id=?",
        (status, result, task_id)
    )

def clean_old_history(conn):
    conn.execute("DELETE FROM price_history WHERE recorded_at < datetime('now','-30 days')")
