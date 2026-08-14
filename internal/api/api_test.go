package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
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
	if created.Process.Source.Kind != "imperative" {
		t.Fatalf("Source kind = %q", created.Process.Source.Kind)
	}
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/processes", map[string]any{
		"label": "Other task",
		"kind":  "task",
		"cwd":   filepath.Join(root, "other"),
		"command": map[string]any{
			"shell": "true",
		},
	}, http.StatusCreated, nil)

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

	requestJSON(t, http.MethodGet,
		server.URL+"/api/v1/processes?directory="+url.QueryEscape(root),
		nil, http.StatusOK, &listed,
	)
	if len(listed.Processes) != 1 || listed.Processes[0].ID != created.Process.ID {
		t.Fatalf("Directory processes = %#v", listed.Processes)
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

func TestProcessListUsesCursorPaginationWhenRequested(t *testing.T) {
	t.Parallel()
	root := t.TempDir()
	state, err := store.Open(filepath.Join(root, "state.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { state.Close() })
	manager := supervisor.New(state, supervisor.Options{
		LogRoot: filepath.Join(root, "logs"), Shell: "/bin/sh",
	})
	server := httptest.NewServer(New(state, manager, nil).Handler())
	t.Cleanup(server.Close)

	for index := 0; index < 5; index++ {
		tags := []string{"all"}
		if index%2 == 0 {
			tags = append(tags, "target")
		}
		requestJSON(t, http.MethodPost, server.URL+"/api/v1/processes", map[string]any{
			"label": fmt.Sprintf("Process %d", index),
			"kind":  "task",
			"tags":  tags,
			"cwd":   root,
			"command": map[string]any{
				"argv": []string{"true"},
			},
		}, http.StatusCreated, nil)
	}

	type pageResponse struct {
		Processes []domain.Process `json:"processes"`
		Page      struct {
			Limit      int    `json:"limit"`
			HasMore    bool   `json:"has_more"`
			NextCursor string `json:"next_cursor"`
		} `json:"page"`
	}

	var first pageResponse
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/processes?limit=2",
		nil, http.StatusOK, &first)
	if len(first.Processes) != 2 || first.Page.Limit != 2 ||
		!first.Page.HasMore || first.Page.NextCursor == "" {
		t.Fatalf("First page = %#v", first)
	}

	var second pageResponse
	requestJSON(t, http.MethodGet,
		server.URL+"/api/v1/processes?limit=2&cursor="+url.QueryEscape(first.Page.NextCursor),
		nil, http.StatusOK, &second)
	if len(second.Processes) != 2 || !second.Page.HasMore || second.Page.NextCursor == "" {
		t.Fatalf("Second page = %#v", second)
	}

	var third pageResponse
	requestJSON(t, http.MethodGet,
		server.URL+"/api/v1/processes?limit=2&cursor="+url.QueryEscape(second.Page.NextCursor),
		nil, http.StatusOK, &third)
	if len(third.Processes) != 1 || third.Page.HasMore || third.Page.NextCursor != "" {
		t.Fatalf("Third page = %#v", third)
	}

	seen := map[string]bool{}
	for _, page := range [][]domain.Process{first.Processes, second.Processes, third.Processes} {
		for _, process := range page {
			if seen[process.ID] {
				t.Fatalf("Process %q appeared on multiple pages", process.ID)
			}
			seen[process.ID] = true
		}
	}
	if len(seen) != 5 {
		t.Fatalf("Paged process count = %d, want 5", len(seen))
	}

	var filtered pageResponse
	requestJSON(t, http.MethodGet,
		server.URL+"/api/v1/processes?limit=2&tag=target",
		nil, http.StatusOK, &filtered)
	if len(filtered.Processes) != 2 || !filtered.Page.HasMore {
		t.Fatalf("Filtered first page = %#v", filtered)
	}
	for _, process := range filtered.Processes {
		if !contains(process.Tags, "target") {
			t.Fatalf("Filtered process tags = %#v", process.Tags)
		}
	}

	var unpaged pageResponse
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/processes",
		nil, http.StatusOK, &unpaged)
	if len(unpaged.Processes) != 5 {
		t.Fatalf("Unpaged process count = %d, want 5", len(unpaged.Processes))
	}

	for _, invalidQuery := range []string{
		"limit=0",
		"limit=101",
		"limit=2&cursor=not-a-cursor",
	} {
		requestJSON(t, http.MethodGet,
			server.URL+"/api/v1/processes?"+invalidQuery,
			nil, http.StatusBadRequest, nil)
	}
}

func contains(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
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
