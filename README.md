# Intelligent AI-Based Cyberbullying Detection and Alert System

A small academic demonstration project using Flask, SQLite, TF-IDF and a calibrated Linear SVM.

The chat is a shared anonymous room. Each browser receives a temporary `Guest-####` name, uses SQLite for durable message history, and connects through Server-Sent Events so many browser tabs/devices can see safe messages appear in real time. Blocked messages are saved as incidents but are never shown in the shared chat.

## Dataset

Use Kaggle **Cyberbullying Classification** by Larxel/andrewmvd:

https://www.kaggle.com/datasets/andrewmvd/cyberbullying-classification

Download `cyberbullying_tweets.csv` and place it here:

```text
data/cyberbullying_tweets.csv
```

Expected columns:

- `tweet_text`
- `cyberbullying_type`

The original dataset contains six classes. This project converts it to a binary target:

- `not_cyberbullying` -> SAFE (0)
- every other cyberbullying type -> CYBERBULLYING (1)

Because merging five positive subtypes creates a larger positive class, the Linear SVM uses `class_weight="balanced"`.

## 1. Create a virtual environment

Windows PowerShell:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
```

macOS/Linux:

```bash
python3 -m venv .venv
source .venv/bin/activate
```

## 2. Install dependencies

```bash
pip install -r requirements.txt
```

## 3. Train the model

For Google Colab, open `colab_model_training.ipynb`, upload the Kaggle file, and run all cells. The notebook downloads `colab_model_bundle.zip`, which can be uploaded from the Admin Monitor's Model Hub.

```bash
python train_model.py
```

This generates:

```text
model/cyberbullying_pipeline.pkl
model/model_metadata.json
reports/classification_report.txt
reports/metrics.json
reports/confusion_matrix.png
```

## 4. Run the web application

On Windows, the included `run_flask.ps1` creates the virtual environment, installs dependencies, and starts Flask:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\run_flask.ps1
```

```bash
python app.py
```

Open:

```text
http://127.0.0.1:5000
```

Admin dashboard:

```text
http://127.0.0.1:5000/admin
```

## Demonstration

1. Open the room in two browser tabs or devices.
2. Each browser receives an anonymous guest name automatically.
3. Send a normal message, e.g. `Are you coming to class tomorrow?`.
4. The backend preprocesses it, transforms it with TF-IDF, and gets a probability from the calibrated Linear SVM.
5. Safe messages are saved and appear in the room in real time.
6. A clearly bullying/abusive message is saved as blocked, hidden from the room, and linked to an administrator alert.
7. Open `/admin` to review the alert.

## Important academic note

This model is a demonstration classifier, not a perfect judge of intent. Dataset bias, slang, quoting, sarcasm, reclaimed language and context can produce false positives or false negatives. For a real-world system, flagged content should be reviewed by a human rather than treated as conclusive evidence.

## Optional threshold adjustment

The default block threshold is 0.50. You can change it before starting Flask.

Windows PowerShell:

```powershell
$env:BLOCK_THRESHOLD="0.65"
python app.py
```

macOS/Linux:

```bash
BLOCK_THRESHOLD=0.65 python app.py
```

Raising the threshold generally blocks fewer messages (higher precision, lower recall); lowering it generally blocks more messages (higher recall, potentially more false positives).

## Free Cloud Deployment (Render)

This repository includes a `Procfile` and `render.yaml` configured with multithreaded Gunicorn for handling real-time Server-Sent Events (SSE).

1. Push your changes to GitHub:
   ```bash
   git add .
   git commit -m "Configure production deployment for Render"
   git push origin main
   ```
2. Go to [render.com](https://render.com) and log in.
3. Click **New +** -> **Web Service** (or **Blueprint**).
4. Connect this repository (`Emmyayeni/cyberbullying_recognition`).
5. Render detects `render.yaml` automatically:
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `gunicorn --worker-class gthread --threads 8 --workers 1 --bind 0.0.0.0:$PORT app:app`
6. Click **Create Web Service**. Your live chat URL will be live in 2-3 minutes.

