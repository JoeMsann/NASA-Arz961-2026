# Build from the repository root:  docker build -f services/ml/Dockerfile .
FROM python:3.13-slim
WORKDIR /app
COPY services/ml/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY services/ml/app.py .
COPY data/build/ /data/build/
COPY data/environments.json /data/environments.json
ENV DATA_DIR=/data/build ENV_FILE=/data/environments.json PYTHONUNBUFFERED=1
EXPOSE 8001
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8001"]
