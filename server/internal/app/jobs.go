package app

import (
	"context"
	"errors"
	"log/slog"
	"strconv"
	"sync"
	"time"
)

// Jobs runs extractions inside the web process, one at a time. A job id is never queued twice; a queued job can be
// cancelled, and cancelling the running one cancels its context; a job past its timeout is cancelled too.
type Jobs struct {
	mu        sync.Mutex
	run       func(ctx context.Context, uid int) error
	timeout   time.Duration
	pending   map[string]int
	order     []string
	running   string
	cancelRun context.CancelFunc
	wake      chan struct{}
	idle      *sync.Cond
	stop      chan struct{}
	stopOnce  sync.Once
}

func JobID(uid int) string { return "extract:" + strconv.Itoa(uid) }

func NewJobs(run func(ctx context.Context, uid int) error, timeout time.Duration) *Jobs {
	j := &Jobs{run: run, timeout: timeout, pending: map[string]int{}, wake: make(chan struct{}, 1), stop: make(chan struct{})}
	j.idle = sync.NewCond(&j.mu)
	go j.work()
	return j
}

// Enqueue queues a job, now or after deferBy; false when that id is already queued or running.
func (j *Jobs) Enqueue(id string, uid int, deferBy time.Duration) bool {
	j.mu.Lock()
	defer j.mu.Unlock()
	if _, ok := j.pending[id]; ok || id == j.running {
		return false
	}
	j.pending[id] = uid
	if deferBy > 0 {
		time.AfterFunc(deferBy, func() { j.push(id) })
	} else {
		j.order = append(j.order, id)
		j.signal()
	}
	return true
}

func (j *Jobs) push(id string) {
	j.mu.Lock()
	defer j.mu.Unlock()
	if _, ok := j.pending[id]; ok {
		j.order = append(j.order, id)
		j.signal()
	}
}

func (j *Jobs) signal() {
	select {
	case j.wake <- struct{}{}:
	default:
	}
}

func (j *Jobs) Cancel(id string) {
	j.mu.Lock()
	defer j.mu.Unlock()
	delete(j.pending, id)
	if id == j.running && j.cancelRun != nil {
		j.cancelRun()
	}
	j.idle.Broadcast()
}

func (j *Jobs) Queued() []string {
	j.mu.Lock()
	defer j.mu.Unlock()
	var out []string
	for _, id := range j.order {
		if _, ok := j.pending[id]; ok {
			out = append(out, id)
		}
	}
	for id := range j.pending { // deferred ones not yet in order
		found := false
		for _, o := range out {
			found = found || o == id
		}
		if !found {
			out = append(out, id)
		}
	}
	return out
}

func (j *Jobs) next() (string, int, bool) {
	for len(j.order) > 0 {
		id := j.order[0]
		j.order = j.order[1:]
		if uid, ok := j.pending[id]; ok {
			delete(j.pending, id)
			return id, uid, true
		}
	}
	return "", 0, false
}

func (j *Jobs) work() {
	for {
		select {
		case <-j.stop:
			return
		case <-j.wake:
		}
		for {
			j.mu.Lock()
			id, uid, ok := j.next()
			if !ok {
				j.idle.Broadcast()
				j.mu.Unlock()
				break
			}
			ctx, cancel := context.WithTimeout(context.Background(), j.timeout)
			j.running, j.cancelRun = id, cancel
			j.mu.Unlock()
			if err := j.run(ctx, uid); err != nil && !errors.Is(err, context.Canceled) {
				slog.Warn("job ended with an error", "job", "extract", "error", err.Error())
			}
			cancel()
			j.mu.Lock()
			j.running, j.cancelRun = "", nil
			j.idle.Broadcast()
			j.mu.Unlock()
		}
	}
}

// Drain waits until nothing is queued or running (tests and shutdown); deferred jobs count as queued.
func (j *Jobs) Drain() {
	j.mu.Lock()
	defer j.mu.Unlock()
	for len(j.pending) > 0 || j.running != "" {
		j.idle.Wait()
	}
}

func (j *Jobs) Stop() { j.stopOnce.Do(func() { close(j.stop) }) }
