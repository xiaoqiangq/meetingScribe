package middleware

import (
	"compress/gzip"
	"github.com/gin-gonic/gin"
	"io"
	"net/http/httptest"
	"testing"
)

func TestCompressionPreservesResponses(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, tc := range []struct {
		name, method, encoding, contentType string
		status                              int
		optOut, stream, compressed          bool
	}{
		{name: "json", method: "GET", encoding: "gzip", contentType: "application/json", status: 200, compressed: true},
		{name: "css", method: "GET", encoding: "gzip", contentType: "text/css", status: 200, compressed: true},
		{name: "gzip disabled", method: "GET", encoding: "gzip;q=0", contentType: "application/json", status: 200},
		{name: "plain client", method: "GET", contentType: "application/json", status: 200},
		{name: "audio range", method: "GET", encoding: "gzip", contentType: "audio/wav", status: 206},
		{name: "binary", method: "GET", encoding: "gzip", contentType: "application/octet-stream", status: 200},
		{name: "SSE", method: "GET", encoding: "gzip", contentType: "text/event-stream", status: 200, stream: true},
		{name: "opt out", method: "GET", encoding: "gzip", contentType: "application/json", status: 200, optOut: true},
		{name: "HEAD", method: "HEAD", encoding: "gzip", contentType: "application/json", status: 200},
		{name: "not modified", method: "GET", encoding: "gzip", status: 304},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := gin.New()
			r.Use(CompressionMiddleware())
			r.Handle(tc.method, "/", func(c *gin.Context) {
				if tc.optOut {
					c.Header("X-No-Compression", "1")
				}
				if tc.status == 206 {
					c.Header("Content-Range", "bytes 0-6/7")
				}
				if tc.stream {
					c.Header("Content-Type", tc.contentType)
					c.Writer.Flush()
				}
				if tc.method == "HEAD" || tc.status == 304 {
					c.Status(tc.status)
					return
				}
				c.Data(tc.status, tc.contentType, []byte("payload"))
			})
			request := httptest.NewRequest(tc.method, "/", nil)
			request.Header.Set("Accept-Encoding", tc.encoding)
			w := httptest.NewRecorder()
			r.ServeHTTP(w, request)
			if w.Code != tc.status {
				t.Fatalf("status %d", w.Code)
			}
			compressed := w.Header().Get("Content-Encoding") == "gzip"
			if compressed != tc.compressed {
				t.Fatalf("compression=%v", compressed)
			}
			if tc.method == "HEAD" || tc.status == 304 {
				return
			}
			body := w.Body.Bytes()
			if compressed {
				gz, err := gzip.NewReader(w.Body)
				if err != nil {
					t.Fatal(err)
				}
				body, err = io.ReadAll(gz)
				if err != nil {
					t.Fatal(err)
				}
				gz.Close()
			}
			if string(body) != "payload" {
				t.Fatalf("body %q", body)
			}
			if tc.stream && !w.Flushed {
				t.Fatal("SSE did not flush")
			}
		})
	}
}
