//go:build windows

package cli

import (
	"os"

	"golang.org/x/sys/windows"
)

func shutdownSignals() []os.Signal {
	return []os.Signal{os.Interrupt}
}

func lockFile(file *os.File) error {
	overlapped := new(windows.Overlapped)
	return windows.LockFileEx(
		windows.Handle(file.Fd()),
		windows.LOCKFILE_EXCLUSIVE_LOCK|windows.LOCKFILE_FAIL_IMMEDIATELY,
		0,
		1,
		0,
		overlapped,
	)
}
