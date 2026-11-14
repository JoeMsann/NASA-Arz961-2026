# Build from the repository root:  docker build -f services/agent/Dockerfile .
FROM python:3.13-slim
WORKDIR /app
COPY services/agent/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY services/agent/*.py ./
COPY data/build/unified.db /data/build/unified.db
ENV DATA_DIR=/data/build PYTHONUNBUFFERED=1
EXPOSE 8002
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8002"]
