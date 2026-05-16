package main

import (
	"context"
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"syscall"
	"time"

	slavev1 "github.com/josh/project-commander/packages/agent-shared/gen/projectcommander/slave/v1"
)

const (
	processStatusRunning  = "running"
	processStatusStopping = "stopping"
	processStatusExited   = "exited"
	processStatusFailed   = "failed"
	processStatusKilled   = "killed"
	processStatusOrphaned = "orphaned"
	processStatusReplaced = "replaced"

	reconciliationSourceStartup = "startup"
	reconciliationSourceTick    = "tick"
	reconciliationSourceKill    = "kill"
	reconciliationSourceLaunch  = "launch"
	reconciliationSourceCommand = "command"

	changeTypeStarted  = "started"
	changeTypeAdopted  = "adopted"
	changeTypeExited   = "exited"
	changeTypeMissing  = "missing"
	changeTypeOrphaned = "orphaned"
	changeTypeReplaced = "replaced"
	changeTypeKilled   = "killed"
)

type processExit struct {
	exitCode   int32
	exitSignal string
	status     string
	completed  time.Time
}

type persistedProcessState struct {
	RunID             string   `json:"run_id"`
	DesiredProcessID  int64    `json:"desired_process_id"`
	ProcessKey        string   `json:"process_key"`
	ProjectPath       string   `json:"project_path"`
	PackageKey        string   `json:"package_key"`
	Pid               int      `json:"pid"`
	Pgid              int      `json:"pgid"`
	BootID            string   `json:"boot_id"`
	LaunchFingerprint string   `json:"launch_fingerprint"`
	Command           string   `json:"command"`
	Args              []string `json:"args"`
	Cwd               string   `json:"cwd"`
	EnvHash           string   `json:"env_hash"`
	LogPath           string   `json:"log_path"`
	StartedAt         string   `json:"started_at"`
	UpdatedAt         string   `json:"updated_at"`
}

type managedProcess struct {
	desired        *slavev1.DesiredProcess
	run            *slavev1.ObservedProcessRun
	cmd            *exec.Cmd
	stateFilePath  string
	matcher        *gitignoreMatcher
	lastSignature  string
	hasWatchRoot   bool
	adopted        bool
	awaitingExit   bool
	expectedSignal string
	exitResult     *processExit
}

type processManager struct {
	logger               *slog.Logger
	slaveID              string
	bootID               string
	stateRoot            string
	processStateRoot     string
	processLogRoot       string
	defaultProjectPath   string
	defaultLaunchCommand string
	watchInterval        time.Duration
	artifactRetention    time.Duration
	maxRetainedBootLogs  int

	mu              sync.Mutex
	processes       map[string]*managedProcess
	completedNever  map[string]string
	pendingChanges  []*slavev1.ProcessReconciliationChange
	runtimeSequence int64
}

func newProcessManager(logger *slog.Logger, cfg config) (*processManager, error) {
	if logger == nil {
		logger = slog.Default()
	}
	stateRoot := strings.TrimSpace(cfg.StateRoot)
	if stateRoot == "" {
		return nil, fmt.Errorf("state root is required")
	}
	processLogRoot := strings.TrimSpace(cfg.ProcessLogRoot)
	if processLogRoot == "" {
		return nil, fmt.Errorf("process log root is required")
	}
	processStateRoot := filepath.Join(stateRoot, defaultProcessStateDirName)
	for _, pathValue := range []string{stateRoot, processStateRoot, processLogRoot} {
		if err := os.MkdirAll(pathValue, 0o755); err != nil {
			return nil, fmt.Errorf("create runtime directory %s: %w", pathValue, err)
		}
	}
	manager := &processManager{
		logger:               logger,
		slaveID:              strings.TrimSpace(cfg.SlaveID),
		bootID:               strings.TrimSpace(cfg.BootID),
		stateRoot:            stateRoot,
		processStateRoot:     processStateRoot,
		processLogRoot:       processLogRoot,
		defaultProjectPath:   strings.TrimSpace(cfg.ProjectPath),
		defaultLaunchCommand: strings.TrimSpace(cfg.LaunchCommand),
		watchInterval:        cfg.WatchInterval,
		artifactRetention:    cfg.RuntimeArtifactRetention,
		maxRetainedBootLogs:  cfg.MaxRetainedBootLogs,
		processes:            map[string]*managedProcess{},
		completedNever:       map[string]string{},
		pendingChanges:       make([]*slavev1.ProcessReconciliationChange, 0, 8),
	}
	if err := manager.cleanupRuntimeArtifacts(); err != nil {
		manager.logger.Warn("failed to clean runtime artifacts", "error", err.Error())
	}
	return manager, nil
}

func cloneProcessEnvEntries(input []*slavev1.ProcessEnvEntry) []*slavev1.ProcessEnvEntry {
	cloned := make([]*slavev1.ProcessEnvEntry, 0, len(input))
	for _, entry := range input {
		if entry == nil {
			continue
		}
		key := strings.TrimSpace(entry.GetKey())
		if key == "" {
			continue
		}
		cloned = append(cloned, &slavev1.ProcessEnvEntry{
			Key:   key,
			Value: entry.GetValue(),
		})
	}
	sort.Slice(cloned, func(i, j int) bool {
		return cloned[i].GetKey() < cloned[j].GetKey()
	})
	return cloned
}

func cloneDesiredProcess(input *slavev1.DesiredProcess) *slavev1.DesiredProcess {
	if input == nil {
		return nil
	}
	return &slavev1.DesiredProcess{
		DesiredProcessId:    input.GetDesiredProcessId(),
		HostId:              input.GetHostId(),
		ProjectId:           input.GetProjectId(),
		ServiceId:           input.GetServiceId(),
		ProcessKey:          strings.TrimSpace(input.GetProcessKey()),
		ProjectPath:         strings.TrimSpace(input.GetProjectPath()),
		PackageKey:          strings.TrimSpace(input.GetPackageKey()),
		PackageRelativePath: strings.TrimSpace(input.GetPackageRelativePath()),
		DesiredState:        strings.TrimSpace(input.GetDesiredState()),
		LaunchMode:          strings.TrimSpace(input.GetLaunchMode()),
		Cwd:                 strings.TrimSpace(input.GetCwd()),
		Command:             strings.TrimSpace(input.GetCommand()),
		Args:                append([]string{}, input.GetArgs()...),
		Env:                 cloneProcessEnvEntries(input.GetEnv()),
		EnvHash:             strings.TrimSpace(input.GetEnvHash()),
		LaunchFingerprint:   strings.TrimSpace(input.GetLaunchFingerprint()),
		LogRoot:             strings.TrimSpace(input.GetLogRoot()),
		RestartPolicy:       strings.TrimSpace(input.GetRestartPolicy()),
		UpdatedAt:           strings.TrimSpace(input.GetUpdatedAt()),
	}
}

func cloneObservedProcessRun(input *slavev1.ObservedProcessRun) *slavev1.ObservedProcessRun {
	if input == nil {
		return nil
	}
	return &slavev1.ObservedProcessRun{
		RunId:                strings.TrimSpace(input.GetRunId()),
		DesiredProcessId:     input.GetDesiredProcessId(),
		ProcessKey:           strings.TrimSpace(input.GetProcessKey()),
		ProjectPath:          strings.TrimSpace(input.GetProjectPath()),
		PackageKey:           strings.TrimSpace(input.GetPackageKey()),
		Pid:                  input.GetPid(),
		Pgid:                 input.GetPgid(),
		BootId:               strings.TrimSpace(input.GetBootId()),
		LaunchFingerprint:    strings.TrimSpace(input.GetLaunchFingerprint()),
		Command:              strings.TrimSpace(input.GetCommand()),
		Args:                 append([]string{}, input.GetArgs()...),
		Cwd:                  strings.TrimSpace(input.GetCwd()),
		EnvHash:              strings.TrimSpace(input.GetEnvHash()),
		Status:               strings.TrimSpace(input.GetStatus()),
		StartedAt:            strings.TrimSpace(input.GetStartedAt()),
		LastSeenAt:           strings.TrimSpace(input.GetLastSeenAt()),
		ExitedAt:             strings.TrimSpace(input.GetExitedAt()),
		ExitCode:             input.GetExitCode(),
		ExitSignal:           strings.TrimSpace(input.GetExitSignal()),
		LogPath:              strings.TrimSpace(input.GetLogPath()),
		Adopted:              input.GetAdopted(),
		ReconciliationSource: strings.TrimSpace(input.GetReconciliationSource()),
	}
}

func cloneReconciliationChange(input *slavev1.ProcessReconciliationChange) *slavev1.ProcessReconciliationChange {
	if input == nil {
		return nil
	}
	return &slavev1.ProcessReconciliationChange{
		ChangeType:     strings.TrimSpace(input.GetChangeType()),
		Reason:         strings.TrimSpace(input.GetReason()),
		DesiredProcess: cloneDesiredProcess(input.GetDesiredProcess()),
		ObservedRun:    cloneObservedProcessRun(input.GetObservedRun()),
	}
}

func normalizeDesiredProcesses(input []*slavev1.DesiredProcess) map[string]*slavev1.DesiredProcess {
	normalized := map[string]*slavev1.DesiredProcess{}
	for _, desiredProcess := range input {
		candidate := normalizeDesiredProcess(desiredProcess)
		if candidate == nil {
			continue
		}
		normalized[candidate.GetProcessKey()] = candidate
	}
	return normalized
}

func normalizeDesiredProcess(input *slavev1.DesiredProcess) *slavev1.DesiredProcess {
	if input == nil {
		return nil
	}
	processKey := strings.TrimSpace(input.GetProcessKey())
	if processKey == "" {
		return nil
	}
	projectPath, _ := normalizeProjectPath(input.GetProjectPath())
	cwd, _ := normalizeProjectPath(input.GetCwd())
	if cwd == "" {
		cwd = projectPath
	}
	command := strings.TrimSpace(input.GetCommand())
	args := append([]string{}, input.GetArgs()...)
	launchMode := strings.TrimSpace(strings.ToLower(input.GetLaunchMode()))
	if launchMode == "" {
		launchMode = "exec"
	}
	if launchMode == "shell" && command == "" && len(args) > 0 {
		command = strings.Join(args, " ")
		args = nil
	}
	packageKey := strings.TrimSpace(input.GetPackageKey())
	if packageKey == "" {
		packageKey = processKey
	}
	desiredState := strings.TrimSpace(strings.ToLower(input.GetDesiredState()))
	if desiredState == "" {
		desiredState = "running"
	}
	env := cloneProcessEnvEntries(input.GetEnv())
	envHash := strings.TrimSpace(input.GetEnvHash())
	if envHash == "" {
		envHash = computeProcessEnvHash(env)
	}
	launchFingerprint := strings.TrimSpace(input.GetLaunchFingerprint())
	if launchFingerprint == "" {
		launchFingerprint = computeLaunchFingerprint(launchMode, command, args, cwd, envHash)
	}
	logRoot := strings.TrimSpace(input.GetLogRoot())
	if logRoot == "" {
		logRoot = ""
	}
	restartPolicy := strings.TrimSpace(strings.ToLower(input.GetRestartPolicy()))
	if restartPolicy == "" {
		restartPolicy = "restart_on_package_change"
	}
	return &slavev1.DesiredProcess{
		DesiredProcessId:    input.GetDesiredProcessId(),
		HostId:              input.GetHostId(),
		ProjectId:           input.GetProjectId(),
		ServiceId:           input.GetServiceId(),
		ProcessKey:          processKey,
		ProjectPath:         projectPath,
		PackageKey:          packageKey,
		PackageRelativePath: strings.TrimSpace(input.GetPackageRelativePath()),
		DesiredState:        desiredState,
		LaunchMode:          launchMode,
		Cwd:                 cwd,
		Command:             command,
		Args:                args,
		Env:                 env,
		EnvHash:             envHash,
		LaunchFingerprint:   launchFingerprint,
		LogRoot:             logRoot,
		RestartPolicy:       restartPolicy,
		UpdatedAt:           strings.TrimSpace(input.GetUpdatedAt()),
	}
}

func computeProcessEnvHash(entries []*slavev1.ProcessEnvEntry) string {
	encoded := make([]string, 0, len(entries))
	for _, entry := range cloneProcessEnvEntries(entries) {
		encoded = append(encoded, entry.GetKey()+"="+entry.GetValue())
	}
	sum := sha1.Sum([]byte(strings.Join(encoded, "\n")))
	return hex.EncodeToString(sum[:])
}

func computeLaunchFingerprint(launchMode string, command string, args []string, cwd string, envHash string) string {
	normalizedArgs := append([]string{}, args...)
	sum := sha1.Sum([]byte(strings.Join([]string{
		strings.TrimSpace(strings.ToLower(launchMode)),
		strings.TrimSpace(command),
		strings.TrimSpace(cwd),
		strings.TrimSpace(envHash),
		strings.Join(normalizedArgs, "\x1f"),
	}, "\x1e")))
	return hex.EncodeToString(sum[:])
}

func desiredProcessMatchesRun(desired *slavev1.DesiredProcess, run *slavev1.ObservedProcessRun) bool {
	if desired == nil || run == nil {
		return false
	}
	if strings.TrimSpace(desired.GetProcessKey()) != strings.TrimSpace(run.GetProcessKey()) {
		return false
	}
	desiredFingerprint := strings.TrimSpace(desired.GetLaunchFingerprint())
	runFingerprint := strings.TrimSpace(run.GetLaunchFingerprint())
	if desiredFingerprint != "" && runFingerprint != "" {
		return desiredFingerprint == runFingerprint
	}
	return strings.TrimSpace(desired.GetCommand()) == strings.TrimSpace(run.GetCommand()) &&
		strings.TrimSpace(desired.GetCwd()) == strings.TrimSpace(run.GetCwd()) &&
		strings.TrimSpace(desired.GetEnvHash()) == strings.TrimSpace(run.GetEnvHash()) &&
		strings.Join(desired.GetArgs(), "\x1f") == strings.Join(run.GetArgs(), "\x1f")
}

func shouldRestartExitedDesiredProcess(desired *slavev1.DesiredProcess) bool {
	if desired == nil || !strings.EqualFold(desired.GetDesiredState(), "running") {
		return false
	}
	restartPolicy := strings.TrimSpace(strings.ToLower(desired.GetRestartPolicy()))
	if restartPolicy == "" {
		restartPolicy = "restart_on_package_change"
	}
	return restartPolicy != "never"
}

func completedNeverFingerprint(desired *slavev1.DesiredProcess) string {
	if desired == nil {
		return ""
	}
	fingerprint := strings.TrimSpace(desired.GetLaunchFingerprint())
	if fingerprint != "" {
		return fingerprint
	}
	return computeLaunchFingerprint(
		desired.GetLaunchMode(),
		desired.GetCommand(),
		append([]string{}, desired.GetArgs()...),
		desired.GetCwd(),
		desired.GetEnvHash(),
	)
}

func shouldRememberCompletedNeverProcess(desired *slavev1.DesiredProcess) bool {
	if desired == nil || !strings.EqualFold(desired.GetDesiredState(), "running") {
		return false
	}
	return strings.TrimSpace(strings.ToLower(desired.GetRestartPolicy())) == "never"
}

func (manager *processManager) hasCompletedNeverProcessLocked(desired *slavev1.DesiredProcess) bool {
	if !shouldRememberCompletedNeverProcess(desired) {
		return false
	}
	processKey := strings.TrimSpace(desired.GetProcessKey())
	if processKey == "" {
		return false
	}
	expected := completedNeverFingerprint(desired)
	if strings.TrimSpace(manager.completedNever[processKey]) == expected {
		return true
	}
	delete(manager.completedNever, processKey)
	return false
}

func mergeProcessEnvironment(entries []*slavev1.ProcessEnvEntry, managedMarkers map[string]string) []string {
	merged := map[string]string{}
	for _, candidate := range os.Environ() {
		parts := strings.SplitN(candidate, "=", 2)
		if len(parts) == 0 {
			continue
		}
		key := strings.TrimSpace(parts[0])
		if key == "" {
			continue
		}
		value := ""
		if len(parts) == 2 {
			value = parts[1]
		}
		merged[key] = value
	}
	for _, entry := range cloneProcessEnvEntries(entries) {
		merged[entry.GetKey()] = entry.GetValue()
	}
	for key, value := range managedMarkers {
		if strings.TrimSpace(key) == "" {
			continue
		}
		merged[key] = value
	}
	keys := make([]string, 0, len(merged))
	for key := range merged {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	result := make([]string, 0, len(keys))
	for _, key := range keys {
		result = append(result, key+"="+merged[key])
	}
	return result
}

func processExists(pid int) bool {
	if pid <= 0 {
		return false
	}
	err := syscall.Kill(pid, 0)
	if err == nil {
		return true
	}
	return errors.Is(err, syscall.EPERM)
}

func processGroupID(pid int) int {
	if pid <= 0 {
		return 0
	}
	pgid, err := syscall.Getpgid(pid)
	if err != nil {
		return 0
	}
	return pgid
}

func waitForProcessExit(pid int, timeout time.Duration) bool {
	if pid <= 0 {
		return true
	}
	if timeout <= 0 {
		return !processExists(pid)
	}
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if !processExists(pid) {
			return true
		}
		time.Sleep(50 * time.Millisecond)
	}
	return !processExists(pid)
}

func sendSignalToProcessGroupOrProcess(pid int, pgid int, signal syscall.Signal) error {
	targetGroup := pgid
	if targetGroup <= 0 {
		targetGroup = processGroupID(pid)
	}
	if targetGroup > 0 {
		if err := syscall.Kill(-targetGroup, signal); err == nil || errors.Is(err, syscall.ESRCH) {
			return nil
		}
	}
	if pid <= 0 {
		return nil
	}
	process, err := os.FindProcess(pid)
	if err != nil {
		return err
	}
	if err := process.Signal(signal); err != nil && !errors.Is(err, os.ErrProcessDone) {
		return err
	}
	return nil
}

func waitForManagedProcess(cmd *exec.Cmd) *processExit {
	result := &processExit{
		status:    processStatusExited,
		completed: time.Now().UTC(),
	}
	err := cmd.Wait()
	result.completed = time.Now().UTC()
	if processState := cmd.ProcessState; processState != nil {
		if waitStatus, ok := processState.Sys().(syscall.WaitStatus); ok {
			if waitStatus.Signaled() {
				result.exitSignal = waitStatus.Signal().String()
				result.status = processStatusKilled
			}
			result.exitCode = int32(waitStatus.ExitStatus())
		}
	}
	if err != nil {
		if result.status != processStatusKilled {
			result.status = processStatusFailed
		}
	}
	return result
}

func (manager *processManager) nextObservedRun(
	desired *slavev1.DesiredProcess,
	runID string,
	pid int,
	pgid int,
	logPath string,
	adopted bool,
	source string,
	now time.Time,
) *slavev1.ObservedProcessRun {
	if now.IsZero() {
		now = time.Now().UTC()
	}
	if strings.TrimSpace(runID) == "" {
		nextRunID, err := newRunID()
		if err == nil {
			runID = nextRunID
		}
	}
	return &slavev1.ObservedProcessRun{
		RunId:                strings.TrimSpace(runID),
		DesiredProcessId:     desired.GetDesiredProcessId(),
		ProcessKey:           strings.TrimSpace(desired.GetProcessKey()),
		ProjectPath:          strings.TrimSpace(desired.GetProjectPath()),
		PackageKey:           strings.TrimSpace(desired.GetPackageKey()),
		Pid:                  int64(pid),
		Pgid:                 int64(pgid),
		BootId:               manager.bootID,
		LaunchFingerprint:    strings.TrimSpace(desired.GetLaunchFingerprint()),
		Command:              strings.TrimSpace(desired.GetCommand()),
		Args:                 append([]string{}, desired.GetArgs()...),
		Cwd:                  strings.TrimSpace(desired.GetCwd()),
		EnvHash:              strings.TrimSpace(desired.GetEnvHash()),
		Status:               processStatusRunning,
		StartedAt:            now.Format(time.RFC3339Nano),
		LastSeenAt:           now.Format(time.RFC3339Nano),
		ExitCode:             0,
		ExitSignal:           "",
		LogPath:              strings.TrimSpace(logPath),
		Adopted:              adopted,
		ReconciliationSource: source,
	}
}

func (manager *processManager) appendChange(changeType string, reason string, desired *slavev1.DesiredProcess, run *slavev1.ObservedProcessRun) {
	change := &slavev1.ProcessReconciliationChange{
		ChangeType:     strings.TrimSpace(changeType),
		Reason:         strings.TrimSpace(reason),
		DesiredProcess: cloneDesiredProcess(desired),
		ObservedRun:    cloneObservedProcessRun(run),
	}
	manager.pendingChanges = append(manager.pendingChanges, change)
	manager.runtimeSequence += 1
}

func (manager *processManager) bootstrapDesiredProcesses() []*slavev1.DesiredProcess {
	projectPath := strings.TrimSpace(manager.defaultProjectPath)
	if projectPath == "" {
		return nil
	}
	launchCommand := strings.TrimSpace(manager.defaultLaunchCommand)
	if launchCommand == "" {
		launchCommand = defaultWorkloadLaunchCommand
	}
	desired := normalizeDesiredProcess(&slavev1.DesiredProcess{
		ProcessKey:        "bootstrap.default",
		ProjectPath:       projectPath,
		PackageKey:        "bootstrap.default",
		DesiredState:      "running",
		LaunchMode:        "shell",
		Cwd:               projectPath,
		Command:           launchCommand,
		Env:               nil,
		RestartPolicy:     "restart_on_package_change",
		LaunchFingerprint: computeLaunchFingerprint("shell", launchCommand, nil, projectPath, ""),
	})
	if desired == nil {
		return nil
	}
	return []*slavev1.DesiredProcess{desired}
}

func (manager *processManager) ReconcileDesiredProcesses(ctx context.Context, desired []*slavev1.DesiredProcess, source string) error {
	manager.mu.Lock()
	defer manager.mu.Unlock()

	desiredMap := normalizeDesiredProcesses(desired)
	if len(desiredMap) == 0 {
		for _, bootstrap := range manager.bootstrapDesiredProcesses() {
			desiredMap[bootstrap.GetProcessKey()] = bootstrap
		}
	}

	if err := manager.loadPersistedProcessesLocked(desiredMap, source); err != nil {
		return err
	}

	processKeys := make([]string, 0, len(desiredMap))
	for processKey := range desiredMap {
		processKeys = append(processKeys, processKey)
	}
	sort.Strings(processKeys)
	for _, processKey := range processKeys {
		desiredProcess := desiredMap[processKey]
		managed := manager.processes[processKey]
		if strings.EqualFold(desiredProcess.GetDesiredState(), "stopped") {
			delete(manager.completedNever, strings.TrimSpace(desiredProcess.GetProcessKey()))
			if managed != nil {
				manager.stopManagedProcessLocked(managed, processStatusKilled, "desired state is stopped", reconciliationSourceKill, true)
			}
			continue
		}
		if managed == nil {
			if manager.hasCompletedNeverProcessLocked(desiredProcess) {
				continue
			}
			if err := manager.startDesiredProcessLocked(desiredProcess, source, false); err != nil {
				manager.logger.Error("failed to launch desired process", "process_key", desiredProcess.GetProcessKey(), "error", err.Error())
				manager.appendChange(changeTypeMissing, "failed to launch desired process: "+err.Error(), desiredProcess, nil)
			}
			continue
		}
		managed.desired = cloneDesiredProcess(desiredProcess)
		if managed.exitResult != nil {
			exitResult := managed.exitResult
			managed.exitResult = nil
			manager.finalizeExitedProcessLocked(managed, exitResult, "managed process exited", source)
			if !shouldRestartExitedDesiredProcess(desiredProcess) {
				continue
			}
			if err := manager.startDesiredProcessLocked(desiredProcess, source, false); err != nil {
				manager.logger.Error("failed to restart exited desired process", "process_key", desiredProcess.GetProcessKey(), "error", err.Error())
				manager.appendChange(changeTypeMissing, "failed to restart exited desired process: "+err.Error(), desiredProcess, nil)
			}
			continue
		}
		if !processExists(int(managed.run.GetPid())) {
			manager.finalizeExitedProcessLocked(managed, nil, "process no longer exists", source)
			if !shouldRestartExitedDesiredProcess(desiredProcess) {
				continue
			}
			if err := manager.startDesiredProcessLocked(desiredProcess, source, false); err != nil {
				manager.logger.Error("failed to restart missing desired process", "process_key", desiredProcess.GetProcessKey(), "error", err.Error())
				manager.appendChange(changeTypeMissing, "failed to restart missing desired process: "+err.Error(), desiredProcess, nil)
			}
			continue
		}
		if !desiredProcessMatchesRun(desiredProcess, managed.run) {
			manager.stopManagedProcessLocked(managed, processStatusReplaced, "desired process fingerprint changed", source, false)
			if err := manager.startDesiredProcessLocked(desiredProcess, source, false); err != nil {
				manager.logger.Error("failed to replace desired process", "process_key", desiredProcess.GetProcessKey(), "error", err.Error())
				manager.appendChange(changeTypeMissing, "failed to replace desired process: "+err.Error(), desiredProcess, nil)
			}
		}
	}

	for processKey, managed := range manager.processes {
		if _, exists := desiredMap[processKey]; exists {
			continue
		}
		manager.appendChange(changeTypeOrphaned, "observed process is not part of desired state", managed.desired, managed.run)
		manager.stopManagedProcessLocked(managed, processStatusOrphaned, "observed process is not part of desired state", source, true)
	}

	return nil
}

func (manager *processManager) loadPersistedProcessesLocked(desiredMap map[string]*slavev1.DesiredProcess, source string) error {
	entries, err := os.ReadDir(manager.processStateRoot)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return fmt.Errorf("read process state root: %w", err)
	}
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(strings.ToLower(entry.Name()), ".json") {
			continue
		}
		stateFilePath := filepath.Join(manager.processStateRoot, entry.Name())
		if manager.hasManagedProcessForStateFileLocked(stateFilePath) {
			continue
		}
		persisted, err := manager.readPersistedState(stateFilePath)
		if err != nil {
			manager.logger.Warn("failed to read persisted process state", "path", stateFilePath, "error", err.Error())
			continue
		}
		if persisted == nil || strings.TrimSpace(persisted.ProcessKey) == "" {
			continue
		}
		if persisted.BootID != "" && manager.bootID != "" && persisted.BootID != manager.bootID {
			_ = os.Remove(stateFilePath)
			continue
		}
		if !processExists(persisted.Pid) {
			run := manager.observedRunFromPersistedState(persisted)
			if run != nil {
				run.Status = processStatusExited
				run.ExitedAt = time.Now().UTC().Format(time.RFC3339Nano)
				run.LastSeenAt = run.ExitedAt
				manager.appendChange(changeTypeExited, "persisted process was not running during reconciliation", desiredMap[persisted.ProcessKey], run)
			}
			_ = os.Remove(stateFilePath)
			continue
		}
		desiredProcess := desiredMap[persisted.ProcessKey]
		managed := &managedProcess{
			desired:       cloneDesiredProcess(desiredProcess),
			run:           manager.observedRunFromPersistedState(persisted),
			stateFilePath: stateFilePath,
			adopted:       true,
		}
		if managed.run == nil {
			continue
		}
		managed.run.Adopted = true
		managed.run.Status = processStatusRunning
		managed.run.ReconciliationSource = source
		managed.run.LastSeenAt = time.Now().UTC().Format(time.RFC3339Nano)
		if desiredProcess != nil {
			if desiredProcessMatchesRun(desiredProcess, managed.run) {
				if err := manager.refreshWatchStateLocked(managed); err != nil {
					manager.logger.Warn("failed to prepare adopted process watch state", "process_key", managed.run.GetProcessKey(), "error", err.Error())
				}
				manager.processes[persisted.ProcessKey] = managed
				manager.appendChange(changeTypeAdopted, "adopted persisted process during reconciliation", desiredProcess, managed.run)
				continue
			}
			manager.processes[persisted.ProcessKey] = managed
			continue
		}
		manager.processes[persisted.ProcessKey] = managed
	}
	return nil
}

func (manager *processManager) hasManagedProcessForStateFileLocked(stateFilePath string) bool {
	for _, managed := range manager.processes {
		if managed != nil && managed.stateFilePath == stateFilePath {
			return true
		}
	}
	return false
}

func (manager *processManager) cleanupRuntimeArtifacts() error {
	var cleanupErrors []string
	if err := manager.cleanupPersistedStateArtifacts(); err != nil {
		cleanupErrors = append(cleanupErrors, err.Error())
	}
	if err := manager.cleanupBootLogDirectories(); err != nil {
		cleanupErrors = append(cleanupErrors, err.Error())
	}
	if len(cleanupErrors) == 0 {
		return nil
	}
	return fmt.Errorf("runtime artifact cleanup failed: %s", strings.Join(cleanupErrors, "; "))
}

func (manager *processManager) cleanupPersistedStateArtifacts() error {
	entries, err := os.ReadDir(manager.processStateRoot)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return err
	}
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(strings.ToLower(entry.Name()), ".json") {
			continue
		}
		stateFilePath := filepath.Join(manager.processStateRoot, entry.Name())
		persisted, readErr := manager.readPersistedState(stateFilePath)
		if readErr != nil {
			manager.logger.Debug("removing unreadable persisted process state", "path", stateFilePath, "error", readErr.Error())
			if removeErr := os.Remove(stateFilePath); removeErr != nil && !errors.Is(removeErr, os.ErrNotExist) {
				return removeErr
			}
			continue
		}
		if persisted == nil {
			continue
		}
		if persisted.BootID != "" && manager.bootID != "" && persisted.BootID != manager.bootID {
			manager.logger.Debug("removing persisted process state from previous boot", "path", stateFilePath, "process_key", persisted.ProcessKey)
			if removeErr := os.Remove(stateFilePath); removeErr != nil && !errors.Is(removeErr, os.ErrNotExist) {
				return removeErr
			}
			continue
		}
		if !processExists(persisted.Pid) {
			manager.logger.Debug("removing stale persisted process state for exited process", "path", stateFilePath, "process_key", persisted.ProcessKey, "pid", persisted.Pid)
			if removeErr := os.Remove(stateFilePath); removeErr != nil && !errors.Is(removeErr, os.ErrNotExist) {
				return removeErr
			}
		}
	}
	return nil
}

func (manager *processManager) cleanupBootLogDirectories() error {
	entries, err := os.ReadDir(manager.processLogRoot)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return err
	}

	type bootLogDirectory struct {
		path    string
		name    string
		modTime time.Time
	}

	currentBootDirectory := sanitizeStateToken(manager.bootID)
	candidates := make([]bootLogDirectory, 0, len(entries))
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		name := strings.TrimSpace(entry.Name())
		if name == "" || name == currentBootDirectory {
			continue
		}
		info, infoErr := entry.Info()
		if infoErr != nil {
			return infoErr
		}
		candidates = append(candidates, bootLogDirectory{
			path:    filepath.Join(manager.processLogRoot, name),
			name:    name,
			modTime: info.ModTime(),
		})
	}

	sort.Slice(candidates, func(i, j int) bool {
		return candidates[i].modTime.After(candidates[j].modTime)
	})

	retainedCount := 0
	now := time.Now().UTC()
	for _, candidate := range candidates {
		expiredByAge := manager.artifactRetention > 0 && now.Sub(candidate.modTime) > manager.artifactRetention
		expiredByCount := manager.maxRetainedBootLogs > 0 && retainedCount >= manager.maxRetainedBootLogs
		if !expiredByAge && !expiredByCount {
			retainedCount += 1
			continue
		}
		manager.logger.Debug("removing retained process log directory", "path", candidate.path, "expired_by_age", expiredByAge, "expired_by_count", expiredByCount)
		if removeErr := os.RemoveAll(candidate.path); removeErr != nil && !errors.Is(removeErr, os.ErrNotExist) {
			return removeErr
		}
	}
	return nil
}

func (manager *processManager) observedRunFromPersistedState(state *persistedProcessState) *slavev1.ObservedProcessRun {
	if state == nil || strings.TrimSpace(state.ProcessKey) == "" {
		return nil
	}
	return &slavev1.ObservedProcessRun{
		RunId:                strings.TrimSpace(state.RunID),
		DesiredProcessId:     state.DesiredProcessID,
		ProcessKey:           strings.TrimSpace(state.ProcessKey),
		ProjectPath:          strings.TrimSpace(state.ProjectPath),
		PackageKey:           strings.TrimSpace(state.PackageKey),
		Pid:                  int64(state.Pid),
		Pgid:                 int64(state.Pgid),
		BootId:               strings.TrimSpace(state.BootID),
		LaunchFingerprint:    strings.TrimSpace(state.LaunchFingerprint),
		Command:              strings.TrimSpace(state.Command),
		Args:                 append([]string{}, state.Args...),
		Cwd:                  strings.TrimSpace(state.Cwd),
		EnvHash:              strings.TrimSpace(state.EnvHash),
		Status:               processStatusRunning,
		StartedAt:            strings.TrimSpace(state.StartedAt),
		LastSeenAt:           strings.TrimSpace(state.UpdatedAt),
		LogPath:              strings.TrimSpace(state.LogPath),
		Adopted:              true,
		ReconciliationSource: reconciliationSourceStartup,
	}
}

func (manager *processManager) readPersistedState(stateFilePath string) (*persistedProcessState, error) {
	raw, err := os.ReadFile(stateFilePath)
	if err != nil {
		return nil, err
	}
	var state persistedProcessState
	if err := json.Unmarshal(raw, &state); err != nil {
		return nil, err
	}
	return &state, nil
}

func (manager *processManager) writePersistedState(managed *managedProcess) error {
	if managed == nil || managed.run == nil {
		return nil
	}
	state := &persistedProcessState{
		RunID:             strings.TrimSpace(managed.run.GetRunId()),
		DesiredProcessID:  managed.run.GetDesiredProcessId(),
		ProcessKey:        strings.TrimSpace(managed.run.GetProcessKey()),
		ProjectPath:       strings.TrimSpace(managed.run.GetProjectPath()),
		PackageKey:        strings.TrimSpace(managed.run.GetPackageKey()),
		Pid:               int(managed.run.GetPid()),
		Pgid:              int(managed.run.GetPgid()),
		BootID:            strings.TrimSpace(managed.run.GetBootId()),
		LaunchFingerprint: strings.TrimSpace(managed.run.GetLaunchFingerprint()),
		Command:           strings.TrimSpace(managed.run.GetCommand()),
		Args:              append([]string{}, managed.run.GetArgs()...),
		Cwd:               strings.TrimSpace(managed.run.GetCwd()),
		EnvHash:           strings.TrimSpace(managed.run.GetEnvHash()),
		LogPath:           strings.TrimSpace(managed.run.GetLogPath()),
		StartedAt:         strings.TrimSpace(managed.run.GetStartedAt()),
		UpdatedAt:         time.Now().UTC().Format(time.RFC3339Nano),
	}
	encoded, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return err
	}
	stateFilePath := managed.stateFilePath
	if stateFilePath == "" {
		stateFilePath = filepath.Join(manager.processStateRoot, sanitizeStateToken(managed.run.GetProcessKey())+".json")
		managed.stateFilePath = stateFilePath
	}
	return os.WriteFile(stateFilePath, append(encoded, '\n'), 0o644)
}

func (manager *processManager) removePersistedState(managed *managedProcess) {
	if managed == nil || strings.TrimSpace(managed.stateFilePath) == "" {
		return
	}
	_ = os.Remove(managed.stateFilePath)
}

func (manager *processManager) refreshWatchStateLocked(managed *managedProcess) error {
	if managed == nil {
		return nil
	}
	projectPath := strings.TrimSpace(managed.run.GetProjectPath())
	if projectPath == "" {
		managed.matcher = nil
		managed.lastSignature = ""
		managed.hasWatchRoot = false
		return nil
	}
	matcher, err := loadGitignoreMatcher(projectPath)
	if err != nil {
		return err
	}
	signature, hasWatchRoot, err := computePackagesWatchSignature(projectPath, matcher)
	if err != nil {
		return err
	}
	managed.matcher = matcher
	managed.lastSignature = signature
	managed.hasWatchRoot = hasWatchRoot
	return nil
}

func (manager *processManager) startDesiredProcessLocked(desired *slavev1.DesiredProcess, source string, adopted bool) error {
	if desired == nil {
		return fmt.Errorf("desired process is required")
	}
	desired = normalizeDesiredProcess(desired)
	if desired == nil {
		return fmt.Errorf("desired process is invalid")
	}
	delete(manager.completedNever, strings.TrimSpace(desired.GetProcessKey()))
	processLogRoot := manager.processLogRoot
	if strings.TrimSpace(desired.GetLogRoot()) != "" {
		processLogRoot = strings.TrimSpace(desired.GetLogRoot())
	}
	runID, err := newRunID()
	if err != nil {
		return err
	}
	bootLogRoot := filepath.Join(processLogRoot, sanitizeStateToken(manager.bootID))
	if err := os.MkdirAll(bootLogRoot, 0o755); err != nil {
		return fmt.Errorf("create process log directory: %w", err)
	}
	var command *exec.Cmd
	switch strings.ToLower(strings.TrimSpace(desired.GetLaunchMode())) {
	case "", "exec":
		command = exec.CommandContext(context.Background(), desired.GetCommand(), desired.GetArgs()...)
	case "shell":
		command = exec.CommandContext(context.Background(), "sh", "-lc", desired.GetCommand())
	default:
		return fmt.Errorf("unsupported launch mode: %s", desired.GetLaunchMode())
	}
	command.Dir = strings.TrimSpace(desired.GetCwd())
	command.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	command.Env = mergeProcessEnvironment(desired.GetEnv(), map[string]string{
		"PC_MANAGED_PROCESS": "1",
		"PC_RUN_ID":          runID,
		"PC_PROCESS_KEY":     desired.GetProcessKey(),
		"PC_SLAVE_ID":        manager.slaveID,
		"PC_BOOT_ID":         manager.bootID,
	})

	tempLogPath := filepath.Join(bootLogRoot, runID+".pending.log")
	logFile, err := os.OpenFile(tempLogPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return fmt.Errorf("open process log file: %w", err)
	}
	command.Stdout = logFile
	command.Stderr = logFile
	if err := command.Start(); err != nil {
		_ = logFile.Close()
		return fmt.Errorf("start process: %w", err)
	}
	_ = logFile.Close()

	pid := command.Process.Pid
	pgid := processGroupID(pid)
	logPath := filepath.Join(bootLogRoot, fmt.Sprintf("%d.log", pid))
	if renameErr := os.Rename(tempLogPath, logPath); renameErr != nil {
		logPath = tempLogPath
	}
	now := time.Now().UTC()
	run := manager.nextObservedRun(desired, runID, pid, pgid, logPath, adopted, source, now)
	managed := &managedProcess{
		desired:       cloneDesiredProcess(desired),
		run:           run,
		cmd:           command,
		stateFilePath: filepath.Join(manager.processStateRoot, sanitizeStateToken(desired.GetProcessKey())+".json"),
		adopted:       adopted,
	}
	if err := manager.refreshWatchStateLocked(managed); err != nil {
		manager.logger.Warn("failed to initialize process watch state", "process_key", desired.GetProcessKey(), "error", err.Error())
	}
	manager.processes[desired.GetProcessKey()] = managed
	if err := manager.writePersistedState(managed); err != nil {
		manager.logger.Warn("failed to persist managed process state", "process_key", desired.GetProcessKey(), "error", err.Error())
	}
	manager.appendChange(changeTypeStarted, "started desired process", desired, run)
	manager.logger.Debug(
		"managed process started",
		"process_key",
		desired.GetProcessKey(),
		"pid",
		pid,
		"pgid",
		pgid,
		"log_path",
		logPath,
		"launch_mode",
		desired.GetLaunchMode(),
		"command",
		desired.GetCommand(),
	)
	go manager.captureProcessExit(desired.GetProcessKey(), command)
	return nil
}

func (manager *processManager) captureProcessExit(processKey string, command *exec.Cmd) {
	result := waitForManagedProcess(command)
	manager.mu.Lock()
	defer manager.mu.Unlock()
	managed := manager.processes[strings.TrimSpace(processKey)]
	if managed == nil || managed.run == nil {
		return
	}
	if managed.cmd != command {
		return
	}
	managed.exitResult = result
}

func (manager *processManager) finalizeExitedProcessLocked(managed *managedProcess, exit *processExit, reason string, source string) {
	if managed == nil || managed.run == nil {
		return
	}
	now := time.Now().UTC()
	run := cloneObservedProcessRun(managed.run)
	if run == nil {
		return
	}
	if exit != nil {
		run.ExitCode = exit.exitCode
		run.ExitSignal = strings.TrimSpace(exit.exitSignal)
		run.Status = strings.TrimSpace(exit.status)
	} else if run.GetStatus() == "" || run.GetStatus() == processStatusRunning || run.GetStatus() == processStatusStopping {
		run.Status = processStatusExited
	}
	run.ExitedAt = now.Format(time.RFC3339Nano)
	run.LastSeenAt = run.ExitedAt
	run.ReconciliationSource = source
	delete(manager.processes, run.GetProcessKey())
	manager.removePersistedState(managed)
	if shouldRememberCompletedNeverProcess(managed.desired) {
		manager.completedNever[strings.TrimSpace(run.GetProcessKey())] = completedNeverFingerprint(managed.desired)
	} else {
		delete(manager.completedNever, strings.TrimSpace(run.GetProcessKey()))
	}
	manager.appendChange(changeTypeExited, reason, managed.desired, run)
}

func (manager *processManager) stopManagedProcessLocked(
	managed *managedProcess,
	finalStatus string,
	reason string,
	source string,
	soft bool,
) {
	if managed == nil || managed.run == nil {
		return
	}
	pid := int(managed.run.GetPid())
	pgid := int(managed.run.GetPgid())
	if pid <= 0 {
		manager.finalizeExitedProcessLocked(managed, &processExit{status: finalStatus, completed: time.Now().UTC()}, reason, source)
		return
	}
	managed.awaitingExit = true
	managed.expectedSignal = finalStatus
	managed.run.Status = processStatusStopping
	managed.run.LastSeenAt = time.Now().UTC().Format(time.RFC3339Nano)
	if err := manager.writePersistedState(managed); err != nil {
		manager.logger.Warn("failed to persist stopping state", "process_key", managed.run.GetProcessKey(), "error", err.Error())
	}

	signal := syscall.SIGTERM
	timeout := processStopTimeout
	if !soft {
		signal = syscall.SIGKILL
		timeout = 500 * time.Millisecond
	}
	if err := sendSignalToProcessGroupOrProcess(pid, pgid, signal); err != nil {
		manager.logger.Warn("failed to signal managed process", "process_key", managed.run.GetProcessKey(), "pid", pid, "pgid", pgid, "error", err.Error())
	}
	if signal == syscall.SIGTERM && !waitForProcessExit(pid, timeout) {
		_ = sendSignalToProcessGroupOrProcess(pid, pgid, syscall.SIGKILL)
		waitForProcessExit(pid, 2*time.Second)
		finalStatus = processStatusKilled
	}
	run := cloneObservedProcessRun(managed.run)
	if run == nil {
		return
	}
	run.Status = finalStatus
	run.ExitSignal = signal.String()
	run.ExitedAt = time.Now().UTC().Format(time.RFC3339Nano)
	run.LastSeenAt = run.ExitedAt
	run.ReconciliationSource = source
	delete(manager.processes, run.GetProcessKey())
	manager.removePersistedState(managed)
	manager.appendChange(changeTypeKilled, reason, managed.desired, run)
	manager.logger.Debug(
		"managed process stopped",
		"process_key",
		run.GetProcessKey(),
		"pid",
		run.GetPid(),
		"status",
		finalStatus,
		"reason",
		reason,
	)
}

func (manager *processManager) Tick(ctx context.Context) error {
	manager.mu.Lock()
	defer manager.mu.Unlock()

	for _, managed := range manager.processes {
		if managed == nil || managed.run == nil {
			continue
		}
		if managed.exitResult != nil {
			exitResult := managed.exitResult
			managed.exitResult = nil
			manager.finalizeExitedProcessLocked(managed, exitResult, "managed process exited", reconciliationSourceTick)
			continue
		}
		pid := int(managed.run.GetPid())
		if !processExists(pid) {
			manager.finalizeExitedProcessLocked(managed, nil, "managed process no longer exists", reconciliationSourceTick)
			continue
		}
		managed.run.LastSeenAt = time.Now().UTC().Format(time.RFC3339Nano)
		if err := manager.writePersistedState(managed); err != nil {
			manager.logger.Warn("failed to refresh persisted process state", "process_key", managed.run.GetProcessKey(), "error", err.Error())
		}
		if managed.desired == nil || strings.EqualFold(managed.desired.GetDesiredState(), "stopped") {
			continue
		}
		if !strings.Contains(strings.ToLower(managed.desired.GetRestartPolicy()), "package_change") {
			continue
		}
		projectPath := strings.TrimSpace(managed.run.GetProjectPath())
		if projectPath == "" {
			continue
		}
		matcher, err := loadGitignoreMatcher(projectPath)
		if err != nil {
			manager.logger.Warn("failed to refresh process gitignore matcher", "process_key", managed.run.GetProcessKey(), "error", err.Error())
			continue
		}
		nextSignature, hasWatchRoot, err := computePackagesWatchSignature(projectPath, matcher)
		if err != nil {
			manager.logger.Warn("failed to compute process package watch signature", "process_key", managed.run.GetProcessKey(), "error", err.Error())
			continue
		}
		if !hasWatchRoot {
			managed.hasWatchRoot = false
			continue
		}
		if !managed.hasWatchRoot {
			managed.hasWatchRoot = true
			managed.lastSignature = nextSignature
			managed.matcher = matcher
			continue
		}
		if nextSignature == managed.lastSignature {
			continue
		}
		managed.lastSignature = nextSignature
		desired := cloneDesiredProcess(managed.desired)
		manager.stopManagedProcessLocked(managed, processStatusReplaced, "packages directory changed", reconciliationSourceTick, false)
		if err := manager.startDesiredProcessLocked(desired, reconciliationSourceTick, false); err != nil {
			manager.logger.Error("failed to restart process after package change", "process_key", desired.GetProcessKey(), "error", err.Error())
			manager.appendChange(changeTypeMissing, "failed to restart after package change: "+err.Error(), desired, nil)
		}
	}
	return ctx.Err()
}

func (manager *processManager) RunningServices() int32 {
	manager.mu.Lock()
	defer manager.mu.Unlock()
	var running int32
	for _, managed := range manager.processes {
		if managed == nil || managed.run == nil {
			continue
		}
		if managed.run.GetStatus() == processStatusRunning || managed.run.GetStatus() == processStatusOrphaned {
			running += 1
		}
	}
	return running
}

func (manager *processManager) ObservedRuns() []*slavev1.ObservedProcessRun {
	manager.mu.Lock()
	defer manager.mu.Unlock()
	runs := make([]*slavev1.ObservedProcessRun, 0, len(manager.processes))
	for _, managed := range manager.processes {
		if managed == nil || managed.run == nil {
			continue
		}
		run := cloneObservedProcessRun(managed.run)
		if run == nil {
			continue
		}
		run.LastSeenAt = time.Now().UTC().Format(time.RFC3339Nano)
		runs = append(runs, run)
	}
	sort.Slice(runs, func(i, j int) bool {
		if runs[i].GetProcessKey() != runs[j].GetProcessKey() {
			return runs[i].GetProcessKey() < runs[j].GetProcessKey()
		}
		return runs[i].GetRunId() < runs[j].GetRunId()
	})
	return runs
}

func (manager *processManager) RuntimeSequence() int64 {
	manager.mu.Lock()
	defer manager.mu.Unlock()
	return manager.runtimeSequence
}

func (manager *processManager) DrainPendingReconciliationChanges() []*slavev1.ProcessReconciliationChange {
	manager.mu.Lock()
	defer manager.mu.Unlock()
	if len(manager.pendingChanges) == 0 {
		return nil
	}
	changes := make([]*slavev1.ProcessReconciliationChange, 0, len(manager.pendingChanges))
	for _, change := range manager.pendingChanges {
		changes = append(changes, cloneReconciliationChange(change))
	}
	manager.pendingChanges = manager.pendingChanges[:0]
	return changes
}

func (manager *processManager) RequeuePendingReconciliationChanges(changes []*slavev1.ProcessReconciliationChange) {
	if len(changes) == 0 {
		return
	}
	manager.mu.Lock()
	defer manager.mu.Unlock()
	requeued := make([]*slavev1.ProcessReconciliationChange, 0, len(changes)+len(manager.pendingChanges))
	for _, change := range changes {
		requeued = append(requeued, cloneReconciliationChange(change))
	}
	manager.pendingChanges = append(requeued, manager.pendingChanges...)
}

func (manager *processManager) ExecuteLaunchCommand(command *slavev1.LaunchProcessCommand) error {
	manager.mu.Lock()
	defer manager.mu.Unlock()
	if command == nil {
		return fmt.Errorf("launch process command is required")
	}
	desired := normalizeDesiredProcess(&slavev1.DesiredProcess{
		ProcessKey:          strings.TrimSpace(command.GetProcessKey()),
		ProjectPath:         strings.TrimSpace(command.GetProjectPath()),
		PackageKey:          strings.TrimSpace(command.GetPackageKey()),
		PackageRelativePath: strings.TrimSpace(command.GetPackageRelativePath()),
		DesiredState:        "running",
		LaunchMode:          "exec",
		Cwd:                 strings.TrimSpace(command.GetCwd()),
		Command:             strings.TrimSpace(command.GetCommand()),
		Args:                append([]string{}, command.GetArgs()...),
		Env:                 cloneProcessEnvEntries(command.GetEnv()),
		EnvHash:             strings.TrimSpace(command.GetEnvHash()),
		LaunchFingerprint:   strings.TrimSpace(command.GetLaunchFingerprint()),
		LogRoot:             strings.TrimSpace(command.GetLogRoot()),
		RestartPolicy:       "manual",
	})
	if desired == nil {
		return fmt.Errorf("launch process command is invalid")
	}
	if existing := manager.processes[desired.GetProcessKey()]; existing != nil {
		manager.stopManagedProcessLocked(existing, processStatusReplaced, "launch command replaced existing process", reconciliationSourceCommand, false)
	}
	return manager.startDesiredProcessLocked(desired, reconciliationSourceCommand, false)
}

func (manager *processManager) ExecuteKillCommand(command *slavev1.KillProcessCommand, hard bool) error {
	manager.mu.Lock()
	defer manager.mu.Unlock()
	if command == nil {
		return fmt.Errorf("kill process command is required")
	}
	var target *managedProcess
	runID := strings.TrimSpace(command.GetRunId())
	processKey := strings.TrimSpace(command.GetProcessKey())
	for _, managed := range manager.processes {
		if managed == nil || managed.run == nil {
			continue
		}
		if runID != "" && strings.TrimSpace(managed.run.GetRunId()) == runID {
			target = managed
			break
		}
		if processKey != "" && strings.TrimSpace(managed.run.GetProcessKey()) == processKey {
			target = managed
			break
		}
		if command.GetPid() > 0 && managed.run.GetPid() == command.GetPid() {
			target = managed
			break
		}
	}
	if target == nil {
		return fmt.Errorf("target process was not found")
	}
	reason := strings.TrimSpace(command.GetReason())
	if reason == "" {
		reason = "kill command requested"
	}
	manager.stopManagedProcessLocked(target, processStatusKilled, reason, reconciliationSourceKill, !hard)
	return nil
}
