package service

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

type Manager struct {
	GOOS       string
	Home       string
	Executable string
	Run        func(name string, arguments ...string) error
}

func Current() (*Manager, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil, err
	}
	executable, err := os.Executable()
	if err != nil {
		return nil, err
	}
	return &Manager{
		GOOS: runtime.GOOS, Home: home, Executable: executable,
		Run: func(name string, arguments ...string) error {
			command := exec.Command(name, arguments...)
			command.Stdout = os.Stdout
			command.Stderr = os.Stderr
			return command.Run()
		},
	}, nil
}

func (manager *Manager) Install(now bool) (string, error) {
	switch manager.GOOS {
	case "linux":
		return manager.installSystemd(now)
	case "darwin":
		return manager.installLaunchAgent(now)
	default:
		return "", fmt.Errorf("proc-man services support Linux and macOS")
	}
}

func (manager *Manager) Uninstall() error {
	switch manager.GOOS {
	case "linux":
		path := manager.systemdPath()
		_ = manager.Run("systemctl", "--user", "disable", "--now", "proc-man.service")
		if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
			return err
		}
		return manager.Run("systemctl", "--user", "daemon-reload")
	case "darwin":
		path := manager.launchAgentPath()
		_ = manager.Run("launchctl", "bootout", "gui/"+fmt.Sprint(currentUserID()), path)
		if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
			return err
		}
		return nil
	default:
		return fmt.Errorf("proc-man services support Linux and macOS")
	}
}

func (manager *Manager) Action(action string) error {
	switch manager.GOOS {
	case "linux":
		return manager.Run("systemctl", "--user", action, "proc-man.service")
	case "darwin":
		domain := "gui/" + fmt.Sprint(currentUserID())
		label := domain + "/dev.proc-man"
		switch action {
		case "start":
			return manager.Run("launchctl", "kickstart", label)
		case "stop":
			return manager.Run("launchctl", "kill", "SIGTERM", label)
		case "restart":
			return manager.Run("launchctl", "kickstart", "-k", label)
		case "status":
			return manager.Run("launchctl", "print", label)
		}
	}
	return fmt.Errorf("unsupported service action %q", action)
}

func (manager *Manager) installSystemd(now bool) (string, error) {
	path := manager.systemdPath()
	content := fmt.Sprintf(`[Unit]
Description=proc-man local development process manager
After=network.target

[Service]
ExecStart=%s serve
Restart=on-failure
RestartSec=2

[Install]
WantedBy=default.target
`, systemdEscape(manager.Executable))
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return "", err
	}
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		return "", err
	}
	if err := manager.Run("systemctl", "--user", "daemon-reload"); err != nil {
		return "", err
	}
	if now {
		if err := manager.Run("systemctl", "--user", "enable", "--now", "proc-man.service"); err != nil {
			return "", err
		}
	}
	return path, nil
}

func (manager *Manager) installLaunchAgent(now bool) (string, error) {
	path := manager.launchAgentPath()
	content := fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>dev.proc-man</string>
  <key>ProgramArguments</key><array><string>%s</string><string>serve</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>StandardOutPath</key><string>%s</string>
  <key>StandardErrorPath</key><string>%s</string>
</dict></plist>
`, xmlEscape(manager.Executable),
		xmlEscape(filepath.Join(manager.Home, "Library", "Logs", "proc-man", "daemon.log")),
		xmlEscape(filepath.Join(manager.Home, "Library", "Logs", "proc-man", "daemon-error.log")),
	)
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return "", err
	}
	if err := os.MkdirAll(filepath.Join(manager.Home, "Library", "Logs", "proc-man"), 0o700); err != nil {
		return "", err
	}
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		return "", err
	}
	if now {
		if err := manager.Run("launchctl", "bootstrap", "gui/"+fmt.Sprint(currentUserID()), path); err != nil {
			return "", err
		}
	}
	return path, nil
}

func (manager *Manager) systemdPath() string {
	return filepath.Join(manager.Home, ".config", "systemd", "user", "proc-man.service")
}

func (manager *Manager) launchAgentPath() string {
	return filepath.Join(manager.Home, "Library", "LaunchAgents", "dev.proc-man.plist")
}

func systemdEscape(value string) string {
	return strings.ReplaceAll(value, "%", "%%")
}

func xmlEscape(value string) string {
	replacer := strings.NewReplacer(
		"&", "&amp;", "<", "&lt;", ">", "&gt;", `"`, "&quot;", "'", "&apos;",
	)
	return replacer.Replace(value)
}
