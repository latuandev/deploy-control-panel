from django.contrib import admin

from .models import DeploymentJob, ScriptDefinition


@admin.register(ScriptDefinition)
class ScriptDefinitionAdmin(admin.ModelAdmin):
    list_display = ("slug", "label", "remote_key", "enabled", "updated_at")
    list_filter = ("enabled",)
    search_fields = ("slug", "label", "remote_key")


@admin.register(DeploymentJob)
class DeploymentJobAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "script",
        "remote_job_id",
        "status",
        "exit_code",
        "started_by",
        "started_at",
        "finished_at",
    )
    list_filter = ("status", "script")
    search_fields = ("id", "remote_job_id", "remote_log_file")
    readonly_fields = ("id", "created_at", "updated_at")

