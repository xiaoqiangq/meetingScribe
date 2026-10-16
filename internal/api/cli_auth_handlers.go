package api

import (
	"fmt"
	"net/http"
	"net/url"
	"strconv"

	"github.com/gin-gonic/gin"
)

// AuthorizeCLIRequest represents the request body for confirming CLI authorization
type AuthorizeCLIRequest struct {
	CallbackURL string `json:"callback_url" binding:"required"`
	DeviceName  string `json:"device_name"`
}

// AuthorizeCLI validates the user session and returns user info for the confirmation page
// GET /api/auth/cli/authorize
func (h *Handler) AuthorizeCLI(c *gin.Context) {
	// User ID is set by middleware
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	// Fetch full user object
	u, err := h.userRepo.FindByID(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch user"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"status": "authorized",
		"user": gin.H{
			"id":       u.ID,
			"username": u.Username,
		},
	})
}

// A CLI callback is a local listener, never a caller-selected external site.
func validateCLICallback(raw string) (*url.URL, error) {
	u, err := url.Parse(raw)
	if err != nil || u == nil {
		return nil, fmt.Errorf("invalid callback URL")
	}
	port, err := strconv.Atoi(u.Port())
	if u.Scheme != "http" || u.User != nil || u.Fragment != "" || err != nil || port < 1024 || port > 65535 || (u.Hostname() != "localhost" && u.Hostname() != "127.0.0.1" && u.Hostname() != "::1") {
		return nil, fmt.Errorf("CLI callback must be an HTTP loopback listener with an explicit port")
	}
	if u.Query().Has("token") || u.Query().Has("username") {
		return nil, fmt.Errorf("invalid callback parameters")
	}
	return u, nil
}

// ConfirmCLIAuthorization generates a token and returns the redirect URL for the CLI
// POST /api/auth/cli/authorize
func (h *Handler) ConfirmCLIAuthorization(c *gin.Context) {
	var req AuthorizeCLIRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	callbackURL, err := validateCLICallback(req.CallbackURL)
	if err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}

	// User ID is set by middleware
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	// Fetch full user object
	u, err := h.userRepo.FindByID(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch user"})
		return
	}

	// Generate long-lived token
	token, err := h.authService.GenerateLongLivedToken(u)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate token"})
		return
	}

	q := callbackURL.Query()
	q.Set("token", token)
	q.Set("username", u.Username)
	callbackURL.RawQuery = q.Encode()

	c.JSON(http.StatusOK, gin.H{
		"redirect_url": callbackURL.String(),
	})
}
