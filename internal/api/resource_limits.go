package api

import (
	"github.com/gin-gonic/gin"
	"net/http"
	"os"
	"scriberr/internal/database"
	"scriberr/internal/models"
	"strconv"
	"strings"
	"sync"
	"time"
)

func envBytes(key string, fallback int64) int64 {
	n, e := strconv.ParseInt(os.Getenv(key), 10, 64)
	if e != nil || n <= 0 {
		return fallback
	}
	return n
}

type rateBucket struct {
	count int
	since time.Time
}

func loginLimiter() gin.HandlerFunc {
	var mu sync.Mutex
	buckets := map[string]rateBucket{}
	return func(c *gin.Context) {
		ip := c.ClientIP()
		now := time.Now()
		mu.Lock()
		if len(buckets) > 10000 {
			for key, b := range buckets {
				if now.Sub(b.since) > time.Minute {
					delete(buckets, key)
				}
			}
		}
		b := buckets[ip]
		if now.Sub(b.since) >= time.Minute {
			b = rateBucket{since: now}
		}
		limit := int(envBytes("LOGIN_REQUESTS_PER_MINUTE", 10))
		b.count++
		buckets[ip] = b
		blocked := b.count > limit || len(buckets) > 20000
		mu.Unlock()
		if blocked {
			c.Header("Retry-After", "60")
			c.AbortWithStatusJSON(429, gin.H{"error": "Too many login attempts. Retry in one minute."})
			return
		}
		c.Next()
	}
}
func requestLimits() gin.HandlerFunc {
	var mu sync.Mutex
	active := map[uint]bool{}
	return func(c *gin.Context) {
		if c.Request.Method == "GET" || c.Request.Method == "HEAD" || c.Request.Method == "OPTIONS" {
			c.Next()
			return
		}
		upload := strings.Contains(c.Request.URL.Path, "/upload") || c.Request.URL.Path == "/api/v1/transcription/quick" || strings.Contains(c.Request.URL.Path, "youtube")
		maximum := int64(4 << 20)
		if upload {
			maximum = envBytes("MAX_UPLOAD_BYTES", 1<<30)
			_ = http.NewResponseController(c.Writer).SetReadDeadline(time.Now().Add(30 * time.Minute))
			defer http.NewResponseController(c.Writer).SetReadDeadline(time.Time{})
			owner := c.GetUint("user_id")
			mu.Lock()
			busy := active[owner]
			if !busy {
				active[owner] = true
			}
			mu.Unlock()
			if busy {
				c.AbortWithStatusJSON(429, gin.H{"error": "An upload is already in progress for this account"})
				return
			}
			defer func() { mu.Lock(); delete(active, owner); mu.Unlock() }()
			var used int64
			if database.DB != nil {
				if err := database.DB.Model(&models.TranscriptionJob{}).Select("COALESCE(SUM(audio_bytes),0)").Where("owner_id = ?", owner).Scan(&used).Error; err != nil {
					c.AbortWithStatusJSON(503, gin.H{"error": "Storage quota check unavailable"})
					return
				}
			}
			remaining := envBytes("USER_STORAGE_QUOTA_BYTES", 20<<30) - used
			if remaining <= 0 {
				c.AbortWithStatusJSON(413, gin.H{"error": "Account audio storage quota exceeded"})
				return
			}
			if maximum > remaining {
				maximum = remaining
			}
		}
		if c.Request.ContentLength > maximum {
			c.AbortWithStatusJSON(413, gin.H{"error": "Request exceeds upload size or account storage limit", "max_bytes": maximum})
			return
		}
		c.Set("upload_max_bytes", maximum)
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maximum)
		c.Next()
	}
}

// Bound long-lived connections independently of ordinary HTTP requests.
func connectionLimit(maximum int) gin.HandlerFunc {
	var mu sync.Mutex
	active := map[uint]int{}
	return func(c *gin.Context) {
		owner := c.GetUint("user_id")
		mu.Lock()
		if active[owner] >= maximum {
			mu.Unlock()
			c.Header("Retry-After", "10")
			c.AbortWithStatusJSON(429, gin.H{"error": "Too many active connections"})
			return
		}
		active[owner]++
		mu.Unlock()
		defer func() {
			mu.Lock()
			active[owner]--
			if active[owner] == 0 {
				delete(active, owner)
			}
			mu.Unlock()
		}()
		c.Next()
	}
}
