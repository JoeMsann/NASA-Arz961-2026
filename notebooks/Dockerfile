# Jupyter + scikit-learn + CPU PyTorch for notebooks/train_models.ipynb.  The repo is mounted at /repo by docker compose.
FROM python:3.13-slim
COPY notebooks/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt \
 && pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu
WORKDIR /repo
EXPOSE 8888
CMD ["jupyter", "lab", "--ip=0.0.0.0", "--port=8888", "--no-browser", "--allow-root", "--IdentityProvider.token=", "--ServerApp.root_dir=/repo"]
