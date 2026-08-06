package manifest

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"sort"

	"proc-man/internal/domain"
	"proc-man/internal/ids"
	"proc-man/internal/store"

	"gopkg.in/yaml.v3"
)

type Manifest struct {
	Version   int               `yaml:"version" json:"version"`
	Processes []ProcessManifest `yaml:"processes" json:"processes"`
}

type ProcessManifest struct {
	Key     string             `yaml:"key" json:"key"`
	Label   string             `yaml:"label" json:"label"`
	Kind    domain.ProcessKind `yaml:"kind" json:"kind"`
	Tags    []string           `yaml:"tags" json:"tags"`
	CWD     string             `yaml:"cwd" json:"cwd"`
	Command domain.Command     `yaml:"command" json:"command"`
	Env     map[string]string  `yaml:"env" json:"env"`
	Ports   []domain.Port      `yaml:"ports" json:"ports"`
}

type Plan struct {
	Source    string           `json:"source"`
	Created   []domain.Process `json:"created"`
	Updated   []domain.Process `json:"updated"`
	Removed   []domain.Process `json:"removed"`
	Unchanged []domain.Process `json:"unchanged"`
	DryRun    bool             `json:"dry_run"`
}

func Parse(source string, content []byte) (Manifest, string, error) {
	canonical, err := filepath.Abs(source)
	if err != nil {
		return Manifest{}, "", fmt.Errorf("resolve manifest path: %w", err)
	}
	canonical, err = filepath.EvalSymlinks(canonical)
	if err != nil && !os.IsNotExist(err) {
		return Manifest{}, "", fmt.Errorf("resolve manifest symlinks: %w", err)
	}
	if canonical == "" {
		canonical, _ = filepath.Abs(source)
	}
	var manifest Manifest
	if err := yaml.Unmarshal(content, &manifest); err != nil {
		return Manifest{}, "", fmt.Errorf("parse manifest: %w", err)
	}
	if manifest.Version != 1 {
		return Manifest{}, "", fmt.Errorf("manifest version must be 1")
	}
	if len(manifest.Processes) == 0 {
		return Manifest{}, "", fmt.Errorf("manifest must contain at least one process")
	}
	seenKeys := map[string]struct{}{}
	base := filepath.Dir(canonical)
	for index := range manifest.Processes {
		entry := &manifest.Processes[index]
		if entry.Key == "" {
			return Manifest{}, "", fmt.Errorf("process %d has no key", index+1)
		}
		if _, exists := seenKeys[entry.Key]; exists {
			return Manifest{}, "", fmt.Errorf("duplicate process key %q", entry.Key)
		}
		seenKeys[entry.Key] = struct{}{}
		if !filepath.IsAbs(entry.CWD) {
			entry.CWD = filepath.Join(base, entry.CWD)
		}
		process := domain.Process{
			Label: entry.Label, Kind: entry.Kind, Tags: entry.Tags,
			Command: entry.Command, CWD: entry.CWD, Env: entry.Env, Ports: entry.Ports,
		}
		if _, err := domain.NormalizeProcess(process); err != nil {
			return Manifest{}, "", fmt.Errorf("process %q: %w", entry.Key, err)
		}
	}
	return manifest, canonical, nil
}

func Reconcile(
	ctx context.Context,
	state *store.Store,
	source string,
	manifest Manifest,
	dryRun bool,
) (Plan, error) {
	current, err := state.ProcessesBySource(ctx, source)
	if err != nil {
		return Plan{}, err
	}
	currentByKey := make(map[string]domain.Process, len(current))
	for _, process := range current {
		currentByKey[process.Source.Key] = process
	}
	plan := Plan{Source: source, DryRun: dryRun}
	desiredKeys := map[string]struct{}{}
	for _, entry := range manifest.Processes {
		desiredKeys[entry.Key] = struct{}{}
		process := domain.Process{
			Label: entry.Label, Kind: entry.Kind, Tags: entry.Tags,
			Command: entry.Command, CWD: entry.CWD, Env: entry.Env, Ports: entry.Ports,
			Source: domain.Source{Kind: "manifest", Path: source, Key: entry.Key},
		}
		process, err = domain.NormalizeProcess(process)
		if err != nil {
			return Plan{}, err
		}
		existing, exists := currentByKey[entry.Key]
		existingPortIDs := map[string]string{}
		if exists {
			for _, port := range existing.Ports {
				existingPortIDs[port.Name] = port.ID
			}
		}
		for index := range process.Ports {
			process.Ports[index].ID = existingPortIDs[process.Ports[index].Name]
			if process.Ports[index].ID == "" {
				process.Ports[index].ID, err = ids.New("endpoint")
				if err != nil {
					return Plan{}, err
				}
			}
		}
		if !exists {
			process.ID, err = ids.New("proc")
			if err != nil {
				return Plan{}, err
			}
			if !dryRun {
				process, err = state.CreateProcess(ctx, process)
				if err != nil {
					return Plan{}, err
				}
			}
			plan.Created = append(plan.Created, process)
			continue
		}
		process.ID = existing.ID
		process.State = existing.State
		process.CreatedAt = existing.CreatedAt
		if equalDefinition(existing, process) {
			plan.Unchanged = append(plan.Unchanged, existing)
			continue
		}
		if !dryRun {
			process, err = state.UpdateProcess(ctx, process)
			if err != nil {
				return Plan{}, err
			}
		}
		plan.Updated = append(plan.Updated, process)
	}
	for _, process := range current {
		if _, exists := desiredKeys[process.Source.Key]; exists {
			continue
		}
		if !dryRun {
			if err := state.DeleteProcess(ctx, process.ID); err != nil {
				return Plan{}, err
			}
		}
		plan.Removed = append(plan.Removed, process)
	}
	sort.Slice(plan.Created, func(i, j int) bool { return plan.Created[i].Label < plan.Created[j].Label })
	sort.Slice(plan.Updated, func(i, j int) bool { return plan.Updated[i].Label < plan.Updated[j].Label })
	sort.Slice(plan.Removed, func(i, j int) bool { return plan.Removed[i].Label < plan.Removed[j].Label })
	sort.Slice(plan.Unchanged, func(i, j int) bool { return plan.Unchanged[i].Label < plan.Unchanged[j].Label })
	return plan, nil
}

func equalDefinition(left, right domain.Process) bool {
	return left.Label == right.Label &&
		left.Kind == right.Kind &&
		left.CWD == right.CWD &&
		reflect.DeepEqual(left.Tags, right.Tags) &&
		reflect.DeepEqual(left.Source, right.Source) &&
		reflect.DeepEqual(left.Command, right.Command) &&
		reflect.DeepEqual(left.Env, right.Env) &&
		reflect.DeepEqual(left.Ports, right.Ports)
}
