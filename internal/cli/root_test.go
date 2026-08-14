package cli

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
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
	if !strings.Contains(output.String(), "stores one audit record") {
		t.Fatalf("Agent instructions do not describe the direct run audit record")
	}
	for _, obsolete := range []string{
		"Register a task", "--kind task", "proc-man process run PROCESS_ID",
		"does not require the proc-man daemon", "does not retain output or run history",
	} {
		if strings.Contains(output.String(), obsolete) {
			t.Fatalf("Agent instructions contain obsolete task registration text %q", obsolete)
		}
	}
}

func TestRunCreatesAuditAndStreamsRetainedOutput(t *testing.T) {
	directory := t.TempDir()
	t.Chdir(directory)

	output := newStreamingBuffer()
	errorsOutput := newStreamingBuffer()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	releaseFinish := make(chan struct{})
	var received struct {
		CWD  string   `json:"cwd"`
		Argv []string `json:"argv"`
		Env  []string `json:"env"`
	}
	t.Setenv("PROC_MAN_TEST_CALLER_ENV", "caller-value")
	logRequests := 0
	run := directRunForTest(directory, []string{"test-command", "first", "two words", "--child-flag"})
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		switch {
		case request.Method == http.MethodPost && request.URL.Path == "/api/v1/runs":
			if err := json.NewDecoder(request.Body).Decode(&received); err != nil {
				t.Errorf("Decode direct run: %v", err)
			}
			writeCLIJSON(response, http.StatusAccepted, map[string]any{"run": run})
		case request.Method == http.MethodGet && request.URL.Path == "/api/v1/runs/run_direct/logs":
			logRequests++
			if logRequests == 1 {
				if request.URL.Query().Get("since") != "" {
					t.Errorf("First since value = %q, want empty", request.URL.Query().Get("since"))
				}
				writeCLIJSON(response, http.StatusOK, map[string]any{
					"run": run,
					"records": []domain.LogRecord{
						{Sequence: 1, Stream: "stdout", Text: "ready"},
						{Sequence: 2, Stream: "stderr", Text: "warning"},
					},
				})
				return
			}
			<-releaseFinish
			if request.URL.Query().Get("since") != "2" {
				t.Errorf("Final since value = %q, want 2", request.URL.Query().Get("since"))
			}
			exitCode := 0
			finished := run
			finished.State = domain.RunStateExited
			finished.ExitCode = &exitCode
			writeCLIJSON(response, http.StatusOK, map[string]any{
				"run": finished,
				"records": []domain.LogRecord{
					{Sequence: 3, Stream: "stdout", Text: "tail", Partial: true},
				},
			})
		default:
			t.Errorf("Request = %s %s", request.Method, request.URL.String())
			writeCLIJSON(response, http.StatusNotFound, map[string]any{})
		}
	}))
	t.Cleanup(server.Close)

	command := New("test", output, errorsOutput)
	command.SetContext(ctx)
	command.SetArgs([]string{
		"--admin-url", server.URL, "run", "--",
		"test-command", "first", "two words", "--child-flag",
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
	close(releaseFinish)
	if err := <-result; err != nil {
		t.Fatal(err)
	}

	if output.String() != "ready\ntail" {
		t.Fatalf("Output = %q", output.String())
	}
	if errorsOutput.String() != "warning\n" {
		t.Fatalf("Error output = %q", errorsOutput.String())
	}
	if received.CWD != directory {
		t.Fatalf("CWD = %q, want %q", received.CWD, directory)
	}
	wantArguments := []string{"test-command", "first", "two words", "--child-flag"}
	if len(received.Argv) != len(wantArguments) {
		t.Fatalf("Arguments = %#v, want %#v", received.Argv, wantArguments)
	}
	for index := range wantArguments {
		if received.Argv[index] != wantArguments[index] {
			t.Fatalf("Arguments = %#v, want %#v", received.Argv, wantArguments)
		}
	}
	if !containsString(received.Env, "PROC_MAN_TEST_CALLER_ENV=caller-value") {
		t.Fatalf("Environment does not contain the caller value: %#v", received.Env)
	}
}

func TestRunCancelsAuditWhenCommandContextEnds(t *testing.T) {
	directory := t.TempDir()
	t.Chdir(directory)
	run := directRunForTest(directory, []string{"test-command"})
	requestObserved := make(chan struct{})
	cancelObserved := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		switch request.Method + " " + request.URL.Path {
		case "POST /api/v1/runs":
			writeCLIJSON(response, http.StatusAccepted, map[string]any{"run": run})
		case "GET /api/v1/runs/run_direct/logs":
			select {
			case <-requestObserved:
			default:
				close(requestObserved)
			}
			writeCLIJSON(response, http.StatusOK, map[string]any{"run": run, "records": []any{}})
		case "POST /api/v1/runs/run_direct/cancel":
			select {
			case <-cancelObserved:
			default:
				close(cancelObserved)
			}
			stopping := run
			stopping.State = domain.RunStateStopping
			writeCLIJSON(response, http.StatusAccepted, map[string]any{"run": stopping})
		default:
			t.Errorf("Request = %s %s", request.Method, request.URL.String())
			writeCLIJSON(response, http.StatusNotFound, map[string]any{})
		}
	}))
	t.Cleanup(server.Close)

	ctx, cancel := context.WithCancel(context.Background())
	command := New("test", &bytes.Buffer{}, &bytes.Buffer{})
	command.SetContext(ctx)
	command.SetArgs([]string{"--admin-url", server.URL, "run", "--", "test-command"})
	result := make(chan error, 1)
	go func() { result <- command.Execute() }()
	<-requestObserved
	cancel()
	if err := <-result; !errors.Is(err, context.Canceled) {
		t.Fatalf("Error = %v, want context cancellation", err)
	}
	select {
	case <-cancelObserved:
	case <-time.After(time.Second):
		t.Fatal("Direct run cancellation was not sent")
	}
}

func TestRunDrainsEveryTerminalLogPage(t *testing.T) {
	directory := t.TempDir()
	t.Chdir(directory)
	run := directRunForTest(directory, []string{"test-command"})
	exitCode := 0
	run.State = domain.RunStateExited
	run.ExitCode = &exitCode
	firstPage := make([]domain.LogRecord, directRunLogPageSize)
	for index := range firstPage {
		firstPage[index] = domain.LogRecord{Sequence: int64(index + 1), Partial: true}
	}
	logRequests := 0
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		switch request.Method + " " + request.URL.Path {
		case "POST /api/v1/runs":
			writeCLIJSON(response, http.StatusAccepted, map[string]any{"run": run})
		case "GET /api/v1/runs/run_direct/logs":
			logRequests++
			if logRequests == 1 {
				writeCLIJSON(response, http.StatusOK, map[string]any{"run": run, "records": firstPage})
				return
			}
			writeCLIJSON(response, http.StatusOK, map[string]any{
				"run": run,
				"records": []domain.LogRecord{{
					Sequence: directRunLogPageSize + 1, Stream: "stdout", Text: "tail",
				}},
			})
		default:
			t.Errorf("Request = %s %s", request.Method, request.URL.String())
			writeCLIJSON(response, http.StatusNotFound, map[string]any{})
		}
	}))
	t.Cleanup(server.Close)

	var output bytes.Buffer
	command := New("test", &output, &bytes.Buffer{})
	command.SetArgs([]string{"--admin-url", server.URL, "run", "--", "test-command"})
	if err := command.Execute(); err != nil {
		t.Fatal(err)
	}
	if output.String() != "tail\n" || logRequests != 2 {
		t.Fatalf("Output = %q and log requests = %d", output.String(), logRequests)
	}
}

func TestRunPreservesChildExitCode(t *testing.T) {
	directory := t.TempDir()
	run := directRunForTest(directory, []string{"test-command"})
	exitCode := 23
	finished := run
	finished.State = domain.RunStateFailed
	finished.ExitCode = &exitCode
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		switch request.Method + " " + request.URL.Path {
		case "POST /api/v1/runs":
			writeCLIJSON(response, http.StatusAccepted, map[string]any{"run": run})
		case "GET /api/v1/runs/run_direct/logs":
			writeCLIJSON(response, http.StatusOK, map[string]any{
				"run":     finished,
				"records": []domain.LogRecord{{Sequence: 1, Stream: "stderr", Text: "helper failed"}},
			})
		default:
			t.Errorf("Request = %s %s", request.Method, request.URL.String())
			writeCLIJSON(response, http.StatusNotFound, map[string]any{})
		}
	}))
	t.Cleanup(server.Close)

	var output bytes.Buffer
	var errorsOutput bytes.Buffer
	command := New("test", &output, &errorsOutput)
	command.SetArgs([]string{
		"--admin-url", server.URL, "run", "--", "test-command",
	})

	err := command.Execute()
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
	var requestedDirectory string
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		requestedPath = request.URL.Path
		requestedDirectory = request.URL.Query().Get("directory")
		_ = json.NewEncoder(response).Encode(map[string]any{"runs": []domain.Run{}})
	}))
	t.Cleanup(server.Close)

	var output bytes.Buffer
	command := New("test", &output, &output)
	command.SetArgs([]string{"--admin-url", server.URL, "run", "list", "--directory", "."})
	if err := command.Execute(); err != nil {
		t.Fatal(err)
	}
	if requestedPath != "/api/v1/runs" {
		t.Fatalf("Request path = %q, want /api/v1/runs", requestedPath)
	}
	directory, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	if requestedDirectory != directory {
		t.Fatalf("Directory = %q, want %q", requestedDirectory, directory)
	}
}

func directRunForTest(directory string, arguments []string) domain.Run {
	return domain.Run{
		ID: "run_direct", State: domain.RunStateRunning,
		Process: domain.ProcessSnapshot{
			Label: directory, Kind: domain.ProcessKindTask,
			Command: domain.Command{Argv: arguments}, CWD: directory,
			Tags: []string{}, Env: map[string]string{}, Ports: []domain.Port{},
			Source: domain.Source{Kind: "direct"},
		},
	}
}

func writeCLIJSON(response http.ResponseWriter, status int, value any) {
	response.Header().Set("Content-Type", "application/json")
	response.WriteHeader(status)
	_ = json.NewEncoder(response).Encode(value)
}

func containsString(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
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
