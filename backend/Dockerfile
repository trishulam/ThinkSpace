FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PORT=8080

WORKDIR /app

RUN pip install --no-cache-dir uv

COPY pyproject.toml uv.lock README.md ./
COPY app ./app

RUN uv sync --frozen --no-dev

WORKDIR /app/app

EXPOSE 8080

CMD ["sh", "-c", "uv run --project .. uvicorn main:app --host 0.0.0.0 --port ${PORT:-8080}"]
