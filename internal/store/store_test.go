package store

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"testing"

	"proc-man/internal/domain"
)

func TestProcessLifecycleAndFilters(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	store, err := Open(filepath.Join(t.TempDir(), "state.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { store.Close() })

	created, err := store.CreateProcess(ctx, domain.Process{
		ID:      "proc_one",
		Label:   "Storefront web",
		Kind:    domain.ProcessKindService,
		Tags:    []string{"frontend", "project:storefront"},
		Command: domain.Command{Argv: []string{"npm", "run", "dev"}},
		CWD:     "/workspace/storefront",
		Ports: []domain.Port{{
			ID: "endpoint_one", Name: "http", Host: "127.0.0.1",
			Port: 4310, Protocol: "http", Path: "/",
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if created.Selector != created.ID {
		t.Fatalf("Selector = %q", created.Selector)
	}

	processes, err := store.ListProcesses(ctx, domain.ProcessFilter{
		Query: "4310", Tags: []string{"FRONTEND"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(processes) != 1 || processes[0].ID != created.ID {
		t.Fatalf("Processes = %#v", processes)
	}

	created.Label = "Storefront preview"
	updated, err := store.UpdateProcess(ctx, created)
	if err != nil {
		t.Fatal(err)
	}
	if updated.Label != "Storefront preview" {
		t.Fatalf("Label = %q", updated.Label)
	}

	if err := store.DeleteProcess(ctx, created.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.GetProcess(ctx, created.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("GetProcess() error = %v", err)
	}
}

func TestRunsSurviveProcessDeletionAndRecover(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	store, err := Open(filepath.Join(t.TempDir(), "state.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { store.Close() })

	process, err := store.CreateProcess(ctx, domain.Process{
		ID: "proc_one", Label: "Task", Kind: domain.ProcessKindTask,
		Command: domain.Command{Argv: []string{"true"}}, CWD: "/tmp",
	})
	if err != nil {
		t.Fatal(err)
	}
	run := domain.Run{
		ID: "run_one", ProcessID: &process.ID, Process: domain.Snapshot(process),
		State: domain.RunStateRunning, StartedAt: process.CreatedAt,
		LogPath: filepath.Join(t.TempDir(), "run.ndjson"),
	}
	if err := store.CreateRun(ctx, run); err != nil {
		t.Fatal(err)
	}
	if err := store.RecoverActiveRuns(ctx); err != nil {
		t.Fatal(err)
	}
	recovered, err := store.GetRun(ctx, run.ID)
	if err != nil {
		t.Fatal(err)
	}
	if recovered.State != domain.RunStateInterrupted || recovered.EndedAt == nil {
		t.Fatalf("Recovered run = %#v", recovered)
	}
	if err := store.DeleteProcess(ctx, process.ID); err != nil {
		t.Fatal(err)
	}
	retained, err := store.GetRun(ctx, run.ID)
	if err != nil {
		t.Fatal(err)
	}
	if retained.ProcessID != nil || retained.Process.Label != "Task" {
		t.Fatalf("Retained run = %#v", retained)
	}
}

func TestOpenConfiguresBusyTimeoutForEveryConnection(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	state, err := Open(filepath.Join(t.TempDir(), "state.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { state.Close() })

	first, err := state.db.Conn(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer first.Close()
	second, err := state.db.Conn(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer second.Close()

	for index, connection := range []*sql.Conn{first, second} {
		var timeout int
		if err := connection.QueryRowContext(ctx, `PRAGMA busy_timeout`).Scan(&timeout); err != nil {
			t.Fatal(err)
		}
		if timeout != 5000 {
			t.Fatalf("connection %d busy timeout = %d, want 5000", index, timeout)
		}
	}
}
