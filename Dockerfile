FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=/app/src
ENV FLET_FORCE_WEB_SERVER=true
ENV FLET_SERVER_IP=0.0.0.0
ENV FLET_SERVER_PORT=8000

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && pip install --no-cache-dir -r requirements.txt

COPY app_flet.py .
COPY src ./src

EXPOSE 8000

CMD ["python", "app_flet.py"]
