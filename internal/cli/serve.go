package cli

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"time"

	"proc-man/internal/api"
	"proc-man/internal/config"
	"proc-man/internal/spa"
	"proc-man/internal/store"
	"proc-man/internal/supervisor"
	embeddedweb "proc-man/internal/web"

	"github.com/spf13/cobra"
)

func (app *application) serveCommand() *cobra.Command {
	defaults := config.DefaultPaths()
	var host string
	var port int
	var dataDir string
	var webDir string
	var shell string
	var stopTimeout time.Duration
	command := &cobra.Command{
		Use:   "serve",
		Short: "Run the proc-man local service",
		RunE: func(command *cobra.Command, _ []string) error {
			if !loopbackHost(host) {
				return fmt.Errorf("proc-man local development requires a loopback host")
			}
			if err := os.MkdirAll(dataDir, 0o700); err != nil {
				return err
			}
			lock, err := acquireLock(filepath.Join(dataDir, "daemon.lock"))
			if err != nil {
				return err
			}
			defer lock.Close()
			state, err := store.Open(filepath.Join(dataDir, "state.db"))
			if err != nil {
				return err
			}
			defer state.Close()
			if err := state.RecoverActiveRuns(command.Context()); err != nil {
				return err
			}
			manager := supervisor.New(state, supervisor.Options{
				LogRoot: supervisor.DefaultLogRoot(dataDir),
				Shell:   shell, StopTimeout: stopTimeout,
				OnError: func(err error) {
					fmt.Fprintln(app.errors, err)
				},
			})
			var web http.Handler = embeddedweb.Handler()
			if webDir != "" {
				web = spa.Directory(webDir)
			}
			server := &http.Server{
				Addr:              net.JoinHostPort(host, fmt.Sprint(port)),
				Handler:           api.New(state, manager, web).Handler(),
				ReadHeaderTimeout: 5 * time.Second,
				IdleTimeout:       60 * time.Second,
			}
			ctx, cancel := signal.NotifyContext(command.Context(), shutdownSignals()...)
			defer cancel()
			errorsChannel := make(chan error, 1)
			go func() {
				app.printLine("proc-man is listening at http://" + server.Addr)
				errorsChannel <- server.ListenAndServe()
			}()
			select {
			case <-ctx.Done():
			case err := <-errorsChannel:
				if !errors.Is(err, http.ErrServerClosed) {
					return err
				}
			}
			shutdownContext, shutdownCancel := context.WithTimeout(context.Background(), stopTimeout+5*time.Second)
			defer shutdownCancel()
			_ = manager.Shutdown(shutdownContext)
			return server.Shutdown(shutdownContext)
		},
	}
	command.Flags().StringVar(&host, "host", "127.0.0.1", "Loopback host")
	command.Flags().IntVar(&port, "port", 13337, "Administration port")
	command.Flags().StringVar(&dataDir, "data-dir", defaults.DataDir, "State and log directory")
	command.Flags().StringVar(&webDir, "web-dir", "", "Built React directory")
	command.Flags().StringVar(&shell, "login-shell", "", "Login shell path")
	command.Flags().DurationVar(&stopTimeout, "stop-timeout", 10*time.Second, "Graceful stop limit")
	return command
}

func loopbackHost(host string) bool {
	if host == "localhost" {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

func acquireLock(path string) (*os.File, error) {
	file, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return nil, err
	}
	if err := lockFile(file); err != nil {
		file.Close()
		return nil, fmt.Errorf("another proc-man service uses this data directory")
	}
	return file, nil
}
