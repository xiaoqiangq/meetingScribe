"""Migration fixtures are retained; no recursive cleanup or real meeting data."""
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest

from migrate_user_uploads import apply_plan, build_plan, namespaces


class UserUploadsMigrationTest(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="meetingscribe-storage-migration-"))
        self.uploads = self.root / "uploads"
        self.uploads.mkdir()
        self.db = sqlite3.connect(self.root / "test.db")
        self.db.row_factory = sqlite3.Row
        self.addCleanup(self.db.close)
        self.db.executescript("""
          CREATE TABLE users(id INTEGER PRIMARY KEY, username TEXT);
          INSERT INTO users VALUES(1,'alice'),(2,'bob');
          CREATE TABLE transcription_jobs(id TEXT PRIMARY KEY,owner_id INTEGER,audio_path TEXT,
            merged_audio_path TEXT,aup_file_path TEXT,multi_track_folder TEXT,quick_cleanup_files TEXT,
            status TEXT,merge_status TEXT,deleted_at TEXT);
          CREATE TABLE multi_track_files(id INTEGER PRIMARY KEY,transcription_job_id TEXT,file_path TEXT);
        """)

    def job(self, identifier, owner, relative, **extra):
        path = self.uploads / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"fixture-audio-" + identifier.encode())
        values = dict(id=identifier, owner_id=owner, audio_path="/app/data/uploads/" + relative, status="completed", **extra)
        columns = ",".join(values)
        self.db.execute(f"INSERT INTO transcription_jobs({columns}) VALUES({','.join('?' for _ in values)})", list(values.values()))
        self.db.commit()
        return path

    def plan(self):
        return build_plan(self.db, self.uploads, "/app/data/uploads")

    def test_preview_then_apply_preserves_audio_and_ownership(self):
        a = self.job("a", 1, "a.wav")
        b = self.job("b", 2, "b.mp3")
        plan = self.plan()
        self.assertFalse((self.uploads / "alice").exists())
        self.assertEqual(len(plan["changes"]), 2)
        apply_plan(self.db, plan, self.root / "backup.db")
        for old, user in [(a,"alice"),(b,"bob")]:
            self.assertEqual(old.read_bytes(), (self.uploads / user / old.name).read_bytes())
        self.assertEqual([tuple(r) for r in self.db.execute("SELECT owner_id,audio_path FROM transcription_jobs ORDER BY id")],
                         [(1,"/app/data/uploads/alice/a.wav"),(2,"/app/data/uploads/bob/b.mp3")])
        self.assertEqual(len(self.plan()["changes"]), 0)
        backup = sqlite3.connect(self.root / "backup.db")
        self.assertEqual(backup.execute("SELECT audio_path FROM transcription_jobs WHERE id='a'").fetchone()[0], "/app/data/uploads/a.wav")
        backup.close()

    def test_multitrack_paths_and_soft_deleted_records_are_preserved(self):
        self.job("multi", 1, "multi/track.wav", multi_track_folder="/app/data/uploads/multi", deleted_at="2020-01-01")
        self.db.execute("INSERT INTO multi_track_files VALUES(1,'multi','/app/data/uploads/multi/track.wav')")
        self.db.commit()
        plan = self.plan()
        self.assertEqual(len(plan["files"]), 1)
        apply_plan(self.db, plan, self.root / "backup.db")
        self.assertEqual(self.db.execute("SELECT file_path FROM multi_track_files").fetchone()[0], "/app/data/uploads/alice/multi/track.wav")
        self.assertEqual(self.db.execute("SELECT deleted_at FROM transcription_jobs").fetchone()[0], "2020-01-01")

    def test_quick_cleanup_manifest_and_conversion_paths(self):
        self.job("quick", 2, "quick_transcriptions/quick.wav", quick_cleanup_files=json.dumps(["/app/data/uploads/quick_transcriptions/quick.wav", "/app/data/transcripts/quick/result.json"]))
        (self.uploads / "quick_transcriptions/quick_converted.wav").write_bytes(b"converted")
        plan = self.plan()
        apply_plan(self.db, plan, self.root / "backup.db")
        paths = json.loads(self.db.execute("SELECT quick_cleanup_files FROM transcription_jobs").fetchone()[0])
        self.assertEqual(paths, ["/app/data/uploads/bob/quick_transcriptions/quick.wav", "/app/data/transcripts/quick/result.json"])
        self.assertTrue((self.uploads / "bob/quick_transcriptions/quick_converted.wav").exists())

    def test_unowned_files_and_missing_recordings_are_not_guessed(self):
        source = self.job("a", 1, "a.wav")
        # A missing file is recorded explicitly and retains its old DB path.
        self.db.execute("UPDATE transcription_jobs SET audio_path='/app/data/uploads/missing.wav'")
        self.db.commit()
        plan = self.plan()
        self.assertIn(str(source.resolve()), plan["unattributed_files"])
        self.assertEqual(plan["missing"], ["/app/data/uploads/missing.wav"])
        self.assertEqual(plan["changes"], [])

    def test_destination_conflict_and_symlinks_fail_closed(self):
        self.job("a", 1, "a.wav")
        (self.uploads / "alice").mkdir()
        (self.uploads / "alice/a.wav").write_bytes(b"different")
        with self.assertRaisesRegex(ValueError, "destination differs"):
            self.plan()
        self.assertEqual(self.db.execute("SELECT audio_path FROM transcription_jobs").fetchone()[0], "/app/data/uploads/a.wav")
        # Separate fixture: a user directory symlink cannot redirect copies.
        self.db.execute("DELETE FROM transcription_jobs WHERE id='a'")
        self.db.commit()
        other = self.root / "other"
        other.mkdir()
        (self.uploads / "bob").symlink_to(other, target_is_directory=True)
        self.job("b", 2, "b.wav")
        with self.assertRaises(ValueError):
            self.plan()

    def test_active_task_and_changed_source_cannot_update_database(self):
        source = self.job("a", 1, "a.wav")
        self.db.execute("UPDATE transcription_jobs SET status='processing'")
        self.db.commit()
        with self.assertRaisesRegex(ValueError, "Active tasks"):
            apply_plan(self.db, self.plan(), self.root / "backup.db")
        self.assertFalse((self.root / "backup.db").exists())
        self.db.execute("UPDATE transcription_jobs SET status='completed'")
        self.db.commit()
        plan = self.plan()
        source.write_bytes(b"changed-after-preview")
        with self.assertRaisesRegex(ValueError, "Source changed"):
            apply_plan(self.db, plan, self.root / "backup.db")
        self.assertEqual(self.db.execute("SELECT audio_path FROM transcription_jobs").fetchone()[0], "/app/data/uploads/a.wav")

    def test_unsafe_names_collisions_and_existing_namespaces(self):
        users = [dict(id=1,username="renamed",upload_directory="alice"), dict(id=2,username="ALICE"), dict(id=3,username="../../escape"), dict(id=4,username="quick_transcriptions")]
        self.assertEqual(namespaces(users), {1:"alice", 2:"_user-2", 3:"_user-3", 4:"_user-4"})
        self.assertEqual(namespaces([dict(id=7,username="12345678-1234-1234-1234-123456789abc")]), {7:"_user-7"})
        with self.assertRaises(ValueError):
            namespaces([dict(id=1,username="a",upload_directory="../escape")])

    def test_database_changes_are_atomic_if_a_project_changes(self):
        self.job("a", 1, "a.wav")
        self.job("b", 2, "b.wav")
        plan = self.plan()
        self.db.execute("UPDATE transcription_jobs SET audio_path='/app/data/uploads/replaced.wav' WHERE id='b'")
        self.db.commit()
        with self.assertRaisesRegex(ValueError, "Project paths changed"):
            apply_plan(self.db, plan, self.root / "backup.db")
        self.assertEqual(self.db.execute("SELECT audio_path FROM transcription_jobs WHERE id='a'").fetchone()[0], "/app/data/uploads/a.wav")
        self.assertNotIn("upload_directory", [r[1] for r in self.db.execute("PRAGMA table_info(users)")])

    def test_cross_account_or_outside_reference_is_rejected(self):
        self.job("a", 1, "bob/a.wav")
        with self.assertRaisesRegex(ValueError, "another account"):
            self.plan()
        self.db.execute("UPDATE transcription_jobs SET audio_path='/outside/a.wav'")
        self.db.commit()
        with self.assertRaisesRegex(ValueError, "outside"):
            self.plan()


if __name__ == "__main__":
    unittest.main()
