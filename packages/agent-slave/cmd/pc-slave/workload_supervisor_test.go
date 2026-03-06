package main

import (
	"context"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func writeFile(t *testing.T, targetPath string, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(targetPath), 0o755); err != nil {
		t.Fatalf("mkdir for %s failed: %v", targetPath, err)
	}
	if err := os.WriteFile(targetPath, []byte(content), 0o644); err != nil {
		t.Fatalf("write %s failed: %v", targetPath, err)
	}
}

func appendFile(t *testing.T, targetPath string, content string) {
	t.Helper()
	file, err := os.OpenFile(targetPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		t.Fatalf("open %s failed: %v", targetPath, err)
	}
	defer file.Close()
	if _, err := file.WriteString(content); err != nil {
		t.Fatalf("append %s failed: %v", targetPath, err)
	}
}

func readLineCount(targetPath string) int {
	raw, err := os.ReadFile(targetPath)
	if err != nil {
		return 0
	}
	trimmed := strings.TrimSpace(string(raw))
	if trimmed == "" {
		return 0
	}
	return len(strings.Split(trimmed, "\n"))
}

func waitForCondition(timeout time.Duration, checkFn func() bool) bool {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if checkFn() {
			return true
		}
		time.Sleep(25 * time.Millisecond)
	}
	return checkFn()
}

func TestResolveConfig_DefaultLaunchCommandUsesYarnDev(t *testing.T) {
	t.Setenv("PC_SLAVE_PROJECT_PATH", "")
	t.Setenv("PC_SLAVE_DEFAULT_PROJECT_PATH", "")
	t.Setenv("PC_SLAVE_LAUNCH_COMMAND", "")
	t.Setenv("PC_SLAVE_WATCH_INTERVAL", "")

	cfg, err := resolveConfig("", "", -1, "", 0, "", "", 0, "")
	if err != nil {
		t.Fatalf("resolveConfig returned error: %v", err)
	}
	if cfg.LaunchCommand != defaultWorkloadLaunchCommand {
		t.Fatalf("expected launch command %q, got %q", defaultWorkloadLaunchCommand, cfg.LaunchCommand)
	}
	if cfg.WatchInterval <= 0 {
		t.Fatalf("expected positive watch interval, got %s", cfg.WatchInterval)
	}
	if cfg.HeartbeatInterval != time.Second {
		t.Fatalf("expected heartbeat interval to be fixed at 1s, got %s", cfg.HeartbeatInterval)
	}
}

func TestResolveConfig_HeartbeatIntervalIsFixedToOneSecond(t *testing.T) {
	t.Setenv("PC_SLAVE_PROJECT_PATH", "")
	t.Setenv("PC_SLAVE_DEFAULT_PROJECT_PATH", "")
	t.Setenv("PC_HEARTBEAT_INTERVAL", "5s")

	cfgFromEnv, err := resolveConfig("", "", -1, "", 0, "", "", 0, "")
	if err != nil {
		t.Fatalf("resolveConfig with env heartbeat returned error: %v", err)
	}
	if cfgFromEnv.HeartbeatInterval != time.Second {
		t.Fatalf("expected env-configured heartbeat to be clamped to 1s, got %s", cfgFromEnv.HeartbeatInterval)
	}

	cfgFromFlag, err := resolveConfig("", "", -1, "", 250*time.Millisecond, "", "", 0, "")
	if err != nil {
		t.Fatalf("resolveConfig with flag heartbeat returned error: %v", err)
	}
	if cfgFromFlag.HeartbeatInterval != time.Second {
		t.Fatalf("expected flag-configured heartbeat to be clamped to 1s, got %s", cfgFromFlag.HeartbeatInterval)
	}
}

func TestResolveHeartbeatUserName_PrefersConfiguredOverride(t *testing.T) {
	t.Setenv("PC_SLAVE_USER", "josh")
	t.Setenv("USER", "fallback-user")
	t.Setenv("LOGNAME", "fallback-logname")
	t.Setenv("USERNAME", "fallback-username")

	resolved := resolveHeartbeatUserName()
	if resolved != "josh" {
		t.Fatalf("expected PC_SLAVE_USER to be preferred, got %q", resolved)
	}
}

func TestResolveHeartbeatUserName_UsesEnvironmentFallbacks(t *testing.T) {
	t.Setenv("PC_SLAVE_USER", "")
	t.Setenv("USER", "")
	t.Setenv("LOGNAME", "josh-logname")
	t.Setenv("USERNAME", "josh-username")

	resolved := resolveHeartbeatUserName()
	if resolved != "josh-logname" {
		t.Fatalf("expected LOGNAME fallback, got %q", resolved)
	}

	t.Setenv("LOGNAME", "")
	resolved = resolveHeartbeatUserName()
	if resolved != "josh-username" {
		t.Fatalf("expected USERNAME fallback, got %q", resolved)
	}
}

func TestResolveConfig_UsesSharedDefaultProjectPathWhenProjectPathUnset(t *testing.T) {
	defaultProjectPath := filepath.Join(t.TempDir(), "shared-projects")
	t.Setenv("PC_SLAVE_PROJECT_PATH", "")
	t.Setenv("PC_SLAVE_DEFAULT_PROJECT_PATH", defaultProjectPath)

	cfg, err := resolveConfig("", "", -1, "", 0, "", "", 0, "")
	if err != nil {
		t.Fatalf("resolveConfig returned error: %v", err)
	}

	expectedPath := filepath.Clean(defaultProjectPath)
	if cfg.ProjectPath != expectedPath {
		t.Fatalf("expected default project path %q, got %q", expectedPath, cfg.ProjectPath)
	}
}

func TestResolveConfig_FallsBackToHomePlayWhenNoProjectPathConfigured(t *testing.T) {
	homeDir := filepath.Join(t.TempDir(), "home")
	if err := os.MkdirAll(homeDir, 0o755); err != nil {
		t.Fatalf("mkdir home dir failed: %v", err)
	}

	t.Setenv("HOME", homeDir)
	t.Setenv("PC_SLAVE_PROJECT_PATH", "")
	t.Setenv("PC_SLAVE_DEFAULT_PROJECT_PATH", "")

	cfg, err := resolveConfig("", "", -1, "", 0, "", "", 0, "")
	if err != nil {
		t.Fatalf("resolveConfig returned error: %v", err)
	}

	expectedPath := filepath.Clean(filepath.Join(homeDir, "play"))
	if cfg.ProjectPath != expectedPath {
		t.Fatalf("expected fallback project path %q, got %q", expectedPath, cfg.ProjectPath)
	}
}

func TestResolveConfig_ExpandsTildeInProjectPath(t *testing.T) {
	homeDir := filepath.Join(t.TempDir(), "home")
	if err := os.MkdirAll(homeDir, 0o755); err != nil {
		t.Fatalf("mkdir home dir failed: %v", err)
	}

	t.Setenv("HOME", homeDir)
	t.Setenv("PC_SLAVE_PROJECT_PATH", "")
	t.Setenv("PC_SLAVE_DEFAULT_PROJECT_PATH", "~/shared-projects")

	cfg, err := resolveConfig("", "", -1, "", 0, "", "", 0, "")
	if err != nil {
		t.Fatalf("resolveConfig returned error: %v", err)
	}

	expectedPath := filepath.Clean(filepath.Join(homeDir, "shared-projects"))
	if cfg.ProjectPath != expectedPath {
		t.Fatalf("expected tilde-expanded path %q, got %q", expectedPath, cfg.ProjectPath)
	}
}

func TestResolveConfig_ProjectPathOverridesSharedDefaultProjectPath(t *testing.T) {
	projectPath := filepath.Join(t.TempDir(), "host-projects")
	defaultProjectPath := filepath.Join(t.TempDir(), "shared-projects")
	t.Setenv("PC_SLAVE_PROJECT_PATH", projectPath)
	t.Setenv("PC_SLAVE_DEFAULT_PROJECT_PATH", defaultProjectPath)

	cfg, err := resolveConfig("", "", -1, "", 0, "", "", 0, "")
	if err != nil {
		t.Fatalf("resolveConfig returned error: %v", err)
	}

	expectedPath := filepath.Clean(projectPath)
	if cfg.ProjectPath != expectedPath {
		t.Fatalf("expected project path %q to override shared default, got %q", expectedPath, cfg.ProjectPath)
	}
}

func TestEnsureProjectPathExists_CreatesMissingDirectory(t *testing.T) {
	targetPath := filepath.Join(t.TempDir(), "shared", "projects")

	created, err := ensureProjectPathExists(targetPath)
	if err != nil {
		t.Fatalf("ensureProjectPathExists returned error: %v", err)
	}
	if !created {
		t.Fatalf("expected ensureProjectPathExists to create directory")
	}

	info, statErr := os.Stat(targetPath)
	if statErr != nil {
		t.Fatalf("expected created project path to exist: %v", statErr)
	}
	if !info.IsDir() {
		t.Fatalf("expected created path %q to be a directory", targetPath)
	}

	createdAgain, err := ensureProjectPathExists(targetPath)
	if err != nil {
		t.Fatalf("ensureProjectPathExists returned error on existing dir: %v", err)
	}
	if createdAgain {
		t.Fatalf("expected ensureProjectPathExists to report no creation for existing directory")
	}
}

func TestEnsureProjectPathExists_ReturnsErrorForFilePath(t *testing.T) {
	targetPath := filepath.Join(t.TempDir(), "project.txt")
	writeFile(t, targetPath, "not-a-directory")

	_, err := ensureProjectPathExists(targetPath)
	if err == nil {
		t.Fatalf("expected ensureProjectPathExists to fail for file path")
	}
}

func TestGitignoreMatcher_PatternsAndNegation(t *testing.T) {
	projectPath := t.TempDir()
	writeFile(t, filepath.Join(projectPath, ".gitignore"), "*.log\nnode_modules/\n!important.log\n")

	matcher, err := loadGitignoreMatcher(projectPath)
	if err != nil {
		t.Fatalf("loadGitignoreMatcher returned error: %v", err)
	}

	if !matcher.ShouldIgnore("packages/api/server.log", false) {
		t.Fatalf("expected .log file to be ignored")
	}
	if matcher.ShouldIgnore("packages/api/important.log", false) {
		t.Fatalf("expected negated pattern to include important.log")
	}
	if !matcher.ShouldIgnore("packages/api/node_modules", true) {
		t.Fatalf("expected node_modules directory to be ignored")
	}
	if !matcher.ShouldIgnore("packages/api/node_modules/react/index.js", false) {
		t.Fatalf("expected node_modules descendants to be ignored")
	}
}

func TestComputePackagesWatchSignature_IgnoresGitignoredFiles(t *testing.T) {
	projectPath := t.TempDir()
	writeFile(t, filepath.Join(projectPath, ".gitignore"), "*.log\n")
	writeFile(t, filepath.Join(projectPath, "packages", "api", "index.ts"), "console.log('v1')\n")
	writeFile(t, filepath.Join(projectPath, "packages", "api", "ignored.log"), "first\n")

	matcher, err := loadGitignoreMatcher(projectPath)
	if err != nil {
		t.Fatalf("loadGitignoreMatcher returned error: %v", err)
	}

	sigBefore, hasWatchRoot, err := computePackagesWatchSignature(projectPath, matcher)
	if err != nil {
		t.Fatalf("computePackagesWatchSignature returned error: %v", err)
	}
	if !hasWatchRoot {
		t.Fatalf("expected packages watch root to exist")
	}

	appendFile(t, filepath.Join(projectPath, "packages", "api", "ignored.log"), "second\n")
	sigAfter, _, err := computePackagesWatchSignature(projectPath, matcher)
	if err != nil {
		t.Fatalf("computePackagesWatchSignature returned error after change: %v", err)
	}
	if sigBefore != sigAfter {
		t.Fatalf("expected ignored file change to keep signature stable")
	}
}

func TestComputePackagesWatchSignature_TracksPackageChanges(t *testing.T) {
	projectPath := t.TempDir()
	writeFile(t, filepath.Join(projectPath, "packages", "api", "index.ts"), "console.log('v1')\n")

	matcher, err := loadGitignoreMatcher(projectPath)
	if err != nil {
		t.Fatalf("loadGitignoreMatcher returned error: %v", err)
	}

	sigBefore, hasWatchRoot, err := computePackagesWatchSignature(projectPath, matcher)
	if err != nil {
		t.Fatalf("computePackagesWatchSignature returned error: %v", err)
	}
	if !hasWatchRoot {
		t.Fatalf("expected packages watch root to exist")
	}

	time.Sleep(10 * time.Millisecond)
	writeFile(t, filepath.Join(projectPath, "packages", "api", "index.ts"), "console.log('v2')\n")

	sigAfter, _, err := computePackagesWatchSignature(projectPath, matcher)
	if err != nil {
		t.Fatalf("computePackagesWatchSignature returned error after tracked file change: %v", err)
	}
	if sigBefore == sigAfter {
		t.Fatalf("expected tracked package file change to alter signature")
	}
}

func TestWorkloadSupervisor_RestartsOnPackagesChange(t *testing.T) {
	projectPath := t.TempDir()
	writeFile(t, filepath.Join(projectPath, "packages", "api", "index.ts"), "console.log('v1')\n")
	writeFile(t, filepath.Join(projectPath, "package.json"), "{}\n")
	markerPath := filepath.Join(projectPath, "reload.log")

	logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelError}))
	supervisor, err := newWorkloadSupervisor(
		logger,
		projectPath,
		"printf 'start\\n' >> reload.log; while true; do sleep 1; done",
		100*time.Millisecond,
	)
	if err != nil {
		t.Fatalf("newWorkloadSupervisor returned error: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		defer close(done)
		supervisor.Run(ctx)
	}()

	if ok := waitForCondition(5*time.Second, func() bool {
		return readLineCount(markerPath) >= 1
	}); !ok {
		cancel()
		<-done
		t.Fatalf("workload process did not start in time")
	}

	time.Sleep(20 * time.Millisecond)
	writeFile(t, filepath.Join(projectPath, "packages", "api", "index.ts"), "console.log('v2')\n")

	if ok := waitForCondition(6*time.Second, func() bool {
		return readLineCount(markerPath) >= 2
	}); !ok {
		cancel()
		<-done
		t.Fatalf("workload process did not restart after package change")
	}

	cancel()
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatalf("supervisor did not stop in time")
	}

	if supervisor.RunningServices() != 0 {
		t.Fatalf("expected running services to be 0 after shutdown")
	}
}

func TestWorkloadSupervisor_NoPackagesDirectoryDoesNotFail(t *testing.T) {
	projectPath := t.TempDir()
	writeFile(t, filepath.Join(projectPath, "package.json"), "{}\n")

	logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelError}))
	supervisor, err := newWorkloadSupervisor(logger, projectPath, "sleep 1", 100*time.Millisecond)
	if err != nil {
		t.Fatalf("newWorkloadSupervisor returned error: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		defer close(done)
		supervisor.Run(ctx)
	}()

	if ok := waitForCondition(2*time.Second, func() bool {
		return supervisor.RunningServices() == 1
	}); !ok {
		cancel()
		<-done
		t.Fatalf("expected workload process to start without packages directory")
	}

	cancel()
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatalf("supervisor did not stop in time")
	}
}
