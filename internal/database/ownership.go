package database

import (
	"gorm.io/gorm"
	"scriberr/internal/models"
)

// Only previously unowned data is assigned. Repeated startup never promotes a new administrator.
func MigrateOwnership(db *gorm.DB) error {
	return db.Transaction(func(tx *gorm.DB) error {
		var first models.User
		err := tx.Order("id asc").First(&first).Error
		if err == gorm.ErrRecordNotFound {
			return nil
		}
		if err != nil {
			return err
		}
		if first.Role == "" {
			if err := tx.Model(&models.User{}).Where("id = ? AND (role IS NULL OR role = '')", first.ID).Update("role", "admin").Error; err != nil {
				return err
			}
		}
		if err := tx.Model(&models.User{}).Where("role IS NULL OR role = ''").Update("role", "user").Error; err != nil {
			return err
		}
		for _, model := range []interface{}{&models.TranscriptionJob{}, &models.APIKey{}} {
			if err := tx.Unscoped().Model(model).Where("owner_id = 0 OR owner_id IS NULL").Update("owner_id", first.ID).Error; err != nil {
				return err
			}
		}
		return nil
	})
}
