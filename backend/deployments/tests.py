from django.contrib.auth import get_user_model
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APITestCase

from .models import DeploymentJob, ScriptDefinition


class JobLogsStreamNegotiationTests(APITestCase):
    def test_log_stream_accepts_event_stream_header(self):
        user = get_user_model().objects.create_user(
            username="admin",
            password="password",
        )
        script = ScriptDefinition.objects.create(
            slug="coin-identifier",
            label="Coin Identifier",
            remote_key="coin-identifier",
        )
        job = DeploymentJob.objects.create(
            script=script,
            remote_job_id="20260526_090129_coin-identifier",
            remote_log_file="/home/tuanle/logs/deploy/20260526_090129_coin-identifier.log",
            status=DeploymentJob.Status.RUNNING,
            started_by=user,
            started_at=timezone.now(),
        )

        self.client.force_authenticate(user=user)
        response = self.client.get(
            reverse("jobs-logs-stream", kwargs={"id": job.id}),
            HTTP_ACCEPT="text/event-stream",
        )

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.streaming)
        self.assertTrue(response["Content-Type"].startswith("text/event-stream"))
        response.close()
