package main

import (
	"bufio"
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/josh/project-commander/packages/agent-master/internal/master"
	masterv1 "github.com/josh/project-commander/packages/agent-shared/gen/projectcommander/master/v1"
	slavev1 "github.com/josh/project-commander/packages/agent-shared/gen/projectcommander/slave/v1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/metadata"
)

const (
	defaultSocketPath      = "/tmp/project-commander/master.sock"
	defaultSlaveListenAddr = "127.0.0.1:50052"
	defaultGracePeriod     = 5 * time.Second
	buildVersion           = "0.1.0"
)

func main() {
	socketPathFlag := flag.String("socket-path", "", "unix socket path for master agent")
	slaveListenAddrFlag := flag.String("slave-listen-addr", "", "tcp listen address for slave registration (host:port)")
	slaveSharedKeyFlag := flag.String("slave-shared-key", "", "shared key required for slave registration")
	logFormatFlag := flag.String("log-format", "text", "log format: text or json")
	consoleLogLevelFlag := flag.String("console-log-level", "", "console log level: trace, debug, info, warn, or error")
	versionFlag := flag.Bool("version", false, "print version and exit")
	flag.Parse()

	if *versionFlag {
		fmt.Println(buildVersion)
		return
	}

	socketPath := resolveSocketPath(*socketPathFlag)
	slaveListenAddr := resolveSlaveListenAddress(*slaveListenAddrFlag)
	slaveSharedKey := resolveSlaveSharedKey(*slaveSharedKeyFlag)
	consoleLogLevel, rawConsoleLogLevel, consoleLogLevelValid := resolveConsoleLogLevel(*consoleLogLevelFlag)
	logger := newLogger(*logFormatFlag, consoleLogLevel)
	if !consoleLogLevelValid {
		logger.Warn(
			"invalid console log level; falling back to info",
			"value",
			rawConsoleLogLevel,
			"allowed_values",
			"trace,debug,info,warn,error",
			"env_key",
			"PC_MASTER_CONSOLE_LOG_LEVEL",
		)
	}

	if err := run(socketPath, slaveListenAddr, slaveSharedKey, logger); err != nil {
		logger.Error("master exited with error", "error", err.Error())
		os.Exit(1)
	}
}

func run(socketPath string, slaveListenAddr string, slaveSharedKey string, logger *slog.Logger) error {
	if strings.TrimSpace(slaveSharedKey) == "" {
		logger.Warn(
			"slave shared key is not configured; slave registration will be rejected",
			"env_key",
			"PC_SLAVE_SHARED_KEY",
		)
	}

	if err := prepareSocket(socketPath); err != nil {
		return err
	}

	unixListener, err := net.Listen("unix", socketPath)
	if err != nil {
		return fmt.Errorf("listen on %s: %w", socketPath, err)
	}
	defer unixListener.Close()

	if err := os.Chmod(socketPath, 0o600); err != nil {
		return fmt.Errorf("chmod socket %s: %w", socketPath, err)
	}

	slaveListener, err := net.Listen("tcp", slaveListenAddr)
	if err != nil {
		return fmt.Errorf("listen for slave registration on %s: %w", slaveListenAddr, err)
	}
	defer slaveListener.Close()

	sharedServer := master.NewServer(logger, buildVersion, socketPath, slaveSharedKey)

	controlServer := grpc.NewServer(
		grpc.UnaryInterceptor(unaryLoggingInterceptor(logger)),
	)
	masterv1.RegisterMasterControlServer(controlServer, sharedServer)
	masterv1.RegisterMasterEventsServer(controlServer, sharedServer)
	// Allow co-located slaves to register over the same filesystem socket.
	slavev1.RegisterSlaveControlServer(controlServer, sharedServer)

	slaveServer := grpc.NewServer(
		grpc.UnaryInterceptor(unaryLoggingInterceptor(logger)),
	)
	slavev1.RegisterSlaveControlServer(slaveServer, sharedServer)

	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()
	sharedServer.StartBackgroundHealthMonitor(ctx)

	type serveFailure struct {
		serverType string
		err        error
	}
	serveErr := make(chan serveFailure, 2)

	go func() {
		logger.Info("master control listening", "socket_path", socketPath, "version", buildVersion)
		if serveErrValue := controlServer.Serve(unixListener); serveErrValue != nil {
			serveErr <- serveFailure{serverType: "master-control", err: serveErrValue}
		}
	}()
	go func() {
		logger.Info(
			"master slave-control listening",
			"listen_addr",
			slaveListenAddr,
			"shared_key_configured",
			strings.TrimSpace(slaveSharedKey) != "",
		)
		if serveErrValue := slaveServer.Serve(slaveListener); serveErrValue != nil {
			serveErr <- serveFailure{serverType: "slave-control", err: serveErrValue}
		}
	}()

	select {
	case <-ctx.Done():
		logger.Info("shutdown signal received", "signal", ctx.Err())
	case failure := <-serveErr:
		if failure.err != nil {
			return fmt.Errorf("%s grpc serve failure: %w", failure.serverType, failure.err)
		}
	}

	shutdownGrpcServer(controlServer, logger, "master-control")
	shutdownGrpcServer(slaveServer, logger, "slave-control")

	if removeErr := os.Remove(socketPath); removeErr != nil && !errors.Is(removeErr, os.ErrNotExist) {
		logger.Warn("failed to remove socket file", "socket_path", socketPath, "error", removeErr.Error())
	}

	logger.Info("master shutdown complete")
	return nil
}

func shutdownGrpcServer(server *grpc.Server, logger *slog.Logger, serverType string) {
	stopCompleted := make(chan struct{})
	go func() {
		server.GracefulStop()
		close(stopCompleted)
	}()

	select {
	case <-stopCompleted:
	case <-time.After(defaultGracePeriod):
		logger.Warn("graceful stop timeout reached, forcing stop", "server", serverType)
		server.Stop()
	}
}

func resolveSocketPath(flagValue string) string {
	if trimmed := strings.TrimSpace(flagValue); trimmed != "" {
		return trimmed
	}
	if envValue := strings.TrimSpace(os.Getenv("PC_MASTER_SOCKET_PATH")); envValue != "" {
		return envValue
	}
	return defaultSocketPath
}

func resolveSlaveListenAddress(flagValue string) string {
	if trimmed := strings.TrimSpace(flagValue); trimmed != "" {
		return trimmed
	}
	if envValue := strings.TrimSpace(os.Getenv("PC_MASTER_SLAVE_LISTEN_ADDR")); envValue != "" {
		return envValue
	}
	return defaultSlaveListenAddr
}

func resolveSlaveSharedKey(flagValue string) string {
	if trimmed := strings.TrimSpace(flagValue); trimmed != "" {
		return trimmed
	}
	if envValue := strings.TrimSpace(os.Getenv("PC_SLAVE_SHARED_KEY")); envValue != "" {
		return envValue
	}
	return resolveEnvVarFromDotEnv("PC_SLAVE_SHARED_KEY")
}

func resolveEnvVarFromDotEnv(key string) string {
	key = strings.TrimSpace(key)
	if key == "" {
		return ""
	}

	cwd, err := os.Getwd()
	if err != nil {
		return ""
	}

	currentDir := cwd
	for {
		candidate := filepath.Join(currentDir, ".env")
		if value, ok := lookupEnvVarInFile(candidate, key); ok {
			return value
		}

		parentDir := filepath.Dir(currentDir)
		if parentDir == currentDir {
			break
		}
		currentDir = parentDir
	}

	return ""
}

func lookupEnvVarInFile(filePath string, key string) (string, bool) {
	file, err := os.Open(filePath)
	if err != nil {
		return "", false
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		line = strings.TrimPrefix(line, "export ")
		separatorIndex := strings.Index(line, "=")
		if separatorIndex <= 0 {
			continue
		}

		foundKey := strings.TrimSpace(line[:separatorIndex])
		if foundKey != key {
			continue
		}

		value := strings.TrimSpace(line[separatorIndex+1:])
		if len(value) >= 2 {
			if (value[0] == '"' && value[len(value)-1] == '"') || (value[0] == '\'' && value[len(value)-1] == '\'') {
				value = value[1 : len(value)-1]
			}
		}
		return strings.TrimSpace(value), true
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
	if fromEnv := strings.TrimSpace(os.Getenv("PC_MASTER_CONSOLE_LOG_LEVEL")); fromEnv != "" {
		level, ok := parseLogLevel(fromEnv)
		return level, fromEnv, ok
	}
	return slog.LevelInfo, "info", true
}

func parseLogLevel(value string) (slog.Level, bool) {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "trace":
		return master.LevelTrace, true
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
	case level <= master.LevelTrace:
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

func prepareSocket(socketPath string) error {
	if strings.TrimSpace(socketPath) == "" {
		return errors.New("socket path is required")
	}

	if err := os.MkdirAll(filepath.Dir(socketPath), 0o755); err != nil {
		return fmt.Errorf("create socket directory: %w", err)
	}

	fileInfo, err := os.Stat(socketPath)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("stat socket path: %w", err)
	}

	if fileInfo.Mode()&os.ModeSocket == 0 {
		return fmt.Errorf("existing path is not a unix socket: %s", socketPath)
	}

	connection, dialErr := net.DialTimeout("unix", socketPath, 250*time.Millisecond)
	if dialErr == nil {
		connection.Close()
		return fmt.Errorf("master socket already in use: %s", socketPath)
	}

	if removeErr := os.Remove(socketPath); removeErr != nil {
		return fmt.Errorf("remove stale socket: %w", removeErr)
	}
	return nil
}

func unaryLoggingInterceptor(logger *slog.Logger) grpc.UnaryServerInterceptor {
	return func(
		ctx context.Context,
		req interface{},
		info *grpc.UnaryServerInfo,
		handler grpc.UnaryHandler,
	) (interface{}, error) {
		start := time.Now()
		requestID := requestIDFromMetadata(ctx)
		response, err := handler(ctx, req)
		durationMs := time.Since(start).Milliseconds()
		if err != nil {
			logger.Error("grpc unary request failed", "method", info.FullMethod, "request_id", requestID, "duration_ms", durationMs, "error", err.Error())
			return response, err
		}
		logger.Log(ctx, master.LevelTrace, "grpc unary request handled", "method", info.FullMethod, "request_id", requestID, "duration_ms", durationMs)
		return response, nil
	}
}

func requestIDFromMetadata(ctx context.Context) string {
	if md, ok := metadata.FromIncomingContext(ctx); ok {
		values := md.Get("x-request-id")
		if len(values) > 0 && strings.TrimSpace(values[0]) != "" {
			return strings.TrimSpace(values[0])
		}
	}
	return "missing"
}
