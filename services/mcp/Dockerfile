# Build from the repository root:  docker build -f services/mcp/Dockerfile .
FROM python:3.13-slim
WORKDIR /app
COPY services/mcp/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY services/mcp/app.py .
ENV PYTHONUNBUFFERED=1
EXPOSE 8003
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8003"]
