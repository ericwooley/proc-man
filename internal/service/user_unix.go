//go:build !windows

package service

import "os"

func currentUserID() int {
	return os.Getuid()
}
