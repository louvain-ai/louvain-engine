# The BM25 sidecar: a Tantivy index at the document grain, the keyword leg for a collection too large for Postgres
# `ts_rank` to rank a page from (bm25.py). python:3.12-slim and one wheel: no model, no torch, no network at boot.
# The index lives on a volume and is derived from the documents, so losing it costs speed until a reindex, never a row.
FROM python:3.12.16-slim@sha256:5e2bdb1b0d542d5039cffb8181c65930093949194a65c365dfb1b0fe13a4fa5b

WORKDIR /app
ENV PYTHONUNBUFFERED=1

COPY services/keyword-index/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# The server and its modules (`bm25*.py`); the shared bearer check travels with every sidecar (verify-nlp.mjs checks it).
COPY services/keyword-index/bm25*.py services/keyword-index/analyzer.py services/keyword-index/sidecar_auth.py ./

# Not root, like the other sidecars: it reads and writes one directory and
# answers HTTP.
RUN useradd --system --uid 10001 --create-home sidecar \
    && mkdir -p /index && chown -R sidecar:sidecar /app /index
USER sidecar
ENV LOUVAIN_BM25_DIR=/index

EXPOSE 8095
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=10 \
  CMD python -c "import os,urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:'+os.environ.get('PORT','8095')+'/healthz', timeout=2).status==200 else 1)"

CMD ["python", "bm25.py"]
