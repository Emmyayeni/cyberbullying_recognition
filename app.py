import csv
import __main__
import io
import json
import logging
import os
import queue
import secrets
import threading
import zipfile
from pathlib import Path

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

import joblib
from flask import Flask, Response, jsonify, render_template, request
from werkzeug.utils import secure_filename

from database import (
    clear_history,
    get_alerts,
    get_message,
    get_stats,
    get_visible_messages,
    init_db,
    insert_message,
    mark_alert_reviewed,
)
from ml_utils import (
    baseline_heuristic_classify,
    clean_text,
    extract_flagged_terms,
    highlight_flagged_terms,
)

logger = logging.getLogger(__name__)

BASE_DIR = Path(__file__).resolve().parent
MODEL_DIR = BASE_DIR / "model"
MODEL_PATH = MODEL_DIR / "cyberbullying_pipeline.pkl"
MODEL_CANDIDATES = (
    MODEL_PATH,
    MODEL_DIR / "cyberbullying_pipeline.joblib",
    MODEL_DIR / "cyberbullying_pipeline (2).joblib",
)
METADATA_PATH = MODEL_DIR / "model_metadata.json"
BLOCK_THRESHOLD = float(os.getenv("BLOCK_THRESHOLD", "0.77"))
MAX_MESSAGE_LENGTH = 1000
MIN_NAME_LENGTH = 2
MAX_NAME_LENGTH = 30

app = Flask(__name__)
app.secret_key = os.getenv("SECRET_KEY", secrets.token_hex(24))
app.config["JSON_SORT_KEYS"] = False
app.config["MAX_CONTENT_LENGTH"] = 50 * 1024 * 1024  # 50MB for model uploads
app.config["ALLOW_MODEL_UPLOAD"] = os.getenv("ALLOW_MODEL_UPLOAD", "0") == "1"

MODEL_DIR.mkdir(parents=True, exist_ok=True)
init_db()

_model = None
_model_source = "heuristic"
_model_metadata = None
_loaded_model_path = None

# One in-process listener queue per connected browser tab. SQLite remains the
# durable source of truth; this only pushes a low-latency notification to tabs
# that are currently open.
_stream_clients = {}
_stream_clients_lock = threading.Lock()


def broadcast_chat_event(message):
    """Push a safe message to every connected chat browser tab."""
    broadcast_stream_event("message", message)


def broadcast_stream_event(event_name, payload):
    """Push a named event to every connected browser tab."""
    stale_clients = []
    with _stream_clients_lock:
        for client_queue in list(_stream_clients):
            try:
                client_queue.put_nowait((event_name, payload))
            except Exception:
                stale_clients.append(client_queue)
        for client_queue in stale_clients:
            _stream_clients.pop(client_queue, None)


def broadcast_presence():
    with _stream_clients_lock:
        online_count = len(_stream_clients)
        members = sorted(set(name for name in _stream_clients.values() if name))
    broadcast_stream_event("presence", {"online": online_count, "members": members})


def make_guest_name():
    return f"Guest-{secrets.randbelow(9000) + 1000}"


def load_model_pipeline():
    global _model, _model_source, _model_metadata, _loaded_model_path
    model_path = next((candidate for candidate in MODEL_CANDIDATES if candidate.exists()), None)
    if model_path is not None:
        try:
            # The Colab artifact was serialized with the notebook's __main__.clean_text.
            # Register the identical production helper before unpickling it.
            __main__.clean_text = clean_text
            _model = joblib.load(model_path)
            _model_source = "colab_pipeline"
            _loaded_model_path = model_path
            if METADATA_PATH.exists():
                with open(METADATA_PATH, "r", encoding="utf-8") as f:
                    _model_metadata = json.load(f)
            else:
                _model_metadata = {
                    "model": "Colab Scikit-Learn Pipeline",
                    "status": "Loaded",
                }
            logger.info("Loaded ML pipeline from %s", model_path)
            return _model
        except Exception as e:
            logger.exception(
                "Failed to load ML pipeline from %s; falling back to baseline engine",
                model_path,
            )
            _model = None
            _model_source = "heuristic"
            _model_metadata = None
            _loaded_model_path = None
    else:
        _model = None
        _model_source = "heuristic"
        _model_metadata = None
        _loaded_model_path = None
    return None


# Initialize model on startup
load_model_pipeline()


def classify_text(text: str):
    """
    Classifies text using the trained Colab pipeline if available,
    otherwise uses the intelligent baseline heuristic engine.
    """
    global _model, _model_source
    cleaned = clean_text(text)

    # 1. Primary: If trained ML pipeline from Colab is available
    if _model is not None:
        try:
            prob = float(_model.predict_proba([text])[0][1])
            heuristic = baseline_heuristic_classify(text, threshold=BLOCK_THRESHOLD)
            blocked = prob >= BLOCK_THRESHOLD or heuristic["blocked"]
            effective_probability = max(prob, heuristic["bullying_probability"])
            flagged = extract_flagged_terms(text)

            category = "Safe"
            if blocked:
                category = heuristic.get("category", "Cyberbullying / Insult") if heuristic["blocked"] else (
                    "Severe Threat / Harassment" if effective_probability > 0.8 else "Cyberbullying / Insult"
                )

            nudge = (
                "Warning: This message was detected as cyberbullying and will be blocked."
                if blocked
                else "Message appears constructive and safe."
            )

            return {
                "classification": "CYBERBULLYING" if blocked else "SAFE",
                "confidence": round(effective_probability if blocked else (1.0 - effective_probability), 4),
                "bullying_probability": round(effective_probability, 4),
                "blocked": blocked,
                "category": category,
                "flagged_terms": flagged,
                "nudge": nudge,
                "model_engine": "Colab Trained Pipeline (Calibrated LinearSVC)",
            }
        except Exception as e:
            logger.exception("ML pipeline inference failed; falling back to baseline engine")

    # 2. Fallback Heuristic Classifier (operates while training on Colab)
    result = baseline_heuristic_classify(text, threshold=BLOCK_THRESHOLD)
    result["model_engine"] = "Baseline Heuristic Engine (Colab Model Pending)"
    return result


@app.route("/")
def index():
    return render_template(
        "index.html",
        threshold=int(BLOCK_THRESHOLD * 100),
        model_ready=_model is not None,
    )


@app.route("/admin")
def admin():
    return render_template(
        "admin.html",
        threshold=int(BLOCK_THRESHOLD * 100),
        model_ready=_model is not None,
    )


@app.get("/api/health")
def health():
    return jsonify({
        "status": "ok",
        "model_ready": _model is not None,
        "engine": _model_source,
        "block_threshold": BLOCK_THRESHOLD,
    })


@app.get("/api/model/info")
def model_info():
    return jsonify({
        "model_ready": _model is not None,
        "engine": _model_source,
        "block_threshold": BLOCK_THRESHOLD,
        "model_path": str(_loaded_model_path or MODEL_PATH),
        "metadata": _model_metadata or {
            "model": "Baseline Heuristic Engine",
            "description": "Rule-based lexical and sentiment analyzer. Train on Colab to enable ML pipeline.",
            "default_block_threshold": BLOCK_THRESHOLD,
        },
    })


@app.post("/api/model/upload")
def upload_model():
    """Accepts uploaded .pkl model or .zip bundle exported from Colab."""
    if not app.config["ALLOW_MODEL_UPLOAD"]:
        return jsonify({"error": "Runtime model uploads are disabled."}), 403

    if "file" not in request.files:
        return jsonify({"error": "No file uploaded."}), 400

    file = request.files["file"]
    if file.filename == "":
        return jsonify({"error": "No file selected."}), 400

    filename = secure_filename(file.filename)
    MODEL_DIR.mkdir(parents=True, exist_ok=True)

    if filename.endswith(".pkl"):
        dest_path = MODEL_DIR / "cyberbullying_pipeline.pkl"
        file.save(dest_path)
        load_model_pipeline()
        return jsonify({
            "success": True,
            "message": "Trained Colab model uploaded and hot-reloaded successfully!",
            "model_ready": _model is not None,
            "engine": _model_source,
        })

    elif filename.endswith(".json"):
        dest_path = MODEL_DIR / "model_metadata.json"
        file.save(dest_path)
        load_model_pipeline()
        return jsonify({
            "success": True,
            "message": "Model metadata uploaded successfully!",
        })

    elif filename.endswith(".zip"):
        # Unzip bundle containing model and metadata
        zip_buffer = io.BytesIO(file.read())
        try:
            with zipfile.ZipFile(zip_buffer, "r") as z:
                for member in z.namelist():
                    basename = os.path.basename(member)
                    if basename in ("cyberbullying_pipeline.pkl", "model_metadata.json"):
                        target = MODEL_DIR / basename
                        with z.open(member) as src, open(target, "wb") as dst:
                            dst.write(src.read())
            load_model_pipeline()
            return jsonify({
                "success": True,
                "message": "Colab bundle extracted and model hot-reloaded successfully!",
                "model_ready": _model is not None,
                "engine": _model_source,
            })
        except Exception as exc:
            return jsonify({"error": f"Failed to extract zip bundle: {str(exc)}"}), 400

    return jsonify({"error": "Invalid file format. Upload .pkl, .json, or .zip archive."}), 400


@app.post("/api/analyze-live")
def analyze_live():
    """Real-time typing feedback endpoint for safety meter."""
    payload = request.get_json(silent=True) or {}
    text = str(payload.get("message", "")).strip()

    if not text:
        return jsonify({
            "bullying_probability": 0.0,
            "blocked": False,
            "category": "Safe",
            "risk_level": "Safe",
            "nudge": "Type a message to begin...",
            "flagged_terms": [],
        })

    result = classify_text(text)
    return jsonify({
        "bullying_probability": result["bullying_probability"],
        "blocked": result["blocked"],
        "category": result.get("category", "General"),
        "risk_level": "High Risk" if result["blocked"] else ("Mild Risk" if result["bullying_probability"] > 0.25 else "Safe"),
        "nudge": result.get("nudge", ""),
        "flagged_terms": result.get("flagged_terms", []),
        "highlighted": highlight_flagged_terms(text),
    })


@app.get("/api/messages")
def messages():
    return jsonify(get_visible_messages(limit=100))


@app.get("/api/events")
def chat_events():
    """Stream safe chat updates to all open browser tabs using SSE."""
    client_queue = queue.Queue()
    requested_name = str(request.args.get("name", "")).strip()
    guest_name = requested_name if MIN_NAME_LENGTH <= len(requested_name) <= MAX_NAME_LENGTH else "Anonymous guest"

    with _stream_clients_lock:
        _stream_clients[client_queue] = guest_name
    broadcast_presence()

    def event_stream():
        try:
            with _stream_clients_lock:
                online_count = len(_stream_clients)
                members = sorted(set(name for name in _stream_clients.values() if name))
            yield f"event: ready\ndata: {json.dumps({'online': online_count, 'members': members})}\n\n"
            while True:
                try:
                    event_name, event = client_queue.get(timeout=20)
                    yield f"event: {event_name}\ndata: {json.dumps(event)}\n\n"
                except queue.Empty:
                    # Keep proxies and browsers from closing an idle stream.
                    yield ": keep-alive\n\n"
        except GeneratorExit:
            pass
        finally:
            with _stream_clients_lock:
                _stream_clients.pop(client_queue, None)
            broadcast_presence()

    return Response(
        event_stream(),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/api/send")
def send_message():
    payload = request.get_json(silent=True) or {}
    sender = str(payload.get("sender", "")).strip()
    message = str(payload.get("message", "")).strip()
    reply_to_id = payload.get("reply_to_id")

    if not sender:
        sender = make_guest_name()

    if len(sender) < MIN_NAME_LENGTH or len(sender) > MAX_NAME_LENGTH:
        return jsonify({"error": f"Display name must be {MIN_NAME_LENGTH}-{MAX_NAME_LENGTH} characters."}), 400
    if any(ord(char) < 32 for char in sender):
        return jsonify({"error": "Display name contains an invalid character."}), 400
    try:
        reply_to_id = int(reply_to_id) if reply_to_id is not None else None
    except (TypeError, ValueError):
        reply_to_id = None
    if reply_to_id is not None and get_message(reply_to_id) is None:
        reply_to_id = None
    if not message:
        return jsonify({"error": "Message cannot be empty."}), 400
    if len(message) > MAX_MESSAGE_LENGTH:
        return jsonify({"error": f"Message must be {MAX_MESSAGE_LENGTH} characters or fewer."}), 400

    result = classify_text(message)

    message_id = insert_message(
        sender=sender,
        message=message,
        classification=result["classification"],
        confidence=result["confidence"],
        blocked=result["blocked"],
        bullying_probability=result["bullying_probability"],
        category=result.get("category", "General"),
        flagged_terms=result.get("flagged_terms", []),
        reply_to_id=reply_to_id,
    )

    saved_message = None
    if not result["blocked"]:
        saved_message = get_message(message_id)
        if saved_message is not None:
            broadcast_chat_event(saved_message)

    return jsonify({
        "message_id": message_id,
        "message": saved_message,
        "sender": sender,
        "reply_to_id": reply_to_id,
        "blocked": result["blocked"],
        "classification": result["classification"],
        "confidence": result["confidence"],
        "bullying_probability": result["bullying_probability"],
        "category": result.get("category", "General"),
        "flagged_terms": result.get("flagged_terms", []),
        "model_engine": result.get("model_engine", _model_source),
        "notice": (
            "Potential cyberbullying detected. Message blocked and administrator alerted."
            if result["blocked"]
            else "Message verified safe and delivered."
        ),
    })


@app.get("/api/admin/stats")
def admin_stats():
    return jsonify(get_stats())


@app.get("/api/admin/alerts")
def admin_alerts():
    status_filter = request.args.get("status", "all")
    return jsonify(get_alerts(limit=100, status_filter=status_filter))


@app.post("/api/admin/alerts/<int:alert_id>/review")
def review_alert(alert_id):
    payload = request.get_json(silent=True) or {}
    action = payload.get("action", "Reviewed")
    status = "Dismissed" if action.lower() == "dismiss" else "Reviewed"

    updated = mark_alert_reviewed(alert_id, status=status)
    if not updated:
        return jsonify({"error": "Alert not found."}), 404
    return jsonify({"success": True, "alert_id": alert_id, "status": status})


@app.post("/api/admin/clear")
def admin_clear():
    """Resets message history and alerts for demonstrations."""
    clear_history()
    return jsonify({"success": True, "message": "Demo data cleared successfully."})


@app.get("/api/admin/export")
def export_csv():
    """Exports all moderation incidents as a CSV report."""
    alerts = get_alerts(limit=500)
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "Alert ID",
        "Status",
        "Sender",
        "Message",
        "Bullying Probability (%)",
        "Classification",
        "Category",
        "Flagged Words",
        "Created At",
        "Reviewed At",
    ])

    for a in alerts:
        writer.writerow([
            a["alert_id"],
            a["status"],
            a["sender"],
            a["message"],
            int((a.get("bullying_probability") or 0.0) * 100),
            a["classification"],
            a.get("category", "General"),
            ", ".join(a.get("flagged_terms", [])),
            a["alert_created_at"],
            a.get("reviewed_at", ""),
        ])

    response = Response(output.getvalue(), mimetype="text/csv")
    response.headers["Content-Disposition"] = "attachment; filename=cyberbullying_moderation_report.csv"
    return response


if __name__ == "__main__":
    app.run(
        host=os.getenv("HOST", "0.0.0.0"),
        port=int(os.getenv("PORT", "7860")),
        debug=os.getenv("FLASK_DEBUG", "0") == "1",
    )
