package domain

import (
	"errors"
	"testing"
)

func TestNormalizeProcess(t *testing.T) {
	t.Parallel()

	process, err := NormalizeProcess(Process{
		Label:   " Storefront web ",
		Kind:    ProcessKindService,
		Tags:    []string{"Frontend", " project:storefront ", "frontend"},
		Command: Command{Argv: []string{"npm", "run", "dev"}},
		CWD:     "/workspace/storefront",
		Ports: []Port{{
			Name: "HTTP", Port: 4310, Protocol: "HTTP",
		}},
	})
	if err != nil {
		t.Fatalf("NormalizeProcess() error = %v", err)
	}
	if process.Label != "Storefront web" {
		t.Fatalf("Label = %q", process.Label)
	}
	if len(process.Tags) != 2 || process.Tags[0] != "frontend" {
		t.Fatalf("Tags = %#v", process.Tags)
	}
	if process.Ports[0].Host != "127.0.0.1" {
		t.Fatalf("Host = %q", process.Ports[0].Host)
	}
	if process.State != ProcessStateStopped {
		t.Fatalf("State = %q", process.State)
	}
}

func TestNormalizeProcessRejectsInvalidInputs(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		process Process
	}{
		{
			name: "missing label",
			process: Process{
				Kind: ProcessKindTask, Command: Command{Argv: []string{"true"}}, CWD: "/tmp",
			},
		},
		{
			name: "two command forms",
			process: Process{
				Label: "task", Kind: ProcessKindTask,
				Command: Command{Argv: []string{"true"}, Shell: "true"}, CWD: "/tmp",
			},
		},
		{
			name: "invalid tag",
			process: Process{
				Label: "task", Kind: ProcessKindTask, Tags: []string{"not valid"},
				Command: Command{Argv: []string{"true"}}, CWD: "/tmp",
			},
		},
		{
			name: "duplicate port",
			process: Process{
				Label: "task", Kind: ProcessKindTask,
				Command: Command{Argv: []string{"true"}}, CWD: "/tmp",
				Ports: []Port{
					{Name: "http", Port: 3000, Protocol: "http"},
					{Name: "HTTP", Port: 3001, Protocol: "http"},
				},
			},
		},
	}

	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			_, err := NormalizeProcess(test.process)
			if !errors.Is(err, ErrValidation) {
				t.Fatalf("error = %v, want ErrValidation", err)
			}
		})
	}
}
