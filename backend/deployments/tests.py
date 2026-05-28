from django.contrib.auth import get_user_model
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APITestCase

from .models import DeploymentJob, ScriptDefinition, TargetServer


class JobLogsStreamNegotiationTests(APITestCase):
    def test_log_stream_accepts_event_stream_header(self):
        user = get_user_model().objects.create_user(
            username="admin",
            password="password",
        )
        target = TargetServer.objects.create(
            slug="default-target",
            name="Default target",
            agent_token_hash=TargetServer.hash_agent_token("test-token"),
            agent_token_prefix=TargetServer.token_prefix("test-token"),
            allowed_script_dir="/opt/scripts",
            log_dir="/home/tuanle/logs/deploy",
        )
        script = ScriptDefinition.objects.create(
            target_server=target,
            slug="coin-identifier",
            label="Coin Identifier",
            remote_key="coin-identifier",
            remote_script_path="/opt/scripts/deploy-coin-identifier.sh",
        )
        job = DeploymentJob.objects.create(
            script=script,
            target_server=target,
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


class AgentWorkflowTests(APITestCase):
    def test_agent_can_claim_log_and_finish_queued_job(self):
        token = "agent-token"
        user = get_user_model().objects.create_user(
            username="admin",
            password="password",
        )
        target = TargetServer.objects.create(
            slug="product-vps",
            name="Product VPS",
            agent_token_hash=TargetServer.hash_agent_token(token),
            agent_token_prefix=TargetServer.token_prefix(token),
            allowed_script_dir="/opt/scripts",
            log_dir="/var/log/deploy",
        )
        script = ScriptDefinition.objects.create(
            target_server=target,
            slug="deploy-api",
            label="Deploy API",
            remote_key="deploy-api",
            remote_script_path="/opt/scripts/deploy-api.sh",
        )
        job = DeploymentJob.objects.create(
            script=script,
            target_server=target,
            status=DeploymentJob.Status.QUEUED,
            started_by=user,
            started_at=timezone.now(),
        )

        auth = {"HTTP_AUTHORIZATION": f"Bearer {token}"}
        claim_response = self.client.post(
            reverse("agent-jobs-claim"),
            {"agent_version": "deploy-agent/1.0", "agent_run_id": "run-123"},
            format="json",
            **auth,
        )

        self.assertEqual(claim_response.status_code, 200)
        self.assertEqual(
            claim_response.data["job"]["script_path"],
            "/opt/scripts/deploy-api.sh",
        )
        job.refresh_from_db()
        target.refresh_from_db()
        self.assertEqual(job.status, DeploymentJob.Status.RUNNING)
        self.assertEqual(job.agent_run_id, "run-123")
        self.assertIsNotNone(job.claimed_at)
        self.assertIsNotNone(target.last_seen_at)
        self.assertEqual(target.agent_version, "deploy-agent/1.0")

        logs_response = self.client.post(
            reverse("agent-jobs-logs", kwargs={"id": job.id}),
            {"lines": ["pull latest", "restart service"]},
            format="json",
            **auth,
        )
        self.assertEqual(logs_response.status_code, 200)
        self.assertEqual(logs_response.data["stored"], 2)
        self.assertEqual(
            list(job.log_lines.values_list("sequence", "line")),
            [(1, "pull latest"), (2, "restart service")],
        )

        status_response = self.client.post(
            reverse("agent-jobs-status", kwargs={"id": job.id}),
            {"status": "success", "exit_code": 0},
            format="json",
            **auth,
        )
        self.assertEqual(status_response.status_code, 200)
        job.refresh_from_db()
        self.assertEqual(job.status, DeploymentJob.Status.SUCCESS)
        self.assertEqual(job.exit_code, 0)
        self.assertIsNotNone(job.finished_at)
