//go:build windows

package supervisor

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
)

func defaultShell() string {
	if shell := os.Getenv("COMSPEC"); shell != "" {
		return shell
	}
	return "cmd.exe"
}

func newShellCommand(shell string, script string) *exec.Cmd {
	name := strings.ToLower(filepath.Base(shell))
	if strings.Contains(name, "powershell") || name == "pwsh.exe" || name == "pwsh" {
		return exec.Command(shell, "-NoLogo", "-NoProfile", "-Command", script)
	}
	return exec.Command(shell, "/D", "/S", "/C", script)
}

func resolveDirectExecutable(name, cwd string, environment []string) (string, error) {
	if filepath.IsAbs(name) || strings.ContainsAny(name, `/\`) {
		return name, nil
	}
	path := ""
	extensions := ".COM;.EXE;.BAT;.CMD"
	pathSet := false
	extensionsSet := false
	for index := len(environment) - 1; index >= 0; index-- {
		key, value, found := strings.Cut(environment[index], "=")
		if !found {
			continue
		}
		switch {
		case strings.EqualFold(key, "PATH") && !pathSet:
			path = value
			pathSet = true
		case strings.EqualFold(key, "PATHEXT") && !extensionsSet:
			extensions = value
			extensionsSet = true
		}
	}
	names := []string{name}
	if filepath.Ext(name) == "" {
		names = names[:0]
		for _, extension := range filepath.SplitList(extensions) {
			names = append(names, name+extension)
		}
	}
	for _, directory := range filepath.SplitList(path) {
		if directory == "" {
			directory = cwd
		} else if !filepath.IsAbs(directory) {
			directory = filepath.Join(cwd, directory)
		}
		for _, candidateName := range names {
			candidate := filepath.Join(directory, candidateName)
			info, err := os.Stat(candidate)
			if err == nil && !info.IsDir() {
				return candidate, nil
			}
		}
	}
	return "", fmt.Errorf("executable file %q was not found in the caller PATH", name)
}

func configureManagedCommand(command *exec.Cmd) {
	command.SysProcAttr = &syscall.SysProcAttr{
		CreationFlags: syscall.CREATE_NEW_PROCESS_GROUP,
	}
}

func terminateManagedProcess(command *exec.Cmd) error {
	return runTaskkill(command.Process.Pid, false)
}

func killManagedProcess(command *exec.Cmd) error {
	return runTaskkill(command.Process.Pid, true)
}

func runTaskkill(pid int, force bool) error {
	arguments := []string{"/PID", strconv.Itoa(pid), "/T"}
	if force {
		arguments = append(arguments, "/F")
	}
	output, err := exec.Command("taskkill", arguments...).CombinedOutput()
	if err != nil {
		return fmt.Errorf("taskkill: %s: %w", strings.TrimSpace(string(output)), err)
	}
	return nil
}
