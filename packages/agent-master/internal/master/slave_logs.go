package master

import (
	"path/filepath"
	"strings"
)

func normalizeSlaveLogStream(stream string) string {
	switch strings.ToLower(strings.TrimSpace(stream)) {
	case "stdout":
		return "stdout"
	case "stderr":
		return "stderr"
	default:
		return "system"
	}
}

func sanitizeSlaveLogFileToken(slaveID string) string {
	normalized := strings.TrimSpace(slaveID)
	if normalized == "" {
		return ""
	}
	return sanitizeToken(normalized)
}

func (s *Server) slaveLogPath(slaveID string) string {
	if s == nil {
		return ""
	}
	token := sanitizeSlaveLogFileToken(slaveID)
	if token == "" {
		return ""
	}
	return filepath.Join(s.logRoot, token+".log")
}

func (s *Server) appendSlaveLogLine(slaveID string, serviceName string, stream string, message string) {
	if s == nil {
		return
	}
	logPath := s.slaveLogPath(slaveID)
	if logPath == "" {
		return
	}

	normalizedServiceName := strings.TrimSpace(serviceName)
	if normalizedServiceName == "" {
		normalizedServiceName = "agent-slave"
	}

	appendStructuredLogLine(
		logPath,
		normalizedServiceName,
		normalizeSlaveLogStream(stream),
		message,
	)
}
