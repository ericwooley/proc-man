package domain

import (
	"errors"
	"fmt"
	"regexp"
	"sort"
	"strings"
)

var tagPattern = regexp.MustCompile(`^[a-z0-9._:-]+$`)
var portNamePattern = regexp.MustCompile(`^[a-z][a-z0-9_-]*$`)

var ErrValidation = errors.New("validation failed")

func NormalizeProcess(process Process) (Process, error) {
	process.Label = strings.TrimSpace(process.Label)
	if length := len([]rune(process.Label)); length < 1 || length > 120 {
		return Process{}, fmt.Errorf("%w: label must contain 1 through 120 characters", ErrValidation)
	}
	if process.Kind != ProcessKindService && process.Kind != ProcessKindTask {
		return Process{}, fmt.Errorf("%w: kind must be service or task", ErrValidation)
	}
	if len(process.Command.Argv) == 0 == (strings.TrimSpace(process.Command.Shell) == "") {
		return Process{}, fmt.Errorf("%w: set exactly one argv or shell command", ErrValidation)
	}
	for _, argument := range process.Command.Argv {
		if strings.ContainsRune(argument, 0) {
			return Process{}, fmt.Errorf("%w: argv contains a null byte", ErrValidation)
		}
	}
	process.Command.Shell = strings.TrimSpace(process.Command.Shell)
	process.CWD = strings.TrimSpace(process.CWD)
	if process.CWD == "" {
		return Process{}, fmt.Errorf("%w: cwd is required", ErrValidation)
	}

	tags, err := NormalizeTags(process.Tags)
	if err != nil {
		return Process{}, err
	}
	process.Tags = tags

	seenPorts := make(map[string]struct{}, len(process.Ports))
	for index := range process.Ports {
		port := &process.Ports[index]
		port.Name = strings.ToLower(strings.TrimSpace(port.Name))
		if !portNamePattern.MatchString(port.Name) {
			return Process{}, fmt.Errorf("%w: invalid port name %q", ErrValidation, port.Name)
		}
		if _, exists := seenPorts[port.Name]; exists {
			return Process{}, fmt.Errorf("%w: duplicate port name %q", ErrValidation, port.Name)
		}
		seenPorts[port.Name] = struct{}{}
		if port.Port < 1 || port.Port > 65535 {
			return Process{}, fmt.Errorf("%w: port %q must be between 1 and 65535", ErrValidation, port.Name)
		}
		if strings.TrimSpace(port.Host) == "" {
			port.Host = "127.0.0.1"
		}
		port.Protocol = strings.ToLower(strings.TrimSpace(port.Protocol))
		switch port.Protocol {
		case "http", "https", "tcp":
		default:
			return Process{}, fmt.Errorf("%w: unsupported protocol %q", ErrValidation, port.Protocol)
		}
		if port.Path != "" && !strings.HasPrefix(port.Path, "/") {
			port.Path = "/" + port.Path
		}
	}

	if process.Env == nil {
		process.Env = map[string]string{}
	}
	if process.Source.Kind == "" {
		process.Source.Kind = "imperative"
	}
	if process.State == "" {
		process.State = ProcessStateStopped
	}
	return process, nil
}

func NormalizeTags(input []string) ([]string, error) {
	if len(input) > 32 {
		return nil, fmt.Errorf("%w: a process can have at most 32 tags", ErrValidation)
	}
	unique := make(map[string]struct{}, len(input))
	for _, value := range input {
		tag := strings.ToLower(strings.TrimSpace(value))
		if tag == "" {
			continue
		}
		if len(tag) > 63 || !tagPattern.MatchString(tag) {
			return nil, fmt.Errorf("%w: invalid tag %q", ErrValidation, tag)
		}
		unique[tag] = struct{}{}
	}
	tags := make([]string, 0, len(unique))
	for tag := range unique {
		tags = append(tags, tag)
	}
	sort.Strings(tags)
	return tags, nil
}
