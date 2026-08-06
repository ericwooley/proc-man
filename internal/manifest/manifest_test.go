package manifest

import (
	"context"
	"path/filepath"
	"testing"

	"proc-man/internal/store"
)

func TestParseAndReconcileIsIdempotent(t *testing.T) {
	t.Parallel()
	root := t.TempDir()
	source := filepath.Join(root, ".proc-man.yaml")
	content := []byte(`
version: 1
processes:
  - key: web
    label: Storefront web
    kind: service
    tags: [Frontend, project:storefront]
    cwd: .
    command:
      argv: [npm, run, dev]
    ports:
      - name: http
        port: 4310
        protocol: http
`)
	parsed, canonical, err := Parse(source, content)
	if err != nil {
		t.Fatal(err)
	}
	state, err := store.Open(filepath.Join(root, "state.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { state.Close() })

	first, err := Reconcile(context.Background(), state, canonical, parsed, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(first.Created) != 1 {
		t.Fatalf("First plan = %#v", first)
	}
	second, err := Reconcile(context.Background(), state, canonical, parsed, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(second.Unchanged) != 1 || second.Unchanged[0].ID != first.Created[0].ID {
		t.Fatalf("Second plan = %#v", second)
	}
}
