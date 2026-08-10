package api

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"proc-man/internal/domain"
	"proc-man/internal/events"
	"proc-man/internal/ids"
	"proc-man/internal/logstore"
	"proc-man/internal/manifest"
	"proc-man/internal/store"
	"proc-man/internal/supervisor"
)

type Server struct {
	store      *store.Store
	supervisor *supervisor.Manager
	spa        http.Handler
}

func New(state *store.Store, manager *supervisor.Manager, spa http.Handler) *Server {
	return &Server{store: state, supervisor: manager, spa: spa}
}

func (server *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", server.health)
	mux.HandleFunc("GET /readyz", server.health)
	mux.HandleFunc("GET /api/v1/openapi.json", server.openapi)
	mux.HandleFunc("GET /api/v1/settings", server.settings)
	mux.HandleFunc("GET /api/v1/tags", server.tags)
	mux.HandleFunc("GET /api/v1/events", server.events)
	mux.HandleFunc("GET /api/v1/processes", server.listProcesses)
	mux.HandleFunc("POST /api/v1/processes", server.createProcess)
	mux.HandleFunc("GET /api/v1/processes/{id}", server.getProcess)
	mux.HandleFunc("PATCH /api/v1/processes/{id}", server.updateProcess)
	mux.HandleFunc("DELETE /api/v1/processes/{id}", server.deleteProcess)
	mux.HandleFunc("POST /api/v1/processes/{id}/start", server.startProcess)
	mux.HandleFunc("POST /api/v1/processes/{id}/stop", server.stopProcess)
	mux.HandleFunc("POST /api/v1/processes/{id}/restart", server.restartProcess)
	mux.HandleFunc("POST /api/v1/processes/{id}/runs", server.runProcess)
	mux.HandleFunc("GET /api/v1/processes/{id}/runs", server.processRuns)
	mux.HandleFunc("GET /api/v1/runs", server.listRuns)
	mux.HandleFunc("GET /api/v1/runs/{id}", server.getRun)
	mux.HandleFunc("POST /api/v1/runs/{id}/cancel", server.cancelRun)
	mux.HandleFunc("GET /api/v1/runs/{id}/logs", server.runLogs)
	mux.HandleFunc("GET /api/v1/runs/{id}/logs/events", server.runLogEvents)
	mux.HandleFunc("GET /api/v1/runs/{id}/logs/download", server.downloadLogs)
	mux.HandleFunc("POST /api/v1/run-search", server.searchLogs)
	mux.HandleFunc("POST /api/v1/registrations", server.registerManifest)
	mux.HandleFunc("POST /api/v1/deregistrations", server.deregisterManifest)
	if server.spa != nil {
		mux.Handle("/", server.spa)
	}
	return requestMiddleware(mux)
}

func requestMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		response.Header().Set("X-Content-Type-Options", "nosniff")
		response.Header().Set("Referrer-Policy", "no-referrer")
		response.Header().Set("Cache-Control", "no-store")
		next.ServeHTTP(response, request)
	})
}

func (server *Server) health(response http.ResponseWriter, _ *http.Request) {
	writeJSON(response, http.StatusOK, map[string]any{
		"ok": true, "name": "proc-man", "time": time.Now().UTC(),
	})
}

func (server *Server) settings(response http.ResponseWriter, _ *http.Request) {
	writeJSON(response, http.StatusOK, map[string]any{
		"name": "proc-man", "api_version": "v1", "authentication": false,
		"local_only": true,
	})
}

func (server *Server) tags(response http.ResponseWriter, request *http.Request) {
	tags, err := server.store.Tags(request.Context())
	if err != nil {
		writeError(response, err)
		return
	}
	type tagResponse struct {
		Tag   string `json:"tag"`
		Count int    `json:"count"`
	}
	result := make([]tagResponse, 0, len(tags))
	for tag, count := range tags {
		result = append(result, tagResponse{Tag: tag, Count: count})
	}
	writeJSON(response, http.StatusOK, map[string]any{"tags": result})
}

func (server *Server) listProcesses(response http.ResponseWriter, request *http.Request) {
	query := request.URL.Query()
	processes, err := server.store.ListProcesses(request.Context(), domain.ProcessFilter{
		Query:     query.Get("query"),
		Directory: query.Get("directory"),
		Tags:      query["tag"],
		Kind:      domain.ProcessKind(query.Get("kind")),
		State:     domain.ProcessState(query.Get("state")),
	})
	if err != nil {
		writeError(response, err)
		return
	}
	writeJSON(response, http.StatusOK, map[string]any{"processes": processes})
}

func (server *Server) createProcess(response http.ResponseWriter, request *http.Request) {
	var process domain.Process
	if err := decodeJSON(request, &process); err != nil {
		writeError(response, err)
		return
	}
	var err error
	process.ID, err = ids.New("proc")
	if err != nil {
		writeError(response, err)
		return
	}
	for index := range process.Ports {
		process.Ports[index].ID, err = ids.New("endpoint")
		if err != nil {
			writeError(response, err)
			return
		}
	}
	process.Source = domain.Source{Kind: "imperative"}
	process, err = server.store.CreateProcess(request.Context(), process)
	if err != nil {
		writeError(response, err)
		return
	}
	server.supervisor.Events().Publish(processEvent("process.created", process))
	writeJSON(response, http.StatusCreated, map[string]any{"process": process})
}

func (server *Server) getProcess(response http.ResponseWriter, request *http.Request) {
	process, err := server.store.GetProcess(request.Context(), request.PathValue("id"))
	if err != nil {
		writeError(response, err)
		return
	}
	runs, err := server.store.ListRuns(request.Context(), domain.RunFilter{
		ProcessID: process.ID, Limit: 100,
	})
	if err != nil {
		writeError(response, err)
		return
	}
	writeJSON(response, http.StatusOK, map[string]any{
		"process": process, "runs": runs,
	})
}

func (server *Server) updateProcess(response http.ResponseWriter, request *http.Request) {
	current, err := server.store.GetProcess(request.Context(), request.PathValue("id"))
	if err != nil {
		writeError(response, err)
		return
	}
	if current.Source.Kind == "manifest" {
		writeAPIError(response, http.StatusConflict, "manifest_owned",
			"manifest-owned processes must be updated through registration", current.Source)
		return
	}
	var update domain.Process
	if err := decodeJSON(request, &update); err != nil {
		writeError(response, err)
		return
	}
	update.ID = current.ID
	update.Source = current.Source
	update.State = current.State
	if update.Label == "" {
		update.Label = current.Label
	}
	if update.Kind == "" {
		update.Kind = current.Kind
	}
	if update.CWD == "" {
		update.CWD = current.CWD
	}
	if len(update.Command.Argv) == 0 && update.Command.Shell == "" {
		update.Command = current.Command
	}
	if update.Tags == nil {
		update.Tags = current.Tags
	}
	if update.Env == nil {
		update.Env = current.Env
	}
	if update.Ports == nil {
		update.Ports = current.Ports
	}
	update, err = server.store.UpdateProcess(request.Context(), update)
	if err != nil {
		writeError(response, err)
		return
	}
	server.supervisor.Events().Publish(processEvent("process.updated", update))
	writeJSON(response, http.StatusOK, map[string]any{"process": update})
}

func (server *Server) deleteProcess(response http.ResponseWriter, request *http.Request) {
	id := request.PathValue("id")
	if err := server.supervisor.StopProcess(request.Context(), id); err != nil &&
		!errors.Is(err, supervisor.ErrNotActive) {
		writeError(response, err)
		return
	}
	if err := server.store.DeleteProcess(request.Context(), id); err != nil {
		writeError(response, err)
		return
	}
	server.supervisor.Events().Publish(processEvent("process.deleted", domain.Process{ID: id}))
	response.WriteHeader(http.StatusNoContent)
}

func (server *Server) startProcess(response http.ResponseWriter, request *http.Request) {
	run, err := server.supervisor.StartService(request.Context(), request.PathValue("id"))
	writeRunResult(response, run, err)
}

func (server *Server) stopProcess(response http.ResponseWriter, request *http.Request) {
	run, err := server.supervisor.StopService(request.Context(), request.PathValue("id"))
	writeRunResult(response, run, err)
}

func (server *Server) restartProcess(response http.ResponseWriter, request *http.Request) {
	run, err := server.supervisor.RestartService(request.Context(), request.PathValue("id"))
	writeRunResult(response, run, err)
}

func (server *Server) runProcess(response http.ResponseWriter, request *http.Request) {
	run, err := server.supervisor.RunTask(request.Context(), request.PathValue("id"))
	writeRunResult(response, run, err)
}

func (server *Server) cancelRun(response http.ResponseWriter, request *http.Request) {
	run, err := server.supervisor.CancelRun(request.Context(), request.PathValue("id"))
	writeRunResult(response, run, err)
}

func writeRunResult(response http.ResponseWriter, run domain.Run, err error) {
	if err != nil {
		writeError(response, err)
		return
	}
	writeJSON(response, http.StatusAccepted, map[string]any{"run": run})
}

func (server *Server) processRuns(response http.ResponseWriter, request *http.Request) {
	runs, err := server.store.ListRuns(request.Context(), domain.RunFilter{
		ProcessID: request.PathValue("id"), Limit: parseLimit(request),
	})
	if err != nil {
		writeError(response, err)
		return
	}
	writeJSON(response, http.StatusOK, map[string]any{"runs": runs})
}

func (server *Server) listRuns(response http.ResponseWriter, request *http.Request) {
	query := request.URL.Query()
	runs, err := server.store.ListRuns(request.Context(), domain.RunFilter{
		ProcessID: query.Get("process_id"),
		Kind:      domain.ProcessKind(query.Get("kind")),
		State:     domain.RunState(query.Get("state")),
		Tags:      query["tag"], Limit: parseLimit(request),
	})
	if err != nil {
		writeError(response, err)
		return
	}
	writeJSON(response, http.StatusOK, map[string]any{"runs": runs})
}

func (server *Server) getRun(response http.ResponseWriter, request *http.Request) {
	run, err := server.store.GetRun(request.Context(), request.PathValue("id"))
	if err != nil {
		writeError(response, err)
		return
	}
	writeJSON(response, http.StatusOK, map[string]any{"run": run})
}

func (server *Server) runLogs(response http.ResponseWriter, request *http.Request) {
	run, err := server.store.GetRun(request.Context(), request.PathValue("id"))
	if err != nil {
		writeError(response, err)
		return
	}
	query := request.URL.Query()
	since, _ := strconv.ParseInt(query.Get("since"), 10, 64)
	records, err := logstore.Read(run.LogPath, logstore.Query{
		Text: query.Get("query"), Stream: query.Get("stream"),
		Since: since, Limit: parseLimit(request),
	})
	if err != nil {
		writeError(response, err)
		return
	}
	writeJSON(response, http.StatusOK, map[string]any{
		"run": run, "records": records,
	})
}

func (server *Server) searchLogs(response http.ResponseWriter, request *http.Request) {
	var input struct {
		Query     string   `json:"query"`
		Stream    string   `json:"stream"`
		ProcessID string   `json:"process_id"`
		Tags      []string `json:"tags"`
		Limit     int      `json:"limit"`
	}
	if err := decodeJSON(request, &input); err != nil {
		writeError(response, err)
		return
	}
	runs, err := server.store.ListRuns(request.Context(), domain.RunFilter{
		ProcessID: input.ProcessID, Tags: input.Tags, Limit: 500,
	})
	if err != nil {
		writeError(response, err)
		return
	}
	type match struct {
		Run    domain.Run       `json:"run"`
		Record domain.LogRecord `json:"record"`
	}
	matches := make([]match, 0)
	limit := input.Limit
	if limit <= 0 || limit > 10_000 {
		limit = 1_000
	}
	for _, run := range runs {
		records, err := logstore.Read(run.LogPath, logstore.Query{
			Text: input.Query, Stream: input.Stream, Limit: limit - len(matches),
		})
		if err != nil {
			writeError(response, err)
			return
		}
		for _, record := range records {
			matches = append(matches, match{Run: run, Record: record})
		}
		if len(matches) >= limit {
			break
		}
	}
	writeJSON(response, http.StatusOK, map[string]any{"matches": matches})
}

func (server *Server) downloadLogs(response http.ResponseWriter, request *http.Request) {
	run, err := server.store.GetRun(request.Context(), request.PathValue("id"))
	if err != nil {
		writeError(response, err)
		return
	}
	records, err := logstore.Read(run.LogPath, logstore.Query{Limit: 100_000})
	if err != nil {
		writeError(response, err)
		return
	}
	format := request.URL.Query().Get("format")
	name := safeFileName(run.Process.Label) + "-" + run.ID
	if format == "ndjson" {
		response.Header().Set("Content-Type", "application/x-ndjson")
		response.Header().Set("Content-Disposition", `attachment; filename="`+name+`.ndjson"`)
		encoder := json.NewEncoder(response)
		for _, record := range records {
			if err := encoder.Encode(record); err != nil {
				return
			}
		}
		return
	}
	response.Header().Set("Content-Type", "text/plain; charset=utf-8")
	response.Header().Set("Content-Disposition", `attachment; filename="`+name+`.log"`)
	_ = logstore.DownloadText(response, records)
}

func (server *Server) runLogEvents(response http.ResponseWriter, request *http.Request) {
	runID := request.PathValue("id")
	if _, err := server.store.GetRun(request.Context(), runID); err != nil {
		writeError(response, err)
		return
	}
	flusher, ok := response.(http.Flusher)
	if !ok {
		writeAPIError(response, http.StatusInternalServerError, "internal_error", "streaming is unavailable", nil)
		return
	}
	response.Header().Set("Content-Type", "text/event-stream")
	response.Header().Set("Cache-Control", "no-cache")
	channel, unsubscribe := server.supervisor.Events().Subscribe()
	defer unsubscribe()
	for {
		select {
		case <-request.Context().Done():
			return
		case event := <-channel:
			if event.Type != "log.record" || event.ResourceID != runID {
				continue
			}
			fmt.Fprintf(response, "event: log\ndata: %s\n\n", event.JSON())
			flusher.Flush()
		}
	}
}

func (server *Server) events(response http.ResponseWriter, request *http.Request) {
	flusher, ok := response.(http.Flusher)
	if !ok {
		writeAPIError(response, http.StatusInternalServerError, "internal_error", "streaming is unavailable", nil)
		return
	}
	response.Header().Set("Content-Type", "text/event-stream")
	channel, unsubscribe := server.supervisor.Events().Subscribe()
	defer unsubscribe()
	fmt.Fprint(response, "event: ready\ndata: {}\n\n")
	flusher.Flush()
	for {
		select {
		case <-request.Context().Done():
			return
		case event := <-channel:
			fmt.Fprintf(response, "event: %s\ndata: %s\n\n", event.Type, event.JSON())
			flusher.Flush()
		}
	}
}

func (server *Server) registerManifest(response http.ResponseWriter, request *http.Request) {
	var input struct {
		Path    string `json:"path"`
		Content string `json:"content"`
		DryRun  bool   `json:"dry_run"`
	}
	if err := decodeJSON(request, &input); err != nil {
		writeError(response, err)
		return
	}
	parsed, canonical, err := manifest.Parse(input.Path, []byte(input.Content))
	if err != nil {
		writeError(response, err)
		return
	}
	preview, err := manifest.Reconcile(request.Context(), server.store, canonical, parsed, true)
	if err != nil {
		writeError(response, err)
		return
	}
	if input.DryRun {
		writeJSON(response, http.StatusOK, map[string]any{"plan": preview})
		return
	}
	for _, process := range preview.Removed {
		_ = server.supervisor.StopProcess(request.Context(), process.ID)
	}
	plan, err := manifest.Reconcile(request.Context(), server.store, canonical, parsed, false)
	if err != nil {
		writeError(response, err)
		return
	}
	writeJSON(response, http.StatusOK, map[string]any{"plan": plan})
}

func (server *Server) deregisterManifest(response http.ResponseWriter, request *http.Request) {
	var input struct {
		Source string `json:"source"`
	}
	if err := decodeJSON(request, &input); err != nil {
		writeError(response, err)
		return
	}
	canonical, err := filepathAbs(input.Source)
	if err != nil {
		writeError(response, err)
		return
	}
	processes, err := server.store.ProcessesBySource(request.Context(), canonical)
	if err != nil {
		writeError(response, err)
		return
	}
	for _, process := range processes {
		_ = server.supervisor.StopProcess(request.Context(), process.ID)
		if err := server.store.DeleteProcess(request.Context(), process.ID); err != nil {
			writeError(response, err)
			return
		}
	}
	writeJSON(response, http.StatusOK, map[string]any{
		"source": canonical, "removed": processes,
	})
}

func (server *Server) openapi(response http.ResponseWriter, _ *http.Request) {
	writeJSON(response, http.StatusOK, map[string]any{
		"openapi": "3.1.0",
		"info":    map[string]any{"title": "proc-man API", "version": "1.0.0"},
		"servers": []map[string]string{{"url": "http://127.0.0.1:13337"}},
	})
}

func decodeJSON(request *http.Request, output any) error {
	defer request.Body.Close()
	decoder := json.NewDecoder(io.LimitReader(request.Body, 4<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(output); err != nil {
		return fmt.Errorf("%w: %v", domain.ErrValidation, err)
	}
	return nil
}

func writeJSON(response http.ResponseWriter, status int, value any) {
	response.Header().Set("Content-Type", "application/json")
	response.WriteHeader(status)
	_ = json.NewEncoder(response).Encode(value)
}

func writeError(response http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, store.ErrNotFound):
		writeAPIError(response, http.StatusNotFound, "not_found", "resource not found", nil)
	case errors.Is(err, domain.ErrValidation):
		writeAPIError(response, http.StatusBadRequest, "validation_failed", err.Error(), nil)
	case errors.Is(err, supervisor.ErrInvalidKind):
		writeAPIError(response, http.StatusConflict, "invalid_kind", err.Error(), nil)
	case errors.Is(err, supervisor.ErrAlreadyActive):
		writeAPIError(response, http.StatusConflict, "invalid_state", err.Error(), nil)
	case errors.Is(err, supervisor.ErrNotActive):
		writeAPIError(response, http.StatusConflict, "invalid_state", err.Error(), nil)
	case errors.Is(err, supervisor.ErrCWDUnavailable):
		writeAPIError(response, http.StatusConflict, "cwd_unavailable", err.Error(), nil)
	default:
		writeAPIError(response, http.StatusInternalServerError, "internal_error", err.Error(), nil)
	}
}

func writeAPIError(response http.ResponseWriter, status int, code, message string, details any) {
	writeJSON(response, status, map[string]any{
		"error": map[string]any{
			"code": code, "message": message, "details": details,
		},
	})
}

func processEvent(kind string, process domain.Process) events.Event {
	return events.Event{Type: kind, ResourceID: process.ID, Data: process}
}

func parseLimit(request *http.Request) int {
	value, _ := strconv.Atoi(request.URL.Query().Get("limit"))
	return value
}

func safeFileName(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	var builder strings.Builder
	lastDash := false
	for _, character := range value {
		if character >= 'a' && character <= 'z' || character >= '0' && character <= '9' {
			builder.WriteRune(character)
			lastDash = false
			continue
		}
		if !lastDash {
			builder.WriteByte('-')
			lastDash = true
		}
	}
	return strings.Trim(builder.String(), "-")
}

func filepathAbs(path string) (string, error) {
	if path == "" {
		return "", fmt.Errorf("%w: source is required", domain.ErrValidation)
	}
	return filepath.Abs(path)
}

func ReadSSE(reader io.Reader, callback func(event, data string) error) error {
	scanner := bufio.NewScanner(reader)
	var event, data string
	for scanner.Scan() {
		line := scanner.Text()
		if line == "" {
			if data != "" {
				if err := callback(event, data); err != nil {
					return err
				}
			}
			event, data = "", ""
			continue
		}
		if strings.HasPrefix(line, "event: ") {
			event = strings.TrimPrefix(line, "event: ")
		}
		if strings.HasPrefix(line, "data: ") {
			data = strings.TrimPrefix(line, "data: ")
		}
	}
	return scanner.Err()
}

func BuildURL(base, path string, query url.Values) string {
	return strings.TrimRight(base, "/") + path + func() string {
		if len(query) == 0 {
			return ""
		}
		return "?" + query.Encode()
	}()
}

func WaitForTerminal(ctx context.Context, client *http.Client, endpoint string) (domain.Run, error) {
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()
	for {
		request, _ := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
		response, err := client.Do(request)
		if err != nil {
			return domain.Run{}, err
		}
		var payload struct {
			Run domain.Run `json:"run"`
		}
		err = json.NewDecoder(response.Body).Decode(&payload)
		response.Body.Close()
		if err != nil {
			return domain.Run{}, err
		}
		if payload.Run.State.Terminal() {
			return payload.Run, nil
		}
		select {
		case <-ctx.Done():
			return domain.Run{}, ctx.Err()
		case <-ticker.C:
		}
	}
}
