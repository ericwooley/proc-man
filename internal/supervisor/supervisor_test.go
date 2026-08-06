package supervisor

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"proc-man/internal/domain"
	"proc-man/internal/logstore"
	"proc-man/internal/store"
)

func TestTaskRunCapturesOutput(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	state, err := store.Open(filepath.Join(t.TempDir(), "state.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { state.Close() })
	process, err := state.CreateProcess(ctx, domain.Process{
		ID: "proc_task", Label: "Task", Kind: domain.ProcessKindTask,
		Command: domain.Command{Shell: `printf 'ready\n'; printf 'warning\n' >&2`},
		CWD:     t.TempDir(),
	})
	if err != nil {
		t.Fatal(err)
	}
	manager := New(state, Options{
		LogRoot: t.TempDir(), Shell: "/bin/sh", StopTimeout: time.Second,
	})
	run, err := manager.RunTask(ctx, process.ID)
	if err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(3 * time.Second)
	for {
		run, err = state.GetRun(ctx, run.ID)
		if err != nil {
			t.Fatal(err)
		}
		if run.State.Terminal() {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("task did not finish")
		}
		time.Sleep(10 * time.Millisecond)
	}
	records, err := logstore.Read(run.LogPath, logstore.Query{})
	if err != nil {
		t.Fatal(err)
	}
	streams := map[string]string{}
	for _, record := range records {
		streams[record.Stream] = record.Text
	}
	if len(records) != 2 || streams["stdout"] != "ready" || streams["stderr"] != "warning" {
		t.Fatalf("Records = %#v", records)
	}
}
