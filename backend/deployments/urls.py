from django.urls import path

from .views import (
    JobDetailView,
    JobLogsStreamView,
    JobRefreshStatusView,
    JobStartView,
    JobStopView,
    JobsListView,
    ScriptsListView,
)

urlpatterns = [
    path("scripts/", ScriptsListView.as_view(), name="scripts-list"),
    path("jobs/", JobsListView.as_view(), name="jobs-list"),
    path("jobs/start/", JobStartView.as_view(), name="jobs-start"),
    path("jobs/<uuid:id>/", JobDetailView.as_view(), name="jobs-detail"),
    path("jobs/<uuid:id>/logs/stream/", JobLogsStreamView.as_view(), name="jobs-logs-stream"),
    path("jobs/<uuid:id>/refresh-status/", JobRefreshStatusView.as_view(), name="jobs-refresh-status"),
    path("jobs/<uuid:id>/stop/", JobStopView.as_view(), name="jobs-stop"),
]

