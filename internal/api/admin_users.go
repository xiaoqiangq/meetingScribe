package api

import (
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"net/http"
	"scriberr/internal/auth"
	"scriberr/internal/database"
	"scriberr/internal/models"
	"strconv"
	"strings"
	"sync"
	"unicode/utf8"
)

var accountMutation sync.Mutex

func (h *Handler) CurrentUser(c *gin.Context) {
	user, err := h.userRepo.FindByID(c.Request.Context(), c.GetUint("user_id"))
	if err != nil {
		c.JSON(401, gin.H{"error": "Not authenticated"})
		return
	}
	c.JSON(200, user)
}
func (h *Handler) ListUsers(c *gin.Context) {
	var users []models.User
	if err := database.DB.Order("id asc").Find(&users).Error; err != nil {
		c.JSON(500, gin.H{"error": "Unable to list accounts"})
		return
	}
	stats, err := h.accountUsage(users)
	if err != nil {
		c.JSON(500, gin.H{"error": "Unable to read account usage"})
		return
	}
	result := make([]AccountWithUsage, 0, len(users))
	for _, user := range users {
		result = append(result, AccountWithUsage{User: user, AccountUsage: stats[user.ID]})
	}
	c.JSON(200, result)
}
func validAccount(name, password string) bool {
	return strings.TrimSpace(name) == name && utf8.RuneCountInString(name) >= 1 && utf8.RuneCountInString(name) <= 50 && !strings.ContainsAny(name, "\r\n\x00") && len(password) >= 8 && len(password) <= 72
}
func (h *Handler) CreateUser(c *gin.Context) {
	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
		Role     string `json:"role"`
	}
	if c.ShouldBindJSON(&req) != nil || !validAccount(req.Username, req.Password) || (req.Role != "admin" && req.Role != "user") {
		c.JSON(400, gin.H{"error": "姓名需为1–50个字符，密码需为8–72字节，角色需为admin或user"})
		return
	}
	accountMutation.Lock()
	defer accountMutation.Unlock()
	hash, err := auth.HashPassword(req.Password)
	if err != nil {
		c.JSON(500, gin.H{"error": "Unable to secure password"})
		return
	}
	user := models.User{Username: req.Username, Password: hash, Role: req.Role}
	if err := database.DB.Create(&user).Error; err != nil {
		c.JSON(409, gin.H{"error": "账号创建失败，用户名可能已存在"})
		return
	}
	c.JSON(201, user)
}
func (h *Handler) UpdateUser(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 32)
	if err != nil || id == 0 {
		c.JSON(400, gin.H{"error": "Invalid account"})
		return
	}
	var req struct {
		Role            *string `json:"role"`
		Disabled        *bool   `json:"disabled"`
		Password        *string `json:"password"`
		ProjectLimit    *int64  `json:"project_limit"`
		FileQuotaBytes  *int64  `json:"file_quota_bytes"`
		AudioQuotaBytes *int64  `json:"audio_quota_bytes"`
	}
	if c.ShouldBindJSON(&req) != nil || (req.Role != nil && *req.Role != "user" && *req.Role != "admin") || (req.Password != nil && (len(*req.Password) < 8 || len(*req.Password) > 72)) {
		c.JSON(400, gin.H{"error": "Invalid account settings; password must be 8–72 bytes"})
		return
	}
	for _, limit := range []*int64{req.ProjectLimit, req.FileQuotaBytes, req.AudioQuotaBytes} {
		if limit != nil && (*limit < 0 || *limit > (1<<50)) {
			c.JSON(400, gin.H{"error": "Limits must be nonnegative integers"})
			return
		}
	}
	accountMutation.Lock()
	defer accountMutation.Unlock()
	var result models.User
	err = database.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.First(&result, uint(id)).Error; err != nil {
			return err
		}
		role := result.Role
		disabled := result.Disabled
		if req.Role != nil {
			role = *req.Role
		}
		if req.Disabled != nil {
			disabled = *req.Disabled
		}
		if uint(id) == c.GetUint("user_id") && (role != "admin" || disabled) {
			return &accountError{"不能停用自己或移除自己的管理员权限"}
		}
		if result.Role == "admin" && !result.Disabled && (role != "admin" || disabled) {
			var count int64
			if err := tx.Model(&models.User{}).Where("role = 'admin' AND disabled = ?", false).Count(&count).Error; err != nil {
				return err
			}
			if count <= 1 {
				return &accountError{"必须保留至少一个启用的管理员"}
			}
		}
		securityChanged := result.Role != role || result.Disabled != disabled || req.Password != nil
		if req.ProjectLimit != nil {
			result.ProjectLimit = *req.ProjectLimit
		}
		if req.FileQuotaBytes != nil {
			result.FileQuotaBytes = *req.FileQuotaBytes
		}
		if req.AudioQuotaBytes != nil {
			result.AudioQuotaBytes = *req.AudioQuotaBytes
		}
		result.Role = role
		result.Disabled = disabled
		if req.Password != nil {
			hash, err := auth.HashPassword(*req.Password)
			if err != nil {
				return err
			}
			result.Password = hash
		}
		if securityChanged {
			result.TokenVersion++
		}
		if err := tx.Save(&result).Error; err != nil {
			return err
		}
		if req.Password != nil || disabled {
			if err := tx.Model(&models.APIKey{}).Where("owner_id = ?", result.ID).Update("is_active", false).Error; err != nil {
				return err
			}
		}
		if !securityChanged {
			return nil
		}
		return tx.Model(&models.RefreshToken{}).Where("user_id = ?", result.ID).Update("revoked", true).Error
	})
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(404, gin.H{"error": "Account not found"})
		} else if e, ok := err.(*accountError); ok {
			c.JSON(400, gin.H{"error": e.Error()})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Unable to update account"})
		}
		return
	}
	c.JSON(200, result)
}

type accountError struct{ message string }

func (e *accountError) Error() string { return e.message }
