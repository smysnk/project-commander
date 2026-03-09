package master

import (
	"os"
	"path/filepath"
	"strings"

	slavev1 "github.com/josh/project-commander/packages/agent-shared/gen/projectcommander/slave/v1"
)

func sanitizeProcessRunLogToken(value string) string {
	normalized := strings.TrimSpace(value)
	if normalized == "" {
		return ""
	}
	return sanitizeToken(normalized)
}

func (s *Server) slaveProcessLogPath(slaveID string, runID string) string {
	if s == nil {
		return ""
	}
	slaveToken := sanitizeSlaveLogFileToken(slaveID)
	runToken := sanitizeProcessRunLogToken(runID)
	if slaveToken == "" || runToken == "" {
		return ""
	}
	return filepath.Join(s.logRoot, "slave-processes", slaveToken, runToken+".log")
}

func (s *Server) appendSlaveProcessLogChunk(slaveID string, chunk *slavev1.ProcessLogChunk) {
	if s == nil || chunk == nil {
		return
	}
	runID := strings.TrimSpace(chunk.GetRunId())
	if runID == "" {
		return
	}
	filePath := s.slaveProcessLogPath(slaveID, runID)
	if filePath == "" {
		return
	}
	if err := os.MkdirAll(filepath.Dir(filePath), 0o755); err != nil {
		return
	}

	serviceName := strings.TrimSpace(chunk.GetPackageKey())
	if serviceName == "" {
		serviceName = strings.TrimSpace(chunk.GetProcessKey())
	}
	if serviceName == "" {
		serviceName = "managed-process"
	}
	stream := normalizeSlaveLogStream(chunk.GetStream())
	for _, line := range chunk.GetLines() {
		if strings.TrimSpace(line) == "" {
			continue
		}
		appendStructuredLogLine(filePath, serviceName, stream, line)
	}
}

func (s *Server) appendSlaveProcessLogChunks(slaveID string, chunks []*slavev1.ProcessLogChunk) {
	for _, chunk := range chunks {
		s.appendSlaveProcessLogChunk(slaveID, chunk)
	}
}
