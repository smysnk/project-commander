package main

import (
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	slavev1 "github.com/josh/project-commander/packages/agent-shared/gen/projectcommander/slave/v1"
)

var defaultSlaveCapabilities = []string{
	"slave.register",
	"slave.heartbeat",
	"slave.watch.packages",
	"slave.restart.on_change",
	"slave.discover.projects",
	"slave.checkout.project",
}

var defaultSlaveRuntimeCapabilities = []string{
	"slave.runtime.desired_processes",
	"slave.runtime.reconcile",
	"slave.runtime.kill",
	"slave.runtime.file_logs",
}

type discoveredProjectsCollector struct {
	logger            *slog.Logger
	projectPath       string
	discoveryInterval time.Duration
	discoveryMaxDepth int

	mu            sync.Mutex
	cached        []*slavev1.DiscoveredProject
	hasScanned    bool
	lastRefreshAt time.Time
	lastSignature string
	lastTopLevel  map[string]struct{}
}

func newDiscoveredProjectsCollector(
	logger *slog.Logger,
	projectPath string,
	discoveryInterval time.Duration,
	discoveryMaxDepth int,
) *discoveredProjectsCollector {
	normalizedDepth := discoveryMaxDepth
	if normalizedDepth < 0 || normalizedDepth > defaultDiscoveryMaxDepth {
		normalizedDepth = defaultDiscoveryMaxDepth
	}
	return &discoveredProjectsCollector{
		logger:            logger,
		projectPath:       strings.TrimSpace(projectPath),
		discoveryInterval: discoveryInterval,
		discoveryMaxDepth: normalizedDepth,
	}
}

func (collector *discoveredProjectsCollector) Collect(force bool) []*slavev1.DiscoveredProject {
	if collector == nil || strings.TrimSpace(collector.projectPath) == "" {
		return []*slavev1.DiscoveredProject{}
	}

	collector.mu.Lock()
	defer collector.mu.Unlock()

	topLevelAdded, topLevelRemoved, topLevelChanged := collector.detectTopLevelDirectoryChangesLocked()
	if topLevelChanged && collector.logger != nil {
		logArgs := []any{
			"project_path", collector.projectPath,
			"watch_depth", 1,
			"added_directories", len(topLevelAdded),
			"removed_directories", len(topLevelRemoved),
		}
		if len(topLevelAdded) > 0 {
			logArgs = append(logArgs, "added_directory_paths", summarizeDiscoveryPaths(topLevelAdded))
		}
		if len(topLevelRemoved) > 0 {
			logArgs = append(logArgs, "removed_directory_paths", summarizeDiscoveryPaths(topLevelRemoved))
		}
		collector.logger.Info("slave discovery top-level directories changed", logArgs...)
	}

	now := time.Now().UTC()
	shouldRefresh := force ||
		!collector.hasScanned ||
		topLevelChanged
	if !shouldRefresh {
		return cloneDiscoveredProjects(collector.cached)
	}

	discoveredProjects, discoveryErr := scanDiscoveredProjects(
		collector.projectPath,
		collector.discoveryMaxDepth,
	)
	if discoveryErr != nil {
		if collector.logger != nil {
			collector.logger.Warn(
				"slave project discovery failed",
				"project_path",
				collector.projectPath,
				"error",
				discoveryErr.Error(),
			)
		}
		return cloneDiscoveredProjects(collector.cached)
	}

	addedPaths, removedPaths := diffDiscoveredProjectPaths(collector.cached, discoveredProjects)
	nextSignature := discoveredProjectsSignature(discoveredProjects)
	isInitialDiscoveryScan := !collector.hasScanned
	if isInitialDiscoveryScan && collector.logger != nil {
		if len(discoveredProjects) == 0 {
			collector.logger.Info(
				"slave startup project discovery found no projects",
				"project_path",
				collector.projectPath,
				"watch_depth",
				collector.discoveryMaxDepth,
			)
		} else {
			collector.logger.Info(
				"slave startup project discovery found projects",
				"project_path",
				collector.projectPath,
				"watch_depth",
				collector.discoveryMaxDepth,
				"total_projects",
				len(discoveredProjects),
				"project_paths",
				summarizeDiscoveryPaths(extractDiscoveredProjectPaths(discoveredProjects)),
			)
		}
	}
	if nextSignature != collector.lastSignature && collector.logger != nil {
		logArgs := []any{
			"project_path", collector.projectPath,
			"total_projects", len(discoveredProjects),
			"added", len(addedPaths),
			"removed", len(removedPaths),
		}
		if len(addedPaths) > 0 {
			logArgs = append(logArgs, "added_paths", summarizeDiscoveryPaths(addedPaths))
		}
		if len(removedPaths) > 0 {
			logArgs = append(logArgs, "removed_paths", summarizeDiscoveryPaths(removedPaths))
		}
		collector.logger.Info("slave project discovery changed", logArgs...)
		if !isInitialDiscoveryScan && len(addedPaths) > 0 {
			collector.logger.Info(
				"slave new project detected",
				"project_path",
				collector.projectPath,
				"new_projects",
				len(addedPaths),
				"new_project_paths",
				summarizeDiscoveryPaths(addedPaths),
			)
		}
	}

	collector.cached = discoveredProjects
	collector.hasScanned = true
	collector.lastRefreshAt = now
	collector.lastSignature = nextSignature
	return cloneDiscoveredProjects(collector.cached)
}

func (collector *discoveredProjectsCollector) detectTopLevelDirectoryChangesLocked() ([]string, []string, bool) {
	currentTopLevel, err := listDiscoveryTopLevelDirectories(collector.projectPath)
	if err != nil {
		if collector.logger != nil {
			collector.logger.Warn(
				"slave discovery top-level watch failed",
				"project_path",
				collector.projectPath,
				"error",
				err.Error(),
			)
		}
		return nil, nil, false
	}

	currentSet := stringSetFromSlice(currentTopLevel)
	if collector.lastTopLevel == nil {
		collector.lastTopLevel = currentSet
		return nil, nil, false
	}

	added, removed := diffStringSets(collector.lastTopLevel, currentSet)
	collector.lastTopLevel = currentSet
	if len(added) == 0 && len(removed) == 0 {
		return nil, nil, false
	}
	return added, removed, true
}

func buildRegisterSlaveRequest(
	cfg config,
	requestID string,
	discoveredProjects []*slavev1.DiscoveredProject,
) *slavev1.RegisterSlaveRequest {
	return &slavev1.RegisterSlaveRequest{
		RequestId: requestID,
		SlaveId:   cfg.SlaveID,
		HostName:  cfg.HostName,
		Capabilities: append(
			[]string{},
			defaultSlaveCapabilities...,
		),
		Port:               cfg.SlavePort,
		DiscoveredProjects: cloneDiscoveredProjects(discoveredProjects),
		Version:            buildVersion,
		ProtocolVersion:    slaveProtocolVersion,
		BootId:             cfg.BootID,
		AgentStartedAt:     cfg.AgentStartedAt,
		ProcessLogRoot:     cfg.ProcessLogRoot,
		StateRoot:          cfg.StateRoot,
		RuntimeCapabilities: append(
			[]string{},
			defaultSlaveRuntimeCapabilities...,
		),
	}
}

func buildHeartbeatRequest(
	cfg config,
	requestID string,
	runningServices int32,
	discoveredProjects []*slavev1.DiscoveredProject,
	hostTelemetry *slavev1.HostTelemetrySample,
	processTelemetry []*slavev1.ProcessTelemetrySample,
	observedRuns []*slavev1.ObservedProcessRun,
	processLogChunks []*slavev1.ProcessLogChunk,
	runtimeSequence int64,
	now time.Time,
) *slavev1.HeartbeatRequest {
	timestamp := now
	if timestamp.IsZero() {
		timestamp = time.Now().UTC()
	}
	return &slavev1.HeartbeatRequest{
		RequestId:          requestID,
		SlaveId:            cfg.SlaveID,
		RunningServices:    runningServices,
		CpuPercent:         0,
		MemoryPercent:      0,
		Timestamp:          timestamp.UTC().Format(time.RFC3339Nano),
		DiscoveredProjects: cloneDiscoveredProjects(discoveredProjects),
		Version:            buildVersion,
		ProtocolVersion:    slaveProtocolVersion,
		BootId:             cfg.BootID,
		HostTelemetry:      cloneHostTelemetrySample(hostTelemetry),
		ProcessTelemetry:   cloneProcessTelemetrySamples(processTelemetry),
		ObservedRuns:       cloneObservedRuns(observedRuns),
		ProcessLogChunks:   cloneProcessLogChunks(processLogChunks),
		RuntimeSequence:    runtimeSequence,
	}
}

func cloneObservedRuns(input []*slavev1.ObservedProcessRun) []*slavev1.ObservedProcessRun {
	cloned := make([]*slavev1.ObservedProcessRun, 0, len(input))
	for _, run := range input {
		if run == nil {
			continue
		}
		cloned = append(cloned, cloneObservedProcessRun(run))
	}
	return cloned
}

func cloneHostTelemetrySample(input *slavev1.HostTelemetrySample) *slavev1.HostTelemetrySample {
	if input == nil {
		return nil
	}
	return &slavev1.HostTelemetrySample{
		SampledAt:            strings.TrimSpace(input.GetSampledAt()),
		CpuPercent:           input.GetCpuPercent(),
		Load_1M:              input.GetLoad_1M(),
		Load_5M:              input.GetLoad_5M(),
		Load_15M:             input.GetLoad_15M(),
		MemoryTotalBytes:     input.GetMemoryTotalBytes(),
		MemoryUsedBytes:      input.GetMemoryUsedBytes(),
		MemoryAvailableBytes: input.GetMemoryAvailableBytes(),
		DiskTotalBytes:       input.GetDiskTotalBytes(),
		DiskUsedBytes:        input.GetDiskUsedBytes(),
		DiskAvailableBytes:   input.GetDiskAvailableBytes(),
		DiskMount:            strings.TrimSpace(input.GetDiskMount()),
	}
}

func cloneProcessTelemetrySamples(input []*slavev1.ProcessTelemetrySample) []*slavev1.ProcessTelemetrySample {
	cloned := make([]*slavev1.ProcessTelemetrySample, 0, len(input))
	for _, sample := range input {
		if sample == nil {
			continue
		}
		cloned = append(cloned, &slavev1.ProcessTelemetrySample{
			RunId:         strings.TrimSpace(sample.GetRunId()),
			ProcessKey:    strings.TrimSpace(sample.GetProcessKey()),
			Pid:           sample.GetPid(),
			SampledAt:     strings.TrimSpace(sample.GetSampledAt()),
			CpuPercent:    sample.GetCpuPercent(),
			MemoryPercent: sample.GetMemoryPercent(),
			RssBytes:      sample.GetRssBytes(),
			VmsBytes:      sample.GetVmsBytes(),
			ReadBytes:     sample.GetReadBytes(),
			WriteBytes:    sample.GetWriteBytes(),
			ReadOps:       sample.GetReadOps(),
			WriteOps:      sample.GetWriteOps(),
			OpenFds:       sample.GetOpenFds(),
			ThreadCount:   sample.GetThreadCount(),
			Status:        strings.TrimSpace(sample.GetStatus()),
		})
	}
	return cloned
}

func cloneProcessLogChunks(input []*slavev1.ProcessLogChunk) []*slavev1.ProcessLogChunk {
	cloned := make([]*slavev1.ProcessLogChunk, 0, len(input))
	for _, chunk := range input {
		if chunk == nil {
			continue
		}
		runID := strings.TrimSpace(chunk.GetRunId())
		logPath := strings.TrimSpace(chunk.GetLogPath())
		if runID == "" || logPath == "" {
			continue
		}
		lines := make([]string, 0, len(chunk.GetLines()))
		for _, line := range chunk.GetLines() {
			if strings.TrimSpace(line) == "" {
				continue
			}
			lines = append(lines, line)
		}
		if len(lines) == 0 {
			continue
		}
		cloned = append(cloned, &slavev1.ProcessLogChunk{
			RunId:      runID,
			ProcessKey: strings.TrimSpace(chunk.GetProcessKey()),
			PackageKey: strings.TrimSpace(chunk.GetPackageKey()),
			LogPath:    logPath,
			SampledAt:  strings.TrimSpace(chunk.GetSampledAt()),
			Stream:     normalizeProcessLogStream(chunk.GetStream()),
			Lines:      lines,
		})
	}
	return cloned
}

func discoveredProjectsSignature(projects []*slavev1.DiscoveredProject) string {
	encoded := make([]string, 0, len(projects))
	for _, project := range projects {
		if project == nil {
			continue
		}
		pathValue := filepathCleanTrimmed(project.GetPath())
		if pathValue == "" {
			continue
		}
		encoded = append(encoded, encodeDiscoveredProjectSignature(project, pathValue))
	}
	sort.Strings(encoded)
	return strings.Join(encoded, "\n")
}

func encodeDiscoveredProjectSignature(project *slavev1.DiscoveredProject, normalizedPath string) string {
	types := normalizeSortedStringList(project.GetTypes())
	services := normalizeSortedStringList(project.GetServices())
	return fmt.Sprintf(
		"%s|%s|%s|%t|%s|%s",
		normalizedPath,
		strings.TrimSpace(project.GetName()),
		strings.TrimSpace(project.GetRelativePath()),
		project.GetHasMakefile(),
		strings.Join(types, ","),
		strings.Join(services, ","),
	)
}

func diffDiscoveredProjectPaths(
	previous []*slavev1.DiscoveredProject,
	current []*slavev1.DiscoveredProject,
) ([]string, []string) {
	previousSet := discoveredProjectPathSet(previous)
	currentSet := discoveredProjectPathSet(current)

	added := make([]string, 0)
	for pathValue := range currentSet {
		if _, exists := previousSet[pathValue]; exists {
			continue
		}
		added = append(added, pathValue)
	}

	removed := make([]string, 0)
	for pathValue := range previousSet {
		if _, exists := currentSet[pathValue]; exists {
			continue
		}
		removed = append(removed, pathValue)
	}

	sort.Strings(added)
	sort.Strings(removed)
	return added, removed
}

func discoveredProjectPathSet(projects []*slavev1.DiscoveredProject) map[string]struct{} {
	paths := map[string]struct{}{}
	for _, project := range projects {
		if project == nil {
			continue
		}
		pathValue := filepathCleanTrimmed(project.GetPath())
		if pathValue == "" {
			continue
		}
		paths[pathValue] = struct{}{}
	}
	return paths
}

func summarizeDiscoveryPaths(paths []string) string {
	const maxPaths = 6
	if len(paths) <= maxPaths {
		return strings.Join(paths, ",")
	}
	visible := append([]string{}, paths[:maxPaths]...)
	return fmt.Sprintf("%s (+%d more)", strings.Join(visible, ","), len(paths)-maxPaths)
}

func normalizeSortedStringList(values []string) []string {
	seen := map[string]struct{}{}
	next := make([]string, 0, len(values))
	for _, value := range values {
		normalized := strings.TrimSpace(value)
		if normalized == "" {
			continue
		}
		if _, exists := seen[normalized]; exists {
			continue
		}
		seen[normalized] = struct{}{}
		next = append(next, normalized)
	}
	sort.Strings(next)
	return next
}

func filepathCleanTrimmed(rawPath string) string {
	trimmed := strings.TrimSpace(rawPath)
	if trimmed == "" {
		return ""
	}
	return strings.TrimSpace(filepath.ToSlash(filepath.Clean(trimmed)))
}

func listDiscoveryTopLevelDirectories(rootPath string) ([]string, error) {
	normalizedRoot := strings.TrimSpace(rootPath)
	if normalizedRoot == "" {
		return []string{}, nil
	}

	entries, err := os.ReadDir(normalizedRoot)
	if err != nil {
		return nil, err
	}

	directories := make([]string, 0, len(entries))
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		if entry.Type()&os.ModeSymlink != 0 {
			continue
		}
		name := strings.TrimSpace(entry.Name())
		if name == "" {
			continue
		}
		if _, ignored := ignoredDiscoveryDirectories[name]; ignored {
			continue
		}
		directories = append(directories, filepathCleanTrimmed(filepath.Join(normalizedRoot, name)))
	}
	sort.Strings(directories)
	return directories, nil
}

func stringSetFromSlice(values []string) map[string]struct{} {
	set := map[string]struct{}{}
	for _, value := range values {
		normalized := filepathCleanTrimmed(value)
		if normalized == "" {
			continue
		}
		set[normalized] = struct{}{}
	}
	return set
}

func diffStringSets(previous map[string]struct{}, current map[string]struct{}) ([]string, []string) {
	added := make([]string, 0)
	for value := range current {
		if _, exists := previous[value]; exists {
			continue
		}
		added = append(added, value)
	}

	removed := make([]string, 0)
	for value := range previous {
		if _, exists := current[value]; exists {
			continue
		}
		removed = append(removed, value)
	}

	sort.Strings(added)
	sort.Strings(removed)
	return added, removed
}

func extractDiscoveredProjectPaths(projects []*slavev1.DiscoveredProject) []string {
	paths := make([]string, 0, len(projects))
	for _, project := range projects {
		if project == nil {
			continue
		}
		pathValue := filepathCleanTrimmed(project.GetPath())
		if pathValue == "" {
			continue
		}
		paths = append(paths, pathValue)
	}
	sort.Strings(paths)
	return paths
}
