package main

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"

	slavev1 "github.com/josh/project-commander/packages/agent-shared/gen/projectcommander/slave/v1"
)

func newTestProcessManager(t *testing.T, projectPath string) *processManager {
	t.Helper()
	rootDir := t.TempDir()
	manager, err := newProcessManager(nil, config{
		SlaveID:        "slave-test",
		ProjectPath:    projectPath,
		LaunchCommand:  defaultWorkloadLaunchCommand,
		WatchInterval:  100 * time.Millisecond,
		BootID:         "boot-test",
		StateRoot:      filepath.Join(rootDir, "state"),
		ProcessLogRoot: filepath.Join(rootDir, "logs"),
	})
	if err != nil {
		t.Fatalf("newProcessManager returned error: %v", err)
	}
	return manager
}

func testDesiredProcess(projectPath string, processKey string, command string, restartPolicy string) *slavev1.DesiredProcess {
	return normalizeDesiredProcess(&slavev1.DesiredProcess{
		ProcessKey:        processKey,
		ProjectPath:       projectPath,
		PackageKey:        processKey,
		DesiredState:      "running",
		LaunchMode:        "shell",
		Cwd:               projectPath,
		Command:           command,
		RestartPolicy:     restartPolicy,
		LaunchFingerprint: computeLaunchFingerprint("shell", command, nil, projectPath, ""),
	})
}

func waitForManagerCondition(timeout time.Duration, checkFn func() bool) bool {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if checkFn() {
			return true
		}
		time.Sleep(25 * time.Millisecond)
	}
	return checkFn()
}

func forceKillPID(pid int64) {
	if pid <= 0 {
		return
	}
	_ = sendSignalToProcessGroupOrProcess(int(pid), processGroupID(int(pid)), syscall.SIGKILL)
}

func TestProcessManager_StartsManagedProcessAndWritesSidecarAndLog(t *testing.T) {
	projectPath := t.TempDir()
	writeFile(t, filepath.Join(projectPath, "package.json"), "{}\n")
	manager := newTestProcessManager(t, projectPath)
	desired := testDesiredProcess(projectPath, "api", "printf 'managed-start\\n'; while true; do sleep 1; done", "manual")

	if err := manager.ReconcileDesiredProcesses(t.Context(), []*slavev1.DesiredProcess{desired}, reconciliationSourceStartup); err != nil {
		t.Fatalf("ReconcileDesiredProcesses returned error: %v", err)
	}
	t.Cleanup(func() {
		runs := manager.ObservedRuns()
		if len(runs) > 0 {
			forceKillPID(runs[0].GetPid())
		}
	})

	if ok := waitForManagerCondition(5*time.Second, func() bool {
		runs := manager.ObservedRuns()
		if len(runs) != 1 {
			return false
		}
		raw, err := os.ReadFile(runs[0].GetLogPath())
		return err == nil && strings.Contains(string(raw), "managed-start")
	}); !ok {
		t.Fatalf("expected process log output to be written")
	}

	runs := manager.ObservedRuns()
	if len(runs) != 1 {
		t.Fatalf("expected 1 observed run, got %d", len(runs))
	}
	stateFilePath := filepath.Join(manager.processStateRoot, sanitizeStateToken("api")+".json")
	if _, err := os.Stat(stateFilePath); err != nil {
		t.Fatalf("expected state sidecar %s to exist: %v", stateFilePath, err)
	}
}

func TestProcessManager_AdoptsPersistedProcessOnStartup(t *testing.T) {
	projectPath := t.TempDir()
	writeFile(t, filepath.Join(projectPath, "package.json"), "{}\n")
	manager := newTestProcessManager(t, projectPath)
	desired := testDesiredProcess(projectPath, "api", "while true; do sleep 1; done", "manual")

	command := exec.Command("sh", "-lc", desired.GetCommand())
	command.Dir = projectPath
	command.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	logPath := filepath.Join(manager.processLogRoot, sanitizeStateToken(manager.bootID), "standalone.log")
	if err := os.MkdirAll(filepath.Dir(logPath), 0o755); err != nil {
		t.Fatalf("mkdir log path failed: %v", err)
	}
	logFile, err := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		t.Fatalf("open log file failed: %v", err)
	}
	command.Stdout = logFile
	command.Stderr = logFile
	if err := command.Start(); err != nil {
		_ = logFile.Close()
		t.Fatalf("start standalone process failed: %v", err)
	}
	_ = logFile.Close()
	t.Cleanup(func() {
		forceKillPID(int64(command.Process.Pid))
	})

	run := manager.nextObservedRun(
		desired,
		"run-adopted",
		command.Process.Pid,
		processGroupID(command.Process.Pid),
		logPath,
		true,
		reconciliationSourceStartup,
		time.Now().UTC(),
	)
	managed := &managedProcess{
		desired:       desired,
		run:           run,
		stateFilePath: filepath.Join(manager.processStateRoot, sanitizeStateToken(desired.GetProcessKey())+".json"),
	}
	if err := manager.writePersistedState(managed); err != nil {
		t.Fatalf("writePersistedState returned error: %v", err)
	}

	if err := manager.ReconcileDesiredProcesses(t.Context(), []*slavev1.DesiredProcess{desired}, reconciliationSourceStartup); err != nil {
		t.Fatalf("ReconcileDesiredProcesses returned error: %v", err)
	}

	if ok := waitForManagerCondition(2*time.Second, func() bool {
		runs := manager.ObservedRuns()
		return len(runs) == 1 && runs[0].GetPid() == int64(command.Process.Pid) && runs[0].GetAdopted()
	}); !ok {
		t.Fatalf("expected persisted process to be adopted")
	}

	changes := manager.DrainPendingReconciliationChanges()
	foundAdopted := false
	for _, change := range changes {
		if change != nil && change.GetChangeType() == changeTypeAdopted {
			foundAdopted = true
			break
		}
	}
	if !foundAdopted {
		t.Fatalf("expected adopted reconciliation change, got %v", changes)
	}
}

func TestProcessManager_RestartsManagedProcessWhenPackagesChange(t *testing.T) {
	projectPath := t.TempDir()
	writeFile(t, filepath.Join(projectPath, "package.json"), "{}\n")
	writeFile(t, filepath.Join(projectPath, "packages", "api", "index.ts"), "console.log('v1')\n")
	reloadPath := filepath.Join(projectPath, "reload.log")

	manager := newTestProcessManager(t, projectPath)
	desired := testDesiredProcess(projectPath, "api", "printf 'start\\n' >> reload.log; while true; do sleep 1; done", "restart_on_package_change")
	if err := manager.ReconcileDesiredProcesses(t.Context(), []*slavev1.DesiredProcess{desired}, reconciliationSourceStartup); err != nil {
		t.Fatalf("ReconcileDesiredProcesses returned error: %v", err)
	}
	t.Cleanup(func() {
		runs := manager.ObservedRuns()
		if len(runs) > 0 {
			forceKillPID(runs[0].GetPid())
		}
	})

	if ok := waitForManagerCondition(5*time.Second, func() bool {
		return readLineCount(reloadPath) >= 1
	}); !ok {
		t.Fatalf("expected initial process start marker")
	}
	firstPID := manager.ObservedRuns()[0].GetPid()

	time.Sleep(20 * time.Millisecond)
	writeFile(t, filepath.Join(projectPath, "packages", "api", "index.ts"), "console.log('v2')\n")
	if ok := waitForManagerCondition(6*time.Second, func() bool {
		_ = manager.Tick(context.Background())
		runs := manager.ObservedRuns()
		if len(runs) != 1 {
			return false
		}
		return runs[0].GetPid() != firstPID && readLineCount(reloadPath) >= 2
	}); !ok {
		t.Fatalf("expected process manager to restart managed process after package change")
	}
}

func TestProcessManager_SoftKillEscalatesAndRemovesRun(t *testing.T) {
	projectPath := t.TempDir()
	writeFile(t, filepath.Join(projectPath, "package.json"), "{}\n")
	manager := newTestProcessManager(t, projectPath)
	desired := testDesiredProcess(projectPath, "api", "trap '' TERM; while true; do sleep 1; done", "manual")
	if err := manager.ReconcileDesiredProcesses(t.Context(), []*slavev1.DesiredProcess{desired}, reconciliationSourceStartup); err != nil {
		t.Fatalf("ReconcileDesiredProcesses returned error: %v", err)
	}

	var run *slavev1.ObservedProcessRun
	if ok := waitForManagerCondition(5*time.Second, func() bool {
		runs := manager.ObservedRuns()
		if len(runs) != 1 {
			return false
		}
		run = runs[0]
		return run.GetPid() > 0
	}); !ok {
		t.Fatalf("expected managed run to start before kill")
	}

	if err := manager.ExecuteKillCommand(&slavev1.KillProcessCommand{
		RunId:      run.GetRunId(),
		ProcessKey: run.GetProcessKey(),
		Pid:        run.GetPid(),
		Pgid:       run.GetPgid(),
		Reason:     "test kill",
	}, false); err != nil {
		t.Fatalf("ExecuteKillCommand returned error: %v", err)
	}

	if ok := waitForManagerCondition(4*time.Second, func() bool {
		return manager.RunningServices() == 0 && !processExists(int(run.GetPid()))
	}); !ok {
		t.Fatalf("expected process to be stopped after kill")
	}

	changes := manager.DrainPendingReconciliationChanges()
	foundKilled := false
	for _, change := range changes {
		if change == nil || change.GetObservedRun() == nil {
			continue
		}
		if change.GetChangeType() == changeTypeKilled && change.GetObservedRun().GetProcessKey() == run.GetProcessKey() {
			foundKilled = true
			break
		}
	}
	if !foundKilled {
		t.Fatalf("expected killed reconciliation change, got %v", changes)
	}
}
