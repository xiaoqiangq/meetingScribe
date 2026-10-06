package llm

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestProviderStreamRequiresCompletionAndRejectsTruncation(t *testing.T) {
	cases := []struct {
		name, body string
		failure    bool
	}{
		{"quiet EOF", `data: {"choices":[{"delta":{"content":"partial"}}]}` + "\n\n", true},
		{"length", `data: {"choices":[{"delta":{"content":"partial"},"finish_reason":"length"}]}` + "\n\ndata: [DONE]\n\n", true},
		{"done", `data: {"choices":[{"delta":{"content":"complete"},"finish_reason":"stop"}]}` + "\n\ndata: [DONE]\n\n", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "text/event-stream")
				w.Write([]byte(tc.body))
			}))
			defer server.Close()
			url := server.URL
			chunks, errors := NewOpenAIService("synthetic-test-key", &url).ChatCompletionStream(context.Background(), "mock", nil, 0)
			for range chunks {
			}
			failed := false
			for err := range errors {
				if err != nil {
					failed = true
				}
			}
			if failed != tc.failure {
				t.Fatalf("error=%v, expected=%v", failed, tc.failure)
			}
		})
	}
}
