package queue

import (
	"context"
	"errors"
	"os/exec"
	"scriberr/internal/models"
	"scriberr/internal/repository"
	"sync/atomic"
	"testing"
	"time"
)

type statusFailureRepo struct {
	repository.JobRepository
	attempts atomic.Int32
	recover  bool
	failed   chan struct{}
}

func (r *statusFailureRepo) UpdateStatus(_ context.Context, _ string, status models.JobStatus) error {
	if status == models.StatusProcessing {
		n := r.attempts.Add(1)
		if !r.recover || n == 1 {
			return errors.New("database is locked")
		}
	}
	if status == models.StatusFailed {
		close(r.failed)
	}
	return nil
}
func (r *statusFailureRepo) UpdateError(context.Context, string, string) error { return nil }

type recoveryProcessor struct{ called chan struct{} }

func (p *recoveryProcessor) ProcessJob(context.Context, string) error { return nil }
func (p *recoveryProcessor) ProcessJobWithProcess(context.Context, string, func(*exec.Cmd)) error {
	close(p.called)
	return nil
}
func TestQueueStatusFailureReleasesAdmission(t *testing.T) {
	r := &statusFailureRepo{failed: make(chan struct{})}
	q := NewTaskQueue(1, nil, r)
	if err := q.EnqueueJob("fixture"); err != nil {
		t.Fatal(err)
	}
	q.wg.Add(1)
	go q.worker(0)
	defer q.Stop()
	select {
	case <-r.failed:
	case <-time.After(3 * time.Second):
		t.Fatal("failure not recorded")
	}
	deadline := time.Now().Add(time.Second)
	for !q.ReserveRealtime() {
		if time.Now().After(deadline) {
			t.Fatal("admission leak")
		}
		time.Sleep(time.Millisecond)
	}
	if r.attempts.Load() != 3 {
		t.Fatal("missing bounded retry")
	}
}
func TestQueueTransientStatusFailureRetriesTask(t *testing.T) {
	r := &statusFailureRepo{recover: true, failed: make(chan struct{})}
	p := &recoveryProcessor{called: make(chan struct{})}
	q := NewTaskQueue(1, p, r)
	q.EnqueueJob("fixture")
	q.wg.Add(1)
	go q.worker(0)
	defer q.Stop()
	select {
	case <-p.called:
	case <-time.After(3 * time.Second):
		t.Fatal("transient failure lost task")
	}
	if r.attempts.Load() != 2 {
		t.Fatal("unexpected retries")
	}
}
func TestQueueRejectedPreparationDoesNotChangeProject(t *testing.T) {
	q := NewTaskQueue(1, nil, nil)
	for i := 0; i < cap(q.jobChannel); i++ {
		q.jobChannel <- "occupied"
	}
	prepared := false
	if err := q.EnqueuePrepared("fixture", func() error { prepared = true; return nil }); err == nil || prepared {
		t.Fatal("full queue ran preparation")
	}
	q2 := NewTaskQueue(1, nil, nil)
	if err := q2.EnqueuePrepared("fixture", func() error { return errors.New("DB write rejected") }); err == nil {
		t.Fatal("preparation failure accepted")
	}
	if !q2.ReserveRealtime() {
		t.Fatal("preparation failure leaked admission")
	}
}
