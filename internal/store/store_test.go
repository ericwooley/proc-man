package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"time"

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
	_, err = store.CreateProcess(ctx, domain.Process{
		ID:      "proc_two",
		Label:   "Admin task",
		Kind:    domain.ProcessKindTask,
		Command: domain.Command{Argv: []string{"true"}},
		CWD:     "/workspace/admin",
	})
	if err != nil {
		t.Fatal(err)
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

	processes, err = store.ListProcesses(ctx, domain.ProcessFilter{
		Directory: "/workspace/storefront",
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(processes) != 1 || processes[0].ID != created.ID {
		t.Fatalf("Directory processes = %#v", processes)
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

func TestListProcessPageOrdersAndFiltersBeforeLimit(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	state, err := Open(filepath.Join(t.TempDir(), "state.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { state.Close() })

	now := time.Date(2026, time.August, 14, 12, 0, 0, 0, time.UTC)
	state.now = func() time.Time { return now }
	for index := 0; index < 6; index++ {
		now = now.Add(time.Minute)
		process := domain.Process{
			ID:      fmt.Sprintf("proc_%02d", index),
			Label:   fmt.Sprintf("Process %02d", index),
			Kind:    domain.ProcessKindTask,
			Tags:    []string{"other"},
			Command: domain.Command{Argv: []string{"true"}},
			CWD:     "/workspace/other",
		}
		if index%2 == 0 {
			process.Label = fmt.Sprintf("Target %02d", index)
			process.Tags = []string{"target"}
			process.CWD = "/workspace/target"
		}
		if _, err := state.CreateProcess(ctx, process); err != nil {
			t.Fatal(err)
		}
	}

	filter := domain.ProcessFilter{
		Query:     "target",
		Directory: "/workspace/target",
		Tags:      []string{"TARGET"},
		Kind:      domain.ProcessKindTask,
		State:     domain.ProcessStateStopped,
	}
	first, err := state.ListProcessPage(ctx, filter, 2, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(first.Processes) != 2 || first.Processes[0].ID != "proc_04" ||
		first.Processes[1].ID != "proc_02" || !first.HasMore || first.NextCursor == "" {
		t.Fatalf("First page = %#v", first)
	}

	second, err := state.ListProcessPage(ctx, filter, 2, first.NextCursor)
	if err != nil {
		t.Fatal(err)
	}
	if len(second.Processes) != 1 || second.Processes[0].ID != "proc_00" ||
		second.HasMore || second.NextCursor != "" {
		t.Fatalf("Second page = %#v", second)
	}

	if _, err := state.ListProcessPage(ctx, filter, 2, "not-a-cursor"); !errors.Is(err, domain.ErrValidation) {
		t.Fatalf("Invalid cursor error = %v", err)
	}
}

func TestListProcessPageUsesIDAsStableTieBreaker(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	state, err := Open(filepath.Join(t.TempDir(), "state.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { state.Close() })

	state.now = func() time.Time {
		return time.Date(2026, time.August, 14, 12, 0, 0, 0, time.UTC)
	}
	for _, id := range []string{"proc_a", "proc_c", "proc_b"} {
		if _, err := state.CreateProcess(ctx, domain.Process{
			ID: id, Label: id, Kind: domain.ProcessKindTask,
			Command: domain.Command{Argv: []string{"true"}}, CWD: "/workspace",
		}); err != nil {
			t.Fatal(err)
		}
	}

	first, err := state.ListProcessPage(ctx, domain.ProcessFilter{}, 2, "")
	if err != nil {
		t.Fatal(err)
	}
	second, err := state.ListProcessPage(ctx, domain.ProcessFilter{}, 2, first.NextCursor)
	if err != nil {
		t.Fatal(err)
	}
	got := []string{first.Processes[0].ID, first.Processes[1].ID, second.Processes[0].ID}
	want := []string{"proc_c", "proc_b", "proc_a"}
	for index := range want {
		if got[index] != want[index] {
			t.Fatalf("Process order = %#v, want %#v", got, want)
		}
	}
}

func TestListProcessPageMatchesLegacyDirectoryAndSearch(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	state, err := Open(filepath.Join(t.TempDir(), "state.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { state.Close() })

	for _, process := range []domain.Process{
		{
			ID:      "proc_unicode",
			Label:   "CAFÉ worker",
			Kind:    domain.ProcessKindTask,
			Command: domain.Command{Argv: []string{"printf", `"quoted value"`}},
			CWD:     "/workspace/project/..",
		},
		{
			ID:      "proc_plain",
			Label:   "Plain worker",
			Kind:    domain.ProcessKindTask,
			Command: domain.Command{Argv: []string{"true"}},
			CWD:     "/workspace/plain",
		},
	} {
		if _, err := state.CreateProcess(ctx, process); err != nil {
			t.Fatal(err)
		}
	}

	cases := []struct {
		name   string
		filter domain.ProcessFilter
	}{
		{name: "noncanonical directory", filter: domain.ProcessFilter{Directory: "/workspace/project/.."}},
		{name: "Unicode text", filter: domain.ProcessFilter{Query: "café"}},
		{name: "quoted command text", filter: domain.ProcessFilter{Query: `"quoted value"`}},
		{name: "JSON field name", filter: domain.ProcessFilter{Query: "argv"}},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			legacy, err := state.ListProcesses(ctx, testCase.filter)
			if err != nil {
				t.Fatal(err)
			}
			page, err := state.ListProcessPage(ctx, testCase.filter, 25, "")
			if err != nil {
				t.Fatal(err)
			}
			if processIDs(page.Processes) != processIDs(legacy) {
				t.Fatalf(
					"Filter %#v paged IDs = %q, legacy IDs = %q",
					testCase.filter, processIDs(page.Processes), processIDs(legacy),
				)
			}
		})
	}
}

func TestListProcessPageReturnsEmptyCollections(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	state, err := Open(filepath.Join(t.TempDir(), "state.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { state.Close() })

	if _, err := state.CreateProcess(ctx, domain.Process{
		ID: "proc_empty", Label: "Empty collections", Kind: domain.ProcessKindTask,
		Command: domain.Command{Argv: []string{"true"}}, CWD: "/workspace",
	}); err != nil {
		t.Fatal(err)
	}

	page, err := state.ListProcessPage(ctx, domain.ProcessFilter{}, 25, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Processes) != 1 {
		t.Fatalf("Process count = %d, want 1", len(page.Processes))
	}
	if page.Processes[0].Tags == nil {
		t.Fatal("Tags must be an empty collection, not nil")
	}
	if page.Processes[0].Ports == nil {
		t.Fatal("Ports must be an empty collection, not nil")
	}
}

func processIDs(processes []domain.Process) string {
	ids := make([]string, len(processes))
	for index := range processes {
		ids[index] = processes[index].ID
	}
	sort.Strings(ids)
	return strings.Join(ids, ",")
}
