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

    def test_hard_delete_target_removes_only_related_scripts_jobs_and_logs(self):
        user = get_user_model().objects.create_user(
            username="admin",
            password="password",
            is_staff=True,
        )
        deleted_target = TargetServer.objects.create(
            slug="hard-delete-target",
            name="Hard delete target",
            agent_token_hash=TargetServer.hash_agent_token("hard-delete-token"),
            agent_token_prefix=TargetServer.token_prefix("hard-delete-token"),
            allowed_script_dir="/opt/scripts",
            log_dir="/var/log/deploy",
        )
        other_target = TargetServer.objects.create(
            slug="kept-target",
            name="Kept target",
            agent_token_hash=TargetServer.hash_agent_token("kept-token"),
            agent_token_prefix=TargetServer.token_prefix("kept-token"),
            allowed_script_dir="/opt/scripts",
            log_dir="/var/log/deploy",
        )
        deleted_script = ScriptDefinition.objects.create(
            target_server=deleted_target,
            slug="hard-delete-script",
            label="Hard delete script",
            remote_key="hard-delete-script",
            remote_script_path="/opt/scripts/hard-delete.sh",
        )
        kept_script = ScriptDefinition.objects.create(
            target_server=other_target,
            slug="kept-script",
            label="Kept script",
            remote_key="kept-script",
            remote_script_path="/opt/scripts/kept.sh",
        )
        deleted_job = DeploymentJob.objects.create(
            script=deleted_script,
            target_server=deleted_target,
            status=DeploymentJob.Status.SUCCESS,
            exit_code=0,
            started_by=user,
            started_at=timezone.now(),
            finished_at=timezone.now(),
        )
        kept_job = DeploymentJob.objects.create(
            script=kept_script,
            target_server=other_target,
            status=DeploymentJob.Status.SUCCESS,
            exit_code=0,
            started_by=user,
            started_at=timezone.now(),
            finished_at=timezone.now(),
        )
        DeploymentJobLogLine.objects.create(
            job=deleted_job,
            sequence=1,
            line="deleted log",
        )
        DeploymentJobLogLine.objects.create(
            job=kept_job,
            sequence=1,
            line="kept log",
        )

        self.client.force_authenticate(user=user)
        response = self.client.delete(
            reverse("targets-hard-delete", kwargs={"id": deleted_target.id})
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.data["deleted"],
            {"targets": 1, "scripts": 1, "jobs": 1, "log_lines": 1},
        )
        self.assertFalse(TargetServer.objects.filter(id=deleted_target.id).exists())
        self.assertFalse(ScriptDefinition.objects.filter(id=deleted_script.id).exists())
        self.assertFalse(DeploymentJob.objects.filter(id=deleted_job.id).exists())
        self.assertFalse(DeploymentJobLogLine.objects.filter(job_id=deleted_job.id).exists())
        self.assertTrue(TargetServer.objects.filter(id=other_target.id).exists())
        self.assertTrue(ScriptDefinition.objects.filter(id=kept_script.id).exists())
        self.assertTrue(DeploymentJob.objects.filter(id=kept_job.id).exists())
        self.assertTrue(DeploymentJobLogLine.objects.filter(job_id=kept_job.id).exists())

    def test_hard_delete_target_rejects_active_jobs(self):
        user = get_user_model().objects.create_user(
            username="admin",
            password="password",
            is_staff=True,
        )
        target = TargetServer.objects.create(
            slug="active-target",
            name="Active target",
            agent_token_hash=TargetServer.hash_agent_token("active-token"),
            agent_token_prefix=TargetServer.token_prefix("active-token"),
            allowed_script_dir="/opt/scripts",
            log_dir="/var/log/deploy",
        )
        script = ScriptDefinition.objects.create(
            target_server=target,
            slug="active-script",
            label="Active script",
            remote_key="active-script",
            remote_script_path="/opt/scripts/active.sh",
        )
        DeploymentJob.objects.create(
            script=script,
            target_server=target,
            status=DeploymentJob.Status.RUNNING,
            started_by=user,
            started_at=timezone.now(),
        )

        self.client.force_authenticate(user=user)
        response = self.client.delete(
            reverse("targets-hard-delete", kwargs={"id": target.id})
        )

        self.assertEqual(response.status_code, 409)
        self.assertTrue(TargetServer.objects.filter(id=target.id).exists())
        self.assertTrue(ScriptDefinition.objects.filter(id=script.id).exists())


class ScriptDefinitionDeletionTests(APITestCase):
    def test_hard_delete_script_removes_only_related_jobs_and_logs(self):
        user = get_user_model().objects.create_user(
            username="admin",
            password="password",
            is_staff=True,
        )
        target = TargetServer.objects.create(
            slug="script-delete-target",
            name="Script delete target",
            agent_token_hash=TargetServer.hash_agent_token("script-delete-token"),
            agent_token_prefix=TargetServer.token_prefix("script-delete-token"),
            allowed_script_dir="/opt/scripts",
            log_dir="/var/log/deploy",
        )
        deleted_script = ScriptDefinition.objects.create(
            target_server=target,
            slug="script-hard-delete",
            label="Script hard delete",
            remote_key="script-hard-delete",
            remote_script_path="/opt/scripts/script-hard-delete.sh",
        )
        kept_script = ScriptDefinition.objects.create(
            target_server=target,
            slug="script-kept",
            label="Script kept",
            remote_key="script-kept",
            remote_script_path="/opt/scripts/script-kept.sh",
        )
        deleted_job = DeploymentJob.objects.create(
            script=deleted_script,
            target_server=target,
            status=DeploymentJob.Status.SUCCESS,
            exit_code=0,
            started_by=user,
            started_at=timezone.now(),
            finished_at=timezone.now(),
        )
        kept_job = DeploymentJob.objects.create(
            script=kept_script,
            target_server=target,
            status=DeploymentJob.Status.SUCCESS,
            exit_code=0,
            started_by=user,
            started_at=timezone.now(),
            finished_at=timezone.now(),
        )
        DeploymentJobLogLine.objects.create(
            job=deleted_job,
            sequence=1,
            line="deleted script log",
        )
        DeploymentJobLogLine.objects.create(
            job=kept_job,
            sequence=1,
            line="kept script log",
        )

        self.client.force_authenticate(user=user)
        response = self.client.delete(
            reverse("scripts-hard-delete", kwargs={"id": deleted_script.id})
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.data["deleted"],
            {"scripts": 1, "jobs": 1, "log_lines": 1},
        )
        self.assertTrue(TargetServer.objects.filter(id=target.id).exists())
        self.assertFalse(ScriptDefinition.objects.filter(id=deleted_script.id).exists())
        self.assertFalse(DeploymentJob.objects.filter(id=deleted_job.id).exists())
        self.assertFalse(DeploymentJobLogLine.objects.filter(job_id=deleted_job.id).exists())
        self.assertTrue(ScriptDefinition.objects.filter(id=kept_script.id).exists())
        self.assertTrue(DeploymentJob.objects.filter(id=kept_job.id).exists())
        self.assertTrue(DeploymentJobLogLine.objects.filter(job_id=kept_job.id).exists())

    def test_hard_delete_script_rejects_active_jobs(self):
        user = get_user_model().objects.create_user(
            username="admin",
            password="password",
            is_staff=True,
        )
        target = TargetServer.objects.create(
            slug="active-script-target",
            name="Active script target",
            agent_token_hash=TargetServer.hash_agent_token("active-script-token"),
            agent_token_prefix=TargetServer.token_prefix("active-script-token"),
            allowed_script_dir="/opt/scripts",
            log_dir="/var/log/deploy",
        )
        script = ScriptDefinition.objects.create(
            target_server=target,
            slug="script-with-active-job",
            label="Script with active job",
            remote_key="script-with-active-job",
            remote_script_path="/opt/scripts/active-script.sh",
        )
        DeploymentJob.objects.create(
            script=script,
            target_server=target,
            status=DeploymentJob.Status.QUEUED,
            started_by=user,
            started_at=timezone.now(),
        )

        self.client.force_authenticate(user=user)
        response = self.client.delete(
            reverse("scripts-hard-delete", kwargs={"id": script.id})
        )

        self.assertEqual(response.status_code, 409)
        self.assertTrue(ScriptDefinition.objects.filter(id=script.id).exists())


class AgentSetupGuideTests(APITestCase):
    def test_staff_can_read_agent_setup_guide(self):
        user = get_user_model().objects.create_user(
            username="admin",
            password="password",
            is_staff=True,
        )
        target = TargetServer.objects.create(
            slug="setup-target",
            name="Setup target",
            agent_token_hash=TargetServer.hash_agent_token("setup-token"),
            agent_token_prefix=TargetServer.token_prefix("setup-token"),
            allowed_script_dir="/opt/scripts",
            log_dir="/home/deployer/logs/deploy",
        )

        self.client.force_authenticate(user=user)
        response = self.client.get(reverse("setup-agent"))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["agent_filename"], "deploy_agent.py")
        self.assertEqual(response.data["agent_path"], "/opt/deploy-control-agent/deploy_agent.py")
        self.assertEqual(response.data["log_retention_days"], 30)
        self.assertIn("def cleanup_old_logs", response.data["agent_source"])
        self.assertEqual(response.data["targets"][0]["id"], target.id)

    def test_non_staff_cannot_read_agent_setup_guide(self):
        user = get_user_model().objects.create_user(
            username="member",
            password="password",
            is_staff=False,
        )

        self.client.force_authenticate(user=user)
        response = self.client.get(reverse("setup-agent"))

        self.assertEqual(response.status_code, 403)


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
            log_dir="/home/deployer/logs/deploy",
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


class JobsListPaginationTests(APITestCase):
    def test_jobs_list_supports_limit_offset_pagination(self):
        user = get_user_model().objects.create_user(
            username="admin",
            password="password",
        )
        target = TargetServer.objects.create(
            slug="jobs-page-target",
            name="Jobs page target",
            agent_token_hash=TargetServer.hash_agent_token("jobs-page-token"),
            agent_token_prefix=TargetServer.token_prefix("jobs-page-token"),
            allowed_script_dir="/opt/scripts",
            log_dir="/var/log/deploy",
        )
        script = ScriptDefinition.objects.create(
            target_server=target,
            slug="jobs-page-script",
            label="Jobs page script",
            remote_key="jobs-page-script",
            remote_script_path="/opt/scripts/jobs-page.sh",
        )
        started_at = timezone.now()
        for index in range(25):
            DeploymentJob.objects.create(
                script=script,
                target_server=target,
                status=DeploymentJob.Status.SUCCESS,
                exit_code=0,
                started_by=user,
                started_at=started_at,
                finished_at=started_at,
                agent_run_id=f"run-{index:02d}",
            )

        self.client.force_authenticate(user=user)
        first_page = self.client.get(
            reverse("jobs-list"),
            {"limit": 10, "offset": 0},
        )
        third_page = self.client.get(
            reverse("jobs-list"),
            {"limit": 10, "offset": 20},
        )
        legacy_response = self.client.get(reverse("jobs-list"))

        self.assertEqual(first_page.status_code, 200)
        self.assertEqual(len(first_page.data["results"]), 10)
        self.assertEqual(first_page.data["next_offset"], 10)
        self.assertTrue(first_page.data["has_more"])
        self.assertEqual(first_page.data["count"], 25)
        self.assertEqual(third_page.status_code, 200)
        self.assertEqual(len(third_page.data["results"]), 5)
        self.assertEqual(third_page.data["next_offset"], 25)
        self.assertFalse(third_page.data["has_more"])
        self.assertEqual(legacy_response.status_code, 200)
        self.assertEqual(len(legacy_response.data), 25)


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
