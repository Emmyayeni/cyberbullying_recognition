FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=7860 \
    ALLOW_MODEL_UPLOAD=0

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 7860

CMD ["gunicorn", "--worker-class", "gthread", "--threads", "8", "--workers", "1", "--bind", "0.0.0.0:7860", "--timeout", "120", "app:app"]
