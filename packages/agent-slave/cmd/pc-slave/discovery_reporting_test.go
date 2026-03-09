package main

import (
	"bytes"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	slavev1 "github.com/josh/project-commander/packages/agent-shared/gen/projectcommander/slave/v1"
)

func writeDiscoveryFixtureFile(t *testing.T, targetPath string, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(targetPath), 0o755); err != nil {
		t.Fatalf("mkdir for %s failed: %v", targetPath, err)
	}
	if err := os.WriteFile(targetPath, []byte(content), 0o644); err != nil {
		t.Fatalf("write %s failed: %v", targetPath, err)
	}
}

func discoveredProjectByPath(projects []*slavev1.DiscoveredProject, expectedPath string) *slavev1.DiscoveredProject {
	normalizedExpected := filepath.Clean(expectedPath)
	for _, project := range projects {
		if project == nil {
			continue
		}
		if filepath.Clean(project.GetPath()) == normalizedExpected {
			return project
		}
	}
	return nil
}

func hasStringValue(values []string, expected string) bool {
	for _, value := range values {
		if strings.TrimSpace(value) == expected {
			return true
		}
	}
	return false
}

func projectPathsSetFromRequest(requestProjects []*slavev1.DiscoveredProject) map[string]struct{} {
	paths := map[string]struct{}{}
	for _, project := range requestProjects {
		if project == nil {
			continue
		}
		paths[filepath.Clean(project.GetPath())] = struct{}{}
	}
	return paths
}

func TestBuildRegisterSlaveRequest_IncludesDiscoveredProjectsFromWatchDirectory(t *testing.T) {
	rootDir := t.TempDir()
	writeDiscoveryFixtureFile(t, filepath.Join(rootDir, "package.json"), `{"name":"root"}`)
	writeDiscoveryFixtureFile(t, filepath.Join(rootDir, "apps", "api", "package.json"), `{"name":"api"}`)

	collector := newDiscoveredProjectsCollector(
		slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{Level: slog.LevelInfo})),
		rootDir,
		time.Hour,
		6,
	)
	discoveredProjects := collector.Collect(true)
	if len(discoveredProjects) == 0 {
		t.Fatalf("expected discovered projects to be reported from watch directory")
	}

	cfg := config{
		SlaveID:        "slave-test",
		HostName:       "test-host",
		SlavePort:      42050,
		MasterEndpoint: "127.0.0.1:50052",
		BootID:         "boot-test",
		StateRoot:      filepath.Join(rootDir, "state"),
		ProcessLogRoot: filepath.Join(rootDir, "logs"),
	}
	request := buildRegisterSlaveRequest(cfg, "register-1", discoveredProjects)
	if request.GetSlaveId() != cfg.SlaveID {
		t.Fatalf("expected slave id %q, got %q", cfg.SlaveID, request.GetSlaveId())
	}
	if len(request.GetDiscoveredProjects()) == 0 {
		t.Fatalf("expected register request to include discovered projects")
	}
	if strings.TrimSpace(request.GetBootId()) == "" {
		t.Fatalf("expected register request to include boot id")
	}
	if strings.TrimSpace(request.GetStateRoot()) == "" {
		t.Fatalf("expected register request to include state root")
	}
	if strings.TrimSpace(request.GetProcessLogRoot()) == "" {
		t.Fatalf("expected register request to include process log root")
	}
	if len(request.GetRuntimeCapabilities()) == 0 {
		t.Fatalf("expected register request to include runtime capabilities")
	}

	for _, project := range request.GetDiscoveredProjects() {
		if project == nil {
			t.Fatalf("expected non-nil discovered project")
		}
		projectPath := filepath.Clean(project.GetPath())
		if !strings.HasPrefix(projectPath, filepath.Clean(rootDir)) {
			t.Fatalf("expected project path %q to be under watch directory %q", projectPath, rootDir)
		}
	}
}

func TestBuildHeartbeatRequest_IncludesFullDiscoveredProjectMetadata(t *testing.T) {
	rootDir := t.TempDir()
	writeDiscoveryFixtureFile(t, filepath.Join(rootDir, "package.json"), `{"name":"root-meta"}`)
	writeDiscoveryFixtureFile(t, filepath.Join(rootDir, "Makefile"), "build:\n\t@echo ok\n")
	if err := os.MkdirAll(filepath.Join(rootDir, "graphql"), 0o755); err != nil {
		t.Fatalf("create graphql directory: %v", err)
	}
	if err := os.MkdirAll(filepath.Join(rootDir, "api"), 0o755); err != nil {
		t.Fatalf("create api directory: %v", err)
	}

	collector := newDiscoveredProjectsCollector(nil, rootDir, time.Hour, 4)
	discoveredProjects := collector.Collect(true)
	if len(discoveredProjects) == 0 {
		t.Fatalf("expected discovered projects to be present")
	}

	cfg := config{
		SlaveID:        "slave-meta",
		HostName:       "meta-host",
		SlavePort:      42051,
		MasterEndpoint: "127.0.0.1:50052",
		BootID:         "boot-meta",
		StateRoot:      filepath.Join(rootDir, "state"),
		ProcessLogRoot: filepath.Join(rootDir, "logs"),
	}
	request := buildHeartbeatRequest(
		cfg,
		"heartbeat-1",
		3,
		discoveredProjects,
		&slavev1.HostTelemetrySample{
			SampledAt:            "2026-03-05T12:00:00Z",
			CpuPercent:           12.5,
			MemoryTotalBytes:     100,
			MemoryUsedBytes:      40,
			MemoryAvailableBytes: 60,
			DiskTotalBytes:       1000,
			DiskUsedBytes:        250,
			DiskAvailableBytes:   750,
			DiskMount:            "/tmp",
		},
		[]*slavev1.ProcessTelemetrySample{
			{
				RunId:         "run-1",
				ProcessKey:    "api",
				Pid:           1234,
				SampledAt:     "2026-03-05T12:00:00Z",
				CpuPercent:    2.5,
				MemoryPercent: 1.25,
				Status:        "running",
			},
		},
		nil,
		nil,
		42,
		time.Date(2026, time.March, 5, 12, 0, 0, 0, time.UTC),
	)

	rootProject := discoveredProjectByPath(request.GetDiscoveredProjects(), rootDir)
	if rootProject == nil {
		t.Fatalf("expected heartbeat to include root project metadata")
	}
	if strings.TrimSpace(rootProject.GetName()) == "" {
		t.Fatalf("expected discovered project name to be set")
	}
	if strings.TrimSpace(rootProject.GetRelativePath()) != "." {
		t.Fatalf("expected root relative path '.', got %q", rootProject.GetRelativePath())
	}
	if !rootProject.GetHasMakefile() {
		t.Fatalf("expected has_makefile to be true")
	}
	if !hasStringValue(rootProject.GetTypes(), "node-project") {
		t.Fatalf("expected node-project type in discovered metadata, got %v", rootProject.GetTypes())
	}
	if !hasStringValue(rootProject.GetServices(), "main") {
		t.Fatalf("expected main service in discovered metadata, got %v", rootProject.GetServices())
	}
	if !hasStringValue(rootProject.GetServices(), "graphql") {
		t.Fatalf("expected graphql service in discovered metadata, got %v", rootProject.GetServices())
	}
	if !hasStringValue(rootProject.GetServices(), "api") {
		t.Fatalf("expected api service in discovered metadata, got %v", rootProject.GetServices())
	}
	if request.GetVersion() != buildVersion {
		t.Fatalf("expected heartbeat version %q, got %q", buildVersion, request.GetVersion())
	}
	if request.GetProtocolVersion() != slaveProtocolVersion {
		t.Fatalf("expected heartbeat protocol version %q, got %q", slaveProtocolVersion, request.GetProtocolVersion())
	}
	if request.GetBootId() != cfg.BootID {
		t.Fatalf("expected heartbeat boot id %q, got %q", cfg.BootID, request.GetBootId())
	}
	if request.GetRuntimeSequence() != 42 {
		t.Fatalf("expected heartbeat runtime sequence 42, got %d", request.GetRuntimeSequence())
	}
	if request.GetHostTelemetry() == nil || request.GetHostTelemetry().GetDiskTotalBytes() != 1000 {
		t.Fatalf("expected heartbeat host telemetry to be included")
	}
	if len(request.GetProcessTelemetry()) != 1 || request.GetProcessTelemetry()[0].GetRunId() != "run-1" {
		t.Fatalf("expected heartbeat process telemetry to be included")
	}
}

func TestDiscoveredProjects_AreReportedWhenFoldersAreAddedAndRemoved(t *testing.T) {
	rootDir := t.TempDir()
	projectOnePath := filepath.Join(rootDir, "one")
	projectTwoPath := filepath.Join(rootDir, "two")
	writeDiscoveryFixtureFile(t, filepath.Join(projectOnePath, "package.json"), `{"name":"one"}`)

	collector := newDiscoveredProjectsCollector(nil, rootDir, time.Hour, 6)
	cfg := config{
		SlaveID:        "slave-reporting",
		HostName:       "reporting-host",
		SlavePort:      42052,
		MasterEndpoint: "127.0.0.1:50052",
		BootID:         "boot-reporting",
		StateRoot:      filepath.Join(rootDir, "state"),
		ProcessLogRoot: filepath.Join(rootDir, "logs"),
	}

	initialHeartbeat := buildHeartbeatRequest(cfg, "heartbeat-initial", 0, collector.Collect(true), nil, nil, nil, nil, 0, time.Now().UTC())
	initialPaths := projectPathsSetFromRequest(initialHeartbeat.GetDiscoveredProjects())
	if _, exists := initialPaths[filepath.Clean(projectOnePath)]; !exists {
		t.Fatalf("expected initial heartbeat to include project %q", projectOnePath)
	}
	if _, exists := initialPaths[filepath.Clean(projectTwoPath)]; exists {
		t.Fatalf("did not expect initial heartbeat to include project %q", projectTwoPath)
	}

	writeDiscoveryFixtureFile(t, filepath.Join(projectTwoPath, "package.json"), `{"name":"two"}`)
	addedHeartbeat := buildHeartbeatRequest(cfg, "heartbeat-added", 0, collector.Collect(true), nil, nil, nil, nil, 0, time.Now().UTC())
	addedPaths := projectPathsSetFromRequest(addedHeartbeat.GetDiscoveredProjects())
	if _, exists := addedPaths[filepath.Clean(projectTwoPath)]; !exists {
		t.Fatalf("expected heartbeat to include newly added project %q", projectTwoPath)
	}

	if err := os.RemoveAll(projectOnePath); err != nil {
		t.Fatalf("remove project one path failed: %v", err)
	}
	removedHeartbeat := buildHeartbeatRequest(cfg, "heartbeat-removed", 0, collector.Collect(true), nil, nil, nil, nil, 0, time.Now().UTC())
	removedPaths := projectPathsSetFromRequest(removedHeartbeat.GetDiscoveredProjects())
	if _, exists := removedPaths[filepath.Clean(projectOnePath)]; exists {
		t.Fatalf("expected heartbeat to exclude removed project %q", projectOnePath)
	}
}

func TestDiscoveredProjectsCollector_LogsChangesWithoutUnchangedSpam(t *testing.T) {
	rootDir := t.TempDir()
	projectOnePath := filepath.Join(rootDir, "one")
	projectTwoPath := filepath.Join(rootDir, "two")
	writeDiscoveryFixtureFile(t, filepath.Join(projectOnePath, "package.json"), `{"name":"one"}`)

	var logBuffer bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&logBuffer, &slog.HandlerOptions{Level: slog.LevelInfo}))
	collector := newDiscoveredProjectsCollector(logger, rootDir, time.Hour, 6)

	collector.Collect(true)
	collector.Collect(true)
	collector.Collect(true)

	writeDiscoveryFixtureFile(t, filepath.Join(projectTwoPath, "package.json"), `{"name":"two"}`)
	collector.Collect(true)
	collector.Collect(true)

	if err := os.RemoveAll(projectTwoPath); err != nil {
		t.Fatalf("remove project two path failed: %v", err)
	}
	collector.Collect(true)
	collector.Collect(true)

	logOutput := logBuffer.String()
	changeLogCount := strings.Count(logOutput, "slave project discovery changed")
	if changeLogCount != 3 {
		t.Fatalf("expected exactly 3 change logs (initial/add/remove), got %d\nlogs:\n%s", changeLogCount, logOutput)
	}
}

func TestDiscoveredProjectsCollector_LogsStartupDiscoveryWhenNoProjectsFound(t *testing.T) {
	rootDir := t.TempDir()

	var logBuffer bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&logBuffer, &slog.HandlerOptions{Level: slog.LevelInfo}))
	collector := newDiscoveredProjectsCollector(logger, rootDir, time.Hour, 6)

	discoveredProjects := collector.Collect(true)
	if len(discoveredProjects) != 0 {
		t.Fatalf("expected no discovered projects for empty root, got %d", len(discoveredProjects))
	}

	logOutput := logBuffer.String()
	if !strings.Contains(logOutput, "slave startup project discovery found no projects") {
		t.Fatalf("expected startup no-projects log, got logs:\n%s", logOutput)
	}
}

func TestDiscoveredProjectsCollector_LogsStartupDiscoveryWhenProjectsFound(t *testing.T) {
	rootDir := t.TempDir()
	writeDiscoveryFixtureFile(t, filepath.Join(rootDir, "package.json"), `{"name":"root"}`)
	writeDiscoveryFixtureFile(t, filepath.Join(rootDir, "apps", "api", "package.json"), `{"name":"api"}`)

	var logBuffer bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&logBuffer, &slog.HandlerOptions{Level: slog.LevelInfo}))
	collector := newDiscoveredProjectsCollector(logger, rootDir, time.Hour, 6)

	discoveredProjects := collector.Collect(true)
	if len(discoveredProjects) == 0 {
		t.Fatalf("expected discovered projects to be present")
	}

	logOutput := logBuffer.String()
	if !strings.Contains(logOutput, "slave startup project discovery found projects") {
		t.Fatalf("expected startup projects-found log, got logs:\n%s", logOutput)
	}
}

func TestDiscoveredProjectsCollector_RefreshesOnTopLevelDirectoryCreation(t *testing.T) {
	rootDir := t.TempDir()
	existingProjectPath := filepath.Join(rootDir, "one")
	newProjectPath := filepath.Join(rootDir, "two")
	writeDiscoveryFixtureFile(t, filepath.Join(existingProjectPath, "package.json"), `{"name":"one"}`)

	var logBuffer bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&logBuffer, &slog.HandlerOptions{Level: slog.LevelInfo}))
	collector := newDiscoveredProjectsCollector(logger, rootDir, time.Hour, 6)

	initial := collector.Collect(true)
	if discoveredProjectByPath(initial, existingProjectPath) == nil {
		t.Fatalf("expected initial discovery to include %q", existingProjectPath)
	}
	if discoveredProjectByPath(initial, newProjectPath) != nil {
		t.Fatalf("did not expect initial discovery to include %q", newProjectPath)
	}

	writeDiscoveryFixtureFile(t, filepath.Join(newProjectPath, "package.json"), `{"name":"two"}`)

	updated := collector.Collect(false)
	if discoveredProjectByPath(updated, newProjectPath) == nil {
		t.Fatalf("expected discovery refresh to include newly created top-level project %q", newProjectPath)
	}

	logOutput := logBuffer.String()
	if !strings.Contains(logOutput, "slave discovery top-level directories changed") {
		t.Fatalf("expected top-level directory watch log, got logs:\n%s", logOutput)
	}
	if !strings.Contains(logOutput, "slave new project detected") {
		t.Fatalf("expected new project detected log, got logs:\n%s", logOutput)
	}
}

func TestDiscoveredProjectsCollector_TopLevelWatchDepthOneIgnoresNestedDirectoryCreationEvenOnRefresh(t *testing.T) {
	rootDir := t.TempDir()
	existingProjectPath := filepath.Join(rootDir, "workspace")
	nestedProjectPath := filepath.Join(existingProjectPath, "nested-project")
	writeDiscoveryFixtureFile(t, filepath.Join(existingProjectPath, "package.json"), `{"name":"workspace"}`)

	var logBuffer bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&logBuffer, &slog.HandlerOptions{Level: slog.LevelInfo}))
	collector := newDiscoveredProjectsCollector(logger, rootDir, time.Hour, 6)

	initial := collector.Collect(true)
	if discoveredProjectByPath(initial, existingProjectPath) == nil {
		t.Fatalf("expected initial discovery to include %q", existingProjectPath)
	}
	if discoveredProjectByPath(initial, nestedProjectPath) != nil {
		t.Fatalf("did not expect initial discovery to include nested project %q", nestedProjectPath)
	}

	writeDiscoveryFixtureFile(t, filepath.Join(nestedProjectPath, "package.json"), `{"name":"nested"}`)

	unchanged := collector.Collect(false)
	if discoveredProjectByPath(unchanged, nestedProjectPath) != nil {
		t.Fatalf("did not expect nested project %q to be discovered from a grandchild directory", nestedProjectPath)
	}

	refreshed := collector.Collect(true)
	if discoveredProjectByPath(refreshed, nestedProjectPath) != nil {
		t.Fatalf("did not expect forced discovery refresh to include nested project %q", nestedProjectPath)
	}
}

func TestDiscoveredProjectsCollector_DoesNotRescanWithoutDirectoryChanges(t *testing.T) {
	rootDir := t.TempDir()
	workspaceDir := filepath.Join(rootDir, "workspace")
	if err := os.MkdirAll(workspaceDir, 0o755); err != nil {
		t.Fatalf("create workspace directory failed: %v", err)
	}

	collector := newDiscoveredProjectsCollector(nil, rootDir, time.Millisecond, 6)
	initial := collector.Collect(true)
	if discoveredProjectByPath(initial, workspaceDir) != nil {
		t.Fatalf("did not expect workspace to be discovered before marker files exist")
	}

	// File-only change inside an existing directory must not trigger a refresh.
	writeDiscoveryFixtureFile(t, filepath.Join(workspaceDir, "package.json"), `{"name":"workspace"}`)

	time.Sleep(10 * time.Millisecond)
	unchanged := collector.Collect(false)
	if discoveredProjectByPath(unchanged, workspaceDir) != nil {
		t.Fatalf("expected cached discovery result without directory change; got %q", workspaceDir)
	}

	refreshed := collector.Collect(true)
	if discoveredProjectByPath(refreshed, workspaceDir) == nil {
		t.Fatalf("expected forced discovery refresh to include %q", workspaceDir)
	}
}

func TestDiscoveredProjectsCollector_RefreshesOnTopLevelDirectoryRemoval(t *testing.T) {
	rootDir := t.TempDir()
	projectOnePath := filepath.Join(rootDir, "one")
	projectTwoPath := filepath.Join(rootDir, "two")
	writeDiscoveryFixtureFile(t, filepath.Join(projectOnePath, "package.json"), `{"name":"one"}`)
	writeDiscoveryFixtureFile(t, filepath.Join(projectTwoPath, "package.json"), `{"name":"two"}`)

	collector := newDiscoveredProjectsCollector(nil, rootDir, time.Hour, 6)
	initial := collector.Collect(true)
	if discoveredProjectByPath(initial, projectOnePath) == nil || discoveredProjectByPath(initial, projectTwoPath) == nil {
		t.Fatalf("expected initial discovery to include both projects")
	}

	if err := os.RemoveAll(projectTwoPath); err != nil {
		t.Fatalf("remove top-level project directory failed: %v", err)
	}

	updated := collector.Collect(false)
	if discoveredProjectByPath(updated, projectTwoPath) != nil {
		t.Fatalf("expected discovery refresh to remove deleted top-level project %q", projectTwoPath)
	}
	if discoveredProjectByPath(updated, projectOnePath) == nil {
		t.Fatalf("expected unaffected project %q to remain discovered", projectOnePath)
	}
}
