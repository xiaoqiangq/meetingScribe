package middleware

import (
	"net/http"
	"strings"
	"time"

	"scriberr/internal/auth"
	"scriberr/internal/database"
	"scriberr/internal/models"

	"github.com/gin-gonic/gin"
)

// AuthMiddleware handles both API key and JWT authentication
func AuthMiddleware(authService *auth.AuthService) gin.HandlerFunc {
	return func(c *gin.Context) {
		// Check for API key first
		apiKey := c.GetHeader("X-API-Key")
		if apiKey != "" {
			if user, valid := apiKeyUser(apiKey); valid {
				setIdentity(c, user)
				c.Set("auth_type", "api_key")
				c.Set("api_key", apiKey)
				c.Next()
				return
			}
		}

		// Check for JWT token
		var token string
		authHeader := c.GetHeader("Authorization")
		if authHeader != "" {
			// Extract token from "Bearer <token>"
			parts := strings.SplitN(authHeader, " ", 2)
			if len(parts) == 2 && parts[0] == "Bearer" {
				token = parts[1]
			}
		}

		// Fallback to cookie if no header
		if token == "" {
			if cookie, err := c.Cookie("scriberr_access_token"); err == nil {
				token = cookie
			}
		}

		if token == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Missing authentication"})
			c.Abort()
			return
		}

		claims, err := authService.ValidateToken(token)
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid token"})
			c.Abort()
			return
		}

		var user models.User
		if database.DB.First(&user, claims.UserID).Error != nil || user.Disabled || user.TokenVersion != claims.TokenVersion {
			c.AbortWithStatusJSON(401, gin.H{"error": "Session expired or account disabled"})
			return
		}
		setIdentity(c, &user)
		c.Set("auth_type", "jwt")
		c.Set("user_id", claims.UserID)
		c.Set("username", claims.Username)
		c.Next()
	}
}

// validateAPIKey validates an API key against the database and updates last used timestamp
func apiKeyUser(key string) (*models.User, bool) {
	var keyRecord models.APIKey
	if database.DB.Where("key = ? AND is_active = ?", key, true).First(&keyRecord).Error != nil {
		return nil, false
	}
	var user models.User
	if keyRecord.OwnerID == 0 || database.DB.First(&user, keyRecord.OwnerID).Error != nil || user.Disabled {
		return nil, false
	}
	now := time.Now()
	database.DB.Model(&keyRecord).Update("last_used", &now)
	return &user, true
}
func setIdentity(c *gin.Context, user *models.User) {
	c.Set("user_id", user.ID)
	c.Set("username", user.Username)
	c.Set("role", user.Role)
	c.Request = c.Request.WithContext(models.WithRequestOwner(c.Request.Context(), user.ID))
}
func RequireAdmin() gin.HandlerFunc {
	return func(c *gin.Context) {
		if c.GetString("auth_type") != "jwt" || c.GetString("role") != "admin" {
			c.AbortWithStatusJSON(403, gin.H{"error": "Administrator login required"})
			return
		}
		c.Next()
	}
}

// APIKeyOnlyMiddleware only allows API key authentication
func APIKeyOnlyMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		apiKey := c.GetHeader("X-API-Key")
		if apiKey == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "API key required"})
			c.Abort()
			return
		}

		user, valid := apiKeyUser(apiKey)
		if !valid {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid API key"})
			c.Abort()
			return
		}

		setIdentity(c, user)
		c.Set("auth_type", "api_key")
		c.Set("api_key", apiKey)
		c.Next()
	}
}

// JWTOnlyMiddleware only allows JWT authentication
func JWTOnlyMiddleware(authService *auth.AuthService) gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Authorization header required"})
			c.Abort()
			return
		}

		parts := strings.SplitN(authHeader, " ", 2)
		if len(parts) != 2 || parts[0] != "Bearer" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid authorization header format"})
			c.Abort()
			return
		}

		token := parts[1]
		claims, err := authService.ValidateToken(token)
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid token"})
			c.Abort()
			return
		}

		var user models.User
		if database.DB.First(&user, claims.UserID).Error != nil || user.Disabled || user.TokenVersion != claims.TokenVersion {
			c.AbortWithStatusJSON(401, gin.H{"error": "Session expired or account disabled"})
			return
		}
		setIdentity(c, &user)
		c.Set("auth_type", "jwt")
		c.Set("user_id", claims.UserID)
		c.Set("username", claims.Username)
		c.Next()
	}
}
