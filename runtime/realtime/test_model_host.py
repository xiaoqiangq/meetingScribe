import subprocess
import sys
import unittest
from unittest.mock import Mock, patch

from model_host import ModelHost


class ModelHostTest(unittest.TestCase):
    def setUp(self):
        self.now = 0
        self.host = ModelHost(clock=lambda: self.now)
        self.host._request = Mock(return_value=(200, b'{"id":"meeting"}'))

    def warm(self):
        self.host.state = "ready"
        self.host.process = Mock()
        self.host.process.poll.return_value = None

    def test_status_never_loads_models(self):
        self.host._spawn = Mock()
        self.assertTrue(self.host.status()["available"])
        self.assertFalse(self.host.status()["models_loaded"])
        self.host.reap()
        self.host._spawn.assert_not_called()
        self.host._request.assert_not_called()

    def test_cold_start_warms_once_and_reuses_child(self):
        child = Mock()
        child.poll.return_value = None
        self.host._spawn = Mock(return_value=child)
        self.host._request.side_effect = [
            (200, b'{"available":true}'), (200, b'{"id":"meeting"}'),
            (200, b'{"available":true}'), (200, b'{"id":"meeting"}'),
        ]
        self.host.call("/sessions")
        self.assertEqual(self.host.active_id, "meeting")
        self.host.call("/sessions")
        self.host._spawn.assert_called_once()
        self.assertEqual(self.host.state, "ready")

    def test_recording_and_paused_heartbeats_prevent_unload(self):
        self.warm()
        self.host.active_id = "meeting"
        self.host._stop = Mock()
        for self.now in range(30, 1800, 30):
            self.host.call("/sessions/meeting/heartbeat")
            self.host.reap()
        self.host._stop.assert_not_called()

    def test_finished_session_unloads_only_after_idle_delay(self):
        self.warm()
        self.host.active_id = "meeting"
        self.host._request.return_value = (200, b'{"finished":true}')
        self.host._stop = Mock()
        self.host.call("/sessions/meeting/finish")
        self.assertIsNone(self.host.active_id)
        self.now = 299
        self.host.reap()
        self.host._stop.assert_not_called()
        self.now = 300
        self.host.reap()
        self.host._stop.assert_called_once()

    def test_queued_finalization_does_not_unload(self):
        self.warm()
        self.host.active_id = "meeting"
        self.host._request.return_value = (200, b'{"finished":false}')
        self.host._stop = Mock()
        for self.now in range(30, 600, 30):
            self.host.call("/sessions/meeting/finish")
            self.host.reap()
        self.assertEqual(self.host.active_id, "meeting")
        self.host._stop.assert_not_called()

    def test_abandoned_browser_is_cancelled_then_unloaded(self):
        self.warm()
        self.host.active_id = "meeting"
        self.host._stop = Mock()
        self.now = 121
        self.host.reap()
        self.host._request.assert_called_once_with("/sessions/meeting/cancel", b"")
        self.host._stop.assert_not_called()
        self.now = 421
        self.host.reap()
        self.host._stop.assert_called_once()

    def test_expired_result_does_not_load_models(self):
        code, _ = self.host.call("/sessions/old/result")
        self.assertEqual(code, 404)
        self.host._request.assert_not_called()

    def test_failed_loading_cleans_up_and_allows_retry(self):
        child = Mock()
        child.poll.return_value = 1
        self.host._spawn = Mock(return_value=child)
        self.host._stop = Mock()
        with self.assertRaises(RuntimeError):
            self.host.call("/sessions")
        self.host._stop.assert_called_once()
        self.assertEqual(self.host.state, "error")
        self.assertTrue(self.host.status()["available"])

    def test_loading_timeout_rejects_unrelated_process_on_model_port(self):
        child = Mock()
        child.poll.return_value = None
        self.host._spawn = Mock(return_value=child)
        self.host.load_seconds = 2
        self.host.instance = "expected-worker"
        self.host._request.return_value = (200, b'{"available":true,"model_instance":"old-worker"}')
        self.host._stop = Mock()
        self.host.stopped = Mock()
        self.host.stopped.is_set.return_value = False
        def advance(_):
            self.now += 1
        self.host.stopped.wait.side_effect = advance
        with self.assertRaises(TimeoutError):
            self.host.call("/sessions")
        self.host._stop.assert_called_once()
        self.assertEqual(self.host.state, "error")

    def test_model_exit_during_idle_shutdown_kills_entire_worker_group(self):
        self.warm()
        self.host.process.pid = 12345
        with patch("model_host.os.killpg") as kill:
            self.host._stop()
        import signal
        self.assertEqual(kill.call_args_list, [
            unittest.mock.call(12345, signal.SIGTERM), unittest.mock.call(12345, signal.SIGKILL)])

    def test_stop_exits_real_child_and_clears_gpu_references(self):
        self.host.process = subprocess.Popen(
            [sys.executable, "-c", "import time; time.sleep(60)"], start_new_session=True)
        child = self.host.process
        self.host.active_id = "meeting"
        self.host.close()
        self.assertIsNotNone(child.poll())
        self.assertIsNone(self.host.process)
        self.assertIsNone(self.host.active_id)
        self.assertEqual(self.host.state, "cold")


if __name__ == "__main__":
    unittest.main()
