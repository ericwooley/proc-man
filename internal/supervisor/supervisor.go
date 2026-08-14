package supervisor

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"proc-man/internal/domain"
	"proc-man/internal/events"
	"proc-man/internal/ids"
	"proc-man/internal/logstore"
	"proc-man/internal/store"
)

var (
	ErrInvalidKind    = errors.New("invalid process kind")
	ErrAlreadyActive  = errors.New("process is already active")
	ErrNotActive      = errors.New("run is not active")
	ErrCWDUnavailable = errors.New("working directory is unavailable")
)

type activeRun struct {
	run     domain.Run
	command *exec.Cmd
	done    chan struct{}
	writer  *logstore.Writer
	stdout  *logstore.LineWriter
	stderr  *logstore.LineWriter
}

type Manager struct {
	store       *store.Store
	logRoot     string
	shell       string
	stopTimeout time.Duration
	events      *events.Broker
	onError     func(error)

	mu               sync.Mutex
	active           map[string]*activeRun
	serviceByProcess map[string]string
}

type Options struct {
	LogRoot     string
	Shell       string
	StopTimeout time.Duration
	Events      *events.Broker
	OnError     func(error)
}

func New(state *store.Store, options Options) *Manager {
	if options.Shell == "" {
		options.Shell = defaultShell()
	}
	if options.StopTimeout <= 0 {
		options.StopTimeout = 10 * time.Second
	}
	if options.Events == nil {
		options.Events = events.New()
	}
	return &Manager{
		store: state, logRoot: options.LogRoot, shell: options.Shell,
		stopTimeout: options.StopTimeout, events: options.Events, onError: options.OnError,
		active: map[string]*activeRun{}, serviceByProcess: map[string]string{},
	}
}

func (manager *Manager) StartService(ctx context.Context, processID string) (domain.Run, error) {
	process, err := manager.store.GetProcess(ctx, processID)
	if err != nil {
		return domain.Run{}, err
	}
	if process.Kind != domain.ProcessKindService {
		return domain.Run{}, ErrInvalidKind
	}
	manager.mu.Lock()
	if runID := manager.serviceByProcess[processID]; runID != "" {
		run := manager.active[runID].run
		manager.mu.Unlock()
		return run, ErrAlreadyActive
	}
	manager.mu.Unlock()
	return manager.launch(ctx, process, &processID, nil)
}

func (manager *Manager) RunTask(ctx context.Context, processID string) (domain.Run, error) {
	process, err := manager.store.GetProcess(ctx, processID)
	if err != nil {
		return domain.Run{}, err
	}
	if process.Kind != domain.ProcessKindTask {
		return domain.Run{}, ErrInvalidKind
	}
	return manager.launch(ctx, process, &processID, nil)
}

func (manager *Manager) RunDirect(
	ctx context.Context,
	directory string,
	arguments []string,
	executionEnvironment []string,
) (domain.Run, error) {
	snapshot, err := domain.DirectRunSnapshot(directory, arguments)
	if err != nil {
		return domain.Run{}, err
	}
	process := domain.Process{
		Label: snapshot.Label, Tags: snapshot.Tags, Kind: snapshot.Kind,
		Command: snapshot.Command, CWD: snapshot.CWD, Env: snapshot.Env,
		Ports: snapshot.Ports, Source: snapshot.Source,
	}
	return manager.launch(ctx, process, nil, executionEnvironment)
}

func (manager *Manager) launch(
	ctx context.Context,
	process domain.Process,
	processID *string,
	executionEnvironment []string,
) (domain.Run, error) {
	runID, err := ids.New("run")
	if err != nil {
		manager.reportLaunchError(process.ID, err)
		return domain.Run{}, err
	}
	run := domain.Run{
		ID: runID, ProcessID: processID, Process: domain.Snapshot(process),
		State: domain.RunStateStarting, StartedAt: time.Now().UTC(),
	}
	writer, logPath, err := logstore.Create(manager.logRoot, run.ID, func(record domain.LogRecord) {
		manager.events.Publish(events.Event{
			Type: "log.record", ResourceID: run.ID, Data: record,
		})
	})
	if err != nil {
		manager.reportLaunchError(process.ID, err)
		return domain.Run{}, err
	}
	run.LogPath = logPath
	if err := manager.store.CreateRun(ctx, run); err != nil {
		writer.Close()
		manager.reportLaunchError(process.ID, err)
		return domain.Run{}, err
	}
	if processID != nil && process.Kind == domain.ProcessKindService {
		_ = manager.store.SetProcessState(ctx, process.ID, domain.ProcessStateStarting)
	}
	stat, err := os.Stat(process.CWD)
	if err != nil {
		launchErr := fmt.Errorf("%w: %w", ErrCWDUnavailable, err)
		return manager.completeLaunchFailure(ctx, run, writer, launchErr)
	}
	if !stat.IsDir() {
		launchErr := fmt.Errorf("%w: %s: not a directory", ErrCWDUnavailable, process.CWD)
		return manager.completeLaunchFailure(ctx, run, writer, launchErr)
	}
	command, err := manager.command(process, run.ID, executionEnvironment)
	if err != nil {
		return manager.completeLaunchFailure(ctx, run, writer, err)
	}
	stdout := writer.Stream("stdout")
	stderr := writer.Stream("stderr")
	command.Stdout = stdout
	command.Stderr = stderr
	command.Dir = process.CWD
	command.Env = manager.environment(process, run.ID, executionEnvironment)
	configureManagedCommand(command)
	if err := command.Start(); err != nil {
		return manager.completeLaunchFailure(ctx, run, writer, fmt.Errorf("start process: %w", err))
	}
	run.PID = command.Process.Pid
	run.State = domain.RunStateRunning
	if err := manager.store.UpdateRun(ctx, run); err != nil {
		_ = killManagedProcess(command)
		writer.Close()
		return domain.Run{}, err
	}
	if processID != nil {
		_ = manager.store.SetProcessState(ctx, process.ID, domain.ProcessStateRunning)
	}
	active := &activeRun{
		run: run, command: command, done: make(chan struct{}),
		writer: writer, stdout: stdout, stderr: stderr,
	}
	manager.mu.Lock()
	manager.active[run.ID] = active
	if process.Kind == domain.ProcessKindService {
		manager.serviceByProcess[process.ID] = run.ID
	}
	manager.mu.Unlock()
	manager.events.Publish(events.Event{
		Type: "run.started", ResourceID: run.ID, Data: run,
	})
	go manager.wait(active)
	return run, nil
}

func (manager *Manager) completeLaunchFailure(
	ctx context.Context,
	run domain.Run,
	writer *logstore.Writer,
	launchErr error,
) (domain.Run, error) {
	now := time.Now().UTC()
	run.State = domain.RunStateFailed
	run.EndedAt = &now
	run.Error = launchErr.Error()
	_ = writer.Append("stderr", "proc-man: "+run.Error, false)
	_ = writer.Close()
	_ = manager.store.UpdateRun(ctx, run)
	if run.ProcessID != nil {
		_ = manager.store.SetProcessState(ctx, run.Process.ID, domain.ProcessStateFailed)
	}
	manager.events.Publish(events.Event{
		Type: "run.finished", ResourceID: run.ID, Data: run,
	})
	manager.reportLaunchError(run.Process.ID, launchErr)
	return run, launchErr
}

func (manager *Manager) reportLaunchError(processID string, err error) {
	if manager.onError != nil {
		manager.onError(fmt.Errorf("launch process %s: %w", processID, err))
	}
}

func (manager *Manager) command(
	process domain.Process,
	runID string,
	executionEnvironment []string,
) (*exec.Cmd, error) {
	if len(process.Command.Argv) > 0 {
		arguments := append([]string(nil), process.Command.Argv...)
		if process.Source.Kind != "direct" {
			for index, argument := range arguments {
				arguments[index] = expand(argument, process, runID)
			}
		}
		executable := arguments[0]
		if process.Source.Kind == "direct" && executionEnvironment != nil {
			var err error
			executable, err = resolveDirectExecutable(
				arguments[0], process.CWD, executionEnvironment,
			)
			if err != nil {
				return nil, err
			}
		}
		command := exec.Command(executable, arguments[1:]...)
		command.Args[0] = arguments[0]
		return command, nil
	}
	if process.Command.Shell != "" {
		return newShellCommand(manager.shell, expand(process.Command.Shell, process, runID)), nil
	}
	return nil, fmt.Errorf("process has no command")
}

func (manager *Manager) environment(
	process domain.Process,
	runID string,
	executionEnvironment []string,
) []string {
	values := append([]string(nil), executionEnvironment...)
	if executionEnvironment == nil {
		values = append(values, os.Environ()...)
	}
	if process.ID != "" {
		values = append(values, "PROC_MAN_PROCESS_ID="+process.ID)
	}
	values = append(values, "PROC_MAN_RUN_ID="+runID)
	for key, value := range process.Env {
		values = append(values, key+"="+expand(value, process, runID))
	}
	for _, port := range process.Ports {
		name := strings.ToUpper(strings.ReplaceAll(port.Name, "-", "_"))
		values = append(values,
			"PROC_MAN_PORT_"+name+"="+strconv.Itoa(port.Port),
			"PROC_MAN_HOST_"+name+"="+port.Host,
		)
	}
	return values
}

func expand(value string, process domain.Process, runID string) string {
	value = strings.ReplaceAll(value, "{process_id}", process.ID)
	value = strings.ReplaceAll(value, "{definition_id}", process.ID)
	value = strings.ReplaceAll(value, "{run_id}", runID)
	for _, port := range process.Ports {
		value = strings.ReplaceAll(value, "{port."+port.Name+"}", strconv.Itoa(port.Port))
	}
	return value
}

func (manager *Manager) wait(active *activeRun) {
	err := active.command.Wait()
	_ = active.stdout.Flush()
	_ = active.stderr.Flush()
	_ = active.writer.Close()

	manager.mu.Lock()
	run := active.run
	delete(manager.active, run.ID)
	if run.Process.Kind == domain.ProcessKindService {
		delete(manager.serviceByProcess, run.Process.ID)
	}
	manager.mu.Unlock()

	now := time.Now().UTC()
	run.EndedAt = &now
	exitCode := 0
	if err != nil {
		var exitError *exec.ExitError
		if errors.As(err, &exitError) {
			exitCode = exitError.ExitCode()
		} else {
			exitCode = -1
			run.Error = err.Error()
		}
	}
	run.ExitCode = &exitCode
	if run.State == domain.RunStateStopping {
		if run.Process.Kind == domain.ProcessKindTask {
			run.State = domain.RunStateCanceled
		} else {
			run.State = domain.RunStateExited
		}
	} else if err != nil {
		run.State = domain.RunStateFailed
	} else {
		run.State = domain.RunStateExited
	}
	_ = manager.store.UpdateRun(context.Background(), run)
	if run.ProcessID != nil && run.Process.Kind == domain.ProcessKindService {
		state := domain.ProcessStateStopped
		if run.State == domain.RunStateFailed {
			state = domain.ProcessStateFailed
		}
		_ = manager.store.SetProcessState(context.Background(), run.Process.ID, state)
	} else if run.ProcessID != nil {
		_ = manager.store.SetProcessState(context.Background(), run.Process.ID, domain.ProcessStateStopped)
	}
	manager.events.Publish(events.Event{
		Type: "run.finished", ResourceID: run.ID, Data: run,
	})
	close(active.done)
}

func (manager *Manager) StopService(ctx context.Context, processID string) (domain.Run, error) {
	process, err := manager.store.GetProcess(ctx, processID)
	if err != nil {
		return domain.Run{}, err
	}
	if process.Kind != domain.ProcessKindService {
		return domain.Run{}, ErrInvalidKind
	}
	manager.mu.Lock()
	runID := manager.serviceByProcess[processID]
	active := manager.active[runID]
	manager.mu.Unlock()
	if active == nil {
		return domain.Run{}, ErrNotActive
	}
	return manager.stop(ctx, active)
}

func (manager *Manager) CancelRun(ctx context.Context, runID string) (domain.Run, error) {
	manager.mu.Lock()
	active := manager.active[runID]
	manager.mu.Unlock()
	if active == nil {
		return domain.Run{}, ErrNotActive
	}
	if active.run.Process.Kind != domain.ProcessKindTask {
		return domain.Run{}, ErrInvalidKind
	}
	return manager.stop(ctx, active)
}

func (manager *Manager) StopProcess(ctx context.Context, processID string) error {
	process, err := manager.store.GetProcess(ctx, processID)
	if err != nil {
		return err
	}
	if process.Kind == domain.ProcessKindService {
		_, err := manager.StopService(ctx, processID)
		if errors.Is(err, ErrNotActive) {
			return nil
		}
		return err
	}
	manager.mu.Lock()
	activeRuns := make([]*activeRun, 0)
	for _, active := range manager.active {
		if active.run.Process.ID == processID {
			activeRuns = append(activeRuns, active)
		}
	}
	manager.mu.Unlock()
	for _, active := range activeRuns {
		if _, err := manager.stop(ctx, active); err != nil {
			return err
		}
	}
	return nil
}

func (manager *Manager) stop(ctx context.Context, active *activeRun) (domain.Run, error) {
	manager.mu.Lock()
	if active.run.State == domain.RunStateStopping {
		run := active.run
		manager.mu.Unlock()
		return run, nil
	}
	active.run.State = domain.RunStateStopping
	run := active.run
	manager.mu.Unlock()
	_ = manager.store.UpdateRun(ctx, run)
	if run.Process.Kind == domain.ProcessKindService {
		_ = manager.store.SetProcessState(ctx, run.Process.ID, domain.ProcessStateStopping)
	}
	if err := terminateManagedProcess(active.command); err != nil {
		return run, fmt.Errorf("stop process group: %w", err)
	}
	go func() {
		timer := time.NewTimer(manager.stopTimeout)
		defer timer.Stop()
		select {
		case <-active.done:
		case <-timer.C:
			_ = killManagedProcess(active.command)
		}
	}()
	return run, nil
}

func (manager *Manager) RestartService(ctx context.Context, processID string) (domain.Run, error) {
	_, err := manager.StopService(ctx, processID)
	if err != nil && !errors.Is(err, ErrNotActive) {
		return domain.Run{}, err
	}
	manager.mu.Lock()
	runID := manager.serviceByProcess[processID]
	active := manager.active[runID]
	manager.mu.Unlock()
	if active != nil {
		select {
		case <-active.done:
		case <-ctx.Done():
			return domain.Run{}, ctx.Err()
		}
	}
	return manager.StartService(ctx, processID)
}

func (manager *Manager) Shutdown(ctx context.Context) error {
	manager.mu.Lock()
	activeRuns := make([]*activeRun, 0, len(manager.active))
	for _, active := range manager.active {
		activeRuns = append(activeRuns, active)
	}
	manager.mu.Unlock()
	for _, active := range activeRuns {
		_, _ = manager.stop(context.Background(), active)
	}
	for _, active := range activeRuns {
		select {
		case <-active.done:
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	return nil
}

func (manager *Manager) Events() *events.Broker {
	return manager.events
}

func DefaultLogRoot(dataDir string) string {
	return filepath.Join(dataDir, "logs")
}
