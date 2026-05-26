from django.core.management.base import BaseCommand

from deployments.models import ScriptDefinition


SCRIPTS = [
    {
        "slug": "coin-identifier",
        "label": "Deploy Coin Identifier Backend",
        "remote_key": "coin-identifier",
        "description": "Runs the Coin Identifier backend deploy script on the target server.",
        "enabled": True,
    },
]


class Command(BaseCommand):
    help = "Create or update the built-in deployment script allowlist."

    def handle(self, *args, **options):
        for script in SCRIPTS:
            obj, created = ScriptDefinition.objects.update_or_create(
                slug=script["slug"],
                defaults={
                    "label": script["label"],
                    "remote_key": script["remote_key"],
                    "description": script["description"],
                    "enabled": script["enabled"],
                },
            )
            action = "created" if created else "updated"
            self.stdout.write(self.style.SUCCESS(f"{action}: {obj.slug}"))

