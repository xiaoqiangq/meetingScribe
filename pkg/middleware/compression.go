package middleware

import (
	"compress/gzip"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"

	"github.com/gin-gonic/gin"
)

const (
	DefaultCompression = gzip.DefaultCompression
	BestCompression    = gzip.BestCompression
	BestSpeed          = gzip.BestSpeed
)

var gzipWriterPool = sync.Pool{New: func() interface{} {
	writer, _ := gzip.NewWriterLevel(io.Discard, DefaultCompression)
	return writer
}}

// Decide on first output, when the handler has set its response headers.
// This preserves streaming, range downloads and explicit opt-outs.
type gzipWriter struct {
	gin.ResponseWriter
	level   int
	gw      *gzip.Writer
	decided bool
	pooled  bool
}

func acceptsGzip(header string) bool {
	for _, coding := range strings.Split(header, ",") {
		parts := strings.Split(strings.TrimSpace(coding), ";")
		if !strings.EqualFold(parts[0], "gzip") {
			continue
		}
		quality := 1.0
		for _, param := range parts[1:] {
			key, value, ok := strings.Cut(strings.TrimSpace(param), "=")
			if ok && strings.EqualFold(key, "q") {
				parsed, err := strconv.ParseFloat(value, 64)
				if err != nil {
					quality = 0
				} else {
					quality = parsed
				}
			}
		}
		return quality > 0
	}
	return false
}

func (g *gzipWriter) prepare(data []byte) {
	if g.decided {
		return
	}
	g.decided = true
	header := g.Header()
	status := g.Status()
	if status < 200 || status == 204 || status == 304 || status == 206 ||
		header.Get("Content-Range") != "" || header.Get("Content-Encoding") != "" ||
		header.Get("X-No-Compression") != "" {
		return
	}
	contentType := header.Get("Content-Type")
	if contentType == "" && len(data) > 0 {
		contentType = http.DetectContentType(data)
		header.Set("Content-Type", contentType)
	}
	contentType = strings.ToLower(strings.Split(contentType, ";")[0])
	switch contentType {
	case "application/json", "application/javascript", "text/html", "text/css",
		"text/plain", "text/xml", "application/xml", "application/x-javascript", "image/svg+xml":
	default:
		return
	}
	if g.level == DefaultCompression {
		g.gw = gzipWriterPool.Get().(*gzip.Writer)
		g.pooled = true
		g.gw.Reset(g.ResponseWriter)
	} else {
		g.gw, _ = gzip.NewWriterLevel(g.ResponseWriter, g.level)
	}
	if g.gw == nil {
		return
	}
	header.Set("Content-Encoding", "gzip")
	header.Add("Vary", "Accept-Encoding")
	header.Del("Content-Length")
}

func (g *gzipWriter) Write(data []byte) (int, error) {
	g.prepare(data)
	if g.gw != nil {
		return g.gw.Write(data)
	}
	return g.ResponseWriter.Write(data)
}
func (g *gzipWriter) WriteString(data string) (int, error) { return g.Write([]byte(data)) }
func (g *gzipWriter) WriteHeaderNow() {
	g.prepare(nil)
	g.ResponseWriter.WriteHeaderNow()
}
func (g *gzipWriter) Flush() {
	// A handler that flushes before writing is streaming; preserve immediate output.
	if !g.decided {
		g.decided = true
	}
	if g.gw != nil {
		_ = g.gw.Flush()
	}
	g.ResponseWriter.Flush()
}
func (g *gzipWriter) close() {
	if g.gw != nil {
		_ = g.gw.Close()
		if g.pooled {
			g.gw.Reset(io.Discard)
			gzipWriterPool.Put(g.gw)
		}
	}
}

func CompressionMiddleware() gin.HandlerFunc {
	return CompressionMiddlewareWithLevel(DefaultCompression)
}
func CompressionMiddlewareWithLevel(level int) gin.HandlerFunc {
	return func(c *gin.Context) {
		if c.Request.Method == "HEAD" || strings.EqualFold(c.Request.Header.Get("Connection"), "Upgrade") ||
			!acceptsGzip(c.Request.Header.Get("Accept-Encoding")) {
			c.Next()
			return
		}
		original := c.Writer
		writer := &gzipWriter{ResponseWriter: original, level: level}
		c.Writer = writer
		defer func() { writer.close(); c.Writer = original }()
		c.Next()
	}
}

func NoCompressionMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("X-No-Compression", "1")
		c.Next()
	}
}
