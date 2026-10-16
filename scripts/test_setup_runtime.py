"""Installer failure/retry checks without Docker, downloads or GPU access.

Fixtures are retained in individual temporary directories; no recursive cleanup.
"""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import setup_runtime


class RuntimeSetupTests(unittest.TestCase):
    def setUp(self):
        self.runtime = Path(tempfile.mkdtemp(prefix="meetingscribe-runtime-test-"))

    def prepare(self, runner):
        with patch.object(setup_runtime.sys, "version_info", (3, 12)), patch.object(setup_runtime, "run", side_effect=runner):
            setup_runtime.prepare(self.runtime)

    def test_retry_skips_successful_dependencies_but_checks_models_again(self):
        calls = []
        self.prepare(lambda command: calls.append(command))
        calls.clear()
        self.prepare(lambda command: calls.append(command))
        self.assertFalse(any("pip" in command or "uv" == command[0] for command in calls))
        self.assertTrue(any(str(setup_runtime.SOURCE / "scripts/download_models.py") in command for command in calls))
        self.assertEqual(calls[-1][1], str(setup_runtime.SOURCE / "scripts/check_runtime.py"))

    def test_failure_never_marks_failed_step_complete_and_can_resume(self):
        calls = []

        def fail_packages(command):
            calls.append(command)
            if "-r" in command:
                raise subprocess.CalledProcessError(42, command)

        with self.assertRaises(subprocess.CalledProcessError):
            self.prepare(fail_packages)
        state = json.loads((self.runtime / ".meetingscribe-setup.json").read_text())
        self.assertIn("qwen3-asr-env:torch", state["completed"])
        self.assertNotIn("qwen3-asr-env:packages", state["completed"])
        calls.clear()
        self.prepare(lambda command: calls.append(command))
        self.assertFalse(any(command[-1] == str(self.runtime / "qwen3-asr-env") and "venv" in command for command in calls))
        self.assertEqual(calls[2][-2], "-r")  # first resumed dependency step

    def test_unmanaged_environment_is_refused_before_commands(self):
        (self.runtime / "qwen3-asr-env").mkdir()
        calls = []
        with self.assertRaisesRegex(SystemExit, "Unmanaged environment"):
            self.prepare(lambda command: calls.append(command))
        self.assertEqual(calls, [])
        self.assertFalse((self.runtime / ".meetingscribe-setup.json").exists())

    def test_changed_recipe_is_refused(self):
        (self.runtime / ".meetingscribe-setup.json").write_text(json.dumps({"recipe": "old", "completed": []}))
        with self.assertRaisesRegex(SystemExit, "Dependency recipe changed"):
            self.prepare(lambda command: self.fail("Must not install anything"))

    def test_concurrent_setup_is_refused(self):
        with (self.runtime / ".meetingscribe-setup.lock").open("a") as lock:
            setup_runtime.fcntl.flock(lock, setup_runtime.fcntl.LOCK_EX | setup_runtime.fcntl.LOCK_NB)
            with self.assertRaisesRegex(SystemExit, "in progress"):
                self.prepare(lambda command: self.fail("Must not install anything"))

    def test_interrupted_uv_init_is_resumable(self):
        def interrupt(command):
            if command[:2] == ["uv", "init"]:
                project = self.runtime / "WhisperX"
                project.mkdir()
                (project / "pyproject.toml").write_text('[project]\nname = "whisperx-runtime"\n')
                raise subprocess.CalledProcessError(42, command)

        with self.assertRaises(subprocess.CalledProcessError):
            self.prepare(interrupt)
        calls = []
        self.prepare(lambda command: calls.append(command))
        self.assertFalse(any(command[:2] == ["uv", "init"] for command in calls))
        self.assertTrue(any(command[:2] == ["uv", "add"] for command in calls))


class LauncherTests(unittest.TestCase):
    def setUp(self):
        self.fixture = Path(tempfile.mkdtemp(prefix="meetingscribe-launcher-test-"))
        self.log = self.fixture / "calls.jsonl"
        self.env = {**os.environ, "PATH": str(self.fixture) + os.pathsep + os.environ["PATH"], "SETUP_TEST_LOG": str(self.log)}
        # Use the current interpreter in these standalone executable stubs.
        interpreter = setup_runtime.sys.executable
        docker = self.fixture / "docker"
        docker.write_text(f'''#!{interpreter}
import json, os, sys
args = sys.argv[1:]
with open(os.environ["SETUP_TEST_LOG"], "a") as stream:
    stream.write(json.dumps(args) + "\\n")
if args == ["compose", "version", "--short"]:
    print(os.environ.get("SETUP_TEST_VERSION", "2.30.0"))
if "ps" in args and os.environ.get("SETUP_TEST_RUNNING"):
    print("existing-container")
if "/app/scripts/setup_runtime.py" in args and os.environ.get("SETUP_TEST_FAIL"):
    sys.exit(42)
''')
        docker.chmod(0o755)
        uname = self.fixture / "uname"
        uname.write_text('#!/bin/sh\nif [ "$1" = "-s" ]; then echo Linux; else echo x86_64; fi\n')
        uname.chmod(0o755)
        smi = self.fixture / "nvidia-smi"
        smi.write_text('#!/bin/sh\nexit 0\n')
        smi.chmod(0o755)

    def launch(self):
        result = subprocess.run(["/bin/bash", str(setup_runtime.SOURCE / "install.sh")], env=self.env, capture_output=True, text=True)
        calls = [json.loads(line) for line in self.log.read_text().splitlines()]
        return result, calls

    def test_success_checks_gpu_and_models_before_start(self):
        result, calls = self.launch()
        self.assertEqual(result.returncode, 0, result.stderr)
        gpu = next(i for i, call in enumerate(calls) if "run" in call and "nvidia-smi" in call)
        models = next(i for i, call in enumerate(calls) if "/app/scripts/setup_runtime.py" in call)
        start = next(i for i, call in enumerate(calls) if "up" in call)
        self.assertLess(gpu, models)
        self.assertLess(models, start)
        self.assertIn("http://localhost:", result.stdout)
        self.assertTrue(all("/dev/null" in call for call in calls if "--project-name" in call))

    def test_model_failure_does_not_start_service(self):
        self.env["SETUP_TEST_FAIL"] = "1"
        result, calls = self.launch()
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(any("up" in call for call in calls))
        self.assertIn("rerun", result.stderr)

    def test_running_installation_is_not_mutated(self):
        self.env["SETUP_TEST_RUNNING"] = "1"
        result, calls = self.launch()
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(any("build" in call or "run" in call or "up" in call for call in calls))

    def test_old_compose_is_rejected_before_build(self):
        self.env["SETUP_TEST_VERSION"] = "v2.29.7"
        result, calls = self.launch()
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(any("build" in call for call in calls))


if __name__ == "__main__":
    unittest.main()
