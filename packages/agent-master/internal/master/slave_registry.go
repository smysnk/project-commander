package master

import (
	"context"
	"fmt"
	"net"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	masterv1 "github.com/josh/project-commander/packages/agent-shared/gen/projectcommander/master/v1"
	slavev1 "github.com/josh/project-commander/packages/agent-shared/gen/projectcommander/slave/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/peer"
	"google.golang.org/grpc/status"
)

const (
	slaveStatusRegistered   = "registered"
	slaveStatusDrained      = "drained"
	slaveStatusDisconnected = "disconnected"
	slaveHealthHealthy      = "healthy"
	slaveHealthWarning      = "warning"
	slaveHealthCritical     = "critical"
	defaultSlaveCluster     = "default"
)

type registeredSlaveState struct {
	SlaveID            string
	HostName           string
	IP                 string
	Port               int32
	Version            string
	ProtocolVersion    string
	Capabilities       []string
	DiscoveredProjects []*slavev1.DiscoveredProject
	Status             string
	Health             string
	Error              string
	RegisteredAt       time.Time
	LastSeenAt         time.Time
}

type assignedWorkloadState struct {
	WorkloadID  string
	ProjectPath string
	ServiceKey  string
	AssignedAt  time.Time
}

func normalizeSlavePort(input int32) int32 {
	if input < 0 || input > 65535 {
		return 0
	}
	return input
}

func normalizeSlaveCapabilities(input []string) []string {
	seen := map[string]struct{}{}
	normalized := make([]string, 0, len(input))
	for _, capability := range input {
		trimmed := strings.TrimSpace(capability)
		if trimmed == "" {
			continue
		}
		if _, exists := seen[trimmed]; exists {
			continue
		}
		seen[trimmed] = struct{}{}
		normalized = append(normalized, trimmed)
	}
	sort.Strings(normalized)
	return normalized
}

func sanitizeDiscoveredProject(input *slavev1.DiscoveredProject) *slavev1.DiscoveredProject {
	if input == nil {
		return nil
	}
	path := strings.TrimSpace(input.GetPath())
	if path == "" {
		return nil
	}
	name := strings.TrimSpace(input.GetName())
	if name == "" {
		name = filepath.Base(path)
		if name == "." || name == "/" {
			name = path
		}
	}

	relativePath := strings.TrimSpace(input.GetRelativePath())
	if relativePath == "" {
		relativePath = "."
	}

	normalizeList := func(values []string) []string {
		seen := map[string]struct{}{}
		next := make([]string, 0, len(values))
		for _, value := range values {
			normalized := strings.TrimSpace(value)
			if normalized == "" {
				continue
			}
			if _, ok := seen[normalized]; ok {
				continue
			}
			seen[normalized] = struct{}{}
			next = append(next, normalized)
		}
		sort.Strings(next)
		return next
	}

	return &slavev1.DiscoveredProject{
		Name:         name,
		Path:         path,
		RelativePath: relativePath,
		Types:        normalizeList(input.GetTypes()),
		Services:     normalizeList(input.GetServices()),
		HasMakefile:  input.GetHasMakefile(),
	}
}

func normalizeDiscoveredProjects(input []*slavev1.DiscoveredProject) []*slavev1.DiscoveredProject {
	seen := map[string]struct{}{}
	normalized := make([]*slavev1.DiscoveredProject, 0, len(input))
	for _, candidate := range input {
		sanitized := sanitizeDiscoveredProject(candidate)
		if sanitized == nil {
			continue
		}
		key := strings.ToLower(strings.TrimSpace(sanitized.GetPath()))
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		normalized = append(normalized, sanitized)
	}
	sort.Slice(normalized, func(i, j int) bool {
		return normalized[i].GetPath() < normalized[j].GetPath()
	})
	return normalized
}

func cloneDiscoveredProjects(input []*slavev1.DiscoveredProject) []*slavev1.DiscoveredProject {
	cloned := make([]*slavev1.DiscoveredProject, 0, len(input))
	for _, candidate := range input {
		sanitized := sanitizeDiscoveredProject(candidate)
		if sanitized == nil {
			continue
		}
		cloned = append(cloned, sanitized)
	}
	return cloned
}

func parsePeerAddress(ctx context.Context) (string, int32) {
	peerInfo, ok := peer.FromContext(ctx)
	if !ok || peerInfo == nil || peerInfo.Addr == nil {
		return "", 0
	}

	network := strings.TrimSpace(strings.ToLower(peerInfo.Addr.Network()))
	if strings.Contains(network, "unix") {
		return "127.0.0.1", 0
	}

	host, portValue, err := net.SplitHostPort(strings.TrimSpace(peerInfo.Addr.String()))
	if err != nil {
		return strings.TrimSpace(peerInfo.Addr.String()), 0
	}

	parsedPort, parseErr := strconv.Atoi(strings.TrimSpace(portValue))
	if parseErr != nil || parsedPort < 0 || parsedPort > 65535 {
		return strings.TrimSpace(host), 0
	}
	return strings.TrimSpace(host), int32(parsedPort)
}

func resolveSlaveSharedKey(ctx context.Context) string {
	md, ok := metadata.FromIncomingContext(ctx)
	if !ok || md == nil {
		return ""
	}

	values := md.Get("x-slave-key")
	if len(values) > 0 && strings.TrimSpace(values[0]) != "" {
		return strings.TrimSpace(values[0])
	}

	authHeaders := md.Get("authorization")
	if len(authHeaders) == 0 {
		return ""
	}
	authHeader := strings.TrimSpace(authHeaders[0])
	if authHeader == "" {
		return ""
	}

	if strings.HasPrefix(strings.ToLower(authHeader), "bearer ") {
		return strings.TrimSpace(authHeader[7:])
	}
	return authHeader
}

func (s *Server) authorizeSlaveRequest(ctx context.Context) error {
	configured := strings.TrimSpace(s.slaveSharedKey)
	if configured == "" {
		return status.Error(codes.PermissionDenied, "slave shared key is not configured on master")
	}

	provided := resolveSlaveSharedKey(ctx)
	if provided == "" {
		return status.Error(codes.Unauthenticated, "missing slave shared key")
	}
	if provided != configured {
		return status.Error(codes.PermissionDenied, "invalid slave shared key")
	}
	return nil
}

func toRegisteredSlavePayload(slave *registeredSlaveState) *masterv1.RegisteredSlave {
	if slave == nil {
		return nil
	}
	return &masterv1.RegisteredSlave{
		SlaveId:            slave.SlaveID,
		HostName:           slave.HostName,
		Ip:                 slave.IP,
		Port:               slave.Port,
		Version:            slave.Version,
		ProtocolVersion:    slave.ProtocolVersion,
		Capabilities:       append([]string{}, slave.Capabilities...),
		DiscoveredProjects: cloneDiscoveredProjects(slave.DiscoveredProjects),
		Status:             slave.Status,
		RegisteredAt:       slave.RegisteredAt.Format(time.RFC3339Nano),
		LastSeenAt:         slave.LastSeenAt.Format(time.RFC3339Nano),
		Health:             slave.Health,
		Error:              slave.Error,
	}
}

func cloneRegisteredSlaveState(slave *registeredSlaveState) *registeredSlaveState {
	if slave == nil {
		return nil
	}
	return &registeredSlaveState{
		SlaveID:            slave.SlaveID,
		HostName:           slave.HostName,
		IP:                 slave.IP,
		Port:               slave.Port,
		Version:            slave.Version,
		ProtocolVersion:    slave.ProtocolVersion,
		Capabilities:       append([]string{}, slave.Capabilities...),
		DiscoveredProjects: cloneDiscoveredProjects(slave.DiscoveredProjects),
		Status:             slave.Status,
		Health:             slave.Health,
		Error:              slave.Error,
		RegisteredAt:       slave.RegisteredAt,
		LastSeenAt:         slave.LastSeenAt,
	}
}

func computeDisconnectedSlaveError(now time.Time, lastSeenAt time.Time, heartbeatTimeout time.Duration) string {
	if now.IsZero() {
		now = time.Now().UTC()
	}
	lastSeenLabel := "unknown"
	if !lastSeenAt.IsZero() {
		lastSeenLabel = lastSeenAt.UTC().Format(time.RFC3339Nano)
	}
	if heartbeatTimeout <= 0 {
		return fmt.Sprintf("heartbeat timeout: last contact at %s", lastSeenLabel)
	}
	return fmt.Sprintf(
		"heartbeat timeout: last contact at %s (threshold %s)",
		lastSeenLabel,
		heartbeatTimeout.Round(time.Second),
	)
}

func evaluateSlaveConnectionState(slave *registeredSlaveState, now time.Time, heartbeatTimeout time.Duration) (changed bool) {
	if slave == nil {
		return false
	}
	if now.IsZero() {
		now = time.Now().UTC()
	}

	lastSeenAt := slave.LastSeenAt
	if lastSeenAt.IsZero() {
		lastSeenAt = slave.RegisteredAt
	}
	if lastSeenAt.IsZero() {
		lastSeenAt = now
	}
	if heartbeatTimeout <= 0 {
		heartbeatTimeout = defaultSlaveHeartbeatTimeout
	}

	previousStatus := strings.TrimSpace(slave.Status)
	previousHealth := strings.TrimSpace(slave.Health)
	previousError := strings.TrimSpace(slave.Error)

	if now.Sub(lastSeenAt) > heartbeatTimeout {
		slave.Status = slaveStatusDisconnected
		slave.Health = slaveHealthCritical
		slave.Error = computeDisconnectedSlaveError(now, lastSeenAt, heartbeatTimeout)
	} else {
		slave.Status = slaveStatusRegistered
		slave.Health = slaveHealthHealthy
		slave.Error = ""
	}

	return previousStatus != slave.Status || previousHealth != slave.Health || previousError != strings.TrimSpace(slave.Error)
}

func (s *Server) sweepSlaveConnectionHealth(now time.Time) {
	if s == nil {
		return
	}
	if now.IsZero() {
		now = time.Now().UTC()
	}

	connectionLostEvents := make([]*registeredSlaveState, 0)

	s.slaveMu.Lock()
	for _, slave := range s.slaves {
		changed := evaluateSlaveConnectionState(slave, now, s.slaveHeartbeatTimeout)
		if changed && strings.TrimSpace(slave.Status) == slaveStatusDisconnected {
			s.setSlaveRuntimeStatusLocked(slave.SlaveID, runtimeStateStatusDisconnected, now)
		}
		if !changed || strings.TrimSpace(slave.Status) != slaveStatusDisconnected {
			continue
		}
		connectionLostEvents = append(connectionLostEvents, cloneRegisteredSlaveState(slave))
	}
	s.slaveMu.Unlock()

	for _, slave := range connectionLostEvents {
		if slave == nil {
			continue
		}
		s.logger.Warn(
			"slave heartbeat timeout detected",
			"slave_id",
			slave.SlaveID,
			"host_name",
			slave.HostName,
			"ip",
			slave.IP,
			"error",
			slave.Error,
		)
		s.emitSlaveStateEvent(eventTypeSlaveConnectionLost, slave, slave.Error)
		s.appendSlaveLogLine(
			slave.SlaveID,
			slave.HostName,
			"stderr",
			fmt.Sprintf("connection lost: %s", strings.TrimSpace(slave.Error)),
		)
	}
}

func (s *Server) RegisterSlave(ctx context.Context, req *slavev1.RegisterSlaveRequest) (*slavev1.RegisterSlaveResponse, error) {
	requestID := s.resolveRequestID(ctx, req.GetRequestId())
	if err := s.authorizeSlaveRequest(ctx); err != nil {
		return nil, err
	}

	slaveID := strings.TrimSpace(req.GetSlaveId())
	if slaveID == "" {
		return nil, status.Error(codes.InvalidArgument, "slave_id is required")
	}

	hostName := strings.TrimSpace(req.GetHostName())
	if hostName == "" {
		hostName = slaveID
	}

	peerIP, peerPort := parsePeerAddress(ctx)
	port := normalizeSlavePort(req.GetPort())
	if port == 0 {
		port = normalizeSlavePort(peerPort)
	}
	version := strings.TrimSpace(req.GetVersion())
	protocolVersion := strings.TrimSpace(req.GetProtocolVersion())

	now := time.Now().UTC()
	var desiredProcessCount int32
	s.slaveMu.Lock()
	registeredAt := now
	if existing := s.slaves[slaveID]; existing != nil {
		registeredAt = existing.RegisteredAt
		if version == "" {
			version = strings.TrimSpace(existing.Version)
		}
		if protocolVersion == "" {
			protocolVersion = strings.TrimSpace(existing.ProtocolVersion)
		}
	}
	registeredState := &registeredSlaveState{
		SlaveID:            slaveID,
		HostName:           hostName,
		IP:                 peerIP,
		Port:               port,
		Version:            version,
		ProtocolVersion:    protocolVersion,
		Capabilities:       normalizeSlaveCapabilities(req.GetCapabilities()),
		DiscoveredProjects: normalizeDiscoveredProjects(req.GetDiscoveredProjects()),
		Status:             slaveStatusRegistered,
		Health:             slaveHealthHealthy,
		Error:              "",
		RegisteredAt:       registeredAt,
		LastSeenAt:         now,
	}
	s.slaves[slaveID] = registeredState
	runtimeState := s.ensureSlaveRuntimeStateLocked(slaveID)
	if runtimeState != nil {
		runtimeState.BootID = strings.TrimSpace(req.GetBootId())
		runtimeState.Status = runtimeStateStatusRegistered
		runtimeState.UpdatedAt = now
	}
	desiredProcessCount = int32(len(s.desiredProcessesForSlaveLocked(slaveID)))
	registeredEventState := cloneRegisteredSlaveState(registeredState)
	s.slaveMu.Unlock()

	s.logger.Info(
		"slave registered",
		"request_id",
		requestID,
		"slave_id",
		slaveID,
		"host_name",
		hostName,
		"ip",
		peerIP,
		"port",
		port,
		"version",
		version,
		"protocol_version",
		protocolVersion,
	)
	s.emitSlaveStateEvent(eventTypeSlaveRegistered, registeredEventState, "")
	s.appendSlaveLogLine(
		slaveID,
		hostName,
		"system",
		fmt.Sprintf(
			"registered host=%s ip=%s port=%d version=%s protocol=%s",
			hostName,
			peerIP,
			port,
			version,
			protocolVersion,
		),
	)

	return &slavev1.RegisterSlaveResponse{
		RequestId:           requestID,
		Status:              slaveStatusRegistered,
		AssignedCluster:     defaultSlaveCluster,
		DesiredProcessCount: desiredProcessCount,
		ReconcileRequired:   desiredProcessCount > 0,
	}, nil
}

func (s *Server) Heartbeat(ctx context.Context, req *slavev1.HeartbeatRequest) (*slavev1.HeartbeatResponse, error) {
	requestID := s.resolveRequestID(ctx, req.GetRequestId())
	if err := s.authorizeSlaveRequest(ctx); err != nil {
		return nil, err
	}

	slaveID := strings.TrimSpace(req.GetSlaveId())
	if slaveID == "" {
		return nil, status.Error(codes.InvalidArgument, "slave_id is required")
	}

	now := time.Now().UTC()
	version := strings.TrimSpace(req.GetVersion())
	protocolVersion := strings.TrimSpace(req.GetProtocolVersion())
	var pendingCommands []*slavev1.SlaveCommand
	var runtimePayload map[string]any
	processLogChunks := req.GetProcessLogChunks()
	s.slaveMu.Lock()
	state := s.slaves[slaveID]
	if state == nil {
		s.slaveMu.Unlock()
		return nil, status.Error(codes.FailedPrecondition, "slave is not registered")
	}
	if version != "" {
		state.Version = version
	}
	if protocolVersion != "" {
		state.ProtocolVersion = protocolVersion
	}
	state.LastSeenAt = now
	state.Status = slaveStatusRegistered
	state.Health = slaveHealthHealthy
	state.Error = ""
	state.DiscoveredProjects = normalizeDiscoveredProjects(req.GetDiscoveredProjects())
	runtimeState := s.ensureSlaveRuntimeStateLocked(slaveID)
	if runtimeState != nil {
		if bootID := strings.TrimSpace(req.GetBootId()); bootID != "" {
			runtimeState.BootID = bootID
		}
		runtimeState.Status = runtimeStateStatusConnected
		runtimeState.HostTelemetry = coarseHostTelemetryFromHeartbeat(req)
		s.replaceObservedRunsLocked(runtimeState, req.GetObservedRuns())
		if len(req.GetProcessTelemetry()) > 0 {
			s.replaceProcessTelemetryLocked(runtimeState, req.GetProcessTelemetry())
		}
		runtimeState.UpdatedAt = now
		runtimePayload = runtimeStatePayload(slaveID, runtimeState, s.desiredProcessesForSlaveLocked(slaveID))
	}
	pendingCommands = s.dequeuePendingSlaveCommandsLocked(slaveID, now)
	heartbeatEventState := cloneRegisteredSlaveState(state)
	s.slaveMu.Unlock()
	s.emitSlaveStateEvent(eventTypeSlaveHeartbeat, heartbeatEventState, "")
	if len(runtimePayload) > 0 {
		s.publishEvent(
			eventTypeSlaveRuntimeTelemetry,
			"",
			"",
			"",
			runtimePayload,
		)
	}
	if len(processLogChunks) > 0 {
		s.appendSlaveProcessLogChunks(slaveID, processLogChunks)
	}
	s.appendSlaveLogLine(
		slaveID,
		heartbeatEventState.HostName,
		"system",
		fmt.Sprintf(
			"heartbeat status=ok discovered_projects=%d pending_commands=%d",
			len(heartbeatEventState.DiscoveredProjects),
			len(pendingCommands),
		),
	)

	for _, command := range pendingCommands {
		if command == nil {
			continue
		}
		s.publishEvent(
			eventTypeSlaveCommandDispatch,
			"",
			"",
			"",
			slaveCommandPayload(
				command,
				slaveID,
				heartbeatEventState.HostName,
				heartbeatEventState.IP,
				slaveCommandStatusDispatched,
				"checkout command dispatched to slave",
				nil,
				"",
			),
		)
	}

	return &slavev1.HeartbeatResponse{
		RequestId: requestID,
		Status:    "ok",
		Commands:  pendingCommands,
	}, nil
}

func (s *Server) ReportCommandResult(
	ctx context.Context,
	req *slavev1.ReportCommandResultRequest,
) (*slavev1.ReportCommandResultResponse, error) {
	requestID := s.resolveRequestID(ctx, req.GetRequestId())
	if err := s.authorizeSlaveRequest(ctx); err != nil {
		return nil, err
	}

	slaveID := strings.TrimSpace(req.GetSlaveId())
	if slaveID == "" {
		return nil, status.Error(codes.InvalidArgument, "slave_id is required")
	}
	commandID := strings.TrimSpace(req.GetCommandId())
	if commandID == "" {
		return nil, status.Error(codes.InvalidArgument, "command_id is required")
	}

	now := time.Now().UTC()
	resultStatus := normalizeSlaveCommandStatus(req.GetStatus())
	resultMessage := strings.TrimSpace(req.GetMessage())
	outputLines := normalizeSlaveCommandOutputLines(req.GetOutputLines())
	completedAt := strings.TrimSpace(req.GetCompletedAt())
	if completedAt == "" {
		completedAt = now.Format(time.RFC3339Nano)
	}

	var command *slavev1.SlaveCommand
	var hostName string
	var hostIP string
	var requestedAt string
	var dispatchedAt string
	var commandType string

	s.slaveMu.Lock()
	if state := s.slaves[slaveID]; state != nil {
		state.LastSeenAt = now
		state.Status = slaveStatusRegistered
		state.Health = slaveHealthHealthy
		state.Error = ""
		hostName = state.HostName
		hostIP = state.IP
	}

	if commandState := s.slaveCommandsByID[commandID]; commandState != nil {
		command = cloneSlaveCommand(commandState.Command)
		hostName = strings.TrimSpace(commandState.HostName)
		hostIP = strings.TrimSpace(commandState.HostIP)
		if !commandState.RequestedAt.IsZero() {
			requestedAt = commandState.RequestedAt.UTC().Format(time.RFC3339Nano)
		}
		if !commandState.DispatchedAt.IsZero() {
			dispatchedAt = commandState.DispatchedAt.UTC().Format(time.RFC3339Nano)
		}
		delete(s.slaveCommandsByID, commandID)
	}

	if queued := s.slavePendingCommands[slaveID]; len(queued) > 0 {
		filtered := make([]*slavev1.SlaveCommand, 0, len(queued))
		for _, queuedCommand := range queued {
			if strings.TrimSpace(queuedCommand.GetCommandId()) == commandID {
				continue
			}
			filtered = append(filtered, queuedCommand)
		}
		if len(filtered) == 0 {
			delete(s.slavePendingCommands, slaveID)
		} else {
			s.slavePendingCommands[slaveID] = filtered
		}
	}
	s.slaveMu.Unlock()

	if command == nil {
		command = &slavev1.SlaveCommand{
			CommandId:   commandID,
			CommandType: strings.TrimSpace(req.GetCommandType()),
		}
	}
	commandType = strings.TrimSpace(command.GetCommandType())
	if commandType == "" {
		commandType = strings.TrimSpace(req.GetCommandType())
	}

	eventPayload := slaveCommandPayload(
		command,
		slaveID,
		hostName,
		hostIP,
		resultStatus,
		resultMessage,
		outputLines,
		completedAt,
	)
	if strings.TrimSpace(commandType) != "" {
		eventPayload["commandType"] = commandType
	}
	if requestedAt != "" {
		eventPayload["requestedAtResolved"] = requestedAt
	}
	if dispatchedAt != "" {
		eventPayload["dispatchedAt"] = dispatchedAt
	}

	s.publishEvent(
		eventTypeSlaveCommandResult,
		"",
		"",
		"",
		eventPayload,
	)
	commandLogStream := "stdout"
	if resultStatus != slaveCommandStatusCompleted {
		commandLogStream = "stderr"
	}
	commandLogMessage := resultMessage
	if commandLogMessage == "" {
		commandLogMessage = "command completed"
		if resultStatus != slaveCommandStatusCompleted {
			commandLogMessage = "command failed"
		}
	}
	s.appendSlaveLogLine(
		slaveID,
		hostName,
		commandLogStream,
		fmt.Sprintf(
			"command result command_id=%s command_type=%s status=%s message=%s",
			commandID,
			commandType,
			resultStatus,
			commandLogMessage,
		),
	)
	for _, outputLine := range outputLines {
		s.appendSlaveLogLine(
			slaveID,
			hostName,
			commandLogStream,
			fmt.Sprintf(
				"[command][%s][%s] %s",
				commandType,
				commandID,
				outputLine,
			),
		)
	}

	if resultStatus == slaveCommandStatusCompleted {
		s.logger.Info(
			"slave command completed",
			"request_id",
			requestID,
			"slave_id",
			slaveID,
			"command_id",
			commandID,
			"command_type",
			commandType,
			"message",
			resultMessage,
		)
	} else {
		s.logger.Warn(
			"slave command failed",
			"request_id",
			requestID,
			"slave_id",
			slaveID,
			"command_id",
			commandID,
			"command_type",
			commandType,
			"message",
			resultMessage,
		)
	}

	return &slavev1.ReportCommandResultResponse{
		RequestId: requestID,
		Status:    "acknowledged",
	}, nil
}

func (s *Server) AssignWorkload(ctx context.Context, req *slavev1.AssignWorkloadRequest) (*slavev1.AssignWorkloadResponse, error) {
	requestID := s.resolveRequestID(ctx, req.GetRequestId())
	if err := s.authorizeSlaveRequest(ctx); err != nil {
		return nil, err
	}

	slaveID := strings.TrimSpace(req.GetSlaveId())
	if slaveID == "" {
		return nil, status.Error(codes.InvalidArgument, "slave_id is required")
	}
	workloadID := strings.TrimSpace(req.GetWorkloadId())
	if workloadID == "" {
		return nil, status.Error(codes.InvalidArgument, "workload_id is required")
	}
	projectPath := strings.TrimSpace(req.GetProjectPath())
	if projectPath == "" {
		return nil, status.Error(codes.InvalidArgument, "project_path is required")
	}
	serviceKey := strings.TrimSpace(req.GetServiceKey())
	if serviceKey == "" {
		return nil, status.Error(codes.InvalidArgument, "service_key is required")
	}

	now := time.Now().UTC()
	s.slaveMu.Lock()
	if s.slaves[slaveID] == nil {
		s.slaveMu.Unlock()
		return nil, status.Error(codes.NotFound, "slave is not registered")
	}
	assignments := s.slaveAssignments[slaveID]
	if assignments == nil {
		assignments = map[string]*assignedWorkloadState{}
		s.slaveAssignments[slaveID] = assignments
	}
	assignments[workloadID] = &assignedWorkloadState{
		WorkloadID:  workloadID,
		ProjectPath: projectPath,
		ServiceKey:  serviceKey,
		AssignedAt:  now,
	}
	s.slaveMu.Unlock()

	s.publishEvent("slave.assignment", "", serviceKey, "", map[string]any{
		"slaveId":     slaveID,
		"workloadId":  workloadID,
		"projectPath": projectPath,
		"serviceKey":  serviceKey,
		"status":      "accepted",
		"assignedAt":  now.Format(time.RFC3339Nano),
	})

	return &slavev1.AssignWorkloadResponse{
		RequestId: requestID,
		Status:    "accepted",
	}, nil
}

func (s *Server) Drain(ctx context.Context, req *slavev1.DrainRequest) (*slavev1.DrainResponse, error) {
	requestID := s.resolveRequestID(ctx, req.GetRequestId())
	if err := s.authorizeSlaveRequest(ctx); err != nil {
		return nil, err
	}

	slaveID := strings.TrimSpace(req.GetSlaveId())
	if slaveID == "" {
		return nil, status.Error(codes.InvalidArgument, "slave_id is required")
	}

	s.slaveMu.Lock()
	drainedState := cloneRegisteredSlaveState(s.slaves[slaveID])
	if drainedState != nil {
		drainedState.Status = slaveStatusDrained
		drainedState.LastSeenAt = time.Now().UTC()
	}
	s.setSlaveRuntimeStatusLocked(slaveID, runtimeStateStatusDrained, time.Now().UTC())
	delete(s.slaveAssignments, slaveID)
	delete(s.slavePendingCommands, slaveID)
	if len(s.slaveCommandsByID) > 0 {
		for commandID, commandState := range s.slaveCommandsByID {
			if commandState == nil {
				delete(s.slaveCommandsByID, commandID)
				continue
			}
			if strings.TrimSpace(commandState.SlaveID) == slaveID {
				delete(s.slaveCommandsByID, commandID)
			}
		}
	}
	delete(s.slaves, slaveID)
	s.slaveMu.Unlock()
	s.emitSlaveStateEvent(eventTypeSlaveDrained, drainedState, req.GetReason())
	drainedHostName := ""
	if drainedState != nil {
		drainedHostName = drainedState.HostName
	}
	s.appendSlaveLogLine(
		slaveID,
		drainedHostName,
		"system",
		fmt.Sprintf(
			"drained reason=%s",
			strings.TrimSpace(req.GetReason()),
		),
	)

	return &slavev1.DrainResponse{
		RequestId: requestID,
		Status:    slaveStatusDrained,
	}, nil
}

func (s *Server) ListRegisteredSlaves(ctx context.Context, req *masterv1.ListRegisteredSlavesRequest) (*masterv1.ListRegisteredSlavesResponse, error) {
	requestID := s.resolveRequestID(ctx, req.GetRequestId())
	s.sweepSlaveConnectionHealth(time.Now().UTC())

	s.slaveMu.Lock()
	slaves := make([]*masterv1.RegisteredSlave, 0, len(s.slaves))
	for _, slave := range s.slaves {
		slaves = append(slaves, toRegisteredSlavePayload(slave))
	}
	s.slaveMu.Unlock()

	sort.Slice(slaves, func(i, j int) bool {
		if slaves[i].HostName != slaves[j].HostName {
			return slaves[i].HostName < slaves[j].HostName
		}
		return slaves[i].SlaveId < slaves[j].SlaveId
	})

	return &masterv1.ListRegisteredSlavesResponse{
		RequestId: requestID,
		Slaves:    slaves,
	}, nil
}
