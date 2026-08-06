package config

import (
	"os"
	"path/filepath"
	"runtime"
)

type Paths struct {
	ConfigDir string
	DataDir   string
	StateDir  string
}

func DefaultPaths() Paths {
	home, _ := os.UserHomeDir()
	if runtime.GOOS == "darwin" {
		return Paths{
			ConfigDir: filepath.Join(home, "Library", "Application Support", "proc-man"),
			DataDir:   filepath.Join(home, "Library", "Application Support", "proc-man"),
			StateDir:  filepath.Join(home, "Library", "Logs", "proc-man"),
		}
	}
	configRoot := first(os.Getenv("XDG_CONFIG_HOME"), filepath.Join(home, ".config"))
	dataRoot := first(os.Getenv("XDG_DATA_HOME"), filepath.Join(home, ".local", "share"))
	stateRoot := first(os.Getenv("XDG_STATE_HOME"), filepath.Join(home, ".local", "state"))
	return Paths{
		ConfigDir: filepath.Join(configRoot, "proc-man"),
		DataDir:   filepath.Join(dataRoot, "proc-man"),
		StateDir:  filepath.Join(stateRoot, "proc-man"),
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
