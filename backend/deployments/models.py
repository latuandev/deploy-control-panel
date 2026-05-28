import hashlib
import secrets
import uuid

from django.conf import settings
from django.db import models
from django.db.models import Q


class TargetServer(models.Model):
    slug = models.SlugField(max_length=80, unique=True)
    name = models.CharField(max_length=180)
    agent_token_hash = models.CharField(max_length=64, unique=True)
    agent_token_prefix = models.CharField(max_length=16, db_index=True)
    allowed_script_dir = models.CharField(max_length=255, default="/opt/scripts")
    log_dir = models.CharField(max_length=255, default="/home/deployer/logs/deploy")
    agent_version = models.CharField(max_length=80, blank=True)
    last_seen_at = models.DateTimeField(null=True, blank=True)
    enabled = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name"]

    def __str__(self) -> str:
        return self.name

    @staticmethod
    def generate_agent_token() -> str:
        return secrets.token_urlsafe(32)

    @staticmethod
    def hash_agent_token(token: str) -> str:
        return hashlib.sha256(token.encode("utf-8")).hexdigest()

    @staticmethod
    def token_prefix(token: str) -> str:
        return token[:16]

    def check_agent_token(self, token: str) -> bool:
        return secrets.compare_digest(self.agent_token_hash, self.hash_agent_token(token))


class ScriptDefinition(models.Model):
    target_server = models.ForeignKey(
        TargetServer,
        on_delete=models.PROTECT,
        related_name="scripts",
    )
    slug = models.SlugField(max_length=80, unique=True)
    label = models.CharField(max_length=180)
    remote_key = models.CharField(max_length=120)
    remote_script_path = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    enabled = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["label"]
        constraints = [
            models.UniqueConstraint(
                fields=["target_server", "remote_key"],
                name="one_script_key_per_target",
            )
        ]

    def __str__(self) -> str:
        return self.label


class DeploymentJob(models.Model):
    class Status(models.TextChoices):
        QUEUED = "queued", "Queued"
        RUNNING = "running", "Running"
        SUCCESS = "success", "Success"
        FAILED = "failed", "Failed"
        UNKNOWN = "unknown", "Unknown"
        STOPPED = "stopped", "Stopped"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    script = models.ForeignKey(
        ScriptDefinition,
        on_delete=models.PROTECT,
        related_name="jobs",
    )
    target_server = models.ForeignKey(
        TargetServer,
        on_delete=models.PROTECT,
        related_name="jobs",
    )
    agent_run_id = models.CharField(max_length=180, blank=True)
    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.QUEUED,
        db_index=True,
    )
    exit_code = models.IntegerField(null=True, blank=True)
    stop_requested = models.BooleanField(default=False)
    started_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="deployment_jobs",
    )
    started_at = models.DateTimeField()
    claimed_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["target_server", "script"],
                condition=Q(status__in=["queued", "running"]),
                name="one_active_job_per_target_script",
            )
        ]

    def __str__(self) -> str:
        return f"{self.script.slug} {self.id}"


class DeploymentJobLogLine(models.Model):
    job = models.ForeignKey(
        DeploymentJob,
        on_delete=models.CASCADE,
        related_name="log_lines",
    )
    sequence = models.PositiveIntegerField()
    line = models.TextField()
    timestamp = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["sequence"]
        constraints = [
            models.UniqueConstraint(
                fields=["job", "sequence"],
                name="one_log_sequence_per_job",
            )
        ]

    def __str__(self) -> str:
        return f"{self.job_id} #{self.sequence}"
