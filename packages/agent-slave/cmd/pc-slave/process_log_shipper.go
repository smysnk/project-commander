package main

import (
	"io"
	"log/slog"
	"os"
	"strings"
	"sync"
	"time"

	slavev1 "github.com/josh/project-commander/packages/agent-shared/gen/projectcommander/slave/v1"
)

const (
	maxProcessLogChunkBytesPerTick = 256 * 1024
	maxProcessLogLinesPerTick      = 256
)

type processLogCursor struct {
	logPath   string
	offset    int64
	remainder string
}

type processLogShipper struct {
	logger  *slog.Logger
	mu      sync.Mutex
	cursors map[string]*processLogCursor
}

func newProcessLogShipper(logger *slog.Logger) *processLogShipper {
	if logger == nil {
		logger = slog.Default()
	}
	return &processLogShipper{
		logger:  logger,
		cursors: map[string]*processLogCursor{},
	}
}

func normalizeProcessLogStream(stream string) string {
	switch strings.ToLower(strings.TrimSpace(stream)) {
	case "stderr":
		return "stderr"
	case "system":
		return "system"
	default:
		return "stdout"
	}
}

func (shipper *processLogShipper) Collect(observedRuns []*slavev1.ObservedProcessRun, sampledAt time.Time) []*slavev1.ProcessLogChunk {
	shipper.mu.Lock()
	defer shipper.mu.Unlock()

	if len(observedRuns) == 0 {
		shipper.cursors = map[string]*processLogCursor{}
		return nil
	}

	timestamp := sampledAt.UTC()
	if timestamp.IsZero() {
		timestamp = time.Now().UTC()
	}
	sampledAtValue := timestamp.Format(time.RFC3339Nano)
	activeRunIDs := make(map[string]struct{}, len(observedRuns))
	chunks := make([]*slavev1.ProcessLogChunk, 0)

	for _, observedRun := range observedRuns {
		if observedRun == nil {
			continue
		}
		runID := strings.TrimSpace(observedRun.GetRunId())
		logPath := strings.TrimSpace(observedRun.GetLogPath())
		if runID == "" || logPath == "" {
			continue
		}
		activeRunIDs[runID] = struct{}{}

		cursor := shipper.cursors[runID]
		if cursor == nil {
			cursor = &processLogCursor{
				logPath: logPath,
			}
			shipper.cursors[runID] = cursor
		}
		if cursor.logPath != logPath {
			cursor.logPath = logPath
			cursor.offset = 0
			cursor.remainder = ""
		}

		chunk := shipper.collectRunChunkLocked(cursor, observedRun, sampledAtValue)
		if chunk != nil {
			chunks = append(chunks, chunk)
		}
	}

	for runID := range shipper.cursors {
		if _, ok := activeRunIDs[runID]; ok {
			continue
		}
		delete(shipper.cursors, runID)
	}

	return chunks
}

func (shipper *processLogShipper) collectRunChunkLocked(
	cursor *processLogCursor,
	observedRun *slavev1.ObservedProcessRun,
	sampledAt string,
) *slavev1.ProcessLogChunk {
	if cursor == nil || observedRun == nil {
		return nil
	}

	fileInfo, err := os.Stat(cursor.logPath)
	if err != nil {
		if !os.IsNotExist(err) {
			shipper.logger.Debug("failed to stat managed process log", "run_id", observedRun.GetRunId(), "log_path", cursor.logPath, "error", err.Error())
		}
		return nil
	}

	if cursor.offset > fileInfo.Size() {
		cursor.offset = 0
		cursor.remainder = ""
	}

	file, err := os.Open(cursor.logPath)
	if err != nil {
		shipper.logger.Debug("failed to open managed process log", "run_id", observedRun.GetRunId(), "log_path", cursor.logPath, "error", err.Error())
		return nil
	}
	defer file.Close()

	if _, err := file.Seek(cursor.offset, io.SeekStart); err != nil {
		shipper.logger.Debug("failed to seek managed process log", "run_id", observedRun.GetRunId(), "log_path", cursor.logPath, "error", err.Error())
		return nil
	}

	data, err := io.ReadAll(io.LimitReader(file, maxProcessLogChunkBytesPerTick))
	if err != nil {
		shipper.logger.Debug("failed to read managed process log", "run_id", observedRun.GetRunId(), "log_path", cursor.logPath, "error", err.Error())
		return nil
	}
	if len(data) == 0 {
		return nil
	}
	cursor.offset += int64(len(data))

	text := cursor.remainder + strings.ReplaceAll(string(data), "\r\n", "\n")
	parts := strings.Split(text, "\n")
	if len(parts) == 0 {
		return nil
	}

	cursor.remainder = parts[len(parts)-1]
	rawLines := parts[:len(parts)-1]
	lines := make([]string, 0, len(rawLines))
	for _, line := range rawLines {
		trimmedLine := strings.TrimRight(line, "\n")
		if trimmedLine == "" {
			continue
		}
		lines = append(lines, trimmedLine)
	}
	if len(lines) == 0 {
		return nil
	}
	if len(lines) > maxProcessLogLinesPerTick {
		lines = lines[len(lines)-maxProcessLogLinesPerTick:]
	}

	processKey := strings.TrimSpace(observedRun.GetProcessKey())
	if processKey == "" {
		processKey = strings.TrimSpace(observedRun.GetPackageKey())
	}
	packageKey := strings.TrimSpace(observedRun.GetPackageKey())
	if packageKey == "" {
		packageKey = processKey
	}

	return &slavev1.ProcessLogChunk{
		RunId:      strings.TrimSpace(observedRun.GetRunId()),
		ProcessKey: processKey,
		PackageKey: packageKey,
		LogPath:    cursor.logPath,
		SampledAt:  sampledAt,
		Stream:     normalizeProcessLogStream("stdout"),
		Lines:      append([]string{}, lines...),
	}
}
