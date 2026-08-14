//go:build !windows

package supervisor

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"proc-man/internal/logstore"
	"proc-man/internal/store"
)

func TestDirectRunUsesCallerPath(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	root := t.TempDir()
	binDirectory := filepath.Join(root, "bin")
	if err := os.Mkdir(binDirectory, 0o700); err != nil {
		t.Fatal(err)
	}
	executable := filepath.Join(binDirectory, "proc-man-caller-path-command")
	if err := os.WriteFile(executable, []byte("#!/bin/sh\nprintf 'caller path ready\\n'\n"), 0o700); err != nil {
		t.Fatal(err)
	}
	state, err := store.Open(filepath.Join(root, "state.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { state.Close() })
	manager := New(state, Options{LogRoot: filepath.Join(root, "logs")})

	run, err := manager.RunDirect(ctx, root,
		[]string{"proc-man-caller-path-command"}, []string{"PATH=" + binDirectory},
	)
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
	records, err := logstore.Read(run.LogPath, logstore.Query{})
	if err != nil {
		t.Fatal(err)
	}
	if len(records) != 1 || records[0].Text != "caller path ready" {
		t.Fatalf("Records = %#v", records)
	}
}
