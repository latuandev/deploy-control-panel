import uuid

from django.conf import settings
from django.db import models
from django.db.models import Q


class ScriptDefinition(models.Model):
    slug = models.SlugField(max_length=80, unique=True)
    label = models.CharField(max_length=180)
    remote_key = models.CharField(max_length=120, unique=True)
    description = models.TextField(blank=True)
    enabled = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["label"]

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
    remote_job_id = models.CharField(max_length=180, unique=True)
    remote_log_file = models.TextField()
    remote_pid_file = models.TextField(blank=True)
    remote_status_file = models.TextField(blank=True)
    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.QUEUED,
        db_index=True,
    )
    exit_code = models.IntegerField(null=True, blank=True)
    started_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="deployment_jobs",
    )
    started_at = models.DateTimeField()
    finished_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["script"],
                condition=Q(status__in=["queued", "running"]),
                name="one_active_job_per_script",
            )
        ]

    def __str__(self) -> str:
        return f"{self.script.slug} {self.remote_job_id}"

