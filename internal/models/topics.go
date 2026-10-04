package models

import (
	"fmt"
	"math"
)

// ValidateTopicBoundaries rejects ambiguous ordering and out-of-recording cuts.
// duration=0 is used before audio metadata is available.
func ValidateTopicBoundaries(points []float64, duration float64) error {
	if len(points) == 0 || len(points) > 100 {
		return fmt.Errorf("请设置 1–100 个 topic 分界点")
	}
	previous := 0.0
	for _, point := range points {
		if math.IsNaN(point) || math.IsInf(point, 0) || point <= previous || (duration > 0 && point >= duration) {
			return fmt.Errorf("topic 分界点必须递增、不能重复，并位于音频内部")
		}
		previous = point
	}
	return nil
}
