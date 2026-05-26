from rest_framework import serializers

from .models import DeploymentJob, ScriptDefinition


class ScriptDefinitionSerializer(serializers.ModelSerializer):
    class Meta:
        model = ScriptDefinition
        fields = [
            "id",
            "slug",
            "label",
            "remote_key",
            "description",
            "enabled",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields


class DeploymentJobSerializer(serializers.ModelSerializer):
    script = ScriptDefinitionSerializer(read_only=True)
    started_by = serializers.CharField(source="started_by.username", read_only=True)

    class Meta:
        model = DeploymentJob
        fields = [
            "id",
            "script",
            "remote_job_id",
            "remote_log_file",
            "remote_pid_file",
            "remote_status_file",
            "status",
            "exit_code",
            "started_by",
            "started_at",
            "finished_at",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields


class StartDeploymentSerializer(serializers.Serializer):
    script_slug = serializers.SlugField(max_length=80)

