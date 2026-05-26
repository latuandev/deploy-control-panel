# Generated for the Deploy Control Panel MVP.

import django.db.models.deletion
import uuid
from django.conf import settings
from django.db import migrations, models
from django.db.models import Q


class Migration(migrations.Migration):
    initial = True

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="ScriptDefinition",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("slug", models.SlugField(max_length=80, unique=True)),
                ("label", models.CharField(max_length=180)),
                ("remote_key", models.CharField(max_length=120, unique=True)),
                ("description", models.TextField(blank=True)),
                ("enabled", models.BooleanField(default=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={
                "ordering": ["label"],
            },
        ),
        migrations.CreateModel(
            name="DeploymentJob",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("remote_job_id", models.CharField(max_length=180, unique=True)),
                ("remote_log_file", models.TextField()),
                ("remote_pid_file", models.TextField(blank=True)),
                ("remote_status_file", models.TextField(blank=True)),
                ("status", models.CharField(choices=[("queued", "Queued"), ("running", "Running"), ("success", "Success"), ("failed", "Failed"), ("unknown", "Unknown"), ("stopped", "Stopped")], db_index=True, default="queued", max_length=20)),
                ("exit_code", models.IntegerField(blank=True, null=True)),
                ("started_at", models.DateTimeField()),
                ("finished_at", models.DateTimeField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("script", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="jobs", to="deployments.scriptdefinition")),
                ("started_by", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="deployment_jobs", to=settings.AUTH_USER_MODEL)),
            ],
            options={
                "ordering": ["-created_at"],
            },
        ),
        migrations.AddConstraint(
            model_name="deploymentjob",
            constraint=models.UniqueConstraint(condition=Q(status__in=["queued", "running"]), fields=("script",), name="one_active_job_per_script"),
        ),
    ]
