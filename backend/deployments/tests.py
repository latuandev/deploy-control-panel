from django.contrib.auth import get_user_model
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APITestCase, APITransactionTestCase

from .models import (
    DeploymentJob,
    DeploymentJobLogLine,
    ScriptDefinition,
    TargetServer,
)


class TargetServerDeletionTests(APITestCase):
    def test_delete_target_only_disables_linked_scripts(self):
        user = get_user_model().objects.create_user(
            username="admin",
            password="password",
            is_staff=True,
        )
        deleted_target = TargetServer.objects.create(
            slug="deleted-target",
            name="Deleted target",
            agent_token_hash=TargetServer.hash_agent_token("deleted-token"),
            agent_token_prefix=TargetServer.token_prefix("deleted-token"),
            allowed_script_dir="/opt/scripts",
            log_dir="/var/log/deploy",
        )
        other_target = TargetServer.objects.create(
            slug="other-target",
            name="Other target",
            agent_token_hash=TargetServer.hash_agent_token("other-token"),
            agent_token_prefix=TargetServer.token_prefix("other-token"),
            allowed_script_dir="/opt/scripts",
            log_dir="/var/log/deploy",
        )
        linked_script = ScriptDefinition.objects.create(
            target_server=deleted_target,
            slug="linked-script",
            label="Linked script",
            remote_key="deploy-api",
            remote_script_path="/opt/scripts/deploy-api.sh",
        )
        unrelated_script = ScriptDefinition.objects.create(
            target_server=other_target,
            slug="unrelated-script",
            label="Unrelated script",
            remote_key="deploy-api",
            remote_script_path="/opt/scripts/deploy-api.sh",
        )

        self.client.force_authenticate(user=user)
        response = self.client.delete(
            reverse("targets-detail", kwargs={"id": deleted_target.id})
        )

        self.assertEqual(response.status_code, 200)
        deleted_target.refresh_from_db()
        other_target.refresh_from_db()
        linked_script.refresh_from_db()
        unrelated_script.refresh_from_db()
        self.assertFalse(deleted_target.enabled)
        self.assertTrue(other_target.enabled)
        self.assertFalse(linked_script.enabled)
        self.assertTrue(unrelated_script.enabled)


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


class JobLogReplayTests(APITransactionTestCase):
    def test_terminal_log_stream_replays_more_than_one_batch(self):
        user = get_user_model().objects.create_user(
            username="admin",
            password="password",
        )
        target = TargetServer.objects.create(
            slug="replay-target",
            name="Replay target",
            agent_token_hash=TargetServer.hash_agent_token("replay-token"),
            agent_token_prefix=TargetServer.token_prefix("replay-token"),
            allowed_script_dir="/opt/scripts",
            log_dir="/var/log/deploy",
        )
        script = ScriptDefinition.objects.create(
            target_server=target,
            slug="replay-script",
            label="Replay script",
            remote_key="replay-script",
            remote_script_path="/opt/scripts/replay.sh",
        )
        job = DeploymentJob.objects.create(
            script=script,
            target_server=target,
            status=DeploymentJob.Status.SUCCESS,
            exit_code=0,
            started_by=user,
            started_at=timezone.now(),
            finished_at=timezone.now(),
        )
        timestamp = timezone.now()
        DeploymentJobLogLine.objects.bulk_create(
            [
                DeploymentJobLogLine(
                    job=job,
                    sequence=index,
                    line=f"line-{index:03d}",
                    timestamp=timestamp,
                )
                for index in range(1, 206)
            ]
        )

        self.client.force_authenticate(user=user)
        response = self.client.get(reverse("jobs-logs-stream", kwargs={"id": job.id}))
        body = b"".join(response.streaming_content).decode("utf-8")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(body.count('"line":'), 205)
        self.assertIn("line-001", body)
        self.assertIn("line-205", body)
        self.assertIn('"status": "success"', body)

    def test_agent_logs_endpoint_does_not_truncate_large_batch(self):
        token = "large-log-token"
        target = TargetServer.objects.create(
            slug="large-log-target",
            name="Large log target",
            agent_token_hash=TargetServer.hash_agent_token(token),
            agent_token_prefix=TargetServer.token_prefix(token),
            allowed_script_dir="/opt/scripts",
            log_dir="/var/log/deploy",
        )
        user = get_user_model().objects.create_user(
            username="admin",
            password="password",
        )
        script = ScriptDefinition.objects.create(
            target_server=target,
            slug="large-log-script",
            label="Large log script",
            remote_key="large-log-script",
            remote_script_path="/opt/scripts/large-log.sh",
        )
        job = DeploymentJob.objects.create(
            script=script,
            target_server=target,
            status=DeploymentJob.Status.RUNNING,
            started_by=user,
            started_at=timezone.now(),
        )
        lines = [f"line-{index:03d}" for index in range(1, 551)]

        response = self.client.post(
            reverse("agent-jobs-logs", kwargs={"id": job.id}),
            {"lines": lines},
            format="json",
            HTTP_AUTHORIZATION=f"Bearer {token}",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["stored"], 550)
        self.assertEqual(job.log_lines.count(), 550)
        self.assertEqual(
            job.log_lines.order_by("-sequence").values_list("sequence", "line").first(),
            (550, "line-550"),
        )


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
