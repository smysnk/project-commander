package main

import (
	"context"
	"crypto/sha1"
	"encoding/hex"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"syscall"
	"time"
)

const (
	defaultWorkloadLaunchCommand = "yarn dev"
	defaultWatchInterval         = time.Second
	processStopTimeout           = 3 * time.Second
)

type gitignoreRule struct {
	negated bool
	regex   *regexp.Regexp
}

type gitignoreMatcher struct {
	rules []gitignoreRule
}

func normalizeRelativePath(value string) string {
	normalized := strings.TrimSpace(value)
	normalized = strings.ReplaceAll(normalized, "\\", "/")
	normalized = strings.TrimPrefix(normalized, "./")
	normalized = strings.TrimPrefix(normalized, "/")
	return normalized
}

func globToRegex(glob string) string {
	var builder strings.Builder
	for index := 0; index < len(glob); index += 1 {
		char := glob[index]
		switch char {
		case '*':
			if index+1 < len(glob) && glob[index+1] == '*' {
				builder.WriteString(".*")
				for index+1 < len(glob) && glob[index+1] == '*' {
					index += 1
				}
				continue
			}
			builder.WriteString("[^/]*")
		case '?':
			builder.WriteString("[^/]")
		default:
			if strings.ContainsRune(`.+()|[]{}^$\\`, rune(char)) {
				builder.WriteByte('\\')
			}
			builder.WriteByte(char)
		}
	}
	return builder.String()
}

func compileGitignorePattern(pattern string, directoryOnly bool) string {
	normalized := normalizeRelativePath(pattern)
	anchored := strings.HasPrefix(strings.TrimSpace(pattern), "/")
	hasSlash := strings.Contains(normalized, "/")
	core := globToRegex(normalized)

	if !hasSlash {
		if directoryOnly {
			return `(^|.*/)` + core + `(/.*)?$`
		}
		return `(^|.*/)` + core + `($|/.*)`
	}

	prefix := "(^|.*/)"
	if anchored {
		prefix = "^"
	}
	if directoryOnly {
		return prefix + core + `(/.*)?$`
	}
	return prefix + core + `$`
}

func parseGitignoreRules(content string) []gitignoreRule {
	lines := strings.Split(strings.ReplaceAll(content, "\r\n", "\n"), "\n")
	rules := make([]gitignoreRule, 0, len(lines))
	for _, rawLine := range lines {
		line := strings.TrimSpace(rawLine)
		if line == "" {
			continue
		}
		if strings.HasPrefix(line, "#") {
			continue
		}

		line = strings.TrimPrefix(line, "\\#")

		negated := false
		if strings.HasPrefix(line, "!") {
			negated = true
			line = strings.TrimPrefix(line, "!")
		}
		line = strings.TrimPrefix(line, "\\!")
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		directoryOnly := strings.HasSuffix(line, "/")
		line = strings.TrimSuffix(line, "/")
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		compiled, err := regexp.Compile(compileGitignorePattern(line, directoryOnly))
		if err != nil {
			continue
		}
		rules = append(rules, gitignoreRule{negated: negated, regex: compiled})
	}
	return rules
}

func loadGitignoreMatcher(projectPath string) (*gitignoreMatcher, error) {
	gitignorePath := filepath.Join(projectPath, ".gitignore")
	raw, err := os.ReadFile(gitignorePath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return &gitignoreMatcher{}, nil
		}
		return nil, err
	}
	return &gitignoreMatcher{rules: parseGitignoreRules(string(raw))}, nil
}

func (matcher *gitignoreMatcher) ShouldIgnore(relativePath string, _ bool) bool {
	if matcher == nil || len(matcher.rules) == 0 {
		return false
	}
	normalized := normalizeRelativePath(relativePath)
	if normalized == "" || strings.HasPrefix(normalized, "../") {
		return false
	}

	ignored := false
	for _, rule := range matcher.rules {
		if rule.regex == nil {
			continue
		}
		if rule.regex.MatchString(normalized) {
			ignored = !rule.negated
		}
	}
	return ignored
}

func isDirectoryPath(targetPath string) bool {
	info, err := os.Stat(targetPath)
	if err != nil {
		return false
	}
	return info.IsDir()
}

func computePackagesWatchSignature(projectPath string, matcher *gitignoreMatcher) (string, bool, error) {
	watchRoot := filepath.Join(projectPath, "packages")
	if !isDirectoryPath(watchRoot) {
		return "", false, nil
	}

	entries := make([]string, 0, 256)
	walkErr := filepath.WalkDir(watchRoot, func(currentPath string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if currentPath == watchRoot {
			return nil
		}

		rel, relErr := filepath.Rel(projectPath, currentPath)
		if relErr != nil {
			return relErr
		}
		normalizedRel := normalizeRelativePath(rel)
		if normalizedRel == "" {
			return nil
		}

		if matcher != nil && matcher.ShouldIgnore(normalizedRel, entry.IsDir()) {
			if entry.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}

		if entry.IsDir() {
			return nil
		}
		if entry.Type()&os.ModeSymlink != 0 {
			return nil
		}

		info, infoErr := entry.Info()
		if infoErr != nil {
			return infoErr
		}
		entries = append(entries, fmt.Sprintf("%s|%d|%d", normalizedRel, info.Size(), info.ModTime().UnixNano()))
		return nil
	})
	if walkErr != nil {
		return "", true, walkErr
	}

	sort.Strings(entries)
	signatureBase := strings.Join(entries, "\n")
	sum := sha1.Sum([]byte(signatureBase))
	return hex.EncodeToString(sum[:]), true, nil
}

type workloadSupervisor struct {
	logger        *slog.Logger
	projectPath   string
	launchCommand string
	watchInterval time.Duration

	matcher *gitignoreMatcher

	mu         sync.Mutex
	cmd        *exec.Cmd
	running    bool
	generation uint64
}

func newWorkloadSupervisor(
	logger *slog.Logger,
	projectPath string,
	launchCommand string,
	watchInterval time.Duration,
) (*workloadSupervisor, error) {
	normalizedProjectPath := strings.TrimSpace(projectPath)
	if normalizedProjectPath == "" {
		return nil, fmt.Errorf("project path is required")
	}
	absProjectPath, err := filepath.Abs(normalizedProjectPath)
	if err != nil {
		return nil, err
	}
	absProjectPath = filepath.Clean(absProjectPath)
	if !isDirectoryPath(absProjectPath) {
		return nil, fmt.Errorf("project path is not a directory: %s", absProjectPath)
	}

	if logger == nil {
		logger = slog.Default()
	}
	if strings.TrimSpace(launchCommand) == "" {
		launchCommand = defaultWorkloadLaunchCommand
	}
	if watchInterval <= 0 {
		watchInterval = defaultWatchInterval
	}

	matcher, matcherErr := loadGitignoreMatcher(absProjectPath)
	if matcherErr != nil {
		return nil, matcherErr
	}

	return &workloadSupervisor{
		logger:        logger,
		projectPath:   absProjectPath,
		launchCommand: strings.TrimSpace(launchCommand),
		watchInterval: watchInterval,
		matcher:       matcher,
	}, nil
}

func (supervisor *workloadSupervisor) RunningServices() int32 {
	supervisor.mu.Lock()
	defer supervisor.mu.Unlock()
	if supervisor.running {
		return 1
	}
	return 0
}

func sendSignalToProcessTree(process *os.Process, signal syscall.Signal) {
	if process == nil {
		return
	}
	pid := process.Pid
	if pid <= 0 {
		return
	}
	if err := syscall.Kill(-pid, signal); err == nil {
		return
	}
	_ = process.Signal(signal)
}

func (supervisor *workloadSupervisor) waitForExit(process *exec.Cmd, generation uint64) {
	err := process.Wait()

	supervisor.mu.Lock()
	isCurrent := supervisor.cmd == process
	if isCurrent {
		supervisor.cmd = nil
		supervisor.running = false
	}
	supervisor.mu.Unlock()

	if err != nil {
		supervisor.logger.Warn(
			"slave workload process exited",
			"generation",
			generation,
			"command",
			supervisor.launchCommand,
			"error",
			err.Error(),
		)
		return
	}
	supervisor.logger.Info(
		"slave workload process exited",
		"generation",
		generation,
		"command",
		supervisor.launchCommand,
	)
}

func (supervisor *workloadSupervisor) startProcess() error {
	supervisor.mu.Lock()
	alreadyRunning := supervisor.running
	supervisor.mu.Unlock()
	if alreadyRunning {
		return nil
	}

	command := exec.Command("sh", "-lc", supervisor.launchCommand)
	command.Dir = supervisor.projectPath
	command.Env = os.Environ()
	command.Stdout = os.Stdout
	command.Stderr = os.Stderr
	command.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}

	if err := command.Start(); err != nil {
		return err
	}

	supervisor.mu.Lock()
	supervisor.cmd = command
	supervisor.running = true
	supervisor.generation += 1
	generation := supervisor.generation
	supervisor.mu.Unlock()

	supervisor.logger.Info(
		"slave workload process started",
		"generation",
		generation,
		"pid",
		command.Process.Pid,
		"project_path",
		supervisor.projectPath,
		"command",
		supervisor.launchCommand,
	)

	go supervisor.waitForExit(command, generation)
	return nil
}

func (supervisor *workloadSupervisor) stopProcess(timeout time.Duration) {
	supervisor.mu.Lock()
	process := supervisor.cmd
	running := supervisor.running
	supervisor.mu.Unlock()
	if !running || process == nil || process.Process == nil {
		return
	}

	sendSignalToProcessTree(process.Process, syscall.SIGTERM)
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if supervisor.RunningServices() == 0 {
			return
		}
		time.Sleep(50 * time.Millisecond)
	}

	sendSignalToProcessTree(process.Process, syscall.SIGKILL)
}

func (supervisor *workloadSupervisor) restartProcess(reason string) {
	supervisor.logger.Info(
		"restarting slave workload process",
		"reason",
		reason,
		"project_path",
		supervisor.projectPath,
	)
	supervisor.stopProcess(processStopTimeout)
	if err := supervisor.startProcess(); err != nil {
		supervisor.logger.Error("failed to start slave workload process", "error", err.Error())
	}
}

func (supervisor *workloadSupervisor) refreshMatcher() {
	matcher, err := loadGitignoreMatcher(supervisor.projectPath)
	if err != nil {
		supervisor.logger.Warn("failed to load .gitignore", "error", err.Error())
		return
	}
	supervisor.matcher = matcher
}

func (supervisor *workloadSupervisor) Run(ctx context.Context) {
	if err := supervisor.startProcess(); err != nil {
		supervisor.logger.Error("failed to start slave workload process", "error", err.Error())
	}

	currentSignature, hasWatchRoot, signatureErr := computePackagesWatchSignature(
		supervisor.projectPath,
		supervisor.matcher,
	)
	if signatureErr != nil {
		supervisor.logger.Warn("failed to compute initial package watch signature", "error", signatureErr.Error())
	}
	if !hasWatchRoot {
		supervisor.logger.Info(
			"packages directory not found; file watching disabled until it exists",
			"watch_root",
			filepath.Join(supervisor.projectPath, "packages"),
		)
	}

	ticker := time.NewTicker(supervisor.watchInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			supervisor.stopProcess(processStopTimeout)
			return
		case <-ticker.C:
			supervisor.refreshMatcher()
			nextSignature, nextHasWatchRoot, err := computePackagesWatchSignature(
				supervisor.projectPath,
				supervisor.matcher,
			)
			if err != nil {
				supervisor.logger.Warn("failed to compute package watch signature", "error", err.Error())
				continue
			}
			if !nextHasWatchRoot {
				hasWatchRoot = false
				continue
			}
			if !hasWatchRoot {
				hasWatchRoot = true
				currentSignature = nextSignature
				supervisor.logger.Info(
					"packages directory detected; file watching enabled",
					"watch_root",
					filepath.Join(supervisor.projectPath, "packages"),
				)
				continue
			}
			if nextSignature == currentSignature {
				continue
			}
			currentSignature = nextSignature
			supervisor.restartProcess("packages directory changed")
		}
	}
}
