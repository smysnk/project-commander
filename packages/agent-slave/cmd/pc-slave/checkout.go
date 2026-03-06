package main

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	slavev1 "github.com/josh/project-commander/packages/agent-shared/gen/projectcommander/slave/v1"
)

const (
	slaveCommandTypeGitCheckout = "git_checkout"

	slaveCommandStatusCompleted = "completed"
	slaveCommandStatusFailed    = "failed"

	defaultCheckoutTimeout = 10 * time.Minute
	minCheckoutTimeout     = 30 * time.Second

	maxCheckoutOutputLines = 200
	maxCheckoutLineBytes   = 2048
)

type slaveCommandResult struct {
	status      string
	message     string
	outputLines []string
	completedAt string
}

func cloneQueuedSlaveCommand(command *slavev1.SlaveCommand) *slavev1.SlaveCommand {
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

func normalizeCheckoutOutputLines(rawOutput string) []string {
	if strings.TrimSpace(rawOutput) == "" {
		return nil
	}
	lines := make([]string, 0, 16)
	scanner := bufio.NewScanner(strings.NewReader(rawOutput))
	scanner.Buffer(make([]byte, 0, 128*1024), 1024*1024)
	for scanner.Scan() {
		line := strings.TrimRight(scanner.Text(), "\r\n")
		if strings.TrimSpace(line) == "" {
			continue
		}
		if len(line) > maxCheckoutLineBytes {
			line = line[:maxCheckoutLineBytes]
		}
		lines = append(lines, line)
		if len(lines) >= maxCheckoutOutputLines {
			break
		}
	}
	return lines
}

func resolveCheckoutTimeout() time.Duration {
	configured := strings.TrimSpace(os.Getenv("PC_SLAVE_CHECKOUT_TIMEOUT"))
	if configured == "" {
		return defaultCheckoutTimeout
	}
	parsed, err := time.ParseDuration(configured)
	if err != nil || parsed <= 0 {
		return defaultCheckoutTimeout
	}
	if parsed < minCheckoutTimeout {
		return minCheckoutTimeout
	}
	return parsed
}

func validateDestinationFolderName(input string) (string, error) {
	normalized := strings.TrimSpace(input)
	if normalized == "" {
		return "", fmt.Errorf("destination folder is required")
	}
	if strings.ContainsRune(normalized, '\x00') {
		return "", fmt.Errorf("destination folder cannot contain null bytes")
	}
	if strings.Contains(normalized, "/") || strings.Contains(normalized, "\\") {
		return "", fmt.Errorf("destination folder must be a single folder name")
	}
	if normalized == "." || normalized == ".." {
		return "", fmt.Errorf("destination folder cannot be '.' or '..'")
	}
	return normalized, nil
}

func isDirectoryEmpty(directoryPath string) (bool, error) {
	handle, openErr := os.Open(directoryPath)
	if openErr != nil {
		return false, openErr
	}
	defer handle.Close()

	_, readErr := handle.Readdirnames(1)
	if readErr == nil {
		return false, nil
	}
	if errors.Is(readErr, io.EOF) {
		return true, nil
	}
	return false, readErr
}

func executeCheckoutCommand(
	ctx context.Context,
	logger *slog.Logger,
	command *slavev1.SlaveCommand,
) slaveCommandResult {
	repositoryURL := strings.TrimSpace(command.GetRepositoryUrl())
	if repositoryURL == "" {
		return slaveCommandResult{
			status:      slaveCommandStatusFailed,
			message:     "checkout command missing repository_url",
			outputLines: nil,
			completedAt: time.Now().UTC().Format(time.RFC3339Nano),
		}
	}

	baseDirectory, baseErr := normalizeProjectPath(command.GetBaseDirectory())
	if baseErr != nil || strings.TrimSpace(baseDirectory) == "" {
		return slaveCommandResult{
			status:      slaveCommandStatusFailed,
			message:     fmt.Sprintf("invalid base directory: %v", baseErr),
			outputLines: nil,
			completedAt: time.Now().UTC().Format(time.RFC3339Nano),
		}
	}

	destinationFolder, destinationErr := validateDestinationFolderName(command.GetDestinationFolder())
	if destinationErr != nil {
		return slaveCommandResult{
			status:      slaveCommandStatusFailed,
			message:     destinationErr.Error(),
			outputLines: nil,
			completedAt: time.Now().UTC().Format(time.RFC3339Nano),
		}
	}

	targetPath := filepath.Join(baseDirectory, destinationFolder)
	if mkdirErr := os.MkdirAll(baseDirectory, 0o755); mkdirErr != nil {
		return slaveCommandResult{
			status:      slaveCommandStatusFailed,
			message:     fmt.Sprintf("create base directory %s: %v", baseDirectory, mkdirErr),
			outputLines: nil,
			completedAt: time.Now().UTC().Format(time.RFC3339Nano),
		}
	}

	if existingInfo, statErr := os.Stat(targetPath); statErr == nil {
		if !existingInfo.IsDir() {
			return slaveCommandResult{
				status:      slaveCommandStatusFailed,
				message:     fmt.Sprintf("target path exists and is not a directory: %s", targetPath),
				outputLines: nil,
				completedAt: time.Now().UTC().Format(time.RFC3339Nano),
			}
		}
		empty, emptyErr := isDirectoryEmpty(targetPath)
		if emptyErr != nil {
			return slaveCommandResult{
				status:      slaveCommandStatusFailed,
				message:     fmt.Sprintf("check target directory %s: %v", targetPath, emptyErr),
				outputLines: nil,
				completedAt: time.Now().UTC().Format(time.RFC3339Nano),
			}
		}
		if !empty {
			return slaveCommandResult{
				status:      slaveCommandStatusFailed,
				message:     fmt.Sprintf("target directory already exists and is not empty: %s", targetPath),
				outputLines: nil,
				completedAt: time.Now().UTC().Format(time.RFC3339Nano),
			}
		}
	} else if !errors.Is(statErr, os.ErrNotExist) {
		return slaveCommandResult{
			status:      slaveCommandStatusFailed,
			message:     fmt.Sprintf("stat target directory %s: %v", targetPath, statErr),
			outputLines: nil,
			completedAt: time.Now().UTC().Format(time.RFC3339Nano),
		}
	}

	checkoutTimeout := resolveCheckoutTimeout()
	commandCtx, cancel := context.WithTimeout(ctx, checkoutTimeout)
	defer cancel()

	var output bytes.Buffer
	gitCommand := exec.CommandContext(commandCtx, "git", "clone", "--progress", repositoryURL, targetPath)
	gitCommand.Stdout = &output
	gitCommand.Stderr = &output

	runErr := gitCommand.Run()
	outputLines := normalizeCheckoutOutputLines(output.String())
	for _, line := range outputLines {
		logger.Info(
			"checkout command output",
			"command_id",
			strings.TrimSpace(command.GetCommandId()),
			"line",
			line,
		)
	}

	completedAt := time.Now().UTC().Format(time.RFC3339Nano)
	if runErr != nil {
		if commandCtx.Err() == context.DeadlineExceeded {
			return slaveCommandResult{
				status:      slaveCommandStatusFailed,
				message:     fmt.Sprintf("git clone timed out after %s", checkoutTimeout.String()),
				outputLines: outputLines,
				completedAt: completedAt,
			}
		}
		return slaveCommandResult{
			status:      slaveCommandStatusFailed,
			message:     fmt.Sprintf("git clone failed: %v", runErr),
			outputLines: outputLines,
			completedAt: completedAt,
		}
	}

	successMessage := fmt.Sprintf("repository cloned into %s", targetPath)
	return slaveCommandResult{
		status:      slaveCommandStatusCompleted,
		message:     successMessage,
		outputLines: outputLines,
		completedAt: completedAt,
	}
}

func executeSlaveCommand(
	ctx context.Context,
	logger *slog.Logger,
	command *slavev1.SlaveCommand,
) slaveCommandResult {
	if command == nil {
		return slaveCommandResult{
			status:      slaveCommandStatusFailed,
			message:     "received nil command payload",
			outputLines: nil,
			completedAt: time.Now().UTC().Format(time.RFC3339Nano),
		}
	}

	commandType := strings.TrimSpace(command.GetCommandType())
	switch commandType {
	case slaveCommandTypeGitCheckout:
		return executeCheckoutCommand(ctx, logger, command)
	default:
		return slaveCommandResult{
			status:      slaveCommandStatusFailed,
			message:     fmt.Sprintf("unsupported slave command type: %s", commandType),
			outputLines: nil,
			completedAt: time.Now().UTC().Format(time.RFC3339Nano),
		}
	}
}
