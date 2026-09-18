# Cyberbullying AI Safe Chat - Project Guide

This folder contains the implementation described in `Cyberbullying_Detection_Project_Scope.pdf`.

## Frontend

- `templates/index.html` - Discord-inspired anonymous room screen.
- `templates/admin.html` - administrator monitoring dashboard.
- `static/css/style.css` - responsive visual styling.
- `static/js/chat.js` - anonymous guest identity, live room updates, message submission, replies, and safe-message rendering.
- `static/js/admin.js` - dashboard statistics, alert review, CSV export, and model upload.

## Backend

- `app.py` - Flask routes and model loading.
- `database.py` - SQLite `messages` and `alerts` tables.
- `ml_utils.py` - shared text cleaning and fallback moderation logic.
- `train_model.py` - local training/evaluation script.
- `requirements.txt` - Python dependencies.

The Flask app automatically looks for `model/cyberbullying_pipeline.pkl`, `.joblib`, or the existing `(2).joblib` artifact. A canonical `.pkl` copy is included so the demo can start with the local model already available.

## Shared real-time chat and storage

The app is one shared anonymous chat room. Each open browser tab connects to `/api/events` using Server-Sent Events. When a safe message is committed to SQLite, all connected tabs receive the update immediately. A 15-second refresh remains as a resilience fallback.

Every submitted message is saved in the SQLite `messages` table, including anonymous guest name, text, reply target, classification, model score, blocked status, and timestamp. Blocked messages are not broadcast to the chat, but they remain in the database and create a linked `alerts` row for administrator review. Saving is therefore required for the shared experience and the moderation audit trail; a separate conversation table is not needed while the project has one demo room.

## Google Colab training

Open `colab_model_training.ipynb` in Google Colab, upload the Kaggle file `cyberbullying_tweets.csv`, and run every cell from top to bottom. The notebook:

1. Validates `tweet_text` and `cyberbullying_type` columns.
2. Maps `not_cyberbullying` to `SAFE` and all other labels to `CYBERBULLYING`.
3. Trains TF-IDF with a calibrated, class-balanced LinearSVC.
4. Reports accuracy, precision, recall, F1-score, and a confusion matrix.
5. Downloads `colab_model_bundle.zip` for the Flask admin Model Hub.

## Run the demo on Windows

From PowerShell:

```powershell
cd "$env:USERPROFILE\Desktop\cyberbullying_ai_safe_chat"
Set-ExecutionPolicy -Scope Process Bypass
.\run_flask.ps1
```

Open:

- Chat: `http://127.0.0.1:5000/`
- Admin dashboard: `http://127.0.0.1:5000/admin`

For another person on the same Wi-Fi network, run Flask bound to the computer's network interface, then share the computer's local IPv4 address. In PowerShell:

```powershell
$env:HOST = '0.0.0.0'
.\.venv\Scripts\python.exe app.py
```

The other person can then open `http://YOUR-COMPUTER-IP:5000/`. Only do this on a trusted network; the prototype has no login or authentication.

To train locally instead of Colab:

```powershell
.\.venv\Scripts\python.exe train_model.py --data data\cyberbullying_tweets.csv
```

## Demo messages

- Safe: `Are you coming to class tomorrow?`
- Safe: `Great job on the group project.`
- Flagged: `You are a pathetic idiot, delete your account.`
- Flagged: `Nobody likes you, you worthless loser, go die.`

This is an academic prototype. A real deployment should add human review, authentication, privacy controls, and additional context-aware evaluation.
