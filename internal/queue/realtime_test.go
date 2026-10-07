package queue

import (
	"testing"
	"time"
)

func TestRealtimeAdmissionLease(t *testing.T) {
	q := &TaskQueue{admitted: map[string]bool{}, runningJobs: map[string]*RunningJob{}}
	q.admitted["offline"] = true
	if q.ReserveRealtime() {
		t.Fatal("must not overlap an admitted offline job")
	}
	delete(q.admitted, "offline")
	if !q.ReserveRealtime() {
		t.Fatal("idle GPU must admit live session")
	}
	if q.ReserveRealtime() {
		t.Fatal("only one live session is permitted")
	}
	if q.EnqueueJob("offline") == nil {
		t.Fatal("offline admission must wait during realtime")
	}
	q.realtimeUntil = time.Now().Add(-time.Second)
	if !q.ReserveRealtime() {
		t.Fatal("disconnected browser lease must expire")
	}
	q.ReleaseRealtime()
	if !q.ReserveRealtime() {
		t.Fatal("explicit finish must release lease")
	}
}
