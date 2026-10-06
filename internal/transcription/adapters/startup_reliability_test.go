package adapters

import (
	"context"
	"os"
	"testing"
)

func TestOfflineStartupDoesNotProvisionMissingOptionalModels(t *testing.T) {
	t.Setenv("MODEL_AUTO_PROVISION", "false")
	directory := t.TempDir()
	if err := NewParakeetAdapter(directory).PrepareEnvironment(context.Background()); err == nil {
		t.Fatal("missing Parakeet marked ready")
	}
	if err := NewCanaryAdapter(directory).PrepareEnvironment(context.Background()); err == nil {
		t.Fatal("missing Canary marked ready")
	}
	entries, err := os.ReadDir(directory)
	if err != nil || len(entries) > 0 {
		t.Fatal("offline startup attempted installation")
	}
}
