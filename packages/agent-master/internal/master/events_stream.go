package master

import (
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"
	"time"

	masterv1 "github.com/josh/project-commander/packages/agent-shared/gen/projectcommander/master/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

const (
	eventTypeRuntimeSnapshot      = "runtime.snapshot"
	eventTypeLogAppend            = "log.append"
	eventTypeSlaveRegistered      = "slave.registered"
	eventTypeSlaveHeartbeat       = "slave.heartbeat"
	eventTypeSlaveConnectionLost  = "slave.connection_lost"
	eventTypeSlaveDrained         = "slave.drained"
	eventTypeSlaveCommandQueued   = "slave.command_queued"
	eventTypeSlaveCommandDispatch = "slave.command_dispatched"
	eventTypeSlaveCommandResult   = "slave.command_result"
	eventTypeSlaveProcessLogChunk = "slave.process_log_chunk"
)

type eventSubscriber struct {
	id         uint64
	ch         chan *masterv1.RuntimeEvent
	includeAll bool
	projects   map[string]struct{}
}

func normalizeProjectFilterPath(projectPath string) string {
	trimmed := strings.TrimSpace(projectPath)
	if trimmed == "" {
		return ""
	}
	return filepath.Clean(trimmed)
}

func newEventSubscriber(id uint64, projectPaths []string) *eventSubscriber {
	normalizedPaths := map[string]struct{}{}
	for _, projectPath := range projectPaths {
		normalized := normalizeProjectFilterPath(projectPath)
		if normalized == "" {
			continue
		}
		normalizedPaths[normalized] = struct{}{}
	}

	return &eventSubscriber{
		id:         id,
		ch:         make(chan *masterv1.RuntimeEvent, 128),
		includeAll: len(normalizedPaths) == 0,
		projects:   normalizedPaths,
	}
}

func (subscriber *eventSubscriber) matches(event *masterv1.RuntimeEvent) bool {
	if subscriber == nil || event == nil {
		return false
	}
	if subscriber.includeAll {
		return true
	}
	projectPath := normalizeProjectFilterPath(event.GetProjectPath())
	if projectPath == "" {
		return true
	}
	_, ok := subscriber.projects[projectPath]
	return ok
}

func cloneRuntimeEvent(event *masterv1.RuntimeEvent) *masterv1.RuntimeEvent {
	if event == nil {
		return nil
	}
	return &masterv1.RuntimeEvent{
		RequestId:   event.GetRequestId(),
		EventId:     event.GetEventId(),
		Timestamp:   event.GetTimestamp(),
		Type:        event.GetType(),
		ProjectPath: event.GetProjectPath(),
		ServiceKey:  event.GetServiceKey(),
		RunId:       event.GetRunId(),
		PayloadJson: event.GetPayloadJson(),
	}
}

func encodePayloadJSON(payload any) string {
	if payload == nil {
		return ""
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		return ""
	}
	return string(encoded)
}

func (s *Server) nextEventID() string {
	sequence := s.eventSeed.Add(1)
	return fmt.Sprintf("event-%d-%d", time.Now().UTC().UnixMilli(), sequence)
}

func (s *Server) publishEvent(
	eventType string,
	projectPath string,
	serviceKey string,
	runID string,
	payload any,
) {
	event := &masterv1.RuntimeEvent{
		EventId:     s.nextEventID(),
		Timestamp:   time.Now().UTC().Format(time.RFC3339Nano),
		Type:        strings.TrimSpace(eventType),
		ProjectPath: strings.TrimSpace(projectPath),
		ServiceKey:  strings.TrimSpace(serviceKey),
		RunId:       strings.TrimSpace(runID),
		PayloadJson: encodePayloadJSON(payload),
	}

	s.eventsMu.RLock()
	defer s.eventsMu.RUnlock()
	for _, subscriber := range s.eventSubscribers {
		if !subscriber.matches(event) {
			continue
		}
		select {
		case subscriber.ch <- event:
		default:
			s.logger.Warn("dropping runtime event for slow subscriber", "subscriber_id", subscriber.id, "event_id", event.GetEventId(), "event_type", event.GetType())
		}
	}
}

func (s *Server) subscribeEvents(projectPaths []string) (*eventSubscriber, func()) {
	subscriberID := s.eventSubscriberSeed.Add(1)
	subscriber := newEventSubscriber(subscriberID, projectPaths)

	s.eventsMu.Lock()
	s.eventSubscribers[subscriberID] = subscriber
	s.eventsMu.Unlock()

	unsubscribe := func() {
		s.eventsMu.Lock()
		existing := s.eventSubscribers[subscriberID]
		if existing != nil {
			delete(s.eventSubscribers, subscriberID)
			close(existing.ch)
		}
		s.eventsMu.Unlock()
	}

	return subscriber, unsubscribe
}

func (s *Server) SubscribeEvents(req *masterv1.SubscribeEventsRequest, stream masterv1.MasterEvents_SubscribeEventsServer) error {
	requestID := s.resolveRequestID(stream.Context(), req.GetRequestId())
	subscriber, unsubscribe := s.subscribeEvents(req.GetProjectPaths())
	defer unsubscribe()

	for {
		select {
		case <-stream.Context().Done():
			return nil
		case event, ok := <-subscriber.ch:
			if !ok {
				return nil
			}
			outbound := cloneRuntimeEvent(event)
			if outbound == nil {
				continue
			}
			outbound.RequestId = requestID
			if err := stream.Send(outbound); err != nil {
				if status.Code(err) == codes.Canceled {
					return nil
				}
				return err
			}
		}
	}
}

func runtimeSnapshotPayload(snapshot *masterv1.RuntimeSnapshot) map[string]any {
	if snapshot == nil {
		return map[string]any{}
	}

	services := make([]map[string]any, 0, len(snapshot.GetServices()))
	for _, service := range snapshot.GetServices() {
		services = append(services, map[string]any{
			"serviceKey":  service.GetServiceKey(),
			"serviceName": service.GetServiceName(),
			"pid":         service.GetPid(),
			"port":        service.GetPort(),
			"state":       service.GetState(),
			"runId":       service.GetRunId(),
		})
	}

	return map[string]any{
		"projectPath":    snapshot.GetProjectPath(),
		"status":         snapshot.GetStatus(),
		"pid":            snapshot.GetPid(),
		"portRangeBegin": snapshot.GetPortRangeBegin(),
		"portRangeEnd":   snapshot.GetPortRangeEnd(),
		"services":       services,
	}
}

func slaveStatePayload(slave *registeredSlaveState, reason string) map[string]any {
	if slave == nil {
		payload := map[string]any{}
		if strings.TrimSpace(reason) != "" {
			payload["reason"] = strings.TrimSpace(reason)
		}
		return payload
	}

	discoveredProjects := make([]map[string]any, 0, len(slave.DiscoveredProjects))
	for _, project := range slave.DiscoveredProjects {
		if project == nil {
			continue
		}
		discoveredProjects = append(discoveredProjects, map[string]any{
			"name":         project.GetName(),
			"path":         project.GetPath(),
			"relativePath": project.GetRelativePath(),
			"types":        append([]string{}, project.GetTypes()...),
			"services":     append([]string{}, project.GetServices()...),
			"hasMakefile":  project.GetHasMakefile(),
		})
	}

	payload := map[string]any{
		"slaveId":            slave.SlaveID,
		"hostName":           slave.HostName,
		"ip":                 slave.IP,
		"port":               slave.Port,
		"version":            slave.Version,
		"protocolVersion":    slave.ProtocolVersion,
		"capabilities":       append([]string{}, slave.Capabilities...),
		"discoveredProjects": discoveredProjects,
		"status":             slave.Status,
		"health":             slave.Health,
		"error":              slave.Error,
		"registeredAt":       slave.RegisteredAt.Format(time.RFC3339Nano),
		"lastSeenAt":         slave.LastSeenAt.Format(time.RFC3339Nano),
	}
	if strings.TrimSpace(reason) != "" {
		payload["reason"] = strings.TrimSpace(reason)
	}
	return payload
}

func logEntryPayload(
	projectPath string,
	serviceKey string,
	serviceName string,
	stream string,
	message string,
	runID string,
	timestamp string,
) map[string]any {
	return map[string]any{
		"projectPath": strings.TrimSpace(projectPath),
		"serviceKey":  strings.TrimSpace(serviceKey),
		"serviceName": strings.TrimSpace(serviceName),
		"stream":      strings.TrimSpace(stream),
		"message":     message,
		"runId":       strings.TrimSpace(runID),
		"timestamp":   strings.TrimSpace(timestamp),
	}
}

func (s *Server) emitRuntimeSnapshotEvent(projectPath string, serviceKey string, runID string, snapshot *masterv1.RuntimeSnapshot) {
	if snapshot == nil {
		return
	}
	if strings.TrimSpace(projectPath) == "" {
		projectPath = snapshot.GetProjectPath()
	}
	s.publishEvent(
		eventTypeRuntimeSnapshot,
		projectPath,
		serviceKey,
		runID,
		runtimeSnapshotPayload(snapshot),
	)
}

func (s *Server) emitLogAppendEvent(
	projectPath string,
	serviceKey string,
	serviceName string,
	stream string,
	message string,
	runID string,
) {
	normalizedMessage := strings.TrimRight(message, "\r\n")
	if strings.TrimSpace(normalizedMessage) == "" {
		return
	}
	s.publishEvent(
		eventTypeLogAppend,
		projectPath,
		serviceKey,
		runID,
		logEntryPayload(
			projectPath,
			serviceKey,
			serviceName,
			stream,
			normalizedMessage,
			runID,
			time.Now().UTC().Format(time.RFC3339Nano),
		),
	)
}

func (s *Server) emitSlaveStateEvent(eventType string, slave *registeredSlaveState, reason string) {
	projectPath := ""
	serviceKey := ""
	runID := ""
	s.publishEvent(
		eventType,
		projectPath,
		serviceKey,
		runID,
		slaveStatePayload(slave, reason),
	)
}
