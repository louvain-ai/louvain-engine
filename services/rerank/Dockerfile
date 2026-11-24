# The rerank sidecar on a CPU (services/rerank/rerank.py): an open-weights cross-encoder that reads the search and each
# candidate together and scores how well the candidate answers it. CPU torch from PyTorch's own index (the default
# wheel on Linux carries CUDA, gigabytes the CPU never uses), and the weights fetched ONCE at build at a pinned hub
# commit, so a start never waits on the network and a commit, unlike a branch, cannot move under the same name.
FROM python:3.15.1-slim@sha256:533b0b2f9b5d46fd097091cf826f27902f1d6c3bca714b6dc74551356aa97a51

WORKDIR /app
ENV PYTHONUNBUFFERED=1 \
    HF_HOME=/app/.cache/huggingface

COPY services/rerank/requirements.txt ./
RUN pip install --no-cache-dir "$(grep '^torch==' requirements.txt)" --index-url https://download.pytorch.org/whl/cpu \
    && pip install --no-cache-dir -r requirements.txt

# Not root: the process reads a model and answers HTTP. The user comes before the weights, which are fetched as it: a
# `chown -R` after them would copy every weight file into a second layer.
RUN useradd --system --uid 10001 --create-home sidecar && chown sidecar:sidecar /app
USER sidecar

# Which model, as build arguments: the hub id and the 40-character commit it is fetched at. Only the weights and the
# tokenizer are fetched; a model that ships its weights only as a pickle is refused (a pickle runs code when loaded).
ARG RERANK_MODEL=BAAI/bge-reranker-v2-m3
ARG RERANK_MODEL_REVISION=953dc6f6f85a1b2dbfca4c34a2796e7dde08d41e
RUN python - <<'PY'
import os, sys
from huggingface_hub import snapshot_download
model, revision = os.environ["RERANK_MODEL"], os.environ["RERANK_MODEL_REVISION"]
if len(revision) != 40:
    sys.exit("RERANK_MODEL_REVISION must be the 40-character hub commit the model is fetched at")
path = snapshot_download(model, revision=revision,
                         allow_patterns=["*.json", "*.safetensors", "*.txt", "sentencepiece.bpe.model", "*.model"])
if not any(f.endswith(".safetensors") for f in os.listdir(path)):
    sys.exit(f"{model} at {revision} has no safetensors weights")
PY
ENV HF_HUB_OFFLINE=1 \
    LOUVAIN_RERANK_MODEL=${RERANK_MODEL} \
    LOUVAIN_RERANK_MODEL_REVISION=${RERANK_MODEL_REVISION} \
    LOUVAIN_RERANK_DEVICE=cpu

# The shared bearer check travels with every sidecar (verify-nlp.mjs checks it).
COPY services/rerank/rerank.py services/rerank/sidecar_auth.py ./

EXPOSE 8096
HEALTHCHECK --interval=10s --timeout=3s --start-period=60s --retries=10 \
  CMD python -c "import os,urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:'+os.environ.get('PORT','8096')+'/healthz', timeout=2).status==200 else 1)"

CMD ["python", "rerank.py"]
