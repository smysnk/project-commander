package master

import (
	"context"
	"sort"
	"strings"
	"time"

	masterv1 "github.com/josh/project-commander/packages/agent-shared/gen/projectcommander/master/v1"
	slavev1 "github.com/josh/project-commander/packages/agent-shared/gen/projectcommander/slave/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

const (
	eventTypeSlaveProcessReconciliation = "slave.process_reconciliation"
	eventTypeSlaveRuntimeTelemetry      = "slave.runtime_telemetry"
	runtimeStateStatusUnknown           = "unknown"
	runtimeStateStatusRegistered        = "registered"
	runtimeStateStatusConnected         = "connected"
	runtimeStateStatusDisconnected      = "disconnected"
	runtimeStateStatusDrained           = "drained"
)

type slaveRuntimeState struct {
	SlaveID          string
	BootID           string
	Status           string
	HostTelemetry    *slavev1.HostTelemetrySample
	ObservedRuns     map[string]*slavev1.ObservedProcessRun
	ProcessTelemetry map[string]*slavev1.ProcessTelemetrySample
	UpdatedAt        time.Time
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
	processKey := strings.TrimSpace(input.GetProcessKey())
	if processKey == "" {
		return nil
	}
	packageKey := strings.TrimSpace(input.GetPackageKey())
	if packageKey == "" {
		packageKey = processKey
	}
	desiredState := strings.TrimSpace(input.GetDesiredState())
	if desiredState == "" {
		desiredState = "running"
	}
	launchMode := strings.TrimSpace(input.GetLaunchMode())
	if launchMode == "" {
		launchMode = "exec"
	}
	return &slavev1.DesiredProcess{
		DesiredProcessId:    input.GetDesiredProcessId(),
		HostId:              input.GetHostId(),
		ProjectId:           input.GetProjectId(),
		ServiceId:           input.GetServiceId(),
		ProcessKey:          processKey,
		ProjectPath:         strings.TrimSpace(input.GetProjectPath()),
		PackageKey:          packageKey,
		PackageRelativePath: strings.TrimSpace(input.GetPackageRelativePath()),
		DesiredState:        desiredState,
		LaunchMode:          launchMode,
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

func cloneDesiredProcesses(input []*slavev1.DesiredProcess) []*slavev1.DesiredProcess {
	cloned := make([]*slavev1.DesiredProcess, 0, len(input))
	for _, desiredProcess := range input {
		candidate := cloneDesiredProcess(desiredProcess)
		if candidate == nil {
			continue
		}
		cloned = append(cloned, candidate)
	}
	sort.Slice(cloned, func(i, j int) bool {
		return cloned[i].GetProcessKey() < cloned[j].GetProcessKey()
	})
	return cloned
}

func cloneObservedProcessRun(input *slavev1.ObservedProcessRun) *slavev1.ObservedProcessRun {
	if input == nil {
		return nil
	}
	runID := strings.TrimSpace(input.GetRunId())
	processKey := strings.TrimSpace(input.GetProcessKey())
	if runID == "" && processKey == "" {
		return nil
	}
	return &slavev1.ObservedProcessRun{
		RunId:                runID,
		DesiredProcessId:     input.GetDesiredProcessId(),
		ProcessKey:           processKey,
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

func cloneProcessTelemetrySample(input *slavev1.ProcessTelemetrySample) *slavev1.ProcessTelemetrySample {
	if input == nil {
		return nil
	}
	runID := strings.TrimSpace(input.GetRunId())
	processKey := strings.TrimSpace(input.GetProcessKey())
	if runID == "" && processKey == "" {
		return nil
	}
	return &slavev1.ProcessTelemetrySample{
		RunId:         runID,
		ProcessKey:    processKey,
		Pid:           input.GetPid(),
		SampledAt:     strings.TrimSpace(input.GetSampledAt()),
		CpuPercent:    input.GetCpuPercent(),
		MemoryPercent: input.GetMemoryPercent(),
		RssBytes:      input.GetRssBytes(),
		VmsBytes:      input.GetVmsBytes(),
		ReadBytes:     input.GetReadBytes(),
		WriteBytes:    input.GetWriteBytes(),
		ReadOps:       input.GetReadOps(),
		WriteOps:      input.GetWriteOps(),
		OpenFds:       input.GetOpenFds(),
		ThreadCount:   input.GetThreadCount(),
		Status:        strings.TrimSpace(input.GetStatus()),
	}
}

func cloneHostTelemetrySample(input *slavev1.HostTelemetrySample) *slavev1.HostTelemetrySample {
	if input == nil {
		return nil
	}
	sampledAt := strings.TrimSpace(input.GetSampledAt())
	if sampledAt == "" &&
		input.GetCpuPercent() == 0 &&
		input.GetMemoryTotalBytes() == 0 &&
		input.GetDiskTotalBytes() == 0 {
		return nil
	}
	return &slavev1.HostTelemetrySample{
		SampledAt:            sampledAt,
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

func cloneObservedRuns(input []*slavev1.ObservedProcessRun) []*slavev1.ObservedProcessRun {
	cloned := make([]*slavev1.ObservedProcessRun, 0, len(input))
	for _, observedRun := range input {
		candidate := cloneObservedProcessRun(observedRun)
		if candidate == nil {
			continue
		}
		cloned = append(cloned, candidate)
	}
	sort.Slice(cloned, func(i, j int) bool {
		if cloned[i].GetProcessKey() != cloned[j].GetProcessKey() {
			return cloned[i].GetProcessKey() < cloned[j].GetProcessKey()
		}
		return cloned[i].GetRunId() < cloned[j].GetRunId()
	})
	return cloned
}

func cloneProcessTelemetry(input []*slavev1.ProcessTelemetrySample) []*slavev1.ProcessTelemetrySample {
	cloned := make([]*slavev1.ProcessTelemetrySample, 0, len(input))
	for _, sample := range input {
		candidate := cloneProcessTelemetrySample(sample)
		if candidate == nil {
			continue
		}
		cloned = append(cloned, candidate)
	}
	sort.Slice(cloned, func(i, j int) bool {
		if cloned[i].GetProcessKey() != cloned[j].GetProcessKey() {
			return cloned[i].GetProcessKey() < cloned[j].GetProcessKey()
		}
		return cloned[i].GetRunId() < cloned[j].GetRunId()
	})
	return cloned
}

func cloneObservedRunMap(input map[string]*slavev1.ObservedProcessRun) []*slavev1.ObservedProcessRun {
	cloned := make([]*slavev1.ObservedProcessRun, 0, len(input))
	for _, observedRun := range input {
		candidate := cloneObservedProcessRun(observedRun)
		if candidate == nil {
			continue
		}
		cloned = append(cloned, candidate)
	}
	sort.Slice(cloned, func(i, j int) bool {
		if cloned[i].GetProcessKey() != cloned[j].GetProcessKey() {
			return cloned[i].GetProcessKey() < cloned[j].GetProcessKey()
		}
		return cloned[i].GetRunId() < cloned[j].GetRunId()
	})
	return cloned
}

func cloneProcessTelemetryMap(input map[string]*slavev1.ProcessTelemetrySample) []*slavev1.ProcessTelemetrySample {
	cloned := make([]*slavev1.ProcessTelemetrySample, 0, len(input))
	for _, sample := range input {
		candidate := cloneProcessTelemetrySample(sample)
		if candidate == nil {
			continue
		}
		cloned = append(cloned, candidate)
	}
	sort.Slice(cloned, func(i, j int) bool {
		if cloned[i].GetProcessKey() != cloned[j].GetProcessKey() {
			return cloned[i].GetProcessKey() < cloned[j].GetProcessKey()
		}
		return cloned[i].GetRunId() < cloned[j].GetRunId()
	})
	return cloned
}

func desiredProcessPayload(desiredProcess *slavev1.DesiredProcess) map[string]any {
	if desiredProcess == nil {
		return map[string]any{}
	}
	env := make([]map[string]any, 0, len(desiredProcess.GetEnv()))
	for _, entry := range desiredProcess.GetEnv() {
		if entry == nil {
			continue
		}
		env = append(env, map[string]any{
			"key":   entry.GetKey(),
			"value": entry.GetValue(),
		})
	}
	return map[string]any{
		"desiredProcessId":    desiredProcess.GetDesiredProcessId(),
		"hostId":              desiredProcess.GetHostId(),
		"projectId":           desiredProcess.GetProjectId(),
		"serviceId":           desiredProcess.GetServiceId(),
		"processKey":          desiredProcess.GetProcessKey(),
		"projectPath":         desiredProcess.GetProjectPath(),
		"packageKey":          desiredProcess.GetPackageKey(),
		"packageRelativePath": desiredProcess.GetPackageRelativePath(),
		"desiredState":        desiredProcess.GetDesiredState(),
		"launchMode":          desiredProcess.GetLaunchMode(),
		"cwd":                 desiredProcess.GetCwd(),
		"command":             desiredProcess.GetCommand(),
		"args":                append([]string{}, desiredProcess.GetArgs()...),
		"env":                 env,
		"envHash":             desiredProcess.GetEnvHash(),
		"launchFingerprint":   desiredProcess.GetLaunchFingerprint(),
		"logRoot":             desiredProcess.GetLogRoot(),
		"restartPolicy":       desiredProcess.GetRestartPolicy(),
		"updatedAt":           desiredProcess.GetUpdatedAt(),
	}
}

func observedProcessRunPayload(observedRun *slavev1.ObservedProcessRun) map[string]any {
	if observedRun == nil {
		return map[string]any{}
	}
	return map[string]any{
		"runId":                observedRun.GetRunId(),
		"desiredProcessId":     observedRun.GetDesiredProcessId(),
		"processKey":           observedRun.GetProcessKey(),
		"projectPath":          observedRun.GetProjectPath(),
		"packageKey":           observedRun.GetPackageKey(),
		"pid":                  observedRun.GetPid(),
		"pgid":                 observedRun.GetPgid(),
		"bootId":               observedRun.GetBootId(),
		"launchFingerprint":    observedRun.GetLaunchFingerprint(),
		"command":              observedRun.GetCommand(),
		"args":                 append([]string{}, observedRun.GetArgs()...),
		"cwd":                  observedRun.GetCwd(),
		"envHash":              observedRun.GetEnvHash(),
		"status":               observedRun.GetStatus(),
		"startedAt":            observedRun.GetStartedAt(),
		"lastSeenAt":           observedRun.GetLastSeenAt(),
		"exitedAt":             observedRun.GetExitedAt(),
		"exitCode":             observedRun.GetExitCode(),
		"exitSignal":           observedRun.GetExitSignal(),
		"logPath":              observedRun.GetLogPath(),
		"adopted":              observedRun.GetAdopted(),
		"reconciliationSource": observedRun.GetReconciliationSource(),
	}
}

func processTelemetryPayload(sample *slavev1.ProcessTelemetrySample) map[string]any {
	if sample == nil {
		return map[string]any{}
	}
	return map[string]any{
		"runId":         sample.GetRunId(),
		"processKey":    sample.GetProcessKey(),
		"pid":           sample.GetPid(),
		"sampledAt":     sample.GetSampledAt(),
		"cpuPercent":    sample.GetCpuPercent(),
		"memoryPercent": sample.GetMemoryPercent(),
		"rssBytes":      sample.GetRssBytes(),
		"vmsBytes":      sample.GetVmsBytes(),
		"readBytes":     sample.GetReadBytes(),
		"writeBytes":    sample.GetWriteBytes(),
		"readOps":       sample.GetReadOps(),
		"writeOps":      sample.GetWriteOps(),
		"openFds":       sample.GetOpenFds(),
		"threadCount":   sample.GetThreadCount(),
		"status":        sample.GetStatus(),
	}
}

func hostTelemetryPayload(sample *slavev1.HostTelemetrySample) map[string]any {
	if sample == nil {
		return map[string]any{}
	}
	return map[string]any{
		"sampledAt":            sample.GetSampledAt(),
		"cpuPercent":           sample.GetCpuPercent(),
		"load1m":               sample.GetLoad_1M(),
		"load5m":               sample.GetLoad_5M(),
		"load15m":              sample.GetLoad_15M(),
		"memoryTotalBytes":     sample.GetMemoryTotalBytes(),
		"memoryUsedBytes":      sample.GetMemoryUsedBytes(),
		"memoryAvailableBytes": sample.GetMemoryAvailableBytes(),
		"diskTotalBytes":       sample.GetDiskTotalBytes(),
		"diskUsedBytes":        sample.GetDiskUsedBytes(),
		"diskAvailableBytes":   sample.GetDiskAvailableBytes(),
		"diskMount":            sample.GetDiskMount(),
	}
}

func processReconciliationChangePayload(change *slavev1.ProcessReconciliationChange) map[string]any {
	if change == nil {
		return map[string]any{}
	}
	payload := map[string]any{
		"changeType": strings.TrimSpace(change.GetChangeType()),
		"reason":     strings.TrimSpace(change.GetReason()),
	}
	if desiredProcess := cloneDesiredProcess(change.GetDesiredProcess()); desiredProcess != nil {
		payload["desiredProcess"] = desiredProcessPayload(desiredProcess)
	}
	if observedRun := cloneObservedProcessRun(change.GetObservedRun()); observedRun != nil {
		payload["observedRun"] = observedProcessRunPayload(observedRun)
	}
	return payload
}

func runtimeStatePayload(slaveID string, runtimeState *slaveRuntimeState, desiredProcesses []*slavev1.DesiredProcess) map[string]any {
	normalizedSlaveID := strings.TrimSpace(slaveID)
	payload := map[string]any{
		"slaveId": normalizedSlaveID,
	}
	if runtimeState == nil {
		payload["status"] = runtimeStateStatusUnknown
		return payload
	}
	payload["bootId"] = strings.TrimSpace(runtimeState.BootID)
	payload["status"] = strings.TrimSpace(runtimeState.Status)
	payload["updatedAt"] = runtimeState.UpdatedAt.UTC().Format(time.RFC3339Nano)
	if hostTelemetry := cloneHostTelemetrySample(runtimeState.HostTelemetry); hostTelemetry != nil {
		payload["hostTelemetry"] = hostTelemetryPayload(hostTelemetry)
	}
	if len(desiredProcesses) > 0 {
		next := make([]map[string]any, 0, len(desiredProcesses))
		for _, desiredProcess := range desiredProcesses {
			next = append(next, desiredProcessPayload(desiredProcess))
		}
		payload["desiredProcesses"] = next
	}
	if len(runtimeState.ObservedRuns) > 0 {
		next := make([]map[string]any, 0, len(runtimeState.ObservedRuns))
		for _, observedRun := range cloneObservedRunMap(runtimeState.ObservedRuns) {
			next = append(next, observedProcessRunPayload(observedRun))
		}
		payload["observedRuns"] = next
	}
	if len(runtimeState.ProcessTelemetry) > 0 {
		next := make([]map[string]any, 0, len(runtimeState.ProcessTelemetry))
		for _, sample := range cloneProcessTelemetryMap(runtimeState.ProcessTelemetry) {
			next = append(next, processTelemetryPayload(sample))
		}
		payload["processTelemetry"] = next
	}
	return payload
}

func reconciliationPayload(slaveID string, bootID string, changes []*slavev1.ProcessReconciliationChange, observedRuns []*slavev1.ObservedProcessRun, updatedAt time.Time) map[string]any {
	payload := map[string]any{
		"slaveId": strings.TrimSpace(slaveID),
		"bootId":  strings.TrimSpace(bootID),
	}
	if !updatedAt.IsZero() {
		payload["updatedAt"] = updatedAt.UTC().Format(time.RFC3339Nano)
	}
	if len(changes) > 0 {
		next := make([]map[string]any, 0, len(changes))
		for _, change := range changes {
			next = append(next, processReconciliationChangePayload(change))
		}
		payload["changes"] = next
	}
	if len(observedRuns) > 0 {
		next := make([]map[string]any, 0, len(observedRuns))
		for _, observedRun := range cloneObservedRuns(observedRuns) {
			next = append(next, observedProcessRunPayload(observedRun))
		}
		payload["observedRuns"] = next
	}
	return payload
}

func runtimeStateStatus(value string) string {
	normalized := strings.TrimSpace(strings.ToLower(value))
	switch normalized {
	case runtimeStateStatusRegistered:
		return runtimeStateStatusRegistered
	case runtimeStateStatusConnected:
		return runtimeStateStatusConnected
	case runtimeStateStatusDisconnected:
		return runtimeStateStatusDisconnected
	case runtimeStateStatusDrained:
		return runtimeStateStatusDrained
	default:
		return runtimeStateStatusUnknown
	}
}

func (s *Server) ensureSlaveRuntimeStateLocked(slaveID string) *slaveRuntimeState {
	if s == nil {
		return nil
	}
	normalizedSlaveID := strings.TrimSpace(slaveID)
	if normalizedSlaveID == "" {
		return nil
	}
	runtimeState := s.slaveRuntimeState[normalizedSlaveID]
	if runtimeState == nil {
		runtimeState = &slaveRuntimeState{
			SlaveID:          normalizedSlaveID,
			Status:           runtimeStateStatusUnknown,
			ObservedRuns:     map[string]*slavev1.ObservedProcessRun{},
			ProcessTelemetry: map[string]*slavev1.ProcessTelemetrySample{},
		}
		s.slaveRuntimeState[normalizedSlaveID] = runtimeState
	}
	if runtimeState.ObservedRuns == nil {
		runtimeState.ObservedRuns = map[string]*slavev1.ObservedProcessRun{}
	}
	if runtimeState.ProcessTelemetry == nil {
		runtimeState.ProcessTelemetry = map[string]*slavev1.ProcessTelemetrySample{}
	}
	return runtimeState
}

func (s *Server) desiredProcessesForSlaveLocked(slaveID string) []*slavev1.DesiredProcess {
	if s == nil {
		return nil
	}
	normalizedSlaveID := strings.TrimSpace(slaveID)
	if normalizedSlaveID == "" {
		return nil
	}
	desiredByProcessKey := s.slaveDesiredProcesses[normalizedSlaveID]
	if len(desiredByProcessKey) == 0 {
		return nil
	}
	desiredProcesses := make([]*slavev1.DesiredProcess, 0, len(desiredByProcessKey))
	for _, desiredProcess := range desiredByProcessKey {
		candidate := cloneDesiredProcess(desiredProcess)
		if candidate == nil {
			continue
		}
		desiredProcesses = append(desiredProcesses, candidate)
	}
	sort.Slice(desiredProcesses, func(i, j int) bool {
		return desiredProcesses[i].GetProcessKey() < desiredProcesses[j].GetProcessKey()
	})
	return desiredProcesses
}

func (s *Server) replaceObservedRunsLocked(runtimeState *slaveRuntimeState, observedRuns []*slavev1.ObservedProcessRun) {
	if runtimeState == nil {
		return
	}
	next := map[string]*slavev1.ObservedProcessRun{}
	for _, observedRun := range observedRuns {
		candidate := cloneObservedProcessRun(observedRun)
		if candidate == nil {
			continue
		}
		key := strings.TrimSpace(candidate.GetRunId())
		if key == "" {
			key = strings.TrimSpace(candidate.GetProcessKey())
		}
		if key == "" {
			continue
		}
		next[key] = candidate
	}
	runtimeState.ObservedRuns = next
}

func (s *Server) replaceProcessTelemetryLocked(runtimeState *slaveRuntimeState, samples []*slavev1.ProcessTelemetrySample) {
	if runtimeState == nil {
		return
	}
	next := map[string]*slavev1.ProcessTelemetrySample{}
	for _, sample := range samples {
		candidate := cloneProcessTelemetrySample(sample)
		if candidate == nil {
			continue
		}
		key := strings.TrimSpace(candidate.GetRunId())
		if key == "" {
			key = strings.TrimSpace(candidate.GetProcessKey())
		}
		if key == "" {
			continue
		}
		next[key] = candidate
	}
	runtimeState.ProcessTelemetry = next
}

func (s *Server) setSlaveRuntimeStatusLocked(slaveID string, statusValue string, now time.Time) {
	runtimeState := s.ensureSlaveRuntimeStateLocked(slaveID)
	if runtimeState == nil {
		return
	}
	runtimeState.Status = runtimeStateStatus(statusValue)
	runtimeState.UpdatedAt = now
}

func (s *Server) buildSlaveRuntimeStateLocked(slaveID string) *masterv1.SlaveRuntimeState {
	normalizedSlaveID := strings.TrimSpace(slaveID)
	if normalizedSlaveID == "" {
		return nil
	}
	runtimeState := s.ensureSlaveRuntimeStateLocked(normalizedSlaveID)
	desiredProcesses := s.desiredProcessesForSlaveLocked(normalizedSlaveID)
	if runtimeState == nil {
		return nil
	}
	updatedAt := ""
	if !runtimeState.UpdatedAt.IsZero() {
		updatedAt = runtimeState.UpdatedAt.UTC().Format(time.RFC3339Nano)
	}
	return &masterv1.SlaveRuntimeState{
		SlaveId:          normalizedSlaveID,
		BootId:           strings.TrimSpace(runtimeState.BootID),
		Status:           strings.TrimSpace(runtimeState.Status),
		HostTelemetry:    cloneHostTelemetrySample(runtimeState.HostTelemetry),
		DesiredProcesses: desiredProcesses,
		ObservedRuns:     cloneObservedRunMap(runtimeState.ObservedRuns),
		ProcessTelemetry: cloneProcessTelemetryMap(runtimeState.ProcessTelemetry),
		UpdatedAt:        updatedAt,
	}
}

func coarseHostTelemetryFromHeartbeat(req *slavev1.HeartbeatRequest) *slavev1.HostTelemetrySample {
	if req == nil {
		return nil
	}
	if hostTelemetry := cloneHostTelemetrySample(req.GetHostTelemetry()); hostTelemetry != nil {
		return hostTelemetry
	}
	timestamp := strings.TrimSpace(req.GetTimestamp())
	if timestamp == "" && req.GetCpuPercent() == 0 {
		return nil
	}
	return &slavev1.HostTelemetrySample{
		SampledAt:  timestamp,
		CpuPercent: req.GetCpuPercent(),
	}
}

func (s *Server) UpsertDesiredProcess(ctx context.Context, req *masterv1.UpsertDesiredProcessRequest) (*masterv1.UpsertDesiredProcessResponse, error) {
	requestID := s.resolveRequestID(ctx, req.GetRequestId())
	slaveID := strings.TrimSpace(req.GetSlaveId())
	if slaveID == "" {
		return nil, status.Error(codes.InvalidArgument, "slave_id is required")
	}
	desiredProcess := cloneDesiredProcess(req.GetDesiredProcess())
	if desiredProcess == nil {
		return nil, status.Error(codes.InvalidArgument, "desired_process with process_key is required")
	}

	now := time.Now().UTC()
	s.slaveMu.Lock()
	desiredByProcessKey := s.slaveDesiredProcesses[slaveID]
	if desiredByProcessKey == nil {
		desiredByProcessKey = map[string]*slavev1.DesiredProcess{}
		s.slaveDesiredProcesses[slaveID] = desiredByProcessKey
	}
	desiredByProcessKey[desiredProcess.GetProcessKey()] = desiredProcess
	runtimeState := s.ensureSlaveRuntimeStateLocked(slaveID)
	runtimeState.UpdatedAt = now
	if runtimeState.Status == runtimeStateStatusUnknown {
		runtimeState.Status = runtimeStateStatusRegistered
	}
	s.slaveMu.Unlock()

	s.logger.Info(
		"desired process mirrored into master",
		"request_id",
		requestID,
		"slave_id",
		slaveID,
		"process_key",
		desiredProcess.GetProcessKey(),
		"package_key",
		desiredProcess.GetPackageKey(),
	)

	return &masterv1.UpsertDesiredProcessResponse{
		RequestId: requestID,
		Status:    "upserted",
	}, nil
}

func (s *Server) DeleteDesiredProcess(ctx context.Context, req *masterv1.DeleteDesiredProcessRequest) (*masterv1.DeleteDesiredProcessResponse, error) {
	requestID := s.resolveRequestID(ctx, req.GetRequestId())
	slaveID := strings.TrimSpace(req.GetSlaveId())
	if slaveID == "" {
		return nil, status.Error(codes.InvalidArgument, "slave_id is required")
	}
	processKey := strings.TrimSpace(req.GetProcessKey())
	if processKey == "" {
		return nil, status.Error(codes.InvalidArgument, "process_key is required")
	}

	statusValue := "noop"
	s.slaveMu.Lock()
	if desiredByProcessKey := s.slaveDesiredProcesses[slaveID]; desiredByProcessKey != nil {
		if _, exists := desiredByProcessKey[processKey]; exists {
			delete(desiredByProcessKey, processKey)
			statusValue = "deleted"
		}
		if len(desiredByProcessKey) == 0 {
			delete(s.slaveDesiredProcesses, slaveID)
		}
	}
	if runtimeState := s.ensureSlaveRuntimeStateLocked(slaveID); runtimeState != nil {
		runtimeState.UpdatedAt = time.Now().UTC()
	}
	s.slaveMu.Unlock()

	return &masterv1.DeleteDesiredProcessResponse{
		RequestId: requestID,
		Status:    statusValue,
	}, nil
}

func (s *Server) ListDesiredProcesses(ctx context.Context, req *masterv1.ListDesiredProcessesRequest) (*masterv1.ListDesiredProcessesResponse, error) {
	requestID := s.resolveRequestID(ctx, req.GetRequestId())
	slaveID := strings.TrimSpace(req.GetSlaveId())
	if slaveID == "" {
		return nil, status.Error(codes.InvalidArgument, "slave_id is required")
	}

	s.slaveMu.Lock()
	desiredProcesses := s.desiredProcessesForSlaveLocked(slaveID)
	s.slaveMu.Unlock()

	return &masterv1.ListDesiredProcessesResponse{
		RequestId:        requestID,
		DesiredProcesses: desiredProcesses,
	}, nil
}

func (s *Server) GetSlaveRuntimeState(ctx context.Context, req *masterv1.GetSlaveRuntimeStateRequest) (*masterv1.GetSlaveRuntimeStateResponse, error) {
	requestID := s.resolveRequestID(ctx, req.GetRequestId())
	slaveID := strings.TrimSpace(req.GetSlaveId())
	if slaveID == "" {
		return nil, status.Error(codes.InvalidArgument, "slave_id is required")
	}

	s.slaveMu.Lock()
	runtimeState := s.buildSlaveRuntimeStateLocked(slaveID)
	s.slaveMu.Unlock()
	if runtimeState == nil {
		return nil, status.Error(codes.NotFound, "slave runtime state was not found")
	}

	return &masterv1.GetSlaveRuntimeStateResponse{
		RequestId:    requestID,
		RuntimeState: runtimeState,
	}, nil
}

func (s *Server) GetDesiredProcesses(ctx context.Context, req *slavev1.GetDesiredProcessesRequest) (*slavev1.GetDesiredProcessesResponse, error) {
	requestID := s.resolveRequestID(ctx, req.GetRequestId())
	if err := s.authorizeSlaveRequest(ctx); err != nil {
		return nil, err
	}

	slaveID := strings.TrimSpace(req.GetSlaveId())
	if slaveID == "" {
		return nil, status.Error(codes.InvalidArgument, "slave_id is required")
	}

	s.slaveMu.Lock()
	runtimeState := s.ensureSlaveRuntimeStateLocked(slaveID)
	if runtimeState != nil && strings.TrimSpace(req.GetBootId()) != "" {
		runtimeState.BootID = strings.TrimSpace(req.GetBootId())
		runtimeState.UpdatedAt = time.Now().UTC()
	}
	desiredProcesses := s.desiredProcessesForSlaveLocked(slaveID)
	s.slaveMu.Unlock()

	return &slavev1.GetDesiredProcessesResponse{
		RequestId:        requestID,
		Status:           "ok",
		DesiredProcesses: desiredProcesses,
	}, nil
}

func (s *Server) ReportProcessReconciliation(ctx context.Context, req *slavev1.ReportProcessReconciliationRequest) (*slavev1.ReportProcessReconciliationResponse, error) {
	requestID := s.resolveRequestID(ctx, req.GetRequestId())
	if err := s.authorizeSlaveRequest(ctx); err != nil {
		return nil, err
	}

	slaveID := strings.TrimSpace(req.GetSlaveId())
	if slaveID == "" {
		return nil, status.Error(codes.InvalidArgument, "slave_id is required")
	}

	now := time.Now().UTC()
	changes := req.GetChanges()
	observedRuns := req.GetObservedRuns()

	s.slaveMu.Lock()
	runtimeState := s.ensureSlaveRuntimeStateLocked(slaveID)
	if runtimeState != nil {
		if bootID := strings.TrimSpace(req.GetBootId()); bootID != "" {
			runtimeState.BootID = bootID
		}
		s.replaceObservedRunsLocked(runtimeState, observedRuns)
		runtimeState.Status = runtimeStateStatusConnected
		runtimeState.UpdatedAt = now
	}
	s.slaveMu.Unlock()

	s.publishEvent(
		eventTypeSlaveProcessReconciliation,
		"",
		"",
		"",
		reconciliationPayload(slaveID, req.GetBootId(), changes, observedRuns, now),
	)

	s.logger.Info(
		"slave process reconciliation received",
		"request_id",
		requestID,
		"slave_id",
		slaveID,
		"change_count",
		len(changes),
		"observed_run_count",
		len(observedRuns),
	)

	return &slavev1.ReportProcessReconciliationResponse{
		RequestId: requestID,
		Status:    "acknowledged",
	}, nil
}

func (s *Server) QueueSlaveKill(ctx context.Context, req *masterv1.QueueSlaveKillRequest) (*masterv1.QueueSlaveKillResponse, error) {
	requestID := s.resolveRequestID(ctx, req.GetRequestId())
	slaveID := strings.TrimSpace(req.GetSlaveId())
	if slaveID == "" {
		return nil, status.Error(codes.InvalidArgument, "slave_id is required")
	}
	runID := strings.TrimSpace(req.GetRunId())
	processKey := strings.TrimSpace(req.GetProcessKey())
	pid := req.GetPid()
	if runID == "" && processKey == "" && pid <= 0 {
		return nil, status.Error(codes.InvalidArgument, "run_id, process_key, or pid is required")
	}

	now := time.Now().UTC()
	commandID := s.nextSlaveCommandID("kill")
	commandType := slaveCommandTypeSoftKillProcess
	commandPayload := &slavev1.KillProcessCommand{
		RunId:      runID,
		ProcessKey: processKey,
		Pid:        pid,
		Pgid:       0,
		Signal:     "SIGTERM",
		Reason:     strings.TrimSpace(req.GetReason()),
	}
	command := &slavev1.SlaveCommand{
		CommandId:   commandID,
		CommandType: commandType,
		RequestedAt: now.Format(time.RFC3339Nano),
		Payload: &slavev1.SlaveCommand_SoftKillProcess{
			SoftKillProcess: commandPayload,
		},
	}
	if req.GetHard() {
		commandType = slaveCommandTypeHardKillProcess
		commandPayload.Signal = "SIGKILL"
		command.CommandType = commandType
		command.Payload = &slavev1.SlaveCommand_HardKillProcess{
			HardKillProcess: commandPayload,
		}
	}

	hostName := ""
	hostIP := ""
	s.slaveMu.Lock()
	if slave := s.slaves[slaveID]; slave != nil {
		hostName = strings.TrimSpace(slave.HostName)
		hostIP = strings.TrimSpace(slave.IP)
	}
	s.slavePendingCommands[slaveID] = append(s.slavePendingCommands[slaveID], command)
	s.slaveCommandsByID[commandID] = &slaveCommandState{
		Command:     cloneSlaveCommand(command),
		SlaveID:     slaveID,
		HostName:    hostName,
		HostIP:      hostIP,
		RequestedAt: now,
	}
	s.slaveMu.Unlock()

	s.publishEvent(
		eventTypeSlaveCommandQueued,
		"",
		"",
		"",
		slaveCommandPayload(
			command,
			slaveID,
			hostName,
			hostIP,
			slaveCommandStatusQueued,
			"kill command queued for slave",
			nil,
			"",
		),
	)

	return &masterv1.QueueSlaveKillResponse{
		RequestId: requestID,
		CommandId: commandID,
		Status:    slaveCommandStatusQueued,
	}, nil
}
