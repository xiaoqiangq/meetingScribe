package models

import (
	"math"
	"testing"
)

func TestTopicCutsRejectUnsafeBoundaries(t *testing.T) {
	for _, points := range [][]float64{nil, {0}, {-1}, {43, 43}, {100, 50}, {3796}, {math.NaN()}, {math.Inf(1)}} {
		if ValidateTopicBoundaries(points, 3796) == nil {
			t.Fatalf("accepted %v", points)
		}
	}
	if err := ValidateTopicBoundaries([]float64{2580}, 3796); err != nil {
		t.Fatal(err)
	}
}
