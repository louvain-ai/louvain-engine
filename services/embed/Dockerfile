# syntax=docker/dockerfile:1.7
# The embedding sidecar: the interactive and bulk lanes are this one image run twice. ONNX only, on
# python:3.12-slim, so a CPU image carries no GPU build of torch.
#
# The weights are baked in and the network is closed at run time (`HF_HUB_OFFLINE=1`): a host with no egress
# starts like any other, and a missing weight fails the build, where it is cheap to find.
FROM python:3.12-slim@sha256:5e2bdb1b0d542d5039cffb8181c65930093949194a65c365dfb1b0fe13a4fa5b

WORKDIR /app
ENV PYTHONUNBUFFERED=1 \
    HF_HOME=/app/.cache/huggingface

COPY services/embed/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Which model, as build arguments. The default is the ONNX export every stored vector was made with (see embed.py).
# A model not on a public hub is an archive of its ONNX export, fetched once from `EMBEDDING_MODEL_ARCHIVE` and refused
# unless its sha256 matches. A private store's credential is a build secret, never an argument, since an argument is
# written into the image's history. The label, pooling, width and cut are set with the model, never inferred.

# The default model and the hub commit it is fetched at, read again at run time: a branch moves under the same name, a
# commit does not. The commit is the default model's alone: a build that names another hub model names its commit too.
ARG DEFAULT_EMBEDDING_MODEL=Xenova/bge-base-en-v1.5
ARG DEFAULT_EMBEDDING_MODEL_REVISION=4d6cd88e18e51a5e020c2c305726d76ada9c03cf
ARG EMBEDDING_MODEL=${DEFAULT_EMBEDDING_MODEL}
ARG EMBEDDING_MODEL_REVISION=${DEFAULT_EMBEDDING_MODEL_REVISION}
ARG EMBEDDING_MODEL_ARCHIVE=
ARG EMBEDDING_MODEL_SHA256=
ARG EMBEDDING_MODEL_DIR=
ARG EMBEDDING_POOLING=mean
ARG EMBEDDING_DIM=768
ARG EMBEDDING_MATRYOSHKA=false
RUN --mount=type=secret,id=model_archive_auth,required=false \
    --mount=type=secret,id=model_archive_url,required=false python - <<'PY'
import hashlib, os, sys, tarfile, urllib.request
archive, digest, target = (os.environ.get(k, "") for k in ("EMBEDDING_MODEL_ARCHIVE", "EMBEDDING_MODEL_SHA256", "EMBEDDING_MODEL_DIR"))
# A presigned URL carries its signature in the URL itself, so it may arrive as a SECRET instead of the argument: an
# argument is written into the image's history, a secret is not.
if os.path.exists("/run/secrets/model_archive_url"):
    archive = open("/run/secrets/model_archive_url").read().strip()
if not archive and digest:
    # A pinned digest with no archive is a build that lost its secret: never fall back to the hub under that label.
    sys.exit("EMBEDDING_MODEL_SHA256 is set but no archive was given (EMBEDDING_MODEL_ARCHIVE or the model_archive_url secret)")
if not archive:
    from huggingface_hub import hf_hub_download as d
    model, revision = os.environ["EMBEDDING_MODEL"], os.environ.get("EMBEDDING_MODEL_REVISION", "")
    if model != os.environ["DEFAULT_EMBEDDING_MODEL"] and revision == os.environ["DEFAULT_EMBEDDING_MODEL_REVISION"]:
        sys.exit(f"EMBEDDING_MODEL is {model}: name its hub commit too (EMBEDDING_MODEL_REVISION, 40 characters)")
    if len(revision) != 40:
        sys.exit("EMBEDDING_MODEL_REVISION must be the 40-character hub commit the model is fetched at")
    d(model, "tokenizer.json", revision=revision); d(model, "onnx/model.onnx", revision=revision)
    sys.exit(0)
if not archive.startswith("https://") or len(digest) != 64 or not target:
    sys.exit("EMBEDDING_MODEL_ARCHIVE needs https, EMBEDDING_MODEL_SHA256 (64 hex) and EMBEDDING_MODEL_DIR")
headers = {}
if os.path.exists("/run/secrets/model_archive_auth"):
    headers["Authorization"] = open("/run/secrets/model_archive_auth").read().strip()
h = hashlib.sha256()
with urllib.request.urlopen(urllib.request.Request(archive, headers=headers)) as r, open("/tmp/model.tar", "wb") as f:
    for chunk in iter(lambda: r.read(1 << 20), b""):
        h.update(chunk); f.write(chunk)
if h.hexdigest() != digest.lower():
    sys.exit(f"model archive sha256 {h.hexdigest()} is not EMBEDDING_MODEL_SHA256")
os.makedirs(target, exist_ok=True)
with tarfile.open("/tmp/model.tar") as t:
    t.extractall(target, filter="data")
os.remove("/tmp/model.tar")
PY
ENV HF_HUB_OFFLINE=1 \
    LOUVAIN_EMBEDDING_MODEL=${EMBEDDING_MODEL} \
    LOUVAIN_EMBEDDING_MODEL_REVISION=${EMBEDDING_MODEL_REVISION} \
    LOUVAIN_EMBEDDING_MODEL_DIR=${EMBEDDING_MODEL_DIR} \
    LOUVAIN_EMBEDDING_POOLING=${EMBEDDING_POOLING} \
    LOUVAIN_EMBEDDING_DIM=${EMBEDDING_DIM} \
    LOUVAIN_EMBEDDING_MATRYOSHKA=${EMBEDDING_MATRYOSHKA} \
    LOUVAIN_EMBEDDING_MODEL_SHA256=${EMBEDDING_MODEL_SHA256}

# The shared bearer check travels with every sidecar (verify-nlp.mjs checks it).
COPY services/embed/embed.py services/embed/sidecar_auth.py ./

# Not root: the process reads a model and answers HTTP, and needs nothing more than a system user has.
RUN useradd --system --uid 10001 --create-home sidecar \
    && chown -R sidecar:sidecar /app
USER sidecar

EXPOSE 8090
# Never gated on load: a saturated sidecar says busy on /embed and stays healthy here, since restarting one that is
# doing its job turns a backlog into an outage. start-period covers loading the weights from disk.
HEALTHCHECK --interval=10s --timeout=3s --start-period=60s --retries=10 \
  CMD python -c "import os,urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:'+os.environ.get('PORT','8090')+'/healthz', timeout=2).status==200 else 1)"

CMD ["python", "embed.py"]
