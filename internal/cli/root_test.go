package cli

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"proc-man/internal/domain"
)

func TestProcessListFiltersAndDisplaysDirectory(t *testing.T) {
	t.Parallel()
	directory, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	var requestedDirectory string
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		requestedDirectory = request.URL.Query().Get("directory")
		_ = json.NewEncoder(response).Encode(map[string]any{
			"processes": []domain.Process{{
				ID: "proc_one", Label: "Web", Kind: domain.ProcessKindService,
				State: domain.ProcessStateStopped, CWD: directory,
			}},
		})
	}))
	t.Cleanup(server.Close)

	var output bytes.Buffer
	command := New("test", &output, &output)
	command.SetArgs([]string{
		"--admin-url", server.URL,
		"process", "list", "--directory", ".",
	})
	if err := command.Execute(); err != nil {
		t.Fatal(err)
	}
	if requestedDirectory != directory {
		t.Fatalf("Directory query = %q, want %q", requestedDirectory, directory)
	}
	if !bytes.Contains(output.Bytes(), []byte("DIRECTORY")) ||
		!bytes.Contains(output.Bytes(), []byte(directory)) {
		t.Fatalf("Output = %q", output.String())
	}
}

func TestProcessRegisterSendsAnImperativeCommand(t *testing.T) {
	t.Parallel()
	directory := t.TempDir()
	var received domain.Process
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodPost || request.URL.Path != "/api/v1/processes" {
			t.Fatalf("Request = %s %s", request.Method, request.URL.Path)
		}
		if err := json.NewDecoder(request.Body).Decode(&received); err != nil {
			t.Fatal(err)
		}
		_ = json.NewEncoder(response).Encode(map[string]any{"process": received})
	}))
	t.Cleanup(server.Close)

	var output bytes.Buffer
	command := New("test", &output, &output)
	command.SetArgs([]string{
		"--admin-url", server.URL,
		"process", "register",
		"--label", "Web", "--kind", "service", "--cwd", directory,
		"--", "npm", "run", "dev",
	})
	if err := command.Execute(); err != nil {
		t.Fatal(err)
	}
	if received.CWD != directory {
		t.Fatalf("CWD = %q, want %q", received.CWD, directory)
	}
	if len(received.Command.Argv) != 3 || received.Command.Argv[2] != "dev" {
		t.Fatalf("Command = %#v", received.Command)
	}
}
