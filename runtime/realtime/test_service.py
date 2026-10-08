"""Gateway protocol checks with a fake host; no model imports or GPU required."""
import importlib.util
import unittest
from unittest.mock import Mock, patch

has_http = all(importlib.util.find_spec(name) for name in ("fastapi", "httpx"))


@unittest.skipUnless(has_http, "Optional HTTP service dependencies are not installed")
class GatewayTest(unittest.TestCase):
    def setUp(self):
        from fastapi.testclient import TestClient
        import service
        self.host = Mock()
        self.host.status.return_value = dict(available=True, models_loaded=False, model_state="cold")
        self.host.call.return_value = (200, b'{"id":"meeting"}')
        self.patch = patch.object(service, "host", self.host)
        self.patch.start()
        self.addCleanup(self.patch.stop)
        self.client = TestClient(service.app)

    def test_status_is_cold_but_startable_without_loading(self):
        reply = self.client.get("/status")
        self.assertEqual(reply.status_code, 200)
        self.assertTrue(reply.json()["available"])
        self.assertFalse(reply.json()["models_loaded"])
        self.host.call.assert_not_called()

    def test_start_loads_only_on_explicit_request(self):
        reply = self.client.post("/sessions")
        self.assertEqual(reply.json()["id"], "meeting")
        self.host.call.assert_called_once_with("/sessions", b"")

    def test_pcm_body_and_sequence_are_preserved(self):
        self.client.post("/sessions/meeting/chunk?sequence=3", content=b"\x00\x10" * 16000)
        self.host.call.assert_called_once_with("/sessions/meeting/chunk?sequence=3", b"\x00\x10" * 16000)

    def test_oversized_body_is_rejected_before_model_call(self):
        reply = self.client.post("/sessions/meeting/chunk?sequence=0", content=b"x" * 64001)
        self.assertEqual(reply.status_code, 413)
        self.host.call.assert_not_called()

    def test_loading_failure_returns_retryable_response(self):
        self.host.call.side_effect = RuntimeError("load failed")
        with patch("traceback.print_exc"):
            reply = self.client.post("/sessions")
        self.assertEqual(reply.status_code, 503)


if __name__ == "__main__":
    unittest.main()
