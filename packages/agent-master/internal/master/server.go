package master

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	masterv1 "github.com/josh/project-commander/packages/agent-shared/gen/projectcommander/master/v1"
	slavev1 "github.com/josh/project-commander/packages/agent-shared/gen/projectcommander/slave/v1"
	"google.golang.org/grpc/metadata"
)

const (
	healthStatusServing             = "SERVING"
	healthStatusDegraded            = "DEGRADED"
	serviceName                     = "pc-master"
	protocolVersion                 = "v1"
	LevelTrace                      = slog.LevelDebug - 4
	defaultSlaveHeartbeatTimeout    = 8 * time.Second
	defaultSlaveHealthCheckInterval = 1 * time.Second
	minSlaveHealthCheckInterval     = 250 * time.Millisecond
)

func supportedCapabilities() []string {
	return []string{
		"master.health",
		"master.version",
		"master.handshake",
		"runtime.snapshot",
		"runtime.logs",
		"runtime.process_stats",
		"runtime.port_range",
		"runtime.launch_environment",
		"runtime.start_service",
		"runtime.stop_service",
		"runtime.restart_service",
		"runtime.start_project",
		"runtime.stop_project",
		"slave.register",
		"slave.heartbeat",
		"slave.list",
		"slave.projects",
		"slave.checkout.project",
	}
}

func isCapabilitySupported(capability string) bool {
	for _, supported := range supportedCapabilities() {
		if capability == supported {
			return true
		}
	}
	return false
}

type Server struct {
	masterv1.UnimplementedMasterControlServer
	masterv1.UnimplementedMasterEventsServer
	slavev1.UnimplementedSlaveControlServer

	logger         *slog.Logger
	startedAt      time.Time
	version        string
	socketPath     string
	slaveSharedKey string
	requestSeed    atomic.Uint64

	runtimeMu                  sync.Mutex
	projects                   map[string]*projectRuntimeState
	portRangeSettingsByProject map[string]portRangeSettings
	logRoot                    string

	slaveMu sync.Mutex
	slaves  map[string]*registeredSlaveState
	// keyed by slave_id -> workload_id
	slaveAssignments map[string]map[string]*assignedWorkloadState
	// keyed by slave_id -> queued commands awaiting heartbeat dispatch
	slavePendingCommands map[string][]*slavev1.SlaveCommand
	// keyed by command_id -> command metadata (pending/in-flight)
	slaveCommandsByID map[string]*slaveCommandState

	slaveHeartbeatTimeout    time.Duration
	slaveHealthCheckInterval time.Duration

	eventsMu            sync.RWMutex
	eventSubscribers    map[uint64]*eventSubscriber
	eventSubscriberSeed atomic.Uint64
	eventSeed           atomic.Uint64
}

func NewServer(logger *slog.Logger, version string, socketPath string, slaveSharedKey string) *Server {
	if logger == nil {
		logger = slog.Default()
	}

	logRoot := strings.TrimSpace(os.Getenv("PC_MASTER_LOG_DIR"))
	if logRoot == "" {
		logRoot = "/tmp/project-commander/runtime-logs"
	}
	logRoot = filepath.Clean(logRoot)
	if mkdirErr := os.MkdirAll(logRoot, 0o755); mkdirErr != nil {
		logger.Warn("failed to create master log directory", "path", logRoot, "error", mkdirErr.Error())
	}

	server := &Server{
		logger:                     logger,
		startedAt:                  time.Now().UTC(),
		version:                    strings.TrimSpace(version),
		socketPath:                 strings.TrimSpace(socketPath),
		slaveSharedKey:             strings.TrimSpace(slaveSharedKey),
		projects:                   map[string]*projectRuntimeState{},
		portRangeSettingsByProject: map[string]portRangeSettings{},
		logRoot:                    logRoot,
		slaves:                     map[string]*registeredSlaveState{},
		slaveAssignments:           map[string]map[string]*assignedWorkloadState{},
		slavePendingCommands:       map[string][]*slavev1.SlaveCommand{},
		slaveCommandsByID:          map[string]*slaveCommandState{},
		slaveHeartbeatTimeout:      resolveDurationFromEnv("PC_MASTER_SLAVE_HEARTBEAT_TIMEOUT", defaultSlaveHeartbeatTimeout),
		slaveHealthCheckInterval:   resolveDurationFromEnv("PC_MASTER_SLAVE_HEALTH_CHECK_INTERVAL", defaultSlaveHealthCheckInterval),
		eventSubscribers:           map[uint64]*eventSubscriber{},
	}
	if server.slaveHeartbeatTimeout < time.Second {
		server.slaveHeartbeatTimeout = time.Second
	}
	if server.slaveHealthCheckInterval < minSlaveHealthCheckInterval {
		server.slaveHealthCheckInterval = minSlaveHealthCheckInterval
	}
	if server.slaveHealthCheckInterval > server.slaveHeartbeatTimeout {
		server.slaveHealthCheckInterval = server.slaveHeartbeatTimeout / 2
		if server.slaveHealthCheckInterval < minSlaveHealthCheckInterval {
			server.slaveHealthCheckInterval = minSlaveHealthCheckInterval
		}
	}
	if server.version == "" {
		server.version = "0.0.0-dev"
	}
	return server
}

func (s *Server) StartBackgroundHealthMonitor(ctx context.Context) {
	if s == nil {
		return
	}
	go s.runSlaveHealthMonitor(ctx)
}

func (s *Server) runSlaveHealthMonitor(ctx context.Context) {
	ticker := time.NewTicker(s.slaveHealthCheckInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.sweepSlaveConnectionHealth(time.Now().UTC())
		}
	}
}

func (s *Server) Health(ctx context.Context, req *masterv1.HealthRequest) (*masterv1.HealthResponse, error) {
	requestID := s.resolveRequestID(ctx, req.GetRequestId())
	status := healthStatusServing
	if strings.TrimSpace(s.slaveSharedKey) == "" {
		status = healthStatusDegraded
	}
	response := &masterv1.HealthResponse{
		RequestId: requestID,
		Service:   serviceName,
		Status:    status,
		Version:   s.version,
		StartedAt: s.startedAt.Format(time.RFC3339Nano),
	}
	s.logger.Log(ctx, LevelTrace, "master health request served", "request_id", requestID, "status", response.Status)
	return response, nil
}

func (s *Server) GetVersion(ctx context.Context, req *masterv1.VersionRequest) (*masterv1.VersionResponse, error) {
	requestID := s.resolveRequestID(ctx, req.GetRequestId())
	response := &masterv1.VersionResponse{
		RequestId:       requestID,
		Service:         serviceName,
		Version:         s.version,
		ProtocolVersion: protocolVersion,
		Capabilities:    supportedCapabilities(),
		StartedAt:       s.startedAt.Format(time.RFC3339Nano),
	}
	s.logger.Info("master version request served", "request_id", requestID, "version", response.Version)
	return response, nil
}

func (s *Server) Handshake(ctx context.Context, req *masterv1.HandshakeRequest) (*masterv1.HandshakeResponse, error) {
	requestID := s.resolveRequestID(ctx, req.GetRequestId())

	requested := req.GetRequestedCapabilities()
	granted := make([]string, 0, len(requested))
	for _, capability := range requested {
		if capability == "" {
			continue
		}
		if isCapabilitySupported(capability) {
			granted = append(granted, capability)
		}
	}

	response := &masterv1.HandshakeResponse{
		RequestId:           requestID,
		ServerName:          serviceName,
		ServerVersion:       s.version,
		ProtocolVersion:     protocolVersion,
		GrantedCapabilities: granted,
		SocketPath:          s.socketPath,
	}
	s.logger.Info(
		"master handshake served",
		"request_id",
		requestID,
		"client_name",
		req.GetClientName(),
		"client_version",
		req.GetClientVersion(),
	)
	return response, nil
}

func (s *Server) resolveRequestID(ctx context.Context, requestID string) string {
	trimmed := strings.TrimSpace(requestID)
	if trimmed != "" {
		return trimmed
	}

	if md, ok := metadata.FromIncomingContext(ctx); ok {
		values := md.Get("x-request-id")
		if len(values) > 0 {
			trimmedFromMetadata := strings.TrimSpace(values[0])
			if trimmedFromMetadata != "" {
				return trimmedFromMetadata
			}
		}
	}

	next := s.requestSeed.Add(1)
	return fmt.Sprintf("req-%d", next)
}

func resolveDurationFromEnv(envKey string, fallback time.Duration) time.Duration {
	value := strings.TrimSpace(os.Getenv(strings.TrimSpace(envKey)))
	if value == "" {
		return fallback
	}
	parsed, err := time.ParseDuration(value)
	if err != nil || parsed <= 0 {
		return fallback
	}
	return parsed
}
