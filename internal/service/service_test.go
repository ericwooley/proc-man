package service

import (
	"fmt"
	"os"
	"path/filepath"
	"reflect"
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
	wantCalls := []string{
		"systemctl --user daemon-reload",
		"systemctl --user enable proc-man.service",
		"systemctl --user restart proc-man.service",
	}
	if !reflect.DeepEqual(calls, wantCalls) || filepath.Base(path) != "proc-man.service" {
		t.Fatalf("Calls = %#v, path = %q", calls, path)
	}
}

func TestLaunchAgentInstallNowReplacesRunningService(t *testing.T) {
	t.Parallel()
	home := t.TempDir()
	var calls []string
	manager := &Manager{
		GOOS: "darwin", Home: home, Executable: "/opt/proc-man",
		Run: func(name string, arguments ...string) error {
			calls = append(calls, name+" "+strings.Join(arguments, " "))
			return nil
		},
	}
	path, err := manager.Install(true)
	if err != nil {
		t.Fatal(err)
	}
	domain := "gui/" + fmt.Sprint(currentUserID())
	wantCalls := []string{
		"launchctl bootout " + domain + " " + path,
		"launchctl bootstrap " + domain + " " + path,
	}
	if !reflect.DeepEqual(calls, wantCalls) {
		t.Fatalf("Calls = %#v, want %#v", calls, wantCalls)
	}
}

func TestUserServiceEnvironmentAddsLinuxBusDefaults(t *testing.T) {
	t.Parallel()
	got := userServiceEnvironment("linux", 1000, []string{"PATH=/usr/bin"})
	want := []string{
		"PATH=/usr/bin",
		"XDG_RUNTIME_DIR=/run/user/1000",
		"DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus",
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("Environment = %#v, want %#v", got, want)
	}
}

func TestUserServiceEnvironmentPreservesExplicitBusValues(t *testing.T) {
	t.Parallel()
	want := []string{
		"XDG_RUNTIME_DIR=/custom/runtime",
		"DBUS_SESSION_BUS_ADDRESS=unix:path=/custom/bus",
	}
	got := userServiceEnvironment("linux", 1000, want)
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("Environment = %#v, want %#v", got, want)
	}
}
