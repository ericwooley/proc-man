package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"proc-man/internal/domain"
	"proc-man/internal/store"
	"proc-man/internal/supervisor"
)

func TestProcessTaskAndLogsJourney(t *testing.T) {
	t.Parallel()
	root := t.TempDir()
	state, err := store.Open(filepath.Join(root, "state.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { state.Close() })
	manager := supervisor.New(state, supervisor.Options{
		LogRoot: filepath.Join(root, "logs"), Shell: "/bin/sh",
		StopTimeout: 100 * time.Millisecond,
	})
	server := httptest.NewServer(New(state, manager, nil).Handler())
	t.Cleanup(server.Close)

	var created struct {
		Process domain.Process `json:"process"`
	}
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/processes", map[string]any{
		"label": "Print task",
		"kind":  "task",
		"tags":  []string{"project:test", "script"},
		"cwd":   root,
		"command": map[string]any{
			"shell": "printf 'hello from proc-man\\n'",
		},
	}, http.StatusCreated, &created)
	if created.Process.ID == "" {
		t.Fatal("created process has no ID")
	}

	var listed struct {
		Processes []domain.Process `json:"processes"`
	}
	requestJSON(t, http.MethodGet,
		server.URL+"/api/v1/processes?tag=project%3Atest&query=print",
		nil, http.StatusOK, &listed,
	)
	if len(listed.Processes) != 1 {
		t.Fatalf("Processes = %#v", listed.Processes)
	}

	var started struct {
		Run domain.Run `json:"run"`
	}
	requestJSON(t, http.MethodPost,
		server.URL+"/api/v1/processes/"+created.Process.ID+"/runs",
		map[string]any{}, http.StatusAccepted, &started,
	)
	deadline := time.Now().Add(3 * time.Second)
	var runPayload struct {
		Run domain.Run `json:"run"`
	}
	for {
		requestJSON(t, http.MethodGet,
			server.URL+"/api/v1/runs/"+started.Run.ID,
			nil, http.StatusOK, &runPayload,
		)
		if runPayload.Run.State.Terminal() {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("task did not finish")
		}
		time.Sleep(10 * time.Millisecond)
	}

	var logs struct {
		Records []domain.LogRecord `json:"records"`
	}
	requestJSON(t, http.MethodGet,
		server.URL+"/api/v1/runs/"+started.Run.ID+"/logs",
		nil, http.StatusOK, &logs,
	)
	if len(logs.Records) != 1 || logs.Records[0].Text != "hello from proc-man" {
		t.Fatalf("Records = %#v", logs.Records)
	}
}

func requestJSON(
	t *testing.T,
	method string,
	url string,
	input any,
	status int,
	output any,
) {
	t.Helper()
	var body bytes.Buffer
	if input != nil {
		if err := json.NewEncoder(&body).Encode(input); err != nil {
			t.Fatal(err)
		}
	}
	request, err := http.NewRequestWithContext(context.Background(), method, url, &body)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != status {
		var value any
		_ = json.NewDecoder(response.Body).Decode(&value)
		t.Fatalf("Status = %d, want %d: %s", response.StatusCode, status, fmt.Sprint(value))
	}
	if output != nil {
		if err := json.NewDecoder(response.Body).Decode(output); err != nil {
			t.Fatal(err)
		}
	}
}
