FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ .
RUN mkdir -p /app/ops/target-agent
COPY ops/target-agent/deploy_agent.py /app/ops/target-agent/deploy_agent.py
RUN chmod +x /app/entrypoint.sh

EXPOSE 8000

ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["gunicorn", "controlpanel.wsgi:application", "--bind", "0.0.0.0:8000", "--workers", "2", "--threads", "8", "--timeout", "0", "--access-logfile", "-", "--error-logfile", "-"]
