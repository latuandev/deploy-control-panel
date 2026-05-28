import re

from rest_framework import serializers

from .models import DeploymentJob, ScriptDefinition, TargetServer

SAFE_TOKEN_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,179}$")


class TargetServerSummarySerializer(serializers.ModelSerializer):
    class Meta:
        model = TargetServer
        fields = [
            "id",
            "slug",
            "name",
            "agent_token_prefix",
            "last_seen_at",
            "enabled",
        ]
        read_only_fields = fields


class TargetServerSerializer(serializers.ModelSerializer):
    class Meta:
        model = TargetServer
        fields = [
            "id",
            "slug",
            "name",
            "agent_token_prefix",
            "allowed_script_dir",
            "log_dir",
            "agent_version",
            "last_seen_at",
            "enabled",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "agent_token_prefix",
            "agent_version",
            "last_seen_at",
            "created_at",
            "updated_at",
        ]

    def validate(self, attrs):
        for field_name in ["allowed_script_dir", "log_dir"]:
            value = attrs.get(field_name)
            if value is not None and not value.startswith("/"):
                raise serializers.ValidationError({field_name: "Use an absolute path."})
        return attrs


class ScriptDefinitionSerializer(serializers.ModelSerializer):
    target = TargetServerSummarySerializer(source="target_server", read_only=True)
    target_server_id = serializers.PrimaryKeyRelatedField(
        queryset=TargetServer.objects.all(),
        source="target_server",
        write_only=True,
    )

    class Meta:
        model = ScriptDefinition
        fields = [
            "id",
            "target",
            "target_server_id",
            "slug",
            "label",
            "remote_key",
            "remote_script_path",
            "description",
            "enabled",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "target", "created_at", "updated_at"]

    def validate_remote_key(self, value: str) -> str:
        if not SAFE_TOKEN_RE.fullmatch(value):
            raise serializers.ValidationError(
                "Use letters, numbers, dots, underscores, or hyphens."
            )
        return value

    def validate_remote_script_path(self, value: str) -> str:
        if not value.startswith("/") or any(char in value for char in "\r\n\0"):
            raise serializers.ValidationError("Use an absolute script path.")
        return value

    def validate(self, attrs):
        target = attrs.get("target_server") or getattr(self.instance, "target_server", None)
        script_path = attrs.get("remote_script_path") or getattr(
            self.instance,
            "remote_script_path",
            "",
        )
        if target and script_path:
            allowed_dir = target.allowed_script_dir.rstrip("/")
            if not script_path.startswith(f"{allowed_dir}/"):
                raise serializers.ValidationError(
                    {
                        "remote_script_path": (
                            f"Script path must be under {target.allowed_script_dir}."
                        )
                    }
                )
        return attrs


class DeploymentJobSerializer(serializers.ModelSerializer):
    script = ScriptDefinitionSerializer(read_only=True)
    target = TargetServerSummarySerializer(source="target_server", read_only=True)
    started_by = serializers.CharField(source="started_by.username", read_only=True)

    class Meta:
        model = DeploymentJob
        fields = [
            "id",
            "script",
            "target",
            "agent_run_id",
            "status",
            "exit_code",
            "stop_requested",
            "started_by",
            "started_at",
            "claimed_at",
            "finished_at",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields


class StartDeploymentSerializer(serializers.Serializer):
    script_slug = serializers.SlugField(max_length=80)


class UserProfileSerializer(serializers.Serializer):
    username = serializers.CharField()
    is_staff = serializers.BooleanField()
