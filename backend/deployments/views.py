from __future__ import annotations

import json
import logging
import time
from typing import Any

from django.db import IntegrityError, close_old_connections, transaction
from django.db.models import Max
from django.db.utils import OperationalError
from django.http import StreamingHttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.renderers import BaseRenderer, JSONRenderer
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import DeploymentJob, DeploymentJobLogLine, ScriptDefinition, TargetServer
from .serializers import (
    DeploymentJobSerializer,
    ScriptDefinitionSerializer,
    StartDeploymentSerializer,
    TargetServerSerializer,
    UserProfileSerializer,
)

logger = logging.getLogger(__name__)

ACTIVE_STATUSES = [
    DeploymentJob.Status.QUEUED,
    DeploymentJob.Status.RUNNING,
]
TERMINAL_STATUSES = {
    DeploymentJob.Status.SUCCESS,
    DeploymentJob.Status.FAILED,
    DeploymentJob.Status.UNKNOWN,
    DeploymentJob.Status.STOPPED,
}
VALID_AGENT_STATUSES = {choice.value for choice in DeploymentJob.Status}


def staff_required(request):
    if request.user.is_staff:
        return None
    return Response(
        {"detail": "Admin permission is required."},
        status=status.HTTP_403_FORBIDDEN,
    )


def authenticate_agent(request):
    authorization = request.headers.get("Authorization", "")
    prefix = "Bearer "
    if not authorization.startswith(prefix):
        return None, Response(
            {"detail": "Agent token is required."},
            status=status.HTTP_401_UNAUTHORIZED,
        )

    token = authorization[len(prefix) :].strip()
    if not token:
        return None, Response(
            {"detail": "Agent token is required."},
            status=status.HTTP_401_UNAUTHORIZED,
        )

    candidates = TargetServer.objects.filter(
        agent_token_prefix=TargetServer.token_prefix(token),
        enabled=True,
    )
    for target in candidates:
        if target.check_agent_token(token):
            return target, None

    return None, Response(
        {"detail": "Invalid agent token."},
        status=status.HTTP_401_UNAUTHORIZED,
    )


def touch_agent(target: TargetServer, request) -> None:
    agent_version = request.data.get("agent_version", "")
    target.last_seen_at = timezone.now()
    if isinstance(agent_version, str):
        target.agent_version = agent_version[:80]
    target.save(update_fields=["last_seen_at", "agent_version", "updated_at"])


class ServerSentEventRenderer(BaseRenderer):
    media_type = "text/event-stream"
    format = "event-stream"
    charset = "utf-8"

    def render(self, data, accepted_media_type=None, renderer_context=None):
        if data is None:
            return ""
        payload = data if isinstance(data, dict) else {"detail": str(data)}
        return sse_message(payload, event="error")


class UserProfileView(APIView):
    def get(self, request):
        return Response(
            UserProfileSerializer(
                {
                    "username": request.user.username,
                    "is_staff": request.user.is_staff,
                }
            ).data
        )


class TargetServersListView(APIView):
    def get(self, request):
        forbidden = staff_required(request)
        if forbidden is not None:
            return forbidden
        targets = TargetServer.objects.all()
        return Response(TargetServerSerializer(targets, many=True).data)

    def post(self, request):
        forbidden = staff_required(request)
        if forbidden is not None:
            return forbidden

        token = TargetServer.generate_agent_token()
        serializer = TargetServerSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        target = serializer.save(
            agent_token_hash=TargetServer.hash_agent_token(token),
            agent_token_prefix=TargetServer.token_prefix(token),
        )
        payload = dict(TargetServerSerializer(target).data)
        payload["agent_token"] = token
        return Response(payload, status=status.HTTP_201_CREATED)


class TargetServerDetailView(APIView):
    def get(self, request, id):
        forbidden = staff_required(request)
        if forbidden is not None:
            return forbidden
        target = get_object_or_404(TargetServer, id=id)
        return Response(TargetServerSerializer(target).data)

    def patch(self, request, id):
        forbidden = staff_required(request)
        if forbidden is not None:
            return forbidden
        target = get_object_or_404(TargetServer, id=id)
        serializer = TargetServerSerializer(target, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        target = serializer.save()
        return Response(TargetServerSerializer(target).data)

    def delete(self, request, id):
        forbidden = staff_required(request)
        if forbidden is not None:
            return forbidden
        target = get_object_or_404(TargetServer, id=id)
        target.enabled = False
        target.save(update_fields=["enabled", "updated_at"])
        return Response(TargetServerSerializer(target).data)


class TargetServerTestConnectionView(APIView):
    def post(self, request, id):
        forbidden = staff_required(request)
        if forbidden is not None:
            return forbidden
        target = get_object_or_404(TargetServer, id=id)
        if target.last_seen_at is None:
            return Response(
                {"detail": "Agent has not checked in yet."},
                status=status.HTTP_409_CONFLICT,
            )
        return Response(
            {
                "detail": f"Agent last checked in at {target.last_seen_at.isoformat()}."
            }
        )


class ScriptsListView(APIView):
    def get(self, request):
        scripts = ScriptDefinition.objects.select_related("target_server").order_by(
            "target_server__name",
            "label",
        )
        include_disabled = request.query_params.get("include_disabled") == "true"
        if not request.user.is_staff or not include_disabled:
            scripts = scripts.filter(enabled=True, target_server__enabled=True)
        return Response(ScriptDefinitionSerializer(scripts, many=True).data)

    def post(self, request):
        forbidden = staff_required(request)
        if forbidden is not None:
            return forbidden
        serializer = ScriptDefinitionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        script = serializer.save()
        return Response(
            ScriptDefinitionSerializer(script).data,
            status=status.HTTP_201_CREATED,
        )


class ScriptDefinitionDetailView(APIView):
    def get(self, request, id):
        forbidden = staff_required(request)
        if forbidden is not None:
            return forbidden
        script = get_object_or_404(
            ScriptDefinition.objects.select_related("target_server"),
            id=id,
        )
        return Response(ScriptDefinitionSerializer(script).data)

    def patch(self, request, id):
        forbidden = staff_required(request)
        if forbidden is not None:
            return forbidden
        script = get_object_or_404(
            ScriptDefinition.objects.select_related("target_server"),
            id=id,
        )
        serializer = ScriptDefinitionSerializer(script, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        script = serializer.save()
        return Response(ScriptDefinitionSerializer(script).data)

    def delete(self, request, id):
        forbidden = staff_required(request)
        if forbidden is not None:
            return forbidden
        script = get_object_or_404(ScriptDefinition, id=id)
        script.enabled = False
        script.save(update_fields=["enabled", "updated_at"])
        return Response(ScriptDefinitionSerializer(script).data)


class JobsListView(APIView):
    def get(self, request):
        jobs = DeploymentJob.objects.select_related(
            "script",
            "script__target_server",
            "target_server",
            "started_by",
        )[:50]
        return Response(DeploymentJobSerializer(jobs, many=True).data)


class JobDetailView(APIView):
    def get(self, request, id):
        job = get_object_or_404(
            DeploymentJob.objects.select_related(
                "script",
                "script__target_server",
                "target_server",
                "started_by",
            ),
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
                script = ScriptDefinition.objects.select_for_update().select_related(
                    "target_server"
                ).get(
                    slug=script_slug,
                    enabled=True,
                    target_server__enabled=True,
                )
                if DeploymentJob.objects.filter(
                    script=script,
                    target_server=script.target_server,
                    status__in=ACTIVE_STATUSES,
                ).exists():
                    return Response(
                        {"detail": "This script already has a queued or running job."},
                        status=status.HTTP_409_CONFLICT,
                    )

                job = DeploymentJob.objects.create(
                    script=script,
                    target_server=script.target_server,
                    status=DeploymentJob.Status.QUEUED,
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

        return Response(DeploymentJobSerializer(job).data, status=status.HTTP_201_CREATED)


class JobRefreshStatusView(APIView):
    def post(self, request, id):
        job = get_object_or_404(
            DeploymentJob.objects.select_related(
                "script",
                "script__target_server",
                "target_server",
                "started_by",
            ),
            id=id,
        )
        return Response(DeploymentJobSerializer(job).data)


class JobStopView(APIView):
    def post(self, request, id):
        job = get_object_or_404(
            DeploymentJob.objects.select_related(
                "script",
                "script__target_server",
                "target_server",
                "started_by",
            ),
            id=id,
        )
        if job.status == DeploymentJob.Status.QUEUED:
            job.status = DeploymentJob.Status.STOPPED
            job.stop_requested = True
            job.finished_at = timezone.now()
            job.save(update_fields=["status", "stop_requested", "finished_at", "updated_at"])
        elif job.status == DeploymentJob.Status.RUNNING:
            job.stop_requested = True
            job.save(update_fields=["stop_requested", "updated_at"])
        return Response(DeploymentJobSerializer(job).data)


class JobLogsStreamView(APIView):
    renderer_classes = [JSONRenderer, ServerSentEventRenderer]

    def get(self, request, id):
        job = get_object_or_404(
            DeploymentJob.objects.select_related(
                "script",
                "script__target_server",
                "target_server",
                "started_by",
            ),
            id=id,
        )
        response = StreamingHttpResponse(
            stream_sse_events(job.id),
            content_type="text/event-stream",
        )
        response["Cache-Control"] = "no-cache"
        response["X-Accel-Buffering"] = "no"
        return response


class AgentPingView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        target, error = authenticate_agent(request)
        if error is not None:
            return error
        touch_agent(target, request)
        return Response({"detail": "ok"})


class AgentClaimJobView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        target, error = authenticate_agent(request)
        if error is not None:
            return error
        touch_agent(target, request)

        with transaction.atomic():
            job = (
                DeploymentJob.objects.select_for_update()
                .select_related("script", "target_server")
                .filter(
                    target_server=target,
                    status=DeploymentJob.Status.QUEUED,
                    script__enabled=True,
                )
                .order_by("created_at")
                .first()
            )
            if job is None:
                return Response(status=status.HTTP_204_NO_CONTENT)

            agent_run_id = request.data.get("agent_run_id", "")
            job.status = DeploymentJob.Status.RUNNING
            job.claimed_at = timezone.now()
            if isinstance(agent_run_id, str):
                job.agent_run_id = agent_run_id[:180]
            job.save(update_fields=["status", "claimed_at", "agent_run_id", "updated_at"])

        return Response(
            {
                "job": {
                    "id": str(job.id),
                    "script_key": job.script.remote_key,
                    "script_path": job.script.remote_script_path,
                    "allowed_script_dir": target.allowed_script_dir,
                    "log_dir": target.log_dir,
                }
            }
        )


class AgentJobLogsView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request, id):
        target, error = authenticate_agent(request)
        if error is not None:
            return error
        touch_agent(target, request)
        job = get_object_or_404(DeploymentJob, id=id, target_server=target)

        lines = request.data.get("lines", [])
        if isinstance(lines, str):
            lines = [lines]
        if not isinstance(lines, list):
            return Response(
                {"detail": "lines must be a list."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        lines = [str(line).rstrip("\r\n") for line in lines[:500]]
        if not lines:
            return Response({"detail": "ok", "stored": 0})

        with transaction.atomic():
            DeploymentJob.objects.select_for_update().get(id=job.id)
            last_sequence = (
                DeploymentJobLogLine.objects.filter(job=job).aggregate(Max("sequence"))[
                    "sequence__max"
                ]
                or 0
            )
            now = timezone.now()
            DeploymentJobLogLine.objects.bulk_create(
                [
                    DeploymentJobLogLine(
                        job=job,
                        sequence=last_sequence + index,
                        line=line,
                        timestamp=now,
                    )
                    for index, line in enumerate(lines, start=1)
                ]
            )

        return Response({"detail": "ok", "stored": len(lines)})


class AgentJobStatusView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request, id):
        target, error = authenticate_agent(request)
        if error is not None:
            return error
        touch_agent(target, request)
        job = get_object_or_404(DeploymentJob, id=id, target_server=target)

        next_status = request.data.get("status")
        if next_status not in VALID_AGENT_STATUSES:
            return Response(
                {"detail": "Invalid status."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        job.status = next_status
        if "exit_code" in request.data:
            job.exit_code = request.data["exit_code"]
        if next_status in TERMINAL_STATUSES:
            job.finished_at = timezone.now()
        job.save(update_fields=["status", "exit_code", "finished_at", "updated_at"])
        return Response(DeploymentJobSerializer(job).data)


class AgentJobControlView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request, id):
        target, error = authenticate_agent(request)
        if error is not None:
            return error
        touch_agent(target, request)
        job = get_object_or_404(DeploymentJob, id=id, target_server=target)
        return Response({"stop_requested": job.stop_requested})


def stream_sse_events(job_id):
    yield ": connected\n\n"
    last_sequence = 0
    try:
        while True:
            close_old_connections()
            job = DeploymentJob.objects.get(id=job_id)
            lines = list(
                DeploymentJobLogLine.objects.filter(
                    job=job,
                    sequence__gt=last_sequence,
                ).order_by("sequence")[:200]
            )
            for line in lines:
                last_sequence = line.sequence
                yield sse_message(
                    {
                        "line": line.line,
                        "timestamp": line.timestamp.isoformat(),
                    }
                )

            if job.status in TERMINAL_STATUSES:
                yield sse_message(
                    {
                        "status": job.status,
                        "exit_code": job.exit_code,
                    },
                    event="status",
                )
                break
            time.sleep(1)
    except (DeploymentJob.DoesNotExist, OperationalError) as exc:
        logger.warning("SSE stream failed", exc_info=True)
        yield sse_message({"detail": str(exc)}, event="error")


def sse_message(payload: dict[str, Any], event: str | None = None) -> str:
    prefix = f"event: {event}\n" if event else ""
    return f"{prefix}data: {json.dumps(payload, ensure_ascii=False)}\n\n"
