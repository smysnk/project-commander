package master

import (
	"context"
	"fmt"
	"path/filepath"
	"strings"
	"time"

	masterv1 "github.com/josh/project-commander/packages/agent-shared/gen/projectcommander/master/v1"
	slavev1 "github.com/josh/project-commander/packages/agent-shared/gen/projectcommander/slave/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

const (
	slaveCommandTypeGitCheckout = "git_checkout"

	slaveCommandStatusQueued     = "queued"
	slaveCommandStatusDispatched = "dispatched"
	slaveCommandStatusCompleted  = "completed"
	slaveCommandStatusFailed     = "failed"

	maxSlaveCommandOutputLines = 200
	maxSlaveCommandOutputBytes = 2048
)

type slaveCommandState struct {
	Command      *slavev1.SlaveCommand
	SlaveID      string
	HostName     string
	HostIP       string
	RequestedAt  time.Time
	DispatchedAt time.Time
}

func normalizeRepositoryURL(input string) (string, error) {
	normalized := strings.TrimSpace(input)
	if normalized == "" {
		return "", status.Error(codes.InvalidArgument, "repository_url is required")
	}
	if strings.ContainsRune(normalized, '\x00') {
		return "", status.Error(codes.InvalidArgument, "repository_url cannot contain null bytes")
	}
	return normalized, nil
}

func normalizeBaseDirectory(input string) (string, error) {
	normalized := strings.TrimSpace(input)
	if normalized == "" {
		return "", status.Error(codes.InvalidArgument, "base_directory is required")
	}
	if strings.ContainsRune(normalized, '\x00') {
		return "", status.Error(codes.InvalidArgument, "base_directory cannot contain null bytes")
	}
	return normalized, nil
}

func normalizeDestinationFolder(input string) (string, error) {
	normalized := strings.TrimSpace(input)
	if normalized == "" {
		return "", status.Error(codes.InvalidArgument, "destination_folder is required")
	}
	if strings.ContainsRune(normalized, '\x00') {
		return "", status.Error(codes.InvalidArgument, "destination_folder cannot contain null bytes")
	}
	if strings.Contains(normalized, "/") || strings.Contains(normalized, "\\") {
		return "", status.Error(codes.InvalidArgument, "destination_folder must be a single folder name")
	}
	if normalized == "." || normalized == ".." {
		return "", status.Error(codes.InvalidArgument, "destination_folder cannot be '.' or '..'")
	}
	return normalized, nil
}

func cloneSlaveCommand(command *slavev1.SlaveCommand) *slavev1.SlaveCommand {
	if command == nil {
		return nil
	}
	return &slavev1.SlaveCommand{
		CommandId:         strings.TrimSpace(command.GetCommandId()),
		CommandType:       strings.TrimSpace(command.GetCommandType()),
		RepositoryUrl:     strings.TrimSpace(command.GetRepositoryUrl()),
		BaseDirectory:     strings.TrimSpace(command.GetBaseDirectory()),
		DestinationFolder: strings.TrimSpace(command.GetDestinationFolder()),
		TargetPath:        strings.TrimSpace(command.GetTargetPath()),
		RequestedAt:       strings.TrimSpace(command.GetRequestedAt()),
	}
}

func hasSlaveCapability(capabilities []string, target string) bool {
	normalizedTarget := strings.TrimSpace(target)
	if normalizedTarget == "" {
		return false
	}
	for _, capability := range capabilities {
		if strings.TrimSpace(capability) == normalizedTarget {
			return true
		}
	}
	return false
}

func normalizeSlaveCommandStatus(input string) string {
	normalized := strings.ToLower(strings.TrimSpace(input))
	switch normalized {
	case slaveCommandStatusCompleted:
		return slaveCommandStatusCompleted
	case slaveCommandStatusFailed:
		return slaveCommandStatusFailed
	default:
		return slaveCommandStatusFailed
	}
}

func normalizeSlaveCommandOutputLines(input []string) []string {
	normalized := make([]string, 0, len(input))
	for _, line := range input {
		trimmed := strings.TrimRight(strings.TrimSpace(line), "\r\n")
		if trimmed == "" {
			continue
		}
		if len(trimmed) > maxSlaveCommandOutputBytes {
			trimmed = trimmed[:maxSlaveCommandOutputBytes]
		}
		normalized = append(normalized, trimmed)
		if len(normalized) >= maxSlaveCommandOutputLines {
			break
		}
	}
	return normalized
}

func (s *Server) nextSlaveCommandID(prefix string) string {
	normalizedPrefix := strings.TrimSpace(prefix)
	if normalizedPrefix == "" {
		normalizedPrefix = "cmd"
	}
	sequence := s.requestSeed.Add(1)
	return fmt.Sprintf("%s-%d-%d", normalizedPrefix, time.Now().UTC().UnixMilli(), sequence)
}

func slaveCommandPayload(
	command *slavev1.SlaveCommand,
	slaveID string,
	hostName string,
	hostIP string,
	status string,
	message string,
	outputLines []string,
	completedAt string,
) map[string]any {
	payload := map[string]any{
		"slaveId":           strings.TrimSpace(slaveID),
		"hostName":          strings.TrimSpace(hostName),
		"ip":                strings.TrimSpace(hostIP),
		"commandId":         strings.TrimSpace(command.GetCommandId()),
		"commandType":       strings.TrimSpace(command.GetCommandType()),
		"repositoryUrl":     strings.TrimSpace(command.GetRepositoryUrl()),
		"baseDirectory":     strings.TrimSpace(command.GetBaseDirectory()),
		"destinationFolder": strings.TrimSpace(command.GetDestinationFolder()),
		"targetPath":        strings.TrimSpace(command.GetTargetPath()),
		"requestedAt":       strings.TrimSpace(command.GetRequestedAt()),
		"status":            strings.TrimSpace(status),
		"message":           strings.TrimSpace(message),
		"outputLines":       append([]string{}, outputLines...),
		"completedAt":       strings.TrimSpace(completedAt),
	}
	return payload
}

func (s *Server) dequeuePendingSlaveCommandsLocked(slaveID string, now time.Time) []*slavev1.SlaveCommand {
	queued := s.slavePendingCommands[slaveID]
	if len(queued) == 0 {
		return nil
	}
	delete(s.slavePendingCommands, slaveID)

	dispatched := make([]*slavev1.SlaveCommand, 0, len(queued))
	for _, command := range queued {
		cloned := cloneSlaveCommand(command)
		if cloned == nil || strings.TrimSpace(cloned.GetCommandId()) == "" {
			continue
		}
		dispatched = append(dispatched, cloned)
		if state := s.slaveCommandsByID[cloned.GetCommandId()]; state != nil {
			state.DispatchedAt = now
		}
	}
	return dispatched
}

func (s *Server) CheckoutProjectOnSlave(
	ctx context.Context,
	req *masterv1.CheckoutProjectOnSlaveRequest,
) (*masterv1.CheckoutProjectOnSlaveResponse, error) {
	requestID := s.resolveRequestID(ctx, req.GetRequestId())
	slaveID := strings.TrimSpace(req.GetSlaveId())
	if slaveID == "" {
		return nil, status.Error(codes.InvalidArgument, "slave_id is required")
	}

	repositoryURL, repositoryErr := normalizeRepositoryURL(req.GetRepositoryUrl())
	if repositoryErr != nil {
		return nil, repositoryErr
	}
	baseDirectory, baseErr := normalizeBaseDirectory(req.GetBaseDirectory())
	if baseErr != nil {
		return nil, baseErr
	}
	destinationFolder, destinationErr := normalizeDestinationFolder(req.GetDestinationFolder())
	if destinationErr != nil {
		return nil, destinationErr
	}

	now := time.Now().UTC()
	s.sweepSlaveConnectionHealth(now)

	s.slaveMu.Lock()
	slave := s.slaves[slaveID]
	if slave == nil {
		s.slaveMu.Unlock()
		return nil, status.Error(codes.NotFound, "slave is not registered")
	}
	if strings.TrimSpace(slave.Status) != slaveStatusRegistered {
		s.slaveMu.Unlock()
		return nil, status.Errorf(codes.FailedPrecondition, "slave is not connected (status=%s)", strings.TrimSpace(slave.Status))
	}
	if !hasSlaveCapability(slave.Capabilities, "slave.checkout.project") {
		s.slaveMu.Unlock()
		return nil, status.Error(codes.FailedPrecondition, "slave does not support checkout project commands")
	}

	commandID := s.nextSlaveCommandID("checkout")
	command := &slavev1.SlaveCommand{
		CommandId:         commandID,
		CommandType:       slaveCommandTypeGitCheckout,
		RepositoryUrl:     repositoryURL,
		BaseDirectory:     baseDirectory,
		DestinationFolder: destinationFolder,
		TargetPath:        filepath.Join(baseDirectory, destinationFolder),
		RequestedAt:       now.Format(time.RFC3339Nano),
	}

	s.slavePendingCommands[slaveID] = append(s.slavePendingCommands[slaveID], command)
	s.slaveCommandsByID[commandID] = &slaveCommandState{
		Command:     cloneSlaveCommand(command),
		SlaveID:     slaveID,
		HostName:    slave.HostName,
		HostIP:      slave.IP,
		RequestedAt: now,
	}
	hostName := slave.HostName
	hostIP := slave.IP
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
			"checkout command queued",
			nil,
			"",
		),
	)
	s.logger.Info(
		"queued checkout command for slave",
		"request_id",
		requestID,
		"slave_id",
		slaveID,
		"command_id",
		commandID,
		"repository_url",
		repositoryURL,
		"target_path",
		command.GetTargetPath(),
	)

	return &masterv1.CheckoutProjectOnSlaveResponse{
		RequestId: requestID,
		CommandId: commandID,
		Status:    slaveCommandStatusQueued,
		Message:   "checkout command queued for dispatch",
	}, nil
}
