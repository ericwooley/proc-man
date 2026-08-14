package supervisor

import (
	"bytes"
	"context"
	"errors"
	"io/fs"
	"path/filepath"
	"strings"
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

func TestDirectRunCreatesAuditWithoutProcess(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	root := t.TempDir()
	state, err := store.Open(filepath.Join(root, "state.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { state.Close() })
	arguments := []string{
		"/bin/sh", "-c", `printf 'ready %s\n' "$AUDIT_VALUE"; printf 'warning\n' >&2; exit 23`,
	}
	manager := New(state, Options{LogRoot: filepath.Join(root, "logs")})

	run, err := manager.RunDirect(ctx, root, arguments, []string{"AUDIT_VALUE=caller-environment"})
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
			t.Fatal("direct run did not finish")
		}
		time.Sleep(10 * time.Millisecond)
	}

	if run.ProcessID != nil || run.Process.Source.Kind != "direct" ||
		run.Process.CWD != root || run.ExitCode == nil || *run.ExitCode != 23 {
		t.Fatalf("Run = %#v", run)
	}
	if len(run.Process.Command.Argv) != len(arguments) ||
		run.Process.Command.Argv[2] != arguments[2] {
		t.Fatalf("Arguments = %#v, want %#v", run.Process.Command.Argv, arguments)
	}
	processes, err := state.ListProcesses(ctx, domain.ProcessFilter{})
	if err != nil {
		t.Fatal(err)
	}
	if len(processes) != 0 {
		t.Fatalf("Processes = %#v, want none", processes)
	}
	records, err := logstore.Read(run.LogPath, logstore.Query{})
	if err != nil {
		t.Fatal(err)
	}
	streams := map[string]string{}
	for _, record := range records {
		streams[record.Stream] = record.Text
	}
	if len(records) != 2 || streams["stdout"] != "ready caller-environment" ||
		streams["stderr"] != "warning" {
		t.Fatalf("Records = %#v", records)
	}
}

func TestDirectRunLaunchFailureCreatesAuditWithoutProcess(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	root := t.TempDir()
	state, err := store.Open(filepath.Join(root, "state.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { state.Close() })
	manager := New(state, Options{LogRoot: filepath.Join(root, "logs")})

	run, err := manager.RunDirect(ctx, root, []string{"proc-man-command-that-does-not-exist"}, nil)
	if err == nil {
		t.Fatal("RunDirect() error = nil, want a launch error")
	}
	if run.ID == "" || run.ProcessID != nil || run.State != domain.RunStateFailed {
		t.Fatalf("Run = %#v", run)
	}
	stored, err := state.GetRun(ctx, run.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.Error == "" || stored.Process.Source.Kind != "direct" {
		t.Fatalf("Stored run = %#v", stored)
	}
	records, err := logstore.Read(stored.LogPath, logstore.Query{})
	if err != nil {
		t.Fatal(err)
	}
	if len(records) != 1 || records[0].Stream != "stderr" {
		t.Fatalf("Records = %#v", records)
	}
	processes, err := state.ListProcesses(ctx, domain.ProcessFilter{})
	if err != nil {
		t.Fatal(err)
	}
	if len(processes) != 0 {
		t.Fatalf("Processes = %#v, want none", processes)
	}
}

func TestLaunchFilesystemFailureCreatesFailedRunAndLog(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	root := t.TempDir()
	state, err := store.Open(filepath.Join(root, "state.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { state.Close() })
	missingCWD := filepath.Join(root, "unavailable")
	process, err := state.CreateProcess(ctx, domain.Process{
		ID: "proc_unavailable", Label: "Unavailable", Kind: domain.ProcessKindTask,
		Command: domain.Command{Argv: []string{"true"}},
		CWD:     missingCWD,
	})
	if err != nil {
		t.Fatal(err)
	}
	var daemonErrors bytes.Buffer
	manager := New(state, Options{
		LogRoot: filepath.Join(root, "logs"),
		OnError: func(err error) {
			daemonErrors.WriteString(err.Error())
		},
	})
	eventChannel, unsubscribe := manager.Events().Subscribe()
	t.Cleanup(unsubscribe)

	run, launchErr := manager.RunTask(ctx, process.ID)
	if !errors.Is(launchErr, ErrCWDUnavailable) {
		t.Fatalf("Error = %v, want ErrCWDUnavailable", launchErr)
	}
	if run.ID == "" {
		t.Fatal("filesystem failure did not create a run")
	}
	if !errors.Is(launchErr, fs.ErrNotExist) {
		t.Fatalf("Error = %v, want the filesystem cause", launchErr)
	}

	storedRun, err := state.GetRun(ctx, run.ID)
	if err != nil {
		t.Fatal(err)
	}
	if storedRun.State != domain.RunStateFailed || storedRun.Error == "" {
		t.Fatalf("Run = %#v", storedRun)
	}
	if !strings.Contains(storedRun.Error, missingCWD) {
		t.Fatalf("Run error = %q, want path %q", storedRun.Error, missingCWD)
	}
	records, err := logstore.Read(storedRun.LogPath, logstore.Query{})
	if err != nil {
		t.Fatal(err)
	}
	if len(records) != 1 || records[0].Stream != "stderr" ||
		!strings.Contains(records[0].Text, storedRun.Error) {
		t.Fatalf("Records = %#v, want the launch error on stderr", records)
	}
	if !strings.Contains(daemonErrors.String(), storedRun.Error) {
		t.Fatalf("Daemon error = %q, want the launch error", daemonErrors.String())
	}
	deadline := time.After(time.Second)
	for {
		select {
		case event := <-eventChannel:
			if event.Type != "run.finished" {
				continue
			}
			if event.ResourceID != run.ID {
				t.Fatalf("Event = %#v", event)
			}
			return
		case <-deadline:
			t.Fatal("filesystem failure did not publish a run.finished event")
		}
	}
}

func TestCommandStartFailureCreatesErrorLog(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	root := t.TempDir()
	state, err := store.Open(filepath.Join(root, "state.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { state.Close() })
	process, err := state.CreateProcess(ctx, domain.Process{
		ID: "proc_missing_command", Label: "Missing command", Kind: domain.ProcessKindTask,
		Command: domain.Command{Argv: []string{filepath.Join(root, "missing-command")}},
		CWD:     root,
	})
	if err != nil {
		t.Fatal(err)
	}
	manager := New(state, Options{LogRoot: filepath.Join(root, "logs")})

	run, launchErr := manager.RunTask(ctx, process.ID)
	if launchErr == nil || run.ID == "" {
		t.Fatalf("Run = %#v, error = %v", run, launchErr)
	}
	storedRun, err := state.GetRun(ctx, run.ID)
	if err != nil {
		t.Fatal(err)
	}
	records, err := logstore.Read(storedRun.LogPath, logstore.Query{})
	if err != nil {
		t.Fatal(err)
	}
	if storedRun.State != domain.RunStateFailed || len(records) != 1 ||
		records[0].Stream != "stderr" || !strings.Contains(records[0].Text, "start process") {
		t.Fatalf("Run = %#v, records = %#v", storedRun, records)
	}
}
