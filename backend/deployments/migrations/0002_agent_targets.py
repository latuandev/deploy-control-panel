import django.db.models.deletion
from django.db import migrations, models
from django.db.models import Q


class Migration(migrations.Migration):
    dependencies = [
        ("deployments", "0001_initial"),
    ]

    operations = [
        migrations.CreateModel(
            name="TargetServer",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name="ID",
                    ),
                ),
                ("slug", models.SlugField(max_length=80, unique=True)),
                ("name", models.CharField(max_length=180)),
                ("agent_token_hash", models.CharField(max_length=64, unique=True)),
                ("agent_token_prefix", models.CharField(db_index=True, max_length=16)),
                (
                    "allowed_script_dir",
                    models.CharField(default="/opt/scripts", max_length=255),
                ),
                (
                    "log_dir",
                    models.CharField(
                        default="/home/deployer/logs/deploy",
                        max_length=255,
                    ),
                ),
                ("agent_version", models.CharField(blank=True, max_length=80)),
                ("last_seen_at", models.DateTimeField(blank=True, null=True)),
                ("enabled", models.BooleanField(default=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={
                "ordering": ["name"],
            },
        ),
        migrations.AddField(
            model_name="scriptdefinition",
            name="remote_script_path",
            field=models.CharField(default="", max_length=255),
        ),
        migrations.AddField(
            model_name="scriptdefinition",
            name="target_server",
            field=models.ForeignKey(
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="scripts",
                to="deployments.targetserver",
            ),
        ),
        migrations.AddField(
            model_name="deploymentjob",
            name="target_server",
            field=models.ForeignKey(
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="jobs",
                to="deployments.targetserver",
            ),
        ),
        migrations.AlterField(
            model_name="scriptdefinition",
            name="remote_key",
            field=models.CharField(max_length=120),
        ),
        migrations.AlterField(
            model_name="scriptdefinition",
            name="remote_script_path",
            field=models.CharField(max_length=255),
        ),
        migrations.AlterField(
            model_name="scriptdefinition",
            name="target_server",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT,
                related_name="scripts",
                to="deployments.targetserver",
            ),
        ),
        migrations.AlterField(
            model_name="deploymentjob",
            name="target_server",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT,
                related_name="jobs",
                to="deployments.targetserver",
            ),
        ),
        migrations.RemoveConstraint(
            model_name="deploymentjob",
            name="one_active_job_per_script",
        ),
        migrations.RemoveField(
            model_name="deploymentjob",
            name="remote_job_id",
        ),
        migrations.RemoveField(
            model_name="deploymentjob",
            name="remote_log_file",
        ),
        migrations.RemoveField(
            model_name="deploymentjob",
            name="remote_pid_file",
        ),
        migrations.RemoveField(
            model_name="deploymentjob",
            name="remote_status_file",
        ),
        migrations.AddField(
            model_name="deploymentjob",
            name="agent_run_id",
            field=models.CharField(blank=True, max_length=180),
        ),
        migrations.AddField(
            model_name="deploymentjob",
            name="claimed_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="deploymentjob",
            name="stop_requested",
            field=models.BooleanField(default=False),
        ),
        migrations.CreateModel(
            name="DeploymentJobLogLine",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name="ID",
                    ),
                ),
                ("sequence", models.PositiveIntegerField()),
                ("line", models.TextField()),
                ("timestamp", models.DateTimeField(auto_now_add=True)),
                (
                    "job",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="log_lines",
                        to="deployments.deploymentjob",
                    ),
                ),
            ],
            options={
                "ordering": ["sequence"],
            },
        ),
        migrations.AddConstraint(
            model_name="scriptdefinition",
            constraint=models.UniqueConstraint(
                fields=("target_server", "remote_key"),
                name="one_script_key_per_target",
            ),
        ),
        migrations.AddConstraint(
            model_name="deploymentjob",
            constraint=models.UniqueConstraint(
                condition=Q(status__in=["queued", "running"]),
                fields=("target_server", "script"),
                name="one_active_job_per_target_script",
            ),
        ),
        migrations.AddConstraint(
            model_name="deploymentjoblogline",
            constraint=models.UniqueConstraint(
                fields=("job", "sequence"),
                name="one_log_sequence_per_job",
            ),
        ),
    ]
