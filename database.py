import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "database.db"


@contextmanager
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db():
    with get_db() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                sender TEXT NOT NULL,
                message TEXT NOT NULL,
                reply_to_id INTEGER,
                classification TEXT NOT NULL CHECK(classification IN ('SAFE', 'CYBERBULLYING')),
                confidence REAL NOT NULL,
                bullying_probability REAL NOT NULL DEFAULT 0.0,
                category TEXT NOT NULL DEFAULT 'General',
                flagged_terms TEXT NOT NULL DEFAULT '[]',
                blocked INTEGER NOT NULL DEFAULT 0 CHECK(blocked IN (0, 1)),
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS alerts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                message_id INTEGER NOT NULL UNIQUE,
                alert_type TEXT NOT NULL DEFAULT 'Cyberbullying',
                status TEXT NOT NULL DEFAULT 'Pending' CHECK(status IN ('Pending', 'Reviewed', 'Dismissed')),
                notes TEXT DEFAULT '',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                reviewed_at TEXT,
                FOREIGN KEY(message_id) REFERENCES messages(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_messages_blocked ON messages(blocked);
            CREATE INDEX IF NOT EXISTS idx_alerts_status ON alerts(status);
            """
        )

        # Ensure column migrations for existing databases
        columns = [row["name"] for row in conn.execute("PRAGMA table_info(messages)").fetchall()]
        if "bullying_probability" not in columns:
            conn.execute("ALTER TABLE messages ADD COLUMN bullying_probability REAL NOT NULL DEFAULT 0.0")
        if "category" not in columns:
            conn.execute("ALTER TABLE messages ADD COLUMN category TEXT NOT NULL DEFAULT 'General'")
        if "flagged_terms" not in columns:
            conn.execute("ALTER TABLE messages ADD COLUMN flagged_terms TEXT NOT NULL DEFAULT '[]'")
        if "reply_to_id" not in columns:
            conn.execute("ALTER TABLE messages ADD COLUMN reply_to_id INTEGER")


def insert_message(
    sender: str,
    message: str,
    classification: str,
    confidence: float,
    blocked: bool,
    bullying_probability: float = 0.0,
    category: str = "General",
    flagged_terms: list = None,
    reply_to_id: int = None,
):
    flagged_json = json.dumps(flagged_terms or [])
    with get_db() as conn:
        cur = conn.execute(
            """
            INSERT INTO messages(sender, message, reply_to_id, classification, confidence, bullying_probability, category, flagged_terms, blocked)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                sender,
                message,
                reply_to_id,
                classification,
                float(confidence),
                float(bullying_probability),
                category,
                flagged_json,
                int(blocked),
            ),
        )
        message_id = cur.lastrowid
        if blocked:
            conn.execute(
                "INSERT INTO alerts(message_id, alert_type, status) VALUES (?, 'Cyberbullying', 'Pending')",
                (message_id,),
            )
        return message_id


def get_visible_messages(limit: int = 100):
    with get_db() as conn:
        rows = conn.execute(
            """
            SELECT m.id, m.sender, m.message, m.reply_to_id,
                   parent.sender AS reply_to_sender,
                   parent.message AS reply_to_message,
                   m.classification, m.confidence, m.bullying_probability,
                   m.category, m.flagged_terms, m.created_at
            FROM messages
            AS m LEFT JOIN messages AS parent ON parent.id = m.reply_to_id
            WHERE m.blocked = 0
            ORDER BY m.id DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()

    results = []
    for r in reversed(rows):
        item = dict(r)
        try:
            item["flagged_terms"] = json.loads(item.get("flagged_terms", "[]"))
        except Exception:
            item["flagged_terms"] = []
        results.append(item)
    return results


def get_message(message_id: int):
    """Return one message in the API shape used by the live chat stream."""
    with get_db() as conn:
        row = conn.execute(
            """
            SELECT m.id, m.sender, m.message, m.reply_to_id,
                   parent.sender AS reply_to_sender,
                   parent.message AS reply_to_message,
                   m.classification, m.confidence, m.bullying_probability,
                   m.category, m.flagged_terms, m.created_at
            FROM messages AS m
            LEFT JOIN messages AS parent ON parent.id = m.reply_to_id
            WHERE m.id = ? AND m.blocked = 0
            """,
            (message_id,),
        ).fetchone()

    if row is None:
        return None

    item = dict(row)
    try:
        item["flagged_terms"] = json.loads(item.get("flagged_terms", "[]"))
    except Exception:
        item["flagged_terms"] = []
    return item


def get_alerts(limit: int = 100, status_filter: str = None):
    query = """
        SELECT
            a.id AS alert_id,
            a.status,
            a.alert_type,
            a.created_at AS alert_created_at,
            a.reviewed_at,
            m.id AS message_id,
            m.sender,
            m.message,
            m.classification,
            m.confidence,
            m.bullying_probability,
            m.category,
            m.flagged_terms,
            m.created_at AS message_created_at
        FROM alerts a
        JOIN messages m ON m.id = a.message_id
    """
    params = []
    if status_filter and status_filter.lower() != "all":
        query += " WHERE a.status = ? "
        params.append(status_filter)

    query += " ORDER BY a.id DESC LIMIT ? "
    params.append(limit)

    with get_db() as conn:
        rows = conn.execute(query, tuple(params)).fetchall()

    results = []
    for r in rows:
        item = dict(r)
        try:
            item["flagged_terms"] = json.loads(item.get("flagged_terms", "[]"))
        except Exception:
            item["flagged_terms"] = []
        results.append(item)
    return results


def mark_alert_reviewed(alert_id: int, status: str = "Reviewed"):
    with get_db() as conn:
        cur = conn.execute(
            """
            UPDATE alerts
            SET status = ?, reviewed_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (status, alert_id),
        )
        return cur.rowcount > 0


def clear_history():
    """Resets all messages and alerts for demo testing."""
    with get_db() as conn:
        conn.execute("DELETE FROM alerts")
        conn.execute("DELETE FROM messages")
        conn.execute("DELETE FROM sqlite_sequence WHERE name IN ('messages', 'alerts')")


def get_stats():
    with get_db() as conn:
        message_stats = conn.execute(
            """
            SELECT
                COUNT(*) AS total_messages,
                SUM(CASE WHEN blocked = 0 THEN 1 ELSE 0 END) AS safe_messages,
                SUM(CASE WHEN blocked = 1 THEN 1 ELSE 0 END) AS flagged_messages,
                AVG(bullying_probability) AS avg_probability
            FROM messages
            """
        ).fetchone()

        alert_stats = conn.execute(
            """
            SELECT
                COUNT(*) AS total_alerts,
                SUM(CASE WHEN status = 'Pending' THEN 1 ELSE 0 END) AS pending_alerts,
                SUM(CASE WHEN status = 'Reviewed' THEN 1 ELSE 0 END) AS reviewed_alerts
            FROM alerts
            """
        ).fetchone()

        # Breakdown by category
        categories = conn.execute(
            """
            SELECT category, COUNT(*) as count
            FROM messages
            WHERE blocked = 1
            GROUP BY category
            ORDER BY count DESC
            """
        ).fetchall()

        # Hourly / recent distribution (last 10 items)
        recent_activity = conn.execute(
            """
            SELECT id, sender, blocked, bullying_probability, created_at
            FROM messages
            ORDER BY id DESC
            LIMIT 15
            """
        ).fetchall()

    total = message_stats["total_messages"] or 0
    flagged = message_stats["flagged_messages"] or 0
    safe = message_stats["safe_messages"] or 0
    rate = (flagged / total * 100.0) if total else 0.0
    safety_index = (safe / total * 100.0) if total else 100.0

    return {
        "total_messages": total,
        "safe_messages": safe,
        "flagged_messages": flagged,
        "detection_rate": round(rate, 1),
        "safety_index": round(safety_index, 1),
        "avg_probability": round((message_stats["avg_probability"] or 0.0) * 100, 1),
        "total_alerts": alert_stats["total_alerts"] or 0,
        "pending_alerts": alert_stats["pending_alerts"] or 0,
        "reviewed_alerts": alert_stats["reviewed_alerts"] or 0,
        "categories": [dict(c) for c in categories],
        "recent_activity": [dict(a) for a in reversed(recent_activity)],
    }
