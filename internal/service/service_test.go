package service

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSystemdInstallRendersLocalService(t *testing.T) {
	t.Parallel()
	home := t.TempDir()
	var calls []string
	manager := &Manager{
		GOOS: "linux", Home: home, Executable: "/opt/proc-man",
		Run: func(name string, arguments ...string) error {
			calls = append(calls, name+" "+strings.Join(arguments, " "))
			return nil
		},
	}
	path, err := manager.Install(true)
	if err != nil {
		t.Fatal(err)
	}
	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(content), "ExecStart=/opt/proc-man serve") {
		t.Fatalf("Unit = %s", content)
	}
	if len(calls) != 2 || filepath.Base(path) != "proc-man.service" {
		t.Fatalf("Calls = %#v, path = %q", calls, path)
	}
}
