"""Preview or copy legacy uploads into stable account directories; never delete files.

Run apply only with application/watchdog/model services stopped. Database paths
can use a different prefix (e.g. an isolated runtime mount) from physical paths.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import sqlite3


SAFE_NAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,49}\Z")
FALLBACK_NAME = re.compile(r"_user-[1-9][0-9]*\Z")
LEGACY_JOB_NAME = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\Z", re.IGNORECASE)
JOB_PATHS = ("audio_path", "merged_audio_path", "aup_file_path", "multi_track_folder")


def digest(path):
    value = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1 << 20), b""):
            value.update(block)
    return value.hexdigest()


def safe_name(name):
    return bool(SAFE_NAME.fullmatch(name) or FALLBACK_NAME.fullmatch(name)) and not LEGACY_JOB_NAME.fullmatch(name) and name.lower() != "quick_transcriptions"


def namespaces(users):
    result, used = {}, set()
    for user in users:
        name = user.get("upload_directory")
        if name is not None:
            if not safe_name(name) or name.lower() in used:
                raise ValueError("Invalid or duplicate existing account upload directory")
            result[user["id"]] = name
            used.add(name.lower())
    for user in users:
        if user["id"] in result:
            continue
        name = user["username"]
        if not SAFE_NAME.fullmatch(name) or LEGACY_JOB_NAME.fullmatch(name) or name.lower() == "quick_transcriptions" or name.lower() in used:
            name = f"_user-{user['id']}"
        if name.lower() in used:
            raise ValueError("Account upload directory collision")
        result[user["id"]] = name
        used.add(name.lower())
    return result


def ordinary_path(root, relative):
    """Reject symlinks in every path component and traversal outside root."""
    if relative.is_absolute() or ".." in relative.parts or not relative.parts:
        raise ValueError("Upload path is outside storage")
    current = root
    for part in relative.parts:
        current = current / part
        if current.is_symlink():
            raise ValueError("Upload migration refuses symlinks")
    return current


def build_plan(db, physical_root, stored_root):
    physical_root = Path(physical_root).resolve(strict=True)
    stored_root = PurePosixPath(stored_root)
    users = [dict(row) for row in db.execute("SELECT * FROM users ORDER BY id")]
    folders = namespaces(users)
    reserved = {name.lower(): owner for owner, name in folders.items()}
    files, changes, missing = {}, [], []
    jobs = [dict(row) for row in db.execute("SELECT * FROM transcription_jobs ORDER BY id")]
    owners = {job["id"]: job["owner_id"] for job in jobs}
    active = [job["id"] for job in jobs if job.get("status") in ("pending", "processing", "realtime") or job.get("merge_status") in ("pending", "processing")]
    tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    if "summaries" in tables:
        active += [row[0] for row in db.execute("SELECT id FROM summaries WHERE status IN ('pending','processing','generating')")]

    def destination(value, owner):
        if not value:
            return value
        if owner not in folders:
            raise ValueError("A stored upload has no valid owner")
        path = PurePosixPath(value)
        try:
            relative = path.relative_to(stored_root)
        except ValueError:
            raise ValueError("Referenced upload is outside the configured stored uploads root") from None
        source = ordinary_path(physical_root, relative)
        if relative.parts[0].lower() in reserved:
            if reserved[relative.parts[0].lower()] != owner:
                raise ValueError("Referenced upload belongs to another account directory")
            return value
        new_relative = PurePosixPath(folders[owner]) / relative
        target = ordinary_path(physical_root, new_relative)
        if not source.exists():
            missing.append(value)
            return value
        candidates = [source]
        if source.is_dir():
            candidates = []
            for child in source.rglob("*"):
                if child.is_symlink():
                    raise ValueError("Upload migration refuses symlinks")
                if child.is_file():
                    candidates.append(child)
        elif not source.is_file():
            raise ValueError("Upload migration only copies ordinary files")
        for child in candidates:
            rel = child.relative_to(physical_root)
            dest = ordinary_path(physical_root, PurePosixPath(folders[owner]) / PurePosixPath(rel.as_posix()))
            sha = digest(child)
            if dest.exists() and (not dest.is_file() or digest(dest) != sha):
                raise ValueError("Existing destination differs; no files were overwritten")
            item = {"source": str(child), "destination": str(dest), "sha256": sha, "bytes": child.stat().st_size}
            if str(child) in files and files[str(child)]["destination"] != str(dest):
                raise ValueError("One file is referenced by multiple owners")
            files[str(child)] = item
        return str(stored_root / new_relative)

    def change(table, row, key, owner):
        old = row.get(key)
        if not old:
            return
        new = destination(old, owner)
        if new != old:
            changes.append({"table": table, "id": row["id"], "column": key, "old": old, "new": new})

    for job in jobs:
        for key in JOB_PATHS:
            change("transcription_jobs", job, key, job["owner_id"])
        old = job.get("quick_cleanup_files")
        if old:
            paths = json.loads(old)
            if not isinstance(paths, list) or not all(isinstance(p, str) for p in paths):
                raise ValueError("Invalid quick cleanup manifest")
            # Cleanup also records transcript/temp paths, which remain in place.
            new = [destination(p, job["owner_id"]) if PurePosixPath(p).is_relative_to(stored_root) else p for p in paths]
            if new != paths:
                changes.append({"table": "transcription_jobs", "id": job["id"], "column": "quick_cleanup_files", "old": old, "new": json.dumps(new)})
        # Preserve sibling conversion scratch alongside its source recording.
        audio = job.get("audio_path")
        if audio and PurePosixPath(audio).is_relative_to(stored_root):
            converted = str(PurePosixPath(audio).with_suffix("")) + "_converted.wav"
            rel = PurePosixPath(converted).relative_to(stored_root)
            if ordinary_path(physical_root, rel).exists():
                destination(converted, job["owner_id"])
    if "multi_track_files" in tables:
        for row in db.execute("SELECT * FROM multi_track_files"):
            track = dict(row)
            change("multi_track_files", track, "file_path", owners[track["transcription_job_id"]])

    # No guessed attribution: unrelated and orphaned files stay where they are.
    legacy_files = [p for p in physical_root.rglob("*") if p.is_file() and p.relative_to(physical_root).parts[0].lower() not in reserved]
    unchanged = [str(p) for p in legacy_files if str(p) not in files]
    return {"status": "preview", "physical_root": str(physical_root), "stored_root": str(stored_root),
            "users": [{"id": u["id"], "username": u["username"], "old_directory": u.get("upload_directory"), "directory": folders[u["id"]]} for u in users],
            "files": list(files.values()), "changes": changes, "missing": sorted(set(missing)), "unattributed_files": unchanged, "active_tasks": active}


def apply_plan(db, plan, backup):
    if plan["active_tasks"]:
        raise ValueError("Active tasks prevent migration")
    backup = Path(backup)
    if backup.exists() or backup.is_symlink():
        raise ValueError("Database backup must be a new explicit file")
    # SQLite backup includes committed WAL contents. Never restore it blindly
    # after new recordings have been created; use recorded path changes instead.
    fd = os.open(backup, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    os.close(fd)
    target = sqlite3.connect(backup)
    try:
        db.backup(target)
    finally:
        target.close()
    root = Path(plan["physical_root"])
    for user in plan["users"]:
        folder = ordinary_path(root, PurePosixPath(user["directory"]))
        folder.mkdir(mode=0o700, exist_ok=True)
    for item in plan["files"]:
        source, dest = Path(item["source"]), Path(item["destination"])
        ordinary_path(root, PurePosixPath(source.relative_to(root).as_posix()))
        ordinary_path(root, PurePosixPath(dest.relative_to(root).as_posix()))
        if digest(source) != item["sha256"]:
            raise ValueError("Source changed after preview")
        dest.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        if not dest.exists():
            with source.open("rb") as src, dest.open("xb") as out:
                os.chmod(dest, 0o600)
                for block in iter(lambda: src.read(1 << 20), b""):
                    out.write(block)
                out.flush()
                os.fsync(out.fileno())
        if digest(dest) != item["sha256"] or digest(source) != item["sha256"]:
            raise ValueError("Copy verification failed; database paths unchanged")
    with db:
        db.execute("BEGIN IMMEDIATE")
        columns = {row[1] for row in db.execute("PRAGMA table_info(users)")}
        if "upload_directory" not in columns:
            db.execute("ALTER TABLE users ADD COLUMN upload_directory TEXT")
        db.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_upload_directory ON users(upload_directory)")
        for user in plan["users"]:
            row = db.execute("SELECT username,upload_directory FROM users WHERE id=?", (user["id"],)).fetchone()
            if row is None or row[0] != user["username"] or row[1] != user["old_directory"]:
                raise ValueError("Account changed after preview")
            db.execute("UPDATE users SET upload_directory=? WHERE id=?", (user["directory"], user["id"]))
        for change in plan["changes"]:
            table, column = change["table"], change["column"]
            sql = f'UPDATE "{table}" SET "{column}"=? WHERE id=? AND "{column}"=?'
            if db.execute(sql, (change["new"], change["id"], change["old"])).rowcount != 1:
                raise ValueError("Project paths changed after preview")
    plan.update(status="applied", database_backup=str(backup), original_files_preserved=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", required=True)
    parser.add_argument("--uploads-root", required=True, help="Physical uploads directory")
    parser.add_argument("--stored-uploads-root", required=True, help="Uploads prefix recorded in SQLite")
    parser.add_argument("--report", required=True, help="New private JSON report; contains account/path metadata")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--services-stopped", action="store_true")
    parser.add_argument("--backup", help="New SQLite backup required with --apply")
    args = parser.parse_args()
    if args.apply and (not args.services_stopped or not args.backup):
        parser.error("--apply requires stopped services, --services-stopped and --backup")
    report = Path(args.report)
    if report.exists() or report.is_symlink():
        parser.error("report must be a new explicit file")
    database = Path(args.database).resolve(strict=True)
    db = sqlite3.connect(database.as_uri() + ("?mode=rw" if args.apply else "?mode=ro"), uri=True)
    db.row_factory = sqlite3.Row
    try:
        plan = build_plan(db, args.uploads_root, args.stored_uploads_root)
        # Persist rollback metadata before any copies or DB writes.
        with report.open("x") as stream:
            os.chmod(report, 0o600)
            json.dump(plan, stream, indent=2)
        if args.apply:
            apply_plan(db, plan, args.backup)
            report.write_text(json.dumps(plan, indent=2) + "\n")
        print(json.dumps({"status": plan["status"], "accounts": len(plan["users"]), "files": len(plan["files"]),
                          "bytes": sum(p["bytes"] for p in plan["files"]), "path_changes": len(plan["changes"]),
                          "missing_paths": len(plan["missing"]), "unattributed_files": len(plan["unattributed_files"]),
                          "active_tasks": len(plan["active_tasks"])}))
    finally:
        db.close()


if __name__ == "__main__":
    main()
