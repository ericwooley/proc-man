package cli

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"proc-man/internal/domain"
)

func TestAgentInstructionsPrintMarkdownWithoutServiceAccess(t *testing.T) {
	t.Parallel()
	var output bytes.Buffer
	var errorsOutput bytes.Buffer
	command := New("test", &output, &errorsOutput)
	command.SetArgs([]string{"--agent-instructions"})

	if err := command.Execute(); err != nil {
		t.Fatal(err)
	}
	if output.String() != agentInstructions {
		t.Fatalf("Output = %q, want agent instructions", output.String())
	}
	if errorsOutput.Len() != 0 {
		t.Fatalf("Error output = %q", errorsOutput.String())
	}
	if !strings.Contains(output.String(), "proc-man run -- <command> [args...]") {
		t.Fatalf("Agent instructions do not describe direct one-shot commands")
	}
	if !strings.Contains(output.String(), "Register only long-running commands as services.") {
		t.Fatalf("Agent instructions do not reserve registration for long-running commands")
	}
	for _, obsolete := range []string{"Register a task", "--kind task", "proc-man process run PROCESS_ID"} {
		if strings.Contains(output.String(), obsolete) {
			t.Fatalf("Agent instructions contain obsolete task registration text %q", obsolete)
		}
	}
}

func TestRunExecutesInInvokingDirectoryAndStreamsOutput(t *testing.T) {
	executable, err := filepath.Abs(os.Args[0])
	if err != nil {
		t.Fatal(err)
	}
	directory := t.TempDir()
	t.Chdir(directory)

	output := newStreamingBuffer()
	errorsOutput := newStreamingBuffer()
	inputReader, inputWriter := io.Pipe()
	t.Cleanup(func() {
		_ = inputReader.Close()
		_ = inputWriter.Close()
	})
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	command := New("test", output, errorsOutput)
	command.SetContext(ctx)
	command.SetIn(inputReader)
	command.SetArgs([]string{
		"run", "--", executable,
		"-test.run=TestOneShotCommandHelper", "--",
		"proc-man-test-helper", "stream", "first", "two words", "--child-flag",
	})
	result := make(chan error, 1)
	go func() {
		result <- command.Execute()
	}()

	select {
	case <-output.firstWrite:
	case err := <-result:
		t.Fatalf("Command stopped before it streamed output: %v", err)
	case <-ctx.Done():
		t.Fatal("Command did not stream output before the timeout")
	}
	if _, err := io.WriteString(inputWriter, "input from caller"); err != nil {
		t.Fatal(err)
	}
	if err := inputWriter.Close(); err != nil {
		t.Fatal(err)
	}
	if err := <-result; err != nil {
		t.Fatal(err)
	}

	lines := strings.Split(strings.TrimSpace(output.String()), "\n")
	if len(lines) != 3 || lines[0] != "ready" || lines[2] != "input=input from caller" {
		t.Fatalf("Output = %q", output.String())
	}
	var payload struct {
		CWD  string   `json:"cwd"`
		Args []string `json:"args"`
	}
	if err := json.Unmarshal([]byte(lines[1]), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.CWD != directory {
		t.Fatalf("CWD = %q, want %q", payload.CWD, directory)
	}
	wantArguments := []string{"first", "two words", "--child-flag"}
	if fmt.Sprint(payload.Args) != fmt.Sprint(wantArguments) {
		t.Fatalf("Arguments = %#v, want %#v", payload.Args, wantArguments)
	}
	if errorsOutput.String() != "helper stderr\n" {
		t.Fatalf("Error output = %q", errorsOutput.String())
	}
}

func TestRunPreservesChildExitCode(t *testing.T) {
	executable, err := filepath.Abs(os.Args[0])
	if err != nil {
		t.Fatal(err)
	}
	var output bytes.Buffer
	var errorsOutput bytes.Buffer
	command := New("test", &output, &errorsOutput)
	command.SetArgs([]string{
		"run", "--", executable,
		"-test.run=TestOneShotCommandHelper", "--",
		"proc-man-test-helper", "exit", "23",
	})

	err = command.Execute()
	if !IsDirectRunExit(err) {
		t.Fatalf("Error = %v, want a direct run exit error", err)
	}
	if code := ExitCode(err); code != 23 {
		t.Fatalf("ExitCode() = %d, want 23", code)
	}
	if errorsOutput.String() != "helper failed\n" {
		t.Fatalf("Error output = %q", errorsOutput.String())
	}
}

func TestRunRequiresArgumentBoundary(t *testing.T) {
	var output bytes.Buffer
	command := New("test", &output, &output)
	command.SetArgs([]string{"run", "some-command"})

	err := command.Execute()
	if err == nil || !strings.Contains(err.Error(), "must follow --") {
		t.Fatalf("Error = %v, want an argument boundary error", err)
	}
}

func TestRunRejectsJSONOutput(t *testing.T) {
	var output bytes.Buffer
	command := New("test", &output, &output)
	command.SetArgs([]string{"--json", "run", "--", "some-command"})

	err := command.Execute()
	if err == nil || !strings.Contains(err.Error(), "--json cannot be used") {
		t.Fatalf("Error = %v, want a JSON output error", err)
	}
}

func TestRunListStillReadsRetainedRuns(t *testing.T) {
	t.Parallel()
	var requestedPath string
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		requestedPath = request.URL.Path
		_ = json.NewEncoder(response).Encode(map[string]any{"runs": []domain.Run{}})
	}))
	t.Cleanup(server.Close)

	var output bytes.Buffer
	command := New("test", &output, &output)
	command.SetArgs([]string{"--admin-url", server.URL, "run", "list"})
	if err := command.Execute(); err != nil {
		t.Fatal(err)
	}
	if requestedPath != "/api/v1/runs" {
		t.Fatalf("Request path = %q, want /api/v1/runs", requestedPath)
	}
}

func TestOneShotCommandHelper(_ *testing.T) {
	marker := -1
	for index, argument := range os.Args {
		if argument == "proc-man-test-helper" {
			marker = index
			break
		}
	}
	if marker < 0 {
		return
	}
	mode := os.Args[marker+1]
	if mode == "exit" {
		fmt.Fprintln(os.Stderr, "helper failed")
		var code int
		_, _ = fmt.Sscan(os.Args[marker+2], &code)
		os.Exit(code)
	}

	directory, _ := os.Getwd()
	fmt.Fprintln(os.Stdout, "ready")
	payload, _ := json.Marshal(map[string]any{
		"cwd": directory, "args": os.Args[marker+2:],
	})
	fmt.Fprintln(os.Stdout, string(payload))
	fmt.Fprintln(os.Stderr, "helper stderr")
	input, _ := io.ReadAll(os.Stdin)
	fmt.Fprintf(os.Stdout, "input=%s\n", input)
	os.Exit(0)
}

type streamingBuffer struct {
	mu         sync.Mutex
	buffer     bytes.Buffer
	firstWrite chan struct{}
	once       sync.Once
}

func newStreamingBuffer() *streamingBuffer {
	return &streamingBuffer{firstWrite: make(chan struct{})}
}

func (buffer *streamingBuffer) Write(value []byte) (int, error) {
	buffer.mu.Lock()
	defer buffer.mu.Unlock()
	count, err := buffer.buffer.Write(value)
	buffer.once.Do(func() { close(buffer.firstWrite) })
	return count, err
}

func (buffer *streamingBuffer) String() string {
	buffer.mu.Lock()
	defer buffer.mu.Unlock()
	return buffer.buffer.String()
}

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
