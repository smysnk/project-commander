package main

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

const (
	defaultSlaveStateDirName  = ".project-commander/slave"
	defaultProcessLogDirName  = "process-logs"
	defaultProcessStateDirName = "processes"
)

var bootTimeSecPattern = regexp.MustCompile(`sec\s*=\s*(\d+)`)

func sanitizeStateToken(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return "default"
	}
	var builder strings.Builder
	for _, char := range trimmed {
		if (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') || (char >= '0' && char <= '9') {
			builder.WriteRune(char)
			continue
		}
		switch char {
		case '-', '_', '.':
			builder.WriteRune(char)
		default:
			builder.WriteRune('_')
		}
	}
	normalized := strings.Trim(builder.String(), "._")
	if normalized == "" {
		return "default"
	}
	return normalized
}

func resolveDefaultStateRoot(slaveID string) (string, error) {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("resolve state root home directory: %w", err)
	}
	trimmedHomeDir := strings.TrimSpace(homeDir)
	if trimmedHomeDir == "" {
		return "", fmt.Errorf("resolve state root home directory: home directory is empty")
	}
	return filepath.Join(trimmedHomeDir, defaultSlaveStateDirName, sanitizeStateToken(slaveID)), nil
}

func normalizeOptionalDirectoryPath(rawPath string) (string, error) {
	trimmed := strings.TrimSpace(rawPath)
	if trimmed == "" {
		return "", nil
	}
	if trimmed == "~" || strings.HasPrefix(trimmed, "~/") {
		homeDir, err := os.UserHomeDir()
		if err != nil {
			return "", fmt.Errorf("resolve home directory for %s: %w", trimmed, err)
		}
		if trimmed == "~" {
			trimmed = homeDir
		} else {
			trimmed = filepath.Join(homeDir, strings.TrimPrefix(trimmed, "~/"))
		}
	}
	absolutePath, err := filepath.Abs(trimmed)
	if err != nil {
		return "", fmt.Errorf("normalize directory path %s: %w", trimmed, err)
	}
	return filepath.Clean(absolutePath), nil
}

func resolveStateRoot(configuredPath string, slaveID string) (string, error) {
	normalized, err := normalizeOptionalDirectoryPath(configuredPath)
	if err != nil {
		return "", err
	}
	if normalized != "" {
		return normalized, nil
	}
	return resolveDefaultStateRoot(slaveID)
}

func resolveProcessLogRoot(configuredPath string, stateRoot string) (string, error) {
	normalized, err := normalizeOptionalDirectoryPath(configuredPath)
	if err != nil {
		return "", err
	}
	if normalized != "" {
		return normalized, nil
	}
	if strings.TrimSpace(stateRoot) == "" {
		return "", fmt.Errorf("state root is required to derive process log root")
	}
	return filepath.Join(stateRoot, defaultProcessLogDirName), nil
}

func resolveBootID() (string, error) {
	if configured := strings.TrimSpace(os.Getenv("PC_BOOT_ID")); configured != "" {
		return configured, nil
	}

	const linuxBootIDPath = "/proc/sys/kernel/random/boot_id"
	if raw, err := os.ReadFile(linuxBootIDPath); err == nil {
		if bootID := strings.TrimSpace(string(raw)); bootID != "" {
			return bootID, nil
		}
	}

	if output, err := exec.Command("sysctl", "-n", "kern.boottime").Output(); err == nil {
		if matches := bootTimeSecPattern.FindStringSubmatch(string(output)); len(matches) == 2 {
			return "boot-" + strings.TrimSpace(matches[1]), nil
		}
	}

	hostname, _ := os.Hostname()
	token := make([]byte, 8)
	if _, err := rand.Read(token); err != nil {
		return "", fmt.Errorf("generate fallback boot id: %w", err)
	}
	return fmt.Sprintf("fallback-%s-%d-%s", sanitizeStateToken(hostname), time.Now().UTC().Unix(), hex.EncodeToString(token)), nil
}

func newRunID() (string, error) {
	token := make([]byte, 16)
	if _, err := rand.Read(token); err != nil {
		return "", fmt.Errorf("generate run id: %w", err)
	}
	return "run-" + hex.EncodeToString(token), nil
}
