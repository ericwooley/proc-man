package cli

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"text/tabwriter"
	"time"

	"proc-man/internal/client"
	"proc-man/internal/domain"
	"proc-man/internal/service"

	"github.com/spf13/cobra"
)

type application struct {
	version    string
	output     io.Writer
	errors     io.Writer
	adminURL   string
	jsonOutput bool
}

const directRunLogPageSize = 10_000

type directRunExitError struct {
	runID string
	code  int
}

func (err *directRunExitError) Error() string {
	return fmt.Sprintf("run %s exited with code %d", err.runID, err.code)
}

func New(version string, output, errorsOutput io.Writer) *cobra.Command {
	app := &application{
		version: version, output: output, errors: errorsOutput,
		adminURL: first(os.Getenv("PROC_MAN_ADMIN_URL"), "http://127.0.0.1:13337"),
	}
	var printAgentInstructions bool
	root := &cobra.Command{
		Use:           "proc-man",
		Short:         "Manage local development processes and logs",
		SilenceUsage:  true,
		SilenceErrors: true,
		Version:       version,
		Args:          cobra.NoArgs,
		RunE: func(command *cobra.Command, _ []string) error {
			if printAgentInstructions {
				_, err := fmt.Fprint(app.output, agentInstructions)
				return err
			}
			return command.Help()
		},
	}
	root.SetOut(output)
	root.SetErr(errorsOutput)
	root.Flags().BoolVar(
		&printAgentInstructions,
		"agent-instructions",
		false,
		"Print markdown instructions for coding agents",
	)
	root.PersistentFlags().StringVar(&app.adminURL, "admin-url", app.adminURL, "proc-man service URL")
	root.PersistentFlags().BoolVar(&app.jsonOutput, "json", false, "Print stable JSON")
	root.AddCommand(
		app.serveCommand(),
		app.processCommand(),
		app.runCommand(),
		app.tagCommand(),
		app.registerCommand(),
		app.deregisterCommand(),
		app.openCommand(),
		app.daemonCommand(),
		app.apiCommand(),
	)
	return root
}

func (app *application) processCommand() *cobra.Command {
	command := &cobra.Command{Use: "process", Short: "Manage registered processes"}
	command.AddCommand(
		app.processRegisterCommand(),
		app.processListCommand(),
		app.processStatusCommand(),
		app.processUpdateCommand(),
		app.processDeleteCommand(),
		app.processActionCommand("start"),
		app.processActionCommand("stop"),
		app.processActionCommand("restart"),
		app.processActionCommand("run"),
		app.processCancelCommand(),
		app.processLogsCommand(),
	)
	return command
}

func (app *application) processRegisterCommand() *cobra.Command {
	var label, kind, cwd, shell string
	var tags, ports, environment []string
	command := &cobra.Command{
		Use:   "register [flags] -- command [args...]",
		Short: "Register one long-running service",
		Long:  "Register one long-running service. Use 'proc-man run -- COMMAND [ARG...]' for new one-shot commands.",
		RunE: func(command *cobra.Command, arguments []string) error {
			if cwd == "" {
				value, err := os.Getwd()
				if err != nil {
					return err
				}
				cwd = value
			}
			absoluteCWD, err := filepath.Abs(cwd)
			if err != nil {
				return fmt.Errorf("resolve working directory: %w", err)
			}
			cwd = absoluteCWD
			definition := domain.Process{
				Label: label, Kind: domain.ProcessKind(kind), Tags: tags, CWD: cwd,
				Env: parseKeyValues(environment),
			}
			if shell != "" {
				definition.Command.Shell = shell
			} else {
				definition.Command.Argv = arguments
			}
			definition.Ports, err = parsePorts(ports)
			if err != nil {
				return err
			}
			var response struct {
				Process domain.Process `json:"process"`
			}
			if err := app.client().JSON(command.Context(), http.MethodPost,
				"/api/v1/processes", definition, &response,
			); err != nil {
				return err
			}
			return app.print(response)
		},
	}
	command.Flags().StringVar(&label, "label", "", "Human process label")
	command.Flags().StringVar(&kind, "kind", "", "Process kind: service or task")
	command.Flags().StringSliceVar(&tags, "tag", nil, "Process tag")
	command.Flags().StringSliceVar(&ports, "port", nil, "Declared port as name=URL")
	command.Flags().StringSliceVar(&environment, "env", nil, "Environment override as name=value")
	command.Flags().StringVar(&cwd, "cwd", "", "Working directory")
	command.Flags().StringVar(&shell, "shell", "", "Explicit shell command")
	_ = command.MarkFlagRequired("label")
	_ = command.MarkFlagRequired("kind")
	return command
}

func (app *application) processListCommand() *cobra.Command {
	var query, directory, kind, state string
	var tags []string
	command := &cobra.Command{
		Use:   "list",
		Short: "List registered processes",
		RunE: func(command *cobra.Command, _ []string) error {
			values := url.Values{}
			values.Set("query", query)
			if strings.TrimSpace(directory) != "" {
				absoluteDirectory, err := filepath.Abs(directory)
				if err != nil {
					return fmt.Errorf("resolve directory: %w", err)
				}
				values.Set("directory", absoluteDirectory)
			}
			values.Set("kind", kind)
			values.Set("state", state)
			for _, tag := range tags {
				values.Add("tag", tag)
			}
			var response struct {
				Processes []domain.Process `json:"processes"`
			}
			if err := app.client().JSON(command.Context(), http.MethodGet,
				client.Query("/api/v1/processes", values), nil, &response,
			); err != nil {
				return err
			}
			if app.jsonOutput {
				return app.print(response)
			}
			writer := tabwriter.NewWriter(app.output, 0, 4, 2, ' ', 0)
			fmt.Fprintln(writer, "ID\tLABEL\tDIRECTORY\tKIND\tSTATE\tTAGS\tPORTS")
			for _, process := range response.Processes {
				portValues := make([]string, 0, len(process.Ports))
				for _, port := range process.Ports {
					portValues = append(portValues, port.Name+":"+strconv.Itoa(port.Port))
				}
				fmt.Fprintf(writer, "%s\t%s\t%s\t%s\t%s\t%s\t%s\n",
					process.ID, process.Label, process.CWD, process.Kind, process.State,
					strings.Join(process.Tags, ","), strings.Join(portValues, ","),
				)
			}
			return writer.Flush()
		},
	}
	command.Flags().StringVar(&query, "query", "", "Search label, tags, ports, and command")
	command.Flags().StringVar(&directory, "directory", "", "Exact associated directory")
	command.Flags().StringSliceVar(&tags, "tag", nil, "Required tag")
	command.Flags().StringVar(&kind, "kind", "", "Process kind")
	command.Flags().StringVar(&state, "state", "", "Process state")
	return command
}

func (app *application) processStatusCommand() *cobra.Command {
	return &cobra.Command{
		Use:   "status PROCESS_ID",
		Short: "Show one process and recent runs",
		Args:  cobra.ExactArgs(1),
		RunE: func(command *cobra.Command, arguments []string) error {
			var response any
			if err := app.client().JSON(command.Context(), http.MethodGet,
				"/api/v1/processes/"+url.PathEscape(arguments[0]), nil, &response,
			); err != nil {
				return err
			}
			return app.print(response)
		},
	}
}

func (app *application) processUpdateCommand() *cobra.Command {
	var label string
	var tags []string
	command := &cobra.Command{
		Use:   "update PROCESS_ID",
		Short: "Update an imperative process",
		Args:  cobra.ExactArgs(1),
		RunE: func(command *cobra.Command, arguments []string) error {
			input := map[string]any{}
			if command.Flags().Changed("label") {
				input["label"] = label
			}
			if command.Flags().Changed("tag") {
				input["tags"] = tags
			}
			var response any
			if err := app.client().JSON(command.Context(), http.MethodPatch,
				"/api/v1/processes/"+url.PathEscape(arguments[0]), input, &response,
			); err != nil {
				return err
			}
			return app.print(response)
		},
	}
	command.Flags().StringVar(&label, "label", "", "Replacement label")
	command.Flags().StringSliceVar(&tags, "tag", nil, "Replacement tags")
	return command
}

func (app *application) processDeleteCommand() *cobra.Command {
	return &cobra.Command{
		Use:   "deregister PROCESS_ID",
		Short: "Deregister one process and retain its run history",
		Args:  cobra.ExactArgs(1),
		RunE: func(command *cobra.Command, arguments []string) error {
			if err := app.client().JSON(command.Context(), http.MethodDelete,
				"/api/v1/processes/"+url.PathEscape(arguments[0]), nil, nil,
			); err != nil {
				return err
			}
			return app.print(map[string]any{"deregistered": arguments[0]})
		},
	}
}

func (app *application) processActionCommand(action string) *cobra.Command {
	return &cobra.Command{
		Use:   action + " PROCESS_ID",
		Short: strings.ToUpper(action[:1]) + action[1:] + " a process",
		Args:  cobra.ExactArgs(1),
		RunE: func(command *cobra.Command, arguments []string) error {
			path := "/api/v1/processes/" + url.PathEscape(arguments[0]) + "/" + action
			if action == "run" {
				path = "/api/v1/processes/" + url.PathEscape(arguments[0]) + "/runs"
			}
			var response any
			if err := app.client().JSON(command.Context(), http.MethodPost, path, map[string]any{}, &response); err != nil {
				return err
			}
			return app.print(response)
		},
	}
}

func (app *application) processCancelCommand() *cobra.Command {
	var runID string
	command := &cobra.Command{
		Use:   "cancel PROCESS_ID",
		Short: "Cancel one active task run",
		Args:  cobra.ExactArgs(1),
		RunE: func(command *cobra.Command, _ []string) error {
			if runID == "" {
				return fmt.Errorf("--run is required")
			}
			var response any
			if err := app.client().JSON(command.Context(), http.MethodPost,
				"/api/v1/runs/"+url.PathEscape(runID)+"/cancel", map[string]any{}, &response,
			); err != nil {
				return err
			}
			return app.print(response)
		},
	}
	command.Flags().StringVar(&runID, "run", "", "Active run ID")
	return command
}

func (app *application) processLogsCommand() *cobra.Command {
	var runID, stream, query string
	command := &cobra.Command{
		Use:   "logs PROCESS_ID",
		Short: "Read logs for one process run",
		Args:  cobra.ExactArgs(1),
		RunE: func(command *cobra.Command, arguments []string) error {
			if runID == "" || runID == "latest" {
				var runs struct {
					Runs []domain.Run `json:"runs"`
				}
				if err := app.client().JSON(command.Context(), http.MethodGet,
					"/api/v1/processes/"+url.PathEscape(arguments[0])+"/runs?limit=1",
					nil, &runs,
				); err != nil {
					return err
				}
				if len(runs.Runs) == 0 {
					return fmt.Errorf("process has no runs")
				}
				runID = runs.Runs[0].ID
			}
			var response struct {
				Records []domain.LogRecord `json:"records"`
			}
			values := url.Values{"stream": []string{stream}, "query": []string{query}}
			if err := app.client().JSON(command.Context(), http.MethodGet,
				client.Query("/api/v1/runs/"+url.PathEscape(runID)+"/logs", values),
				nil, &response,
			); err != nil {
				return err
			}
			if app.jsonOutput {
				return app.print(response)
			}
			for _, record := range response.Records {
				fmt.Fprintf(app.output, "%s %-6s %s\n",
					record.Time.Format(time.RFC3339), record.Stream, record.Text,
				)
			}
			return nil
		},
	}
	command.Flags().StringVar(&runID, "run", "latest", "Run ID or latest")
	command.Flags().StringVar(&stream, "stream", "", "stdout or stderr")
	command.Flags().StringVar(&query, "query", "", "Log text")
	return command
}

func (app *application) runCommand() *cobra.Command {
	command := &cobra.Command{
		Use:   "run -- COMMAND [ARG...]",
		Short: "Run one command or inspect retained runs",
		Args: func(command *cobra.Command, arguments []string) error {
			if command.ArgsLenAtDash() < 0 {
				return fmt.Errorf("direct command arguments must follow --")
			}
			if len(arguments) == 0 {
				return fmt.Errorf("a command is required after --")
			}
			return nil
		},
		RunE: func(command *cobra.Command, arguments []string) error {
			if app.jsonOutput {
				return fmt.Errorf("--json cannot be used with a direct command")
			}
			directory, err := os.Getwd()
			if err != nil {
				return fmt.Errorf("resolve working directory: %w", err)
			}
			var response struct {
				Run domain.Run `json:"run"`
			}
			baseContext := command.Context()
			runContext, stopSignals := signal.NotifyContext(baseContext, shutdownSignals()...)
			defer stopSignals()
			if err := app.client().JSON(baseContext, http.MethodPost,
				"/api/v1/runs", map[string]any{
					"cwd": directory, "argv": arguments, "env": os.Environ(),
				}, &response,
			); err != nil {
				return err
			}
			if response.Run.ID == "" {
				return fmt.Errorf("proc-man returned a direct run without an ID")
			}
			finished, err := app.followDirectRun(
				runContext, response.Run.ID,
				command.OutOrStdout(), command.ErrOrStderr(),
			)
			if err != nil {
				if runContext.Err() != nil {
					if cancelErr := app.cancelDirectRun(response.Run.ID); cancelErr != nil {
						fmt.Fprintf(command.ErrOrStderr(),
							"proc-man: cancel audit run %s: %v\n", response.Run.ID, cancelErr,
						)
					}
					if baseContext.Err() != nil {
						return baseContext.Err()
					}
					return &directRunExitError{runID: response.Run.ID, code: 130}
				}
				return err
			}
			code := 0
			if finished.ExitCode != nil {
				code = *finished.ExitCode
			} else if finished.State != domain.RunStateExited {
				code = 1
			}
			if code != 0 {
				if code < 0 {
					code = 1
				}
				return &directRunExitError{runID: finished.ID, code: code}
			}
			return nil
		},
	}
	command.AddCommand(app.runListCommand(), app.runStatusCommand(), app.runLogsCommand())
	return command
}

func (app *application) cancelDirectRun(runID string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	var response struct {
		Run domain.Run `json:"run"`
	}
	return app.client().JSON(ctx, http.MethodPost,
		"/api/v1/runs/"+url.PathEscape(runID)+"/cancel", nil, &response,
	)
}

func (app *application) followDirectRun(
	ctx context.Context,
	runID string,
	output io.Writer,
	errorsOutput io.Writer,
) (domain.Run, error) {
	var sequence int64
	for {
		values := url.Values{}
		values.Set("limit", strconv.Itoa(directRunLogPageSize))
		if sequence > 0 {
			values.Set("since", strconv.FormatInt(sequence, 10))
		}
		previousSequence := sequence
		var response struct {
			Run     domain.Run         `json:"run"`
			Records []domain.LogRecord `json:"records"`
		}
		path := client.Query("/api/v1/runs/"+url.PathEscape(runID)+"/logs", values)
		if err := app.client().JSON(ctx, http.MethodGet, path, nil, &response); err != nil {
			return domain.Run{}, err
		}
		for _, record := range response.Records {
			if record.Sequence <= sequence {
				continue
			}
			writer := output
			if record.Stream == "stderr" {
				writer = errorsOutput
			}
			if _, err := io.WriteString(writer, record.Text); err != nil {
				return domain.Run{}, err
			}
			if !record.Partial {
				if _, err := io.WriteString(writer, "\n"); err != nil {
					return domain.Run{}, err
				}
			}
			sequence = record.Sequence
		}
		if response.Run.State.Terminal() &&
			(len(response.Records) < directRunLogPageSize || sequence == previousSequence) {
			return response.Run, nil
		}
		if len(response.Records) >= directRunLogPageSize {
			continue
		}
		timer := time.NewTimer(100 * time.Millisecond)
		select {
		case <-ctx.Done():
			timer.Stop()
			return domain.Run{}, ctx.Err()
		case <-timer.C:
		}
	}
}

func (app *application) runListCommand() *cobra.Command {
	var processID, directory, kind, state string
	command := &cobra.Command{
		Use:   "list",
		Short: "List retained runs",
		RunE: func(command *cobra.Command, _ []string) error {
			if strings.TrimSpace(directory) != "" {
				absoluteDirectory, err := filepath.Abs(directory)
				if err != nil {
					return fmt.Errorf("resolve directory: %w", err)
				}
				directory = absoluteDirectory
			}
			values := url.Values{
				"process_id": []string{processID}, "directory": []string{directory},
				"kind": []string{kind}, "state": []string{state},
			}
			var response any
			if err := app.client().JSON(command.Context(), http.MethodGet,
				client.Query("/api/v1/runs", values), nil, &response,
			); err != nil {
				return err
			}
			return app.print(response)
		},
	}
	command.Flags().StringVar(&processID, "process", "", "Process ID")
	command.Flags().StringVar(&directory, "directory", "", "Exact run directory")
	command.Flags().StringVar(&kind, "kind", "", "Process kind")
	command.Flags().StringVar(&state, "state", "", "Run state")
	return command
}

func (app *application) runStatusCommand() *cobra.Command {
	return &cobra.Command{
		Use:   "status RUN_ID",
		Short: "Show one run",
		Args:  cobra.ExactArgs(1),
		RunE: func(command *cobra.Command, arguments []string) error {
			var response any
			if err := app.client().JSON(command.Context(), http.MethodGet,
				"/api/v1/runs/"+url.PathEscape(arguments[0]), nil, &response,
			); err != nil {
				return err
			}
			return app.print(response)
		},
	}
}

func (app *application) runLogsCommand() *cobra.Command {
	var outputPath, format string
	command := &cobra.Command{
		Use:   "logs RUN_ID",
		Short: "Read or download one run",
		Args:  cobra.ExactArgs(1),
		RunE: func(command *cobra.Command, arguments []string) error {
			path := "/api/v1/runs/" + url.PathEscape(arguments[0]) + "/logs"
			if outputPath == "" {
				var response any
				if err := app.client().JSON(command.Context(), http.MethodGet, path, nil, &response); err != nil {
					return err
				}
				return app.print(response)
			}
			file, err := os.OpenFile(outputPath, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
			if err != nil {
				return err
			}
			defer file.Close()
			return app.client().Download(command.Context(), path+"/download?format="+url.QueryEscape(format), file)
		},
	}
	command.Flags().StringVar(&outputPath, "output", "", "Download path")
	command.Flags().StringVar(&format, "format", "text", "text or ndjson")
	return command
}

func (app *application) tagCommand() *cobra.Command {
	command := &cobra.Command{Use: "tag", Short: "Inspect process tags"}
	command.AddCommand(&cobra.Command{
		Use:   "list",
		Short: "List tags and process counts",
		RunE: func(command *cobra.Command, _ []string) error {
			var response any
			if err := app.client().JSON(command.Context(), http.MethodGet, "/api/v1/tags", nil, &response); err != nil {
				return err
			}
			return app.print(response)
		},
	})
	return command
}

func (app *application) registerCommand() *cobra.Command {
	var filePath string
	var dryRun bool
	command := &cobra.Command{
		Use:   "register",
		Short: "Apply a .proc-man.yaml process manifest",
		RunE: func(command *cobra.Command, _ []string) error {
			if filePath == "" {
				var err error
				filePath, err = findManifest()
				if err != nil {
					return err
				}
			}
			content, err := os.ReadFile(filePath)
			if err != nil {
				return err
			}
			var response any
			if err := app.client().JSON(command.Context(), http.MethodPost,
				"/api/v1/registrations", map[string]any{
					"path": filePath, "content": string(content), "dry_run": dryRun,
				}, &response,
			); err != nil {
				return err
			}
			return app.print(response)
		},
	}
	command.Flags().StringVarP(&filePath, "file", "f", "", "Manifest path")
	command.Flags().BoolVar(&dryRun, "dry-run", false, "Show the reconciliation plan")
	return command
}

func (app *application) deregisterCommand() *cobra.Command {
	var source string
	command := &cobra.Command{
		Use:   "deregister",
		Short: "Deregister all processes from one manifest",
		RunE: func(command *cobra.Command, _ []string) error {
			if source == "" {
				var err error
				source, err = findManifest()
				if err != nil {
					return err
				}
			}
			var response any
			if err := app.client().JSON(command.Context(), http.MethodPost,
				"/api/v1/deregistrations", map[string]string{"source": source}, &response,
			); err != nil {
				return err
			}
			return app.print(response)
		},
	}
	command.Flags().StringVar(&source, "source", "", "Canonical manifest path")
	return command
}

func (app *application) openCommand() *cobra.Command {
	return &cobra.Command{
		Use:   "open ENDPOINT_ID",
		Short: "Open one declared HTTP endpoint",
		Args:  cobra.ExactArgs(1),
		RunE: func(command *cobra.Command, arguments []string) error {
			var response struct {
				Processes []domain.Process `json:"processes"`
			}
			if err := app.client().JSON(command.Context(), http.MethodGet, "/api/v1/processes", nil, &response); err != nil {
				return err
			}
			for _, process := range response.Processes {
				for _, port := range process.Ports {
					if port.ID != arguments[0] {
						continue
					}
					address := endpointURL(port)
					if port.Protocol == "tcp" {
						app.printLine(address)
						return nil
					}
					name := "xdg-open"
					if runtime.GOOS == "darwin" {
						name = "open"
					}
					return exec.CommandContext(command.Context(), name, address).Start()
				}
			}
			return fmt.Errorf("endpoint not found")
		},
	}
}

func (app *application) daemonCommand() *cobra.Command {
	command := &cobra.Command{Use: "daemon", Short: "Manage the user service"}
	var now bool
	install := &cobra.Command{
		Use: "install", Short: "Install the proc-man user service",
		RunE: func(_ *cobra.Command, _ []string) error {
			manager, err := service.Current()
			if err != nil {
				return err
			}
			path, err := manager.Install(now)
			if err != nil {
				return err
			}
			app.printLine(path)
			return nil
		},
	}
	install.Flags().BoolVar(&now, "now", false, "Start the service after installation")
	command.AddCommand(install)
	command.AddCommand(&cobra.Command{
		Use: "uninstall", Short: "Remove the proc-man user service",
		RunE: func(_ *cobra.Command, _ []string) error {
			manager, err := service.Current()
			if err != nil {
				return err
			}
			return manager.Uninstall()
		},
	})
	for _, action := range []string{"start", "stop", "restart", "status"} {
		action := action
		command.AddCommand(&cobra.Command{
			Use: action, Short: action + " the proc-man user service",
			RunE: func(_ *cobra.Command, _ []string) error {
				manager, err := service.Current()
				if err != nil {
					return err
				}
				return manager.Action(action)
			},
		})
	}
	return command
}

func (app *application) apiCommand() *cobra.Command {
	command := &cobra.Command{Use: "api", Short: "Inspect the local API"}
	command.AddCommand(&cobra.Command{
		Use: "openapi", Short: "Print the OpenAPI document",
		RunE: func(command *cobra.Command, _ []string) error {
			var response any
			if err := app.client().JSON(command.Context(), http.MethodGet,
				"/api/v1/openapi.json", nil, &response,
			); err != nil {
				return err
			}
			return app.print(response)
		},
	})
	return command
}

func (app *application) client() *client.Client {
	return client.New(app.adminURL)
}

func (app *application) print(value any) error {
	if app.jsonOutput {
		value = map[string]any{"ok": true, "data": value, "warnings": []string{}}
	}
	encoder := json.NewEncoder(app.output)
	encoder.SetIndent("", "  ")
	return encoder.Encode(value)
}

func (app *application) printLine(value string) {
	fmt.Fprintln(app.output, value)
}

func parseKeyValues(values []string) map[string]string {
	result := make(map[string]string, len(values))
	for _, value := range values {
		key, item, exists := strings.Cut(value, "=")
		if exists {
			result[key] = item
		}
	}
	return result
}

func parsePorts(values []string) ([]domain.Port, error) {
	ports := make([]domain.Port, 0, len(values))
	for _, value := range values {
		name, address, exists := strings.Cut(value, "=")
		if !exists {
			return nil, fmt.Errorf("port must use name=URL")
		}
		parsed, err := url.Parse(address)
		if err != nil || parsed.Hostname() == "" || parsed.Port() == "" {
			return nil, fmt.Errorf("invalid port URL %q", address)
		}
		number, err := strconv.Atoi(parsed.Port())
		if err != nil {
			return nil, err
		}
		ports = append(ports, domain.Port{
			Name: name, Host: parsed.Hostname(), Port: number,
			Protocol: parsed.Scheme, Path: parsed.Path,
		})
	}
	return ports, nil
}

func endpointURL(port domain.Port) string {
	return fmt.Sprintf("%s://%s:%d%s", port.Protocol, port.Host, port.Port, port.Path)
}

func findManifest() (string, error) {
	directory, err := os.Getwd()
	if err != nil {
		return "", err
	}
	for {
		path := filepath.Join(directory, ".proc-man.yaml")
		if _, err := os.Stat(path); err == nil {
			return path, nil
		}
		parent := filepath.Dir(directory)
		if parent == directory {
			return "", fmt.Errorf(".proc-man.yaml was not found")
		}
		directory = parent
	}
}

func first(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}

func sortedKeys(values map[string]int) []string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func ExecuteContext(ctx context.Context, version string) error {
	command := New(version, os.Stdout, os.Stderr)
	command.SetContext(ctx)
	return command.Execute()
}

func ExitCode(err error) int {
	if err == nil {
		return 0
	}
	var runExit *directRunExitError
	if errors.As(err, &runExit) {
		return runExit.code
	}
	var apiError *client.APIError
	if errors.As(err, &apiError) {
		switch apiError.Status {
		case http.StatusBadRequest:
			return 2
		case http.StatusNotFound:
			return 3
		case http.StatusConflict:
			return 4
		case http.StatusUnauthorized, http.StatusForbidden:
			return 5
		default:
			return 7
		}
	}
	if strings.Contains(err.Error(), "connect to proc-man") {
		return 6
	}
	return 2
}

func IsDirectRunExit(err error) bool {
	var runExit *directRunExitError
	return errors.As(err, &runExit)
}
