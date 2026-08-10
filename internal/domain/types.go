package domain

import "time"

type ProcessKind string

const (
	ProcessKindService ProcessKind = "service"
	ProcessKindTask    ProcessKind = "task"
)

type ProcessState string

const (
	ProcessStateStopped  ProcessState = "stopped"
	ProcessStateStarting ProcessState = "starting"
	ProcessStateRunning  ProcessState = "running"
	ProcessStateStopping ProcessState = "stopping"
	ProcessStateFailed   ProcessState = "failed"
)

type RunState string

const (
	RunStateStarting    RunState = "starting"
	RunStateRunning     RunState = "running"
	RunStateStopping    RunState = "stopping"
	RunStateExited      RunState = "exited"
	RunStateFailed      RunState = "failed"
	RunStateCanceled    RunState = "canceled"
	RunStateInterrupted RunState = "interrupted"
)

func (state RunState) Terminal() bool {
	switch state {
	case RunStateExited, RunStateFailed, RunStateCanceled, RunStateInterrupted:
		return true
	default:
		return false
	}
}

type Source struct {
	Kind string `json:"kind"`
	Path string `json:"path,omitempty"`
	Key  string `json:"key,omitempty"`
}

type Command struct {
	Argv  []string `json:"argv,omitempty"`
	Shell string   `json:"shell,omitempty"`
}

type Port struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Host     string `json:"host"`
	Port     int    `json:"port"`
	Protocol string `json:"protocol"`
	Path     string `json:"path,omitempty"`
}

type Process struct {
	ID        string            `json:"id"`
	Selector  string            `json:"selector"`
	Label     string            `json:"label"`
	Tags      []string          `json:"tags"`
	Kind      ProcessKind       `json:"kind"`
	State     ProcessState      `json:"state"`
	Source    Source            `json:"source"`
	Command   Command           `json:"command"`
	CWD       string            `json:"cwd"`
	Env       map[string]string `json:"env"`
	Ports     []Port            `json:"ports"`
	CreatedAt time.Time         `json:"created_at"`
	UpdatedAt time.Time         `json:"updated_at"`
}

type ProcessSnapshot struct {
	ID      string            `json:"id"`
	Label   string            `json:"label"`
	Tags    []string          `json:"tags"`
	Kind    ProcessKind       `json:"kind"`
	Command Command           `json:"command"`
	CWD     string            `json:"cwd"`
	Env     map[string]string `json:"env"`
	Ports   []Port            `json:"ports"`
	Source  Source            `json:"source"`
}

func Snapshot(process Process) ProcessSnapshot {
	return ProcessSnapshot{
		ID:      process.ID,
		Label:   process.Label,
		Tags:    append([]string(nil), process.Tags...),
		Kind:    process.Kind,
		Command: process.Command,
		CWD:     process.CWD,
		Env:     cloneMap(process.Env),
		Ports:   append([]Port(nil), process.Ports...),
		Source:  process.Source,
	}
}

type Run struct {
	ID        string          `json:"id"`
	ProcessID *string         `json:"process_id,omitempty"`
	Process   ProcessSnapshot `json:"process"`
	State     RunState        `json:"state"`
	PID       int             `json:"pid,omitempty"`
	StartedAt time.Time       `json:"started_at"`
	EndedAt   *time.Time      `json:"ended_at,omitempty"`
	ExitCode  *int            `json:"exit_code,omitempty"`
	Error     string          `json:"error,omitempty"`
	LogPath   string          `json:"log_path"`
}

type LogRecord struct {
	Sequence int64     `json:"seq"`
	Time     time.Time `json:"time"`
	Stream   string    `json:"stream"`
	Text     string    `json:"text"`
	Partial  bool      `json:"partial"`
}

type ProcessFilter struct {
	Query     string
	Directory string
	Tags      []string
	Kind      ProcessKind
	State     ProcessState
}

type RunFilter struct {
	ProcessID string
	Kind      ProcessKind
	State     RunState
	Tags      []string
	Limit     int
}

func cloneMap(input map[string]string) map[string]string {
	output := make(map[string]string, len(input))
	for key, value := range input {
		output[key] = value
	}
	return output
}
