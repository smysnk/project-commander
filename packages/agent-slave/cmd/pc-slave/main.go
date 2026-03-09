package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	slavev1 "github.com/josh/project-commander/packages/agent-shared/gen/projectcommander/slave/v1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/metadata"
)

const (
	defaultHeartbeatInterval = 1 * time.Second
	minHeartbeatInterval     = 1 * time.Second
	defaultMasterEndpoint    = "127.0.0.1:50052"
	defaultProjectPathSuffix = "play"
	defaultDiscoveryInterval = 10 * time.Second
	minDiscoveryInterval     = 2 * time.Second
	// Project discovery is intentionally limited to configured root + one child level.
	defaultDiscoveryMaxDepth = 1
	rpcTimeout               = 5 * time.Second
	initialDialRetryDelay    = 2 * time.Second
	maxDialRetryDelay        = 15 * time.Second
	maxQueuedSlaveCommands   = 64
	commandReportRetryDelay  = 1 * time.Second
	commandReportMaxAttempts = 3
	commandSeenTTL           = 30 * time.Minute
	slaveProtocolVersion     = "v1"
	levelTrace               = slog.LevelDebug - 4
)

var buildVersion = "0.1.0"

type config struct {
	SlaveID           string
	HostName          string
	SlavePort         int32
	MasterEndpoint    string
	SharedKey         string
	HeartbeatInterval time.Duration
	LogFormat         string
	ProjectPath       string
	LaunchCommand     string
	WatchInterval     time.Duration
	BootID            string
	AgentStartedAt    string
	StateRoot         string
	ProcessLogRoot    string
}

func main() {
	slaveIDFlag := flag.String("slave-id", "", "slave identifier")
	masterEndpointFlag := flag.String("master-endpoint", "", "master slave-control endpoint (host:port)")
	slavePortFlag := flag.Int("slave-port", -1, "slave service port reported during registration")
	sharedKeyFlag := flag.String("shared-key", "", "shared key for slave registration")
	heartbeatIntervalFlag := flag.Duration("heartbeat-interval", 0, "heartbeat interval (e.g. 10s)")
	projectPathFlag := flag.String("project-path", "", "project path whose packages folder should be watched")
	launchCommandFlag := flag.String("launch-command", "", "workload launch command (default: yarn dev)")
	watchIntervalFlag := flag.Duration("watch-interval", 0, "file watch interval (e.g. 1s)")
	logFormatFlag := flag.String("log-format", "text", "log format: text or json")
	consoleLogLevelFlag := flag.String("console-log-level", "", "console log level: trace, debug, info, warn, or error")
	versionFlag := flag.Bool("version", false, "print version and exit")
	flag.Parse()

	if *versionFlag {
		fmt.Println(buildVersion)
		return
	}

	cfg, err := resolveConfig(
		*slaveIDFlag,
		*masterEndpointFlag,
		*slavePortFlag,
		*sharedKeyFlag,
		*heartbeatIntervalFlag,
		*projectPathFlag,
		*launchCommandFlag,
		*watchIntervalFlag,
		*logFormatFlag,
	)
	if err != nil {
		fmt.Fprintf(os.Stderr, "invalid configuration: %v\n", err)
		os.Exit(1)
	}

	consoleLogLevel, rawConsoleLogLevel, consoleLogLevelValid := resolveConsoleLogLevel(*consoleLogLevelFlag)
	logger := newLogger(cfg.LogFormat, consoleLogLevel)
	if !consoleLogLevelValid {
		logger.Warn(
			"invalid console log level; falling back to info",
			"value",
			rawConsoleLogLevel,
			"allowed_values",
			"trace,debug,info,warn,error",
			"env_key",
			"PC_SLAVE_CONSOLE_LOG_LEVEL",
		)
	}
	if runErr := run(cfg, logger); runErr != nil {
		logger.Error("pc-slave exited with error", "error", runErr.Error())
		os.Exit(1)
	}
}

func resolveConfig(
	slaveIDFlag string,
	masterEndpointFlag string,
	slavePortFlag int,
	sharedKeyFlag string,
	heartbeatIntervalFlag time.Duration,
	projectPathFlag string,
	launchCommandFlag string,
	watchIntervalFlag time.Duration,
	logFormatFlag string,
) (config, error) {
	slaveID := strings.TrimSpace(slaveIDFlag)
	if slaveID == "" {
		slaveID = strings.TrimSpace(os.Getenv("PC_SLAVE_ID"))
	}

	hostName, err := os.Hostname()
	if err != nil {
		return config{}, fmt.Errorf("resolve hostname: %w", err)
	}
	hostName = strings.TrimSpace(hostName)
	if hostName == "" {
		hostName = "unknown-host"
	}

	if slaveID == "" {
		slaveID = hostName
	}

	masterEndpoint := strings.TrimSpace(masterEndpointFlag)
	if masterEndpoint == "" {
		masterEndpoint = strings.TrimSpace(os.Getenv("PC_MASTER_ENDPOINT"))
	}
	if masterEndpoint == "" {
		masterEndpoint = defaultMasterEndpoint
	}
	masterEndpoint = normalizeMasterEndpoint(masterEndpoint)

	slavePort := int32(0)
	if slavePortFlag >= 0 {
		slavePort = normalizePort(int32(slavePortFlag))
	} else if fromEnv := strings.TrimSpace(os.Getenv("PC_SLAVE_PORT")); fromEnv != "" {
		parsed, parseErr := strconv.Atoi(fromEnv)
		if parseErr != nil {
			return config{}, fmt.Errorf("parse PC_SLAVE_PORT: %w", parseErr)
		}
		slavePort = normalizePort(int32(parsed))
	}

	sharedKey := strings.TrimSpace(sharedKeyFlag)
	if sharedKey == "" {
		sharedKey = strings.TrimSpace(os.Getenv("PC_SLAVE_SHARED_KEY"))
	}

	heartbeatInterval := heartbeatIntervalFlag
	if heartbeatInterval <= 0 {
		if fromEnv := strings.TrimSpace(os.Getenv("PC_HEARTBEAT_INTERVAL")); fromEnv != "" {
			parsed, parseErr := time.ParseDuration(fromEnv)
			if parseErr != nil {
				return config{}, fmt.Errorf("parse PC_HEARTBEAT_INTERVAL: %w", parseErr)
			}
			heartbeatInterval = parsed
		}
	}
	if heartbeatInterval <= 0 {
		heartbeatInterval = defaultHeartbeatInterval
	}
	heartbeatInterval = minHeartbeatInterval

	projectPath := strings.TrimSpace(projectPathFlag)
	if projectPath == "" {
		projectPath = strings.TrimSpace(os.Getenv("PC_SLAVE_PROJECT_PATH"))
	}
	if projectPath == "" {
		projectPath = strings.TrimSpace(os.Getenv("PC_SLAVE_DEFAULT_PROJECT_PATH"))
	}
	if projectPath == "" {
		defaultProjectPath, defaultProjectPathErr := resolveDefaultProjectPath()
		if defaultProjectPathErr != nil {
			return config{}, defaultProjectPathErr
		}
		projectPath = defaultProjectPath
	}
	if projectPath != "" {
		normalizedProjectPath, normalizeProjectPathErr := normalizeProjectPath(projectPath)
		if normalizeProjectPathErr != nil {
			return config{}, normalizeProjectPathErr
		}
		projectPath = normalizedProjectPath
	}

	launchCommand := strings.TrimSpace(launchCommandFlag)
	if launchCommand == "" {
		launchCommand = strings.TrimSpace(os.Getenv("PC_SLAVE_LAUNCH_COMMAND"))
	}
	if launchCommand == "" {
		launchCommand = defaultWorkloadLaunchCommand
	}

	watchInterval := watchIntervalFlag
	if watchInterval <= 0 {
		if fromEnv := strings.TrimSpace(os.Getenv("PC_SLAVE_WATCH_INTERVAL")); fromEnv != "" {
			parsed, parseErr := time.ParseDuration(fromEnv)
			if parseErr != nil {
				return config{}, fmt.Errorf("parse PC_SLAVE_WATCH_INTERVAL: %w", parseErr)
			}
			watchInterval = parsed
		}
	}
	if watchInterval <= 0 {
		watchInterval = defaultWatchInterval
	}

	logFormat := strings.TrimSpace(logFormatFlag)
	if logFormat == "" {
		if fromEnv := strings.TrimSpace(os.Getenv("PC_LOG_FORMAT")); fromEnv != "" {
			logFormat = fromEnv
		}
	}
	if logFormat == "" {
		logFormat = "text"
	}

	stateRoot, err := resolveStateRoot(strings.TrimSpace(os.Getenv("PC_SLAVE_STATE_ROOT")), slaveID)
	if err != nil {
		return config{}, err
	}
	processLogRoot, err := resolveProcessLogRoot(strings.TrimSpace(os.Getenv("PC_SLAVE_PROCESS_LOG_DIR")), stateRoot)
	if err != nil {
		return config{}, err
	}
	bootID, err := resolveBootID()
	if err != nil {
		return config{}, err
	}

	return config{
		SlaveID:           slaveID,
		HostName:          hostName,
		SlavePort:         slavePort,
		MasterEndpoint:    masterEndpoint,
		SharedKey:         sharedKey,
		HeartbeatInterval: heartbeatInterval,
		LogFormat:         logFormat,
		ProjectPath:       projectPath,
		LaunchCommand:     launchCommand,
		WatchInterval:     watchInterval,
		BootID:            strings.TrimSpace(bootID),
		AgentStartedAt:    time.Now().UTC().Format(time.RFC3339Nano),
		StateRoot:         stateRoot,
		ProcessLogRoot:    processLogRoot,
	}, nil
}

func normalizePort(input int32) int32 {
	if input < 0 || input > 65535 {
		return 0
	}
	return input
}

func normalizeMasterEndpoint(raw string) string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return defaultMasterEndpoint
	}
	if strings.HasPrefix(trimmed, "unix://") || strings.HasPrefix(trimmed, "unix:") {
		return trimmed
	}
	if strings.HasPrefix(trimmed, "/") {
		return "unix://" + trimmed
	}
	return trimmed
}

func parseUnixSocketPath(endpoint string) (string, bool) {
	trimmed := strings.TrimSpace(endpoint)
	if trimmed == "" {
		return "", false
	}
	if strings.HasPrefix(trimmed, "unix://") {
		pathValue := strings.TrimSpace(strings.TrimPrefix(trimmed, "unix://"))
		return pathValue, pathValue != ""
	}
	if strings.HasPrefix(trimmed, "unix:") {
		pathValue := strings.TrimSpace(strings.TrimPrefix(trimmed, "unix:"))
		return pathValue, pathValue != ""
	}
	return "", false
}

func newLogger(format string, level slog.Level) *slog.Logger {
	options := &slog.HandlerOptions{
		Level:       level,
		ReplaceAttr: replaceLogLevelAttr,
	}
	var handler slog.Handler
	if strings.EqualFold(strings.TrimSpace(format), "json") {
		handler = slog.NewJSONHandler(os.Stdout, options)
	} else {
		handler = slog.NewTextHandler(os.Stdout, options)
	}
	return slog.New(handler)
}

func resolveConsoleLogLevel(flagValue string) (slog.Level, string, bool) {
	if trimmed := strings.TrimSpace(flagValue); trimmed != "" {
		level, ok := parseLogLevel(trimmed)
		return level, trimmed, ok
	}
	if fromEnv := strings.TrimSpace(os.Getenv("PC_SLAVE_CONSOLE_LOG_LEVEL")); fromEnv != "" {
		level, ok := parseLogLevel(fromEnv)
		return level, fromEnv, ok
	}
	return slog.LevelInfo, "info", true
}

func parseLogLevel(value string) (slog.Level, bool) {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "trace":
		return levelTrace, true
	case "debug":
		return slog.LevelDebug, true
	case "info":
		return slog.LevelInfo, true
	case "warn", "warning":
		return slog.LevelWarn, true
	case "error":
		return slog.LevelError, true
	default:
		return slog.LevelInfo, false
	}
}

func replaceLogLevelAttr(_ []string, attr slog.Attr) slog.Attr {
	if attr.Key != slog.LevelKey {
		return attr
	}

	switch attr.Value.Kind() {
	case slog.KindAny:
		if parsed, ok := attr.Value.Any().(slog.Level); ok {
			attr.Value = slog.StringValue(formatLogLevelLabel(parsed))
		}
	case slog.KindInt64:
		attr.Value = slog.StringValue(formatLogLevelLabel(slog.Level(attr.Value.Int64())))
	}
	return attr
}

func formatLogLevelLabel(level slog.Level) string {
	switch {
	case level <= levelTrace:
		return "TRACE"
	case level < slog.LevelInfo:
		return "DEBUG"
	case level < slog.LevelWarn:
		return "INFO"
	case level < slog.LevelError:
		return "WARN"
	default:
		return "ERROR"
	}
}

func ensureProjectPathExists(projectPath string) (bool, error) {
	normalizedPath := strings.TrimSpace(projectPath)
	if normalizedPath == "" {
		return false, nil
	}

	info, statErr := os.Stat(normalizedPath)
	if statErr == nil {
		if !info.IsDir() {
			return false, fmt.Errorf("project path is not a directory: %s", normalizedPath)
		}
		return false, nil
	}
	if !errors.Is(statErr, os.ErrNotExist) {
		return false, fmt.Errorf("stat project path %s: %w", normalizedPath, statErr)
	}

	if mkdirErr := os.MkdirAll(normalizedPath, 0o755); mkdirErr != nil {
		return false, fmt.Errorf("create project path %s: %w", normalizedPath, mkdirErr)
	}
	return true, nil
}

func resolveDefaultProjectPath() (string, error) {
	homeDir, homeDirErr := os.UserHomeDir()
	if homeDirErr != nil {
		return "", fmt.Errorf("resolve default project path home directory: %w", homeDirErr)
	}
	trimmedHomeDir := strings.TrimSpace(homeDir)
	if trimmedHomeDir == "" {
		return "", errors.New("resolve default project path home directory: home directory is empty")
	}
	return filepath.Join(trimmedHomeDir, defaultProjectPathSuffix), nil
}

func normalizeProjectPath(rawPath string) (string, error) {
	trimmedPath := strings.TrimSpace(rawPath)
	if trimmedPath == "" {
		return "", nil
	}

	expandedPath := trimmedPath
	if expandedPath == "~" || strings.HasPrefix(expandedPath, "~/") {
		homeDir, homeDirErr := os.UserHomeDir()
		if homeDirErr != nil {
			return "", fmt.Errorf("normalize project path: resolve home directory: %w", homeDirErr)
		}
		trimmedHomeDir := strings.TrimSpace(homeDir)
		if trimmedHomeDir == "" {
			return "", errors.New("normalize project path: home directory is empty")
		}
		if expandedPath == "~" {
			expandedPath = trimmedHomeDir
		} else {
			expandedPath = filepath.Join(trimmedHomeDir, strings.TrimPrefix(expandedPath, "~/"))
		}
	}

	absProjectPath, absErr := filepath.Abs(expandedPath)
	if absErr != nil {
		return "", fmt.Errorf("normalize project path: %w", absErr)
	}
	return filepath.Clean(absProjectPath), nil
}

func resolveHeartbeatUserName() string {
	candidates := []string{
		strings.TrimSpace(os.Getenv("PC_SLAVE_USER")),
		strings.TrimSpace(os.Getenv("USER")),
		strings.TrimSpace(os.Getenv("LOGNAME")),
		strings.TrimSpace(os.Getenv("USERNAME")),
	}
	for _, candidate := range candidates {
		if candidate != "" {
			return candidate
		}
	}
	return "unknown"
}

func resolveDiscoveryInterval() time.Duration {
	configured := strings.TrimSpace(os.Getenv("PC_SLAVE_DISCOVERY_INTERVAL"))
	if configured == "" {
		return defaultDiscoveryInterval
	}
	parsed, err := time.ParseDuration(configured)
	if err != nil || parsed <= 0 {
		return defaultDiscoveryInterval
	}
	if parsed < minDiscoveryInterval {
		return minDiscoveryInterval
	}
	return parsed
}

func resolveDiscoveryMaxDepth() int {
	return defaultDiscoveryMaxDepth
}

func cloneDiscoveredProjects(projects []*slavev1.DiscoveredProject) []*slavev1.DiscoveredProject {
	cloned := make([]*slavev1.DiscoveredProject, 0, len(projects))
	for _, project := range projects {
		if project == nil {
			continue
		}
		cloned = append(cloned, &slavev1.DiscoveredProject{
			Name:         strings.TrimSpace(project.GetName()),
			Path:         strings.TrimSpace(project.GetPath()),
			RelativePath: strings.TrimSpace(project.GetRelativePath()),
			Types:        append([]string{}, project.GetTypes()...),
			Services:     append([]string{}, project.GetServices()...),
			HasMakefile:  project.GetHasMakefile(),
		})
	}
	return cloned
}

func run(cfg config, logger *slog.Logger) error {
	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()

	if cfg.ProjectPath != "" {
		created, pathErr := ensureProjectPathExists(cfg.ProjectPath)
		if pathErr != nil {
			return pathErr
		}
		if created {
			logger.Info("created default project path for slave", "project_path", cfg.ProjectPath)
		}
	}

	logger.Info(
		"pc-slave started",
		"version",
		buildVersion,
		"protocol_version",
		slaveProtocolVersion,
		"slave_id",
		cfg.SlaveID,
		"host_name",
		cfg.HostName,
		"master_endpoint",
		cfg.MasterEndpoint,
		"shared_key_configured",
		cfg.SharedKey != "",
		"heartbeat_interval",
		cfg.HeartbeatInterval.String(),
		"project_path",
		cfg.ProjectPath,
		"launch_command",
		cfg.LaunchCommand,
		"watch_interval",
		cfg.WatchInterval.String(),
		"boot_id",
		cfg.BootID,
		"state_root",
		cfg.StateRoot,
		"process_log_root",
		cfg.ProcessLogRoot,
	)

	processManager, err := newProcessManager(logger, cfg)
	if err != nil {
		return fmt.Errorf("initialize process manager: %w", err)
	}
	telemetrySampler := newTelemetrySampler(logger, cfg)
	processLogShipper := newProcessLogShipper(logger)

	discoveryInterval := resolveDiscoveryInterval()
	discoveryMaxDepth := resolveDiscoveryMaxDepth()
	discoveredProjectsCollector := newDiscoveredProjectsCollector(
		logger,
		cfg.ProjectPath,
		discoveryInterval,
		discoveryMaxDepth,
	)
	var forceDiscoveryRefresh atomic.Bool
	collectDiscoveredProjects := func(force bool) []*slavev1.DiscoveredProject {
		if forceDiscoveryRefresh.Swap(false) {
			force = true
		}
		return discoveredProjectsCollector.Collect(force)
	}
	// Warm discovery cache during startup so registration/heartbeat include an immediate scan result.
	collectDiscoveredProjects(true)
	heartbeatUserName := resolveHeartbeatUserName()

	dialAttempt := 0
	var conn *grpc.ClientConn
	unixSocketPath, useUnixSocket := parseUnixSocketPath(cfg.MasterEndpoint)
	baseDialOptions := []grpc.DialOption{
		grpc.WithTransportCredentials(insecure.NewCredentials()),
		grpc.WithBlock(),
	}
	if useUnixSocket {
		baseDialOptions = append(baseDialOptions, grpc.WithContextDialer(func(ctx context.Context, address string) (net.Conn, error) {
			socketPath := strings.TrimSpace(unixSocketPath)
			if socketPath == "" {
				socketPath = strings.TrimSpace(address)
			}
			return (&net.Dialer{}).DialContext(ctx, "unix", socketPath)
		}))
	}

	for {
		dialAttempt += 1
		dialCtx, dialCancel := context.WithTimeout(ctx, rpcTimeout)
		nextConn, dialErr := grpc.DialContext(
			dialCtx,
			cfg.MasterEndpoint,
			baseDialOptions...,
		)
		dialCancel()
		if dialErr == nil {
			conn = nextConn
			logger.Info(
				"connected to master endpoint",
				"master_endpoint",
				cfg.MasterEndpoint,
				"attempt",
				dialAttempt,
			)
			break
		}

		retryDelay := initialDialRetryDelay * time.Duration(dialAttempt)
		if retryDelay > maxDialRetryDelay {
			retryDelay = maxDialRetryDelay
		}
		logger.Warn(
			"dial to master endpoint failed; retrying",
			"master_endpoint",
			cfg.MasterEndpoint,
			"attempt",
			dialAttempt,
			"retry_in",
			retryDelay.String(),
			"error",
			dialErr.Error(),
		)
		select {
		case <-ctx.Done():
			logger.Info("pc-slave shutdown during master dial retries", "reason", ctx.Err())
			return nil
		case <-time.After(retryDelay):
		}
	}
	defer conn.Close()

	client := slavev1.NewSlaveControlClient(conn)
	var requestSeed atomic.Uint64
	nextRequestID := func(prefix string) string {
		seed := requestSeed.Add(1)
		return fmt.Sprintf("%s-%d-%d", prefix, time.Now().UnixMilli(), seed)
	}

	buildRPCContext := func(parent context.Context, requestID string) (context.Context, context.CancelFunc) {
		rpcCtx, rpcCancel := context.WithTimeout(parent, rpcTimeout)
		pairs := []string{"x-request-id", requestID}
		if cfg.SharedKey != "" {
			pairs = append(pairs, "x-slave-key", cfg.SharedKey)
		}
		rpcCtx = metadata.NewOutgoingContext(rpcCtx, metadata.Pairs(pairs...))
		return rpcCtx, rpcCancel
	}

	commandQueue := make(chan *slavev1.SlaveCommand, maxQueuedSlaveCommands)
	var commandSeenMu sync.Mutex
	seenCommandAt := map[string]time.Time{}
	queueSlaveCommands := func(commands []*slavev1.SlaveCommand) {
		if len(commands) == 0 {
			return
		}
		now := time.Now().UTC()
		commandSeenMu.Lock()
		for commandID, seenAt := range seenCommandAt {
			if now.Sub(seenAt) >= commandSeenTTL {
				delete(seenCommandAt, commandID)
			}
		}
		commandSeenMu.Unlock()
		for _, command := range commands {
			cloned := cloneQueuedSlaveCommand(command)
			if cloned == nil {
				continue
			}
			commandID := strings.TrimSpace(cloned.GetCommandId())
			if commandID == "" {
				continue
			}

			commandSeenMu.Lock()
			if _, exists := seenCommandAt[commandID]; exists {
				commandSeenMu.Unlock()
				continue
			}
			commandSeenMu.Unlock()

			select {
			case commandQueue <- cloned:
				commandSeenMu.Lock()
				seenCommandAt[commandID] = now
				commandSeenMu.Unlock()
			default:
				logger.Warn(
					"dropping slave command due to full command queue",
					"command_id",
					commandID,
					"command_type",
					cloned.GetCommandType(),
				)
			}
		}
	}

	reportCommandResult := func(parent context.Context, command *slavev1.SlaveCommand, result slaveCommandResult) error {
		if command == nil {
			return nil
		}
		commandID := strings.TrimSpace(command.GetCommandId())
		if commandID == "" {
			return nil
		}

		attempt := 0
		for {
			attempt += 1
			requestID := nextRequestID("command-result")
			rpcCtx, rpcCancel := buildRPCContext(parent, requestID)
			_, err := client.ReportCommandResult(rpcCtx, &slavev1.ReportCommandResultRequest{
				RequestId:   requestID,
				SlaveId:     cfg.SlaveID,
				CommandId:   commandID,
				CommandType: strings.TrimSpace(command.GetCommandType()),
				Status:      strings.TrimSpace(result.status),
				Message:     strings.TrimSpace(result.message),
				OutputLines: append([]string{}, result.outputLines...),
				CompletedAt: strings.TrimSpace(result.completedAt),
			})
			rpcCancel()
			if err == nil {
				return nil
			}
			if attempt >= commandReportMaxAttempts {
				return err
			}
			select {
			case <-parent.Done():
				return parent.Err()
			case <-time.After(commandReportRetryDelay):
			}
		}
	}

	fetchDesiredProcesses := func(parent context.Context) ([]*slavev1.DesiredProcess, error) {
		requestID := nextRequestID("desired-processes")
		rpcCtx, rpcCancel := buildRPCContext(parent, requestID)
		defer rpcCancel()
		response, err := client.GetDesiredProcesses(rpcCtx, &slavev1.GetDesiredProcessesRequest{
			RequestId: requestID,
			SlaveId:   cfg.SlaveID,
			BootId:    cfg.BootID,
		})
		if err != nil {
			return nil, err
		}
		return response.GetDesiredProcesses(), nil
	}

	reportProcessReconciliation := func(parent context.Context, changes []*slavev1.ProcessReconciliationChange) error {
		if len(changes) == 0 {
			return nil
		}
		requestID := nextRequestID("reconcile")
		rpcCtx, rpcCancel := buildRPCContext(parent, requestID)
		defer rpcCancel()
		_, err := client.ReportProcessReconciliation(rpcCtx, &slavev1.ReportProcessReconciliationRequest{
			RequestId:    requestID,
			SlaveId:      cfg.SlaveID,
			BootId:       cfg.BootID,
			Changes:      changes,
			ObservedRuns: processManager.ObservedRuns(),
		})
		return err
	}

	flushProcessReconciliation := func(parent context.Context) {
		changes := processManager.DrainPendingReconciliationChanges()
		if len(changes) == 0 {
			return
		}
		if err := reportProcessReconciliation(parent, changes); err != nil {
			processManager.RequeuePendingReconciliationChanges(changes)
			logger.Warn(
				"failed to report process reconciliation",
				"change_count",
				len(changes),
				"error",
				err.Error(),
			)
		}
	}

	reconcileRuntime := func(parent context.Context, source string) {
		desiredProcesses, err := fetchDesiredProcesses(parent)
		if err != nil {
			logger.Warn("failed to fetch desired processes", "error", err.Error())
			return
		}
		if err := processManager.ReconcileDesiredProcesses(parent, desiredProcesses, source); err != nil {
			logger.Warn("failed to reconcile desired processes", "error", err.Error())
			return
		}
		flushProcessReconciliation(parent)
	}

	go func() {
		for {
			select {
			case <-ctx.Done():
				return
			case command := <-commandQueue:
				if command == nil {
					continue
				}

				commandID := strings.TrimSpace(command.GetCommandId())
				commandType := strings.TrimSpace(command.GetCommandType())
				logger.Info(
					"executing slave command",
					"command_id",
					commandID,
					"command_type",
					commandType,
					"repository_url",
					command.GetRepositoryUrl(),
					"target_path",
					command.GetTargetPath(),
				)

				result := executeSlaveCommand(ctx, logger, processManager, command)
				if reportErr := reportCommandResult(ctx, command, result); reportErr != nil {
					logger.Warn(
						"failed to report slave command result",
						"command_id",
						commandID,
						"command_type",
						commandType,
						"error",
						reportErr.Error(),
					)
				}
				logger.Info(
					"slave command finished",
					"command_id",
					commandID,
					"command_type",
					commandType,
					"status",
					result.status,
					"message",
					result.message,
				)
				if commandType == slaveCommandTypeGitCheckout && result.status == slaveCommandStatusCompleted {
					forceDiscoveryRefresh.Store(true)
				}
				flushProcessReconciliation(ctx)
			}
		}
	}()

	register := func(parent context.Context) error {
		requestID := nextRequestID("register")
		rpcCtx, rpcCancel := buildRPCContext(parent, requestID)
		defer rpcCancel()
		discoveredProjects := collectDiscoveredProjects(false)
		response, err := client.RegisterSlave(
			rpcCtx,
			buildRegisterSlaveRequest(cfg, requestID, discoveredProjects),
		)
		if err != nil {
			return err
		}

		logger.Info(
			"slave registration acknowledged",
			"slave_id",
			cfg.SlaveID,
			"status",
			response.GetStatus(),
			"assigned_cluster",
			response.GetAssignedCluster(),
			"discovered_projects",
			len(discoveredProjects),
			"desired_process_count",
			response.GetDesiredProcessCount(),
			"reconcile_required",
			response.GetReconcileRequired(),
		)
		return nil
	}

	sendHeartbeat := func(parent context.Context, heartbeatCount int, runningServices int32) (*slavev1.HeartbeatResponse, error) {
		requestID := nextRequestID("heartbeat")
		rpcCtx, rpcCancel := buildRPCContext(parent, requestID)
		defer rpcCancel()
		discoveredProjects := collectDiscoveredProjects(false)
		observedRuns := processManager.ObservedRuns()
		hostTelemetry := telemetrySampler.SampleHostTelemetry()
		processTelemetry := telemetrySampler.SampleProcessTelemetry(observedRuns)
		processLogChunks := processLogShipper.Collect(observedRuns, time.Now().UTC())
		response, err := client.Heartbeat(
			rpcCtx,
			buildHeartbeatRequest(
				cfg,
				requestID,
				runningServices,
				discoveredProjects,
				hostTelemetry,
				processTelemetry,
				observedRuns,
				processLogChunks,
				processManager.RuntimeSequence(),
				time.Now().UTC(),
			),
		)
		if err != nil {
			return nil, err
		}

		logger.Log(
			parent,
			levelTrace,
			"heartbeat",
			"status",
			"ok",
			"discovered_projects",
			len(discoveredProjects),
			"pending_commands",
			len(response.GetCommands()),
			"user",
			heartbeatUserName,
			"slave_id",
			cfg.SlaveID,
			"master_endpoint",
			cfg.MasterEndpoint,
			"count",
			heartbeatCount,
			"running_services",
			runningServices,
			"observed_runs",
			len(observedRuns),
			"process_telemetry",
			len(processTelemetry),
			"runtime_sequence",
			processManager.RuntimeSequence(),
		)
		return response, nil
	}

	registered := false
	if err := register(ctx); err != nil {
		logger.Warn("initial registration failed; will retry on heartbeat", "error", err.Error())
	} else {
		registered = true
		reconcileRuntime(ctx, reconciliationSourceStartup)
	}

	heartbeatCounter := 0
	ticker := time.NewTicker(cfg.HeartbeatInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			logger.Info("pc-slave shutdown signal received", "reason", ctx.Err())
			logger.Info("pc-slave shutdown complete", "heartbeats_sent", heartbeatCounter)
			return nil
		case <-ticker.C:
			if !registered {
				if err := register(ctx); err != nil {
					logger.Warn("registration retry failed", "error", err.Error())
					continue
				}
				registered = true
				reconcileRuntime(ctx, reconciliationSourceStartup)
			}

			reconcileRuntime(ctx, reconciliationSourceTick)
			if err := processManager.Tick(ctx); err != nil && !errors.Is(err, context.Canceled) {
				logger.Warn("process manager tick failed", "error", err.Error())
			}
			flushProcessReconciliation(ctx)

			heartbeatCounter += 1
			runningServices := processManager.RunningServices()
			response, err := sendHeartbeat(ctx, heartbeatCounter, runningServices)
			if err != nil {
				logger.Warn("heartbeat failed; forcing re-registration", "error", err.Error())
				registered = false
				continue
			}
			queueSlaveCommands(response.GetCommands())
		}
	}
}
