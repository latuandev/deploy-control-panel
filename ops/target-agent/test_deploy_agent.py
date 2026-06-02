from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path

import deploy_agent


class LogCleanupTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.original_log_dir = deploy_agent.LOG_DIR
        self.original_retention_days = deploy_agent.LOG_RETENTION_DAYS
        deploy_agent.LOG_DIR = Path(self.temp_dir.name)
        deploy_agent.LOG_RETENTION_DAYS = 30

    def tearDown(self) -> None:
        deploy_agent.LOG_DIR = self.original_log_dir
        deploy_agent.LOG_RETENTION_DAYS = self.original_retention_days
        self.temp_dir.cleanup()

    def write_file(self, name: str, age_days: int, now: float) -> Path:
        path = deploy_agent.LOG_DIR / name
        path.write_text("log\n", encoding="utf-8")
        mtime = now - (age_days * deploy_agent.SECONDS_PER_DAY)
        os.utime(path, (mtime, mtime))
        return path

    def test_cleanup_old_logs_only_deletes_expired_log_files(self) -> None:
        now = 1_800_000_000.0
        old_log = self.write_file("old.log", 31, now)
        fresh_log = self.write_file("fresh.log", 29, now)
        old_text = self.write_file("old.txt", 31, now)

        deleted = deploy_agent.cleanup_old_logs(now=now)

        self.assertEqual(deleted, 1)
        self.assertFalse(old_log.exists())
        self.assertTrue(fresh_log.exists())
        self.assertTrue(old_text.exists())

    def test_cleanup_old_logs_can_be_disabled(self) -> None:
        now = 1_800_000_000.0
        old_log = self.write_file("old.log", 31, now)
        deploy_agent.LOG_RETENTION_DAYS = 0

        deleted = deploy_agent.cleanup_old_logs(now=now)

        self.assertEqual(deleted, 0)
        self.assertTrue(old_log.exists())


if __name__ == "__main__":
    unittest.main()
