from __future__ import annotations

import json
import logging
from datetime import timezone as datetime_timezone
from typing import Any

from django.db import IntegrityError, close_old_connections, transaction
from django.db.utils import OperationalError
from django.http import StreamingHttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from rest_framework import status
from rest_framework.renderers import BaseRenderer, JSONRenderer
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import DeploymentJob, ScriptDefinition
from .serializers import (
    DeploymentJobSerializer,
    ScriptDefinitionSerializer,
    StartDeploymentSerializer,
)
from .services.ssh_client import SSHClientError, SSHClientService

logger = logging.getLogger(__name__)

ACTIVE_STATUSES = [
    DeploymentJob.Status.QUEUED,
    DeploymentJob.Status.RUNNING,
]
VALID_REMOTE_STATUSES = {choice.value for choice in DeploymentJob.Status}


class ServerSentEventRenderer(BaseRenderer):
    media_type = "text/event-stream"
    format = "event-stream"
    charset = "utf-8"

    def render(self, data, accepted_media_type=None, renderer_context=None):
        if data is None:
            return ""
        payload = data if isinstance(data, dict) else {"detail": str(data)}
        return sse_message(payload, event="error")


class ScriptsListView(APIView):
    def get(self, request):
        scripts = ScriptDefinition.objects.filter(enabled=True).order_by("label")
        return Response(ScriptDefinitionSerializer(scripts, many=True).data)


class JobsListView(APIView):
    def get(self, request):
        jobs = DeploymentJob.objects.select_related("script", "started_by")[:50]
        return Response(DeploymentJobSerializer(jobs, many=True).data)


class JobDetailView(APIView):
    def get(self, request, id):
        job = get_object_or_404(
            DeploymentJob.objects.select_related("script", "started_by"),
            id=id,
        )
        return Response(DeploymentJobSerializer(job).data)


class JobStartView(APIView):
    def post(self, request):
        serializer = StartDeploymentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        script_slug = serializer.validated_data["script_slug"]

        try:
            with transaction.atomic():
                script = ScriptDefinition.objects.select_for_update().get(
                    slug=script_slug,
                    enabled=True,
                )
                if DeploymentJob.objects.filter(
                    script=script,
                    status__in=ACTIVE_STATUSES,
                ).exists():
                    return Response(
                        {"detail": "This script already has a queued or running job."},
                        status=status.HTTP_409_CONFLICT,
                    )

                remote_payload = SSHClientService().start_deploy_job(script.remote_key)
                job = DeploymentJob.objects.create(
                    script=script,
                    remote_job_id=required_remote_field(remote_payload, "job_id"),
                    remote_log_file=required_remote_field(remote_payload, "log_file"),
                    remote_pid_file=remote_payload.get("pid_file", ""),
                    remote_status_file=remote_payload.get("status_file", ""),
                    status=DeploymentJob.Status.RUNNING,
                    started_by=request.user,
                    started_at=timezone.now(),
                )
        except ScriptDefinition.DoesNotExist:
            return Response(
                {"detail": "Script is not enabled or does not exist."},
                status=status.HTTP_404_NOT_FOUND,
            )
        except IntegrityError:
            return Response(
                {"detail": "This script already has a queued or running job."},
                status=status.HTTP_409_CONFLICT,
            )
        except SSHClientError as exc:
            logger.warning("Remote deploy start failed", exc_info=True)
            return Response(
                {"detail": str(exc)},
                status=status.HTTP_502_BAD_GATEWAY,
            )

        return Response(DeploymentJobSerializer(job).data, status=status.HTTP_201_CREATED)


class JobRefreshStatusView(APIView):
    def post(self, request, id):
        job = get_object_or_404(
            DeploymentJob.objects.select_related("script", "started_by"),
            id=id,
        )
        try:
            remote_payload = SSHClientService().get_remote_job_status(job.remote_job_id)
        except SSHClientError as exc:
            logger.warning("Remote status refresh failed", exc_info=True)
            return Response({"detail": str(exc)}, status=status.HTTP_502_BAD_GATEWAY)

        update_job_from_remote_status(job, remote_payload)
        return Response(DeploymentJobSerializer(job).data)


class JobStopView(APIView):
    def post(self, request, id):
        job = get_object_or_404(
            DeploymentJob.objects.select_related("script", "started_by"),
            id=id,
        )
        if job.status not in ACTIVE_STATUSES:
            return Response(DeploymentJobSerializer(job).data)

        try:
            remote_payload = SSHClientService().stop_remote_job(job.remote_job_id)
        except SSHClientError as exc:
            logger.warning("Remote stop failed", exc_info=True)
            return Response({"detail": str(exc)}, status=status.HTTP_502_BAD_GATEWAY)

        if remote_payload.get("stopped") is True:
            job.status = DeploymentJob.Status.STOPPED
            job.finished_at = timezone.now()
            job.save(update_fields=["status", "finished_at", "updated_at"])
        return Response(DeploymentJobSerializer(job).data)


class JobLogsStreamView(APIView):
    renderer_classes = [JSONRenderer, ServerSentEventRenderer]

    def get(self, request, id):
        job = get_object_or_404(
            DeploymentJob.objects.select_related("script", "started_by"),
            id=id,
        )
        if not job.remote_log_file:
            return Response(
                {"detail": "Job does not have a remote log file."},
                status=status.HTTP_409_CONFLICT,
            )

        response = StreamingHttpResponse(
            stream_sse_events(job.id),
            content_type="text/event-stream",
        )
        response["Cache-Control"] = "no-cache"
        response["X-Accel-Buffering"] = "no"
        return response


def stream_sse_events(job_id):
    yield ": connected\n\n"
    try:
        close_old_connections()
        job = DeploymentJob.objects.get(id=job_id)
        service = SSHClientService()
        for event in service.stream_remote_log_file(job.remote_log_file, job.remote_job_id):
            if event["event"] == "line":
                yield sse_message(
                    {
                        "line": event["line"],
                        "timestamp": timezone.now().isoformat(),
                    }
                )
            elif event["event"] == "status":
                close_old_connections()
                job = DeploymentJob.objects.get(id=job_id)
                update_job_from_remote_status(job, event["payload"])
                yield sse_message(
                    {
                        "status": job.status,
                        "exit_code": job.exit_code,
                    },
                    event="status",
                )
                break
    except (DeploymentJob.DoesNotExist, OperationalError, SSHClientError) as exc:
        logger.warning("SSE stream failed", exc_info=True)
        yield sse_message({"detail": str(exc)}, event="error")


def sse_message(payload: dict[str, Any], event: str | None = None) -> str:
    prefix = f"event: {event}\n" if event else ""
    return f"{prefix}data: {json.dumps(payload, ensure_ascii=False)}\n\n"


def required_remote_field(payload: dict[str, Any], field: str) -> str:
    value = payload.get(field)
    if not isinstance(value, str) or not value:
        raise SSHClientError(f"Remote response is missing {field}")
    return value


def update_job_from_remote_status(job: DeploymentJob, payload: dict[str, Any]) -> None:
    remote_status = payload.get("status", DeploymentJob.Status.UNKNOWN)
    if remote_status not in VALID_REMOTE_STATUSES:
        remote_status = DeploymentJob.Status.UNKNOWN

    job.status = remote_status
    job.exit_code = payload.get("exit_code")
    if payload.get("log_file"):
        job.remote_log_file = payload["log_file"]
    finished_at = parse_remote_datetime(payload.get("finished_at"))
    if finished_at:
        job.finished_at = finished_at
    elif remote_status in {
        DeploymentJob.Status.SUCCESS,
        DeploymentJob.Status.FAILED,
        DeploymentJob.Status.STOPPED,
        DeploymentJob.Status.UNKNOWN,
    }:
        job.finished_at = job.finished_at or timezone.now()
    job.save()


def parse_remote_datetime(value: Any):
    if not isinstance(value, str) or not value:
        return None
    parsed = parse_datetime(value)
    if parsed is None:
        return None
    if timezone.is_naive(parsed):
        return timezone.make_aware(parsed, datetime_timezone.utc)
    return parsed
