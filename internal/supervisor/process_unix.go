//go:build !windows

package supervisor

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
)

func defaultShell() string {
	if shell := os.Getenv("SHELL"); shell != "" {
		return shell
	}
	return "/bin/sh"
}

func newShellCommand(shell string, script string) *exec.Cmd {
	return exec.Command(shell, "-lc", script)
}

func resolveDirectExecutable(name, cwd string, environment []string) (string, error) {
	if strings.ContainsRune(name, os.PathSeparator) {
		return name, nil
	}
	path := ""
	for index := len(environment) - 1; index >= 0; index-- {
		key, value, found := strings.Cut(environment[index], "=")
		if found && key == "PATH" {
			path = value
			break
		}
	}
	for _, directory := range filepath.SplitList(path) {
		if directory == "" {
			directory = cwd
		} else if !filepath.IsAbs(directory) {
			directory = filepath.Join(cwd, directory)
		}
		candidate := filepath.Join(directory, name)
		info, err := os.Stat(candidate)
		if err == nil && !info.IsDir() && info.Mode().Perm()&0o111 != 0 {
			return candidate, nil
		}
	}
	return "", fmt.Errorf("executable file %q was not found in the caller PATH", name)
}

func configureManagedCommand(command *exec.Cmd) {
	command.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
}

func terminateManagedProcess(command *exec.Cmd) error {
	return signalProcessGroup(command, syscall.SIGTERM)
}

func killManagedProcess(command *exec.Cmd) error {
	return signalProcessGroup(command, syscall.SIGKILL)
}

func signalProcessGroup(command *exec.Cmd, signal syscall.Signal) error {
	err := syscall.Kill(-command.Process.Pid, signal)
	if errors.Is(err, syscall.ESRCH) {
		return nil
	}
	return err
}
