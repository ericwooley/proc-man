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
