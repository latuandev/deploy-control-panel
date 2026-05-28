from django.contrib import admin

from .models import DeploymentJob, DeploymentJobLogLine, ScriptDefinition, TargetServer


@admin.register(TargetServer)
class TargetServerAdmin(admin.ModelAdmin):
    list_display = (
        "slug",
        "name",
        "agent_token_prefix",
        "last_seen_at",
        "enabled",
        "updated_at",
    )
    list_filter = ("enabled",)
    search_fields = ("slug", "name", "agent_token_prefix")
    readonly_fields = (
        "agent_token_hash",
        "agent_token_prefix",
        "last_seen_at",
        "created_at",
        "updated_at",
    )


@admin.register(ScriptDefinition)
class ScriptDefinitionAdmin(admin.ModelAdmin):
    list_display = (
        "slug",
        "label",
        "target_server",
        "remote_key",
        "remote_script_path",
        "enabled",
        "updated_at",
    )
    list_filter = ("enabled", "target_server")
    search_fields = ("slug", "label", "remote_key", "remote_script_path")


@admin.register(DeploymentJob)
class DeploymentJobAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "script",
        "target_server",
        "agent_run_id",
        "status",
        "exit_code",
        "stop_requested",
        "started_by",
        "started_at",
        "claimed_at",
        "finished_at",
    )
    list_filter = ("status", "target_server", "script")
    search_fields = ("id", "agent_run_id")
    readonly_fields = ("id", "created_at", "updated_at")


@admin.register(DeploymentJobLogLine)
class DeploymentJobLogLineAdmin(admin.ModelAdmin):
    list_display = ("job", "sequence", "timestamp")
    list_filter = ("job__target_server", "job__status")
    search_fields = ("job__id", "line")
