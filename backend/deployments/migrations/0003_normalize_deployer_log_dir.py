from django.db import migrations


OLD_LOG_DIR = "/home/tuanle/logs/deploy"
NEW_LOG_DIR = "/home/deployer/logs/deploy"


def normalize_log_dir(apps, schema_editor):
    TargetServer = apps.get_model("deployments", "TargetServer")
    TargetServer.objects.filter(log_dir=OLD_LOG_DIR).update(log_dir=NEW_LOG_DIR)


class Migration(migrations.Migration):
    dependencies = [
        ("deployments", "0002_agent_targets"),
    ]

    operations = [
        migrations.RunPython(normalize_log_dir, migrations.RunPython.noop),
    ]
