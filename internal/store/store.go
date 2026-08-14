package store

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"proc-man/internal/domain"

	_ "modernc.org/sqlite"
)

var ErrNotFound = errors.New("not found")

type Store struct {
	db  *sql.DB
	now func() time.Time
}

type ProcessPage struct {
	Processes  []domain.Process
	HasMore    bool
	NextCursor string
}

type processPageCursor struct {
	UpdatedAt string `json:"updated_at"`
	ID        string `json:"id"`
}

func Open(path string) (*Store, error) {
	absolutePath, err := filepath.Abs(path)
	if err != nil {
		return nil, fmt.Errorf("resolve state database path: %w", err)
	}
	source := url.URL{Scheme: "file", Path: filepath.ToSlash(absolutePath)}
	query := source.Query()
	query.Add("_pragma", "busy_timeout=5000")
	query.Add("_pragma", "foreign_keys=ON")
	source.RawQuery = query.Encode()
	db, err := sql.Open("sqlite", source.String())
	if err != nil {
		return nil, fmt.Errorf("open state database: %w", err)
	}
	store := &Store{db: db, now: time.Now}
	if err := store.configure(context.Background()); err != nil {
		db.Close()
		return nil, err
	}
	return store, nil
}

func (store *Store) Close() error {
	return store.db.Close()
}

func (store *Store) configure(ctx context.Context) error {
	for _, statement := range []string{
		`PRAGMA journal_mode = WAL`,
		`PRAGMA foreign_keys = ON`,
		`PRAGMA busy_timeout = 5000`,
		`CREATE TABLE IF NOT EXISTS processes (
			id TEXT PRIMARY KEY,
			label TEXT NOT NULL,
			kind TEXT NOT NULL,
			state TEXT NOT NULL,
			source_json TEXT NOT NULL,
			command_json TEXT NOT NULL,
			cwd TEXT NOT NULL,
			env_json TEXT NOT NULL,
			ports_json TEXT NOT NULL,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS process_tags (
			process_id TEXT NOT NULL REFERENCES processes(id) ON DELETE CASCADE,
			tag TEXT NOT NULL,
			PRIMARY KEY (process_id, tag)
		)`,
		`CREATE INDEX IF NOT EXISTS process_tags_tag ON process_tags(tag)`,
		`CREATE TABLE IF NOT EXISTS runs (
			id TEXT PRIMARY KEY,
			process_id TEXT REFERENCES processes(id) ON DELETE SET NULL,
			process_json TEXT NOT NULL,
			state TEXT NOT NULL,
			pid INTEGER NOT NULL DEFAULT 0,
			started_at TEXT NOT NULL,
			ended_at TEXT,
			exit_code INTEGER,
			error TEXT NOT NULL DEFAULT '',
			log_path TEXT NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS runs_process_started ON runs(process_id, started_at DESC)`,
	} {
		if _, err := store.db.ExecContext(ctx, statement); err != nil {
			return fmt.Errorf("configure state database: %w", err)
		}
	}
	return nil
}

func (store *Store) CreateProcess(ctx context.Context, process domain.Process) (domain.Process, error) {
	normalized, err := domain.NormalizeProcess(process)
	if err != nil {
		return domain.Process{}, err
	}
	now := store.now().UTC()
	normalized.Selector = normalized.ID
	normalized.CreatedAt = now
	normalized.UpdatedAt = now
	if err := store.writeProcess(ctx, normalized, true); err != nil {
		return domain.Process{}, err
	}
	return normalized, nil
}

func (store *Store) UpdateProcess(ctx context.Context, process domain.Process) (domain.Process, error) {
	normalized, err := domain.NormalizeProcess(process)
	if err != nil {
		return domain.Process{}, err
	}
	current, err := store.GetProcess(ctx, normalized.ID)
	if err != nil {
		return domain.Process{}, err
	}
	normalized.Selector = normalized.ID
	normalized.CreatedAt = current.CreatedAt
	normalized.UpdatedAt = store.now().UTC()
	if err := store.writeProcess(ctx, normalized, false); err != nil {
		return domain.Process{}, err
	}
	return normalized, nil
}

func (store *Store) writeProcess(ctx context.Context, process domain.Process, create bool) error {
	source, _ := json.Marshal(process.Source)
	command, _ := json.Marshal(process.Command)
	env, _ := json.Marshal(process.Env)
	ports, _ := json.Marshal(process.Ports)

	tx, err := store.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin process write: %w", err)
	}
	defer tx.Rollback()

	statement := `INSERT INTO processes
		(id, label, kind, state, source_json, command_json, cwd, env_json, ports_json, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
	if !create {
		statement = `UPDATE processes SET
			label = ?, kind = ?, state = ?, source_json = ?, command_json = ?,
			cwd = ?, env_json = ?, ports_json = ?, created_at = ?, updated_at = ?
			WHERE id = ?`
	}
	var result sql.Result
	if create {
		result, err = tx.ExecContext(ctx, statement,
			process.ID, process.Label, process.Kind, process.State, source, command,
			process.CWD, env, ports, formatTime(process.CreatedAt), formatTime(process.UpdatedAt),
		)
	} else {
		result, err = tx.ExecContext(ctx, statement,
			process.Label, process.Kind, process.State, source, command,
			process.CWD, env, ports, formatTime(process.CreatedAt), formatTime(process.UpdatedAt),
			process.ID,
		)
	}
	if err != nil {
		return fmt.Errorf("write process: %w", err)
	}
	if !create {
		affected, _ := result.RowsAffected()
		if affected == 0 {
			return ErrNotFound
		}
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM process_tags WHERE process_id = ?`, process.ID); err != nil {
		return fmt.Errorf("replace process tags: %w", err)
	}
	for _, tag := range process.Tags {
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO process_tags(process_id, tag) VALUES (?, ?)`, process.ID, tag,
		); err != nil {
			return fmt.Errorf("write process tag: %w", err)
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit process write: %w", err)
	}
	return nil
}

func (store *Store) GetProcess(ctx context.Context, id string) (domain.Process, error) {
	row := store.db.QueryRowContext(ctx, `SELECT
		id, label, kind, state, source_json, command_json, cwd, env_json,
		ports_json, created_at, updated_at
		FROM processes WHERE id = ?`, id)
	process, err := scanProcess(row)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.Process{}, ErrNotFound
	}
	if err != nil {
		return domain.Process{}, fmt.Errorf("get process: %w", err)
	}
	process.Tags, err = store.processTags(ctx, process.ID)
	if err != nil {
		return domain.Process{}, err
	}
	return process, nil
}

func (store *Store) ListProcesses(ctx context.Context, filter domain.ProcessFilter) ([]domain.Process, error) {
	rows, err := store.db.QueryContext(ctx, `SELECT
		id, label, kind, state, source_json, command_json, cwd, env_json,
		ports_json, created_at, updated_at
		FROM processes ORDER BY label COLLATE NOCASE, id`)
	if err != nil {
		return nil, fmt.Errorf("list processes: %w", err)
	}
	defer rows.Close()

	query := strings.ToLower(strings.TrimSpace(filter.Query))
	directory := strings.TrimSpace(filter.Directory)
	if directory != "" {
		directory = filepath.Clean(directory)
	}
	requiredTags, err := domain.NormalizeTags(filter.Tags)
	if err != nil {
		return nil, err
	}
	var processes []domain.Process
	for rows.Next() {
		process, err := scanProcess(rows)
		if err != nil {
			return nil, fmt.Errorf("scan process: %w", err)
		}
		process.Tags, err = store.processTags(ctx, process.ID)
		if err != nil {
			return nil, err
		}
		if filter.Kind != "" && process.Kind != filter.Kind {
			continue
		}
		if filter.State != "" && process.State != filter.State {
			continue
		}
		if directory != "" && filepath.Clean(process.CWD) != directory {
			continue
		}
		if !containsAll(process.Tags, requiredTags) {
			continue
		}
		if query != "" && !processMatches(process, query) {
			continue
		}
		processes = append(processes, process)
	}
	return processes, rows.Err()
}

func (store *Store) ListProcessPage(
	ctx context.Context,
	filter domain.ProcessFilter,
	limit int,
	cursor string,
) (ProcessPage, error) {
	if limit < 1 || limit > 100 {
		return ProcessPage{}, fmt.Errorf("%w: limit must be between 1 and 100", domain.ErrValidation)
	}

	conditions, arguments, err := processPageConditions(filter, cursor)
	if err != nil {
		return ProcessPage{}, err
	}
	query := `SELECT
		p.id, p.label, p.kind, p.state, p.source_json, p.command_json, p.cwd,
		p.env_json, p.ports_json, p.created_at, p.updated_at
		FROM processes p`
	if len(conditions) > 0 {
		query += " WHERE " + strings.Join(conditions, " AND ")
	}
	query += ` ORDER BY julianday(p.updated_at) DESC, p.id DESC LIMIT ?`
	arguments = append(arguments, limit+1)

	rows, err := store.db.QueryContext(ctx, query, arguments...)
	if err != nil {
		return ProcessPage{}, fmt.Errorf("list process page: %w", err)
	}
	defer rows.Close()

	processes := make([]domain.Process, 0, limit+1)
	for rows.Next() {
		process, err := scanProcess(rows)
		if err != nil {
			return ProcessPage{}, fmt.Errorf("scan process page: %w", err)
		}
		processes = append(processes, process)
	}
	if err := rows.Err(); err != nil {
		return ProcessPage{}, fmt.Errorf("read process page: %w", err)
	}

	hasMore := len(processes) > limit
	if hasMore {
		processes = processes[:limit]
	}
	if err := store.loadProcessTags(ctx, processes); err != nil {
		return ProcessPage{}, err
	}
	page := ProcessPage{Processes: processes, HasMore: hasMore}
	if hasMore {
		page.NextCursor, err = encodeProcessPageCursor(processes[len(processes)-1])
		if err != nil {
			return ProcessPage{}, err
		}
	}
	return page, nil
}

func processPageConditions(filter domain.ProcessFilter, encodedCursor string) ([]string, []any, error) {
	requiredTags, err := domain.NormalizeTags(filter.Tags)
	if err != nil {
		return nil, nil, err
	}
	conditions := make([]string, 0)
	arguments := make([]any, 0)

	if filter.Kind != "" {
		conditions = append(conditions, "p.kind = ?")
		arguments = append(arguments, filter.Kind)
	}
	if filter.State != "" {
		conditions = append(conditions, "p.state = ?")
		arguments = append(arguments, filter.State)
	}
	directory := strings.TrimSpace(filter.Directory)
	if directory != "" {
		conditions = append(conditions, "p.cwd = ?")
		arguments = append(arguments, filepath.Clean(directory))
	}
	for _, tag := range requiredTags {
		conditions = append(conditions, `EXISTS (
			SELECT 1 FROM process_tags required_tag
			WHERE required_tag.process_id = p.id AND required_tag.tag = ?
		)`)
		arguments = append(arguments, tag)
	}

	needle := strings.ToLower(strings.TrimSpace(filter.Query))
	if needle != "" {
		conditions = append(conditions, `(
			instr(lower(p.id), ?) > 0 OR
			instr(lower(p.label), ?) > 0 OR
			instr(lower(p.cwd), ?) > 0 OR
			instr(lower(p.command_json), ?) > 0 OR
			instr(lower(p.ports_json), ?) > 0 OR
			EXISTS (
				SELECT 1 FROM process_tags search_tag
				WHERE search_tag.process_id = p.id AND instr(lower(search_tag.tag), ?) > 0
			)
		)`)
		for range 6 {
			arguments = append(arguments, needle)
		}
	}

	if encodedCursor != "" {
		cursor, err := decodeProcessPageCursor(encodedCursor)
		if err != nil {
			return nil, nil, err
		}
		conditions = append(conditions, `(
			julianday(p.updated_at) < julianday(?) OR
			(julianday(p.updated_at) = julianday(?) AND p.id < ?)
		)`)
		arguments = append(arguments, cursor.UpdatedAt, cursor.UpdatedAt, cursor.ID)
	}
	return conditions, arguments, nil
}

func encodeProcessPageCursor(process domain.Process) (string, error) {
	payload, err := json.Marshal(processPageCursor{
		UpdatedAt: formatTime(process.UpdatedAt),
		ID:        process.ID,
	})
	if err != nil {
		return "", fmt.Errorf("encode process cursor: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(payload), nil
}

func decodeProcessPageCursor(value string) (processPageCursor, error) {
	payload, err := base64.RawURLEncoding.DecodeString(value)
	if err != nil {
		return processPageCursor{}, fmt.Errorf("%w: invalid process cursor", domain.ErrValidation)
	}
	var cursor processPageCursor
	if err := json.Unmarshal(payload, &cursor); err != nil {
		return processPageCursor{}, fmt.Errorf("%w: invalid process cursor", domain.ErrValidation)
	}
	if cursor.ID == "" {
		return processPageCursor{}, fmt.Errorf("%w: invalid process cursor", domain.ErrValidation)
	}
	parsed, err := time.Parse(time.RFC3339Nano, cursor.UpdatedAt)
	if err != nil {
		return processPageCursor{}, fmt.Errorf("%w: invalid process cursor", domain.ErrValidation)
	}
	cursor.UpdatedAt = formatTime(parsed)
	return cursor, nil
}

func (store *Store) loadProcessTags(ctx context.Context, processes []domain.Process) error {
	if len(processes) == 0 {
		return nil
	}
	placeholders := make([]string, len(processes))
	arguments := make([]any, len(processes))
	processIndexes := make(map[string]int, len(processes))
	for index := range processes {
		placeholders[index] = "?"
		arguments[index] = processes[index].ID
		processIndexes[processes[index].ID] = index
	}
	rows, err := store.db.QueryContext(ctx, `SELECT process_id, tag FROM process_tags
		WHERE process_id IN (`+strings.Join(placeholders, ",")+`)
		ORDER BY process_id, tag`, arguments...)
	if err != nil {
		return fmt.Errorf("get process page tags: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var processID, tag string
		if err := rows.Scan(&processID, &tag); err != nil {
			return fmt.Errorf("scan process page tag: %w", err)
		}
		index, ok := processIndexes[processID]
		if ok {
			processes[index].Tags = append(processes[index].Tags, tag)
		}
	}
	return rows.Err()
}

func (store *Store) SetProcessState(ctx context.Context, id string, state domain.ProcessState) error {
	result, err := store.db.ExecContext(ctx,
		`UPDATE processes SET state = ?, updated_at = ? WHERE id = ?`,
		state, formatTime(store.now().UTC()), id,
	)
	if err != nil {
		return fmt.Errorf("set process state: %w", err)
	}
	affected, _ := result.RowsAffected()
	if affected == 0 {
		return ErrNotFound
	}
	return nil
}

func (store *Store) DeleteProcess(ctx context.Context, id string) error {
	result, err := store.db.ExecContext(ctx, `DELETE FROM processes WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("delete process: %w", err)
	}
	affected, _ := result.RowsAffected()
	if affected == 0 {
		return ErrNotFound
	}
	return nil
}

func (store *Store) CreateRun(ctx context.Context, run domain.Run) error {
	snapshot, _ := json.Marshal(run.Process)
	var processID any
	if run.ProcessID != nil {
		processID = *run.ProcessID
	}
	_, err := store.db.ExecContext(ctx, `INSERT INTO runs
		(id, process_id, process_json, state, pid, started_at, ended_at, exit_code, error, log_path)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		run.ID, processID, snapshot, run.State, run.PID, formatTime(run.StartedAt),
		formatOptionalTime(run.EndedAt), run.ExitCode, run.Error, run.LogPath,
	)
	if err != nil {
		return fmt.Errorf("create run: %w", err)
	}
	return nil
}

func (store *Store) UpdateRun(ctx context.Context, run domain.Run) error {
	snapshot, _ := json.Marshal(run.Process)
	var processID any
	if run.ProcessID != nil {
		processID = *run.ProcessID
	}
	result, err := store.db.ExecContext(ctx, `UPDATE runs SET
		process_id = ?, process_json = ?, state = ?, pid = ?, started_at = ?,
		ended_at = ?, exit_code = ?, error = ?, log_path = ?
		WHERE id = ?`,
		processID, snapshot, run.State, run.PID, formatTime(run.StartedAt),
		formatOptionalTime(run.EndedAt), run.ExitCode, run.Error, run.LogPath, run.ID,
	)
	if err != nil {
		return fmt.Errorf("update run: %w", err)
	}
	affected, _ := result.RowsAffected()
	if affected == 0 {
		return ErrNotFound
	}
	return nil
}

func (store *Store) GetRun(ctx context.Context, id string) (domain.Run, error) {
	run, err := scanRun(store.db.QueryRowContext(ctx, `SELECT
		id, process_id, process_json, state, pid, started_at, ended_at,
		exit_code, error, log_path FROM runs WHERE id = ?`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return domain.Run{}, ErrNotFound
	}
	if err != nil {
		return domain.Run{}, fmt.Errorf("get run: %w", err)
	}
	return run, nil
}

func (store *Store) ListRuns(ctx context.Context, filter domain.RunFilter) ([]domain.Run, error) {
	rows, err := store.db.QueryContext(ctx, `SELECT
		id, process_id, process_json, state, pid, started_at, ended_at,
		exit_code, error, log_path FROM runs ORDER BY started_at DESC`)
	if err != nil {
		return nil, fmt.Errorf("list runs: %w", err)
	}
	defer rows.Close()

	requiredTags, err := domain.NormalizeTags(filter.Tags)
	if err != nil {
		return nil, err
	}
	limit := filter.Limit
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	var runs []domain.Run
	for rows.Next() {
		run, err := scanRun(rows)
		if err != nil {
			return nil, err
		}
		if filter.ProcessID != "" && (run.ProcessID == nil || *run.ProcessID != filter.ProcessID) {
			continue
		}
		if filter.Kind != "" && run.Process.Kind != filter.Kind {
			continue
		}
		if filter.State != "" && run.State != filter.State {
			continue
		}
		if !containsAll(run.Process.Tags, requiredTags) {
			continue
		}
		runs = append(runs, run)
		if len(runs) >= limit {
			break
		}
	}
	return runs, rows.Err()
}

func (store *Store) RecoverActiveRuns(ctx context.Context) error {
	now := store.now().UTC()
	_, err := store.db.ExecContext(ctx, `UPDATE runs
		SET state = ?, ended_at = ?, error = ?
		WHERE state IN (?, ?, ?)`,
		domain.RunStateInterrupted, formatTime(now), "daemon restarted",
		domain.RunStateStarting, domain.RunStateRunning, domain.RunStateStopping,
	)
	if err != nil {
		return fmt.Errorf("recover active runs: %w", err)
	}
	_, err = store.db.ExecContext(ctx, `UPDATE processes SET state = ?
		WHERE state IN (?, ?, ?)`,
		domain.ProcessStateStopped,
		domain.ProcessStateStarting, domain.ProcessStateRunning, domain.ProcessStateStopping,
	)
	if err != nil {
		return fmt.Errorf("recover process states: %w", err)
	}
	return nil
}

func (store *Store) Tags(ctx context.Context) (map[string]int, error) {
	rows, err := store.db.QueryContext(ctx,
		`SELECT tag, COUNT(DISTINCT process_id) FROM process_tags GROUP BY tag ORDER BY tag`,
	)
	if err != nil {
		return nil, fmt.Errorf("list tags: %w", err)
	}
	defer rows.Close()
	tags := map[string]int{}
	for rows.Next() {
		var tag string
		var count int
		if err := rows.Scan(&tag, &count); err != nil {
			return nil, err
		}
		tags[tag] = count
	}
	return tags, rows.Err()
}

func (store *Store) Directories(ctx context.Context) (map[string]int, error) {
	rows, err := store.db.QueryContext(ctx,
		`SELECT cwd, COUNT(*) FROM processes GROUP BY cwd ORDER BY cwd`,
	)
	if err != nil {
		return nil, fmt.Errorf("list process directories: %w", err)
	}
	defer rows.Close()
	directories := map[string]int{}
	for rows.Next() {
		var directory string
		var count int
		if err := rows.Scan(&directory, &count); err != nil {
			return nil, err
		}
		directories[directory] = count
	}
	return directories, rows.Err()
}

func (store *Store) ProcessesBySource(ctx context.Context, path string) ([]domain.Process, error) {
	processes, err := store.ListProcesses(ctx, domain.ProcessFilter{})
	if err != nil {
		return nil, err
	}
	result := make([]domain.Process, 0)
	for _, process := range processes {
		if process.Source.Kind == "manifest" && process.Source.Path == path {
			result = append(result, process)
		}
	}
	return result, nil
}

type rowScanner interface {
	Scan(dest ...any) error
}

func scanProcess(scanner rowScanner) (domain.Process, error) {
	var process domain.Process
	var source, command, env, ports, createdAt, updatedAt string
	if err := scanner.Scan(
		&process.ID, &process.Label, &process.Kind, &process.State,
		&source, &command, &process.CWD, &env, &ports, &createdAt, &updatedAt,
	); err != nil {
		return domain.Process{}, err
	}
	process.Selector = process.ID
	if err := json.Unmarshal([]byte(source), &process.Source); err != nil {
		return domain.Process{}, err
	}
	if err := json.Unmarshal([]byte(command), &process.Command); err != nil {
		return domain.Process{}, err
	}
	if err := json.Unmarshal([]byte(env), &process.Env); err != nil {
		return domain.Process{}, err
	}
	if err := json.Unmarshal([]byte(ports), &process.Ports); err != nil {
		return domain.Process{}, err
	}
	process.CreatedAt, _ = time.Parse(time.RFC3339Nano, createdAt)
	process.UpdatedAt, _ = time.Parse(time.RFC3339Nano, updatedAt)
	return process, nil
}

func scanRun(scanner rowScanner) (domain.Run, error) {
	var run domain.Run
	var processID sql.NullString
	var snapshot, startedAt string
	var endedAt sql.NullString
	var exitCode sql.NullInt64
	if err := scanner.Scan(
		&run.ID, &processID, &snapshot, &run.State, &run.PID, &startedAt,
		&endedAt, &exitCode, &run.Error, &run.LogPath,
	); err != nil {
		return domain.Run{}, err
	}
	if processID.Valid {
		run.ProcessID = &processID.String
	}
	if err := json.Unmarshal([]byte(snapshot), &run.Process); err != nil {
		return domain.Run{}, err
	}
	run.StartedAt, _ = time.Parse(time.RFC3339Nano, startedAt)
	if endedAt.Valid {
		value, _ := time.Parse(time.RFC3339Nano, endedAt.String)
		run.EndedAt = &value
	}
	if exitCode.Valid {
		value := int(exitCode.Int64)
		run.ExitCode = &value
	}
	return run, nil
}

func (store *Store) processTags(ctx context.Context, id string) ([]string, error) {
	rows, err := store.db.QueryContext(ctx,
		`SELECT tag FROM process_tags WHERE process_id = ? ORDER BY tag`, id,
	)
	if err != nil {
		return nil, fmt.Errorf("get process tags: %w", err)
	}
	defer rows.Close()
	var tags []string
	for rows.Next() {
		var tag string
		if err := rows.Scan(&tag); err != nil {
			return nil, err
		}
		tags = append(tags, tag)
	}
	return tags, rows.Err()
}

func processMatches(process domain.Process, query string) bool {
	values := []string{process.ID, process.Label, process.CWD, process.Command.Shell}
	values = append(values, process.Command.Argv...)
	values = append(values, process.Tags...)
	for _, port := range process.Ports {
		values = append(values, port.Name, port.Host, fmt.Sprint(port.Port), port.Protocol, port.Path)
	}
	for _, value := range values {
		if strings.Contains(strings.ToLower(value), query) {
			return true
		}
	}
	return false
}

func containsAll(values, required []string) bool {
	if len(required) == 0 {
		return true
	}
	copyValues := append([]string(nil), values...)
	sort.Strings(copyValues)
	for _, requiredValue := range required {
		index := sort.SearchStrings(copyValues, requiredValue)
		if index == len(copyValues) || copyValues[index] != requiredValue {
			return false
		}
	}
	return true
}

func formatTime(value time.Time) string {
	return value.UTC().Format(time.RFC3339Nano)
}

func formatOptionalTime(value *time.Time) any {
	if value == nil {
		return nil
	}
	return formatTime(*value)
}
