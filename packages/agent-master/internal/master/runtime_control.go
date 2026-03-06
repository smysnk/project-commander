package master

import (
	"bufio"
	"context"
	"crypto/sha1"
	"encoding/hex"
	"fmt"
	"hash/crc32"
	"io"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"syscall"
	"time"

	masterv1 "github.com/josh/project-commander/packages/agent-shared/gen/projectcommander/master/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

const (
	defaultServiceLaunchCommand = "yarn dev"
	serviceStableDuration       = 4 * time.Second
	stopGraceDuration           = 5 * time.Second
	stopForceDuration           = 2 * time.Second
	portBlockStart              = 4000
	portBlockSize               = 10
	portBlockMax                = 65000
)

var (
	envLinePattern = regexp.MustCompile(`^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$`)

	ignoredServiceDirectories = map[string]struct{}{
		".git":         {},
		".next":        {},
		".yarn":        {},
		"node_modules": {},
		"dist":         {},
		"build":        {},
		"coverage":     {},
		".turbo":       {},
		".cache":       {},
	}
)

type portRangeSettings struct {
	Mode  string
	Begin int
}

type serviceSpec struct {
	Key            string
	DisplayName    string
	Cwd            string
	HasPackageJSON bool
}

type processRunState struct {
	RunID         string
	PID           int
	Status        string
	StartedAt     time.Time
	LastExitCode  *int
	LaunchCommand string
	StdoutPath    string
	StderrPath    string
	StopRequested bool
}

type serviceRuntimeState struct {
	Spec serviceSpec
	Port int
	Run  *processRunState
}

type projectRuntimeState struct {
	ProjectPath    string
	PortRangeBegin int
	PortRangeEnd   int
	Services       map[string]*serviceRuntimeState
}

type parsedLogEntry struct {
	Timestamp string
	Service   string
	Stream    string
	Message   string
	RunID     string
}

type processStatPayload struct {
	PID       int
	CPU       float64
	Memory    float64
	RSSMB     float64
	VirtualMB float64
	Elapsed   string
	Command   string
}

func normalizeProjectPath(projectPath string) (string, error) {
	trimmed := strings.TrimSpace(projectPath)
	if trimmed == "" {
		return "", fmt.Errorf("project path is required")
	}
	absPath, err := filepath.Abs(trimmed)
	if err != nil {
		return "", err
	}
	return filepath.Clean(absPath), nil
}

func normalizeRuntimePortMode(mode string) string {
	if strings.EqualFold(strings.TrimSpace(mode), "manual") {
		return "manual"
	}
	return "automatic"
}

func isDirectory(targetPath string) bool {
	info, err := os.Stat(targetPath)
	if err != nil {
		return false
	}
	return info.IsDir()
}

func fileExists(targetPath string) bool {
	info, err := os.Stat(targetPath)
	if err != nil {
		return false
	}
	return info.Mode().IsRegular()
}

func normalizeServiceKey(value string) string {
	normalized := strings.ToLower(strings.TrimSpace(value))
	switch normalized {
	case "", "service":
		return ""
	case "main", "web", "interface":
		return "main"
	case "api", "server":
		return "api"
	case "admin":
		return "admin"
	case "graphql":
		return "graphql"
	default:
		return sanitizeToken(normalized)
	}
}

func sanitizeToken(value string) string {
	trimmed := strings.ToLower(strings.TrimSpace(value))
	if trimmed == "" {
		return ""
	}

	var builder strings.Builder
	lastDash := false
	for _, r := range trimmed {
		isAlphaNum := (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9')
		if isAlphaNum {
			builder.WriteRune(r)
			lastDash = false
			continue
		}

		if !lastDash {
			builder.WriteRune('-')
			lastDash = true
		}
	}

	cleaned := strings.Trim(builder.String(), "-")
	return cleaned
}

func serviceSortRank(key string) int {
	switch key {
	case "main":
		return 0
	case "graphql":
		return 1
	case "api":
		return 2
	case "admin":
		return 3
	default:
		return 10
	}
}

func sortServiceSpecs(specs []serviceSpec) {
	sort.Slice(specs, func(i, j int) bool {
		leftRank := serviceSortRank(specs[i].Key)
		rightRank := serviceSortRank(specs[j].Key)
		if leftRank != rightRank {
			return leftRank < rightRank
		}
		if specs[i].Key != specs[j].Key {
			return specs[i].Key < specs[j].Key
		}
		return specs[i].DisplayName < specs[j].DisplayName
	})
}

func dedupeServiceSpecs(specs []serviceSpec) []serviceSpec {
	counts := map[string]int{}
	result := make([]serviceSpec, 0, len(specs))
	for _, spec := range specs {
		base := strings.TrimSpace(spec.Key)
		if base == "" {
			continue
		}

		count := counts[base]
		counts[base] = count + 1
		if count > 0 {
			spec.Key = fmt.Sprintf("%s-%d", base, count+1)
		}
		result = append(result, spec)
	}
	return result
}

func buildRootServiceSpec(projectPath string) serviceSpec {
	hasPackageJSON := fileExists(filepath.Join(projectPath, "package.json"))
	return serviceSpec{
		Key:            "main",
		DisplayName:    "main",
		Cwd:            projectPath,
		HasPackageJSON: hasPackageJSON,
	}
}

func (s *Server) discoverServiceSpecs(projectPath string) ([]serviceSpec, error) {
	if !isDirectory(projectPath) {
		return []serviceSpec{}, nil
	}

	packagesPath := filepath.Join(projectPath, "packages")
	specs := make([]serviceSpec, 0)
	if isDirectory(packagesPath) {
		entries, err := os.ReadDir(packagesPath)
		if err != nil {
			return nil, err
		}
		for _, entry := range entries {
			if !entry.IsDir() {
				continue
			}
			if entry.Type()&os.ModeSymlink != 0 {
				continue
			}
			if _, ignored := ignoredServiceDirectories[entry.Name()]; ignored {
				continue
			}

			serviceName := strings.TrimSpace(entry.Name())
			if serviceName == "" {
				continue
			}
			servicePath := filepath.Join(packagesPath, entry.Name())
			specs = append(specs, serviceSpec{
				Key:            normalizeServiceKey(serviceName),
				DisplayName:    strings.ToLower(serviceName),
				Cwd:            servicePath,
				HasPackageJSON: fileExists(filepath.Join(servicePath, "package.json")),
			})
		}
	}

	if len(specs) == 0 {
		specs = append(specs, buildRootServiceSpec(projectPath))
	}

	specs = dedupeServiceSpecs(specs)
	sortServiceSpecs(specs)
	return specs, nil
}

func (s *Server) ensureProjectStateLocked(projectPath string, specs []serviceSpec) *projectRuntimeState {
	state := s.projects[projectPath]
	if state == nil {
		state = &projectRuntimeState{
			ProjectPath: projectPath,
			Services:    map[string]*serviceRuntimeState{},
		}
		s.projects[projectPath] = state
	}

	nextServices := map[string]*serviceRuntimeState{}
	for _, spec := range specs {
		existing := state.Services[spec.Key]
		if existing == nil {
			existing = &serviceRuntimeState{
				Spec: spec,
			}
		} else {
			existing.Spec = spec
		}
		nextServices[spec.Key] = existing
	}

	for key, existing := range state.Services {
		if _, ok := nextServices[key]; ok {
			continue
		}
		if existing.Run != nil && existing.Run.PID > 0 && isProcessRunning(existing.Run.PID) {
			nextServices[key] = existing
		}
	}

	state.Services = nextServices
	s.refreshProjectRuntimeLocked(state)
	return state
}

func (s *Server) refreshProjectRuntimeLocked(state *projectRuntimeState) {
	for _, service := range state.Services {
		run := service.Run
		if run == nil {
			continue
		}

		if run.PID > 0 && isProcessRunning(run.PID) {
			if run.Status == "starting" && time.Since(run.StartedAt) >= serviceStableDuration {
				run.Status = "started"
			}
			continue
		}

		if run.PID > 0 {
			run.PID = 0
		}

		if run.Status == "starting" || run.Status == "started" {
			if run.StopRequested {
				run.Status = "stopped"
			} else {
				run.Status = "crashed"
			}
		}
	}

	s.clearProjectPortRangeIfIdleLocked(state)
}

func isProcessRunning(pid int) bool {
	if pid <= 0 {
		return false
	}
	if err := syscall.Kill(pid, 0); err != nil {
		return false
	}
	return true
}

func orderedServiceKeys(services map[string]*serviceRuntimeState) []string {
	keys := make([]string, 0, len(services))
	for key := range services {
		keys = append(keys, key)
	}
	sort.Slice(keys, func(i, j int) bool {
		leftRank := serviceSortRank(keys[i])
		rightRank := serviceSortRank(keys[j])
		if leftRank != rightRank {
			return leftRank < rightRank
		}
		return keys[i] < keys[j]
	})
	return keys
}

func (s *Server) findServiceLocked(state *projectRuntimeState, requestedKey string) *serviceRuntimeState {
	normalized := normalizeServiceKey(requestedKey)
	if normalized != "" {
		if direct := state.Services[normalized]; direct != nil {
			return direct
		}
	}

	trimmedLower := strings.ToLower(strings.TrimSpace(requestedKey))
	if trimmedLower != "" {
		if direct := state.Services[trimmedLower]; direct != nil {
			return direct
		}
	}

	for _, service := range state.Services {
		if strings.EqualFold(service.Spec.DisplayName, requestedKey) {
			return service
		}
		if normalized != "" && normalizeServiceKey(service.Spec.DisplayName) == normalized {
			return service
		}
	}
	return nil
}

func (s *Server) getRuntimeSnapshotInternal(projectPath string) (*masterv1.RuntimeSnapshot, error) {
	specs, err := s.discoverServiceSpecs(projectPath)
	if err != nil {
		return nil, err
	}

	s.runtimeMu.Lock()
	defer s.runtimeMu.Unlock()

	state := s.ensureProjectStateLocked(projectPath, specs)
	return s.buildRuntimeSnapshotLocked(projectPath, state), nil
}

func (s *Server) buildRuntimeSnapshotLocked(projectPath string, state *projectRuntimeState) *masterv1.RuntimeSnapshot {
	hasStarting := false
	hasRunning := false
	projectPID := int64(0)
	serviceStates := make([]*masterv1.RuntimeServiceState, 0, len(state.Services))

	for _, key := range orderedServiceKeys(state.Services) {
		service := state.Services[key]
		run := service.Run
		pid := int64(0)
		runID := ""
		status := "stopped"

		if run != nil {
			runID = run.RunID
			if run.PID > 0 && isProcessRunning(run.PID) {
				pid = int64(run.PID)
				if projectPID == 0 {
					projectPID = pid
				}
				if run.Status == "starting" {
					status = "starting"
					hasStarting = true
				} else {
					status = "started"
					hasRunning = true
				}
			} else {
				switch run.Status {
				case "crashed":
					status = "crashed"
				case "starting":
					status = "starting"
				default:
					status = "stopped"
				}
			}
		}

		serviceStates = append(serviceStates, &masterv1.RuntimeServiceState{
			ServiceKey:  service.Spec.Key,
			ServiceName: service.Spec.DisplayName,
			Pid:         pid,
			Port:        int32(service.Port),
			State:       status,
			RunId:       runID,
		})
	}

	projectStatus := "stopped"
	if hasStarting {
		projectStatus = "starting"
	} else if hasRunning {
		projectStatus = "started"
	}

	snapshot := &masterv1.RuntimeSnapshot{
		ProjectPath: projectPath,
		Status:      projectStatus,
		Pid:         projectPID,
		Services:    serviceStates,
	}
	if state.PortRangeBegin > 0 && state.PortRangeEnd >= state.PortRangeBegin {
		snapshot.PortRangeBegin = int32(state.PortRangeBegin)
		snapshot.PortRangeEnd = int32(state.PortRangeEnd)
	}
	return snapshot
}

func clampLogLimit(limit int32) int {
	if limit <= 0 {
		return 300
	}
	if limit > 2000 {
		return 2000
	}
	return int(limit)
}

func parseLogLine(raw string) *parsedLogEntry {
	parts := strings.Split(raw, "\t")
	if len(parts) < 4 {
		return nil
	}
	timestamp := strings.TrimSpace(parts[0])
	if _, err := time.Parse(time.RFC3339Nano, timestamp); err != nil {
		if _, fallbackErr := time.Parse(time.RFC3339, timestamp); fallbackErr != nil {
			return nil
		}
	}

	serviceName := strings.TrimSpace(parts[1])
	stream := strings.TrimSpace(parts[2])
	if serviceName == "" || (stream != "stdout" && stream != "stderr" && stream != "system") {
		return nil
	}

	return &parsedLogEntry{
		Timestamp: timestamp,
		Service:   serviceName,
		Stream:    stream,
		Message:   strings.Join(parts[3:], "\t"),
	}
}

func readLogFileEntries(filePath string, fallbackServiceName string, fallbackStream string, runID string) []parsedLogEntry {
	raw, err := os.ReadFile(filePath)
	if err != nil {
		return []parsedLogEntry{}
	}

	info, _ := os.Stat(filePath)
	baseTime := time.Now().UTC()
	if info != nil {
		baseTime = info.ModTime().UTC()
	}

	lines := strings.Split(strings.ReplaceAll(string(raw), "\r\n", "\n"), "\n")
	entries := make([]parsedLogEntry, 0, len(lines))
	for index, line := range lines {
		if strings.TrimSpace(line) == "" {
			continue
		}

		if parsed := parseLogLine(line); parsed != nil {
			parsed.RunID = runID
			entries = append(entries, *parsed)
			continue
		}

		entries = append(entries, parsedLogEntry{
			Timestamp: baseTime.Add(time.Duration(index) * time.Millisecond).Format(time.RFC3339Nano),
			Service:   fallbackServiceName,
			Stream:    fallbackStream,
			Message:   strings.TrimRight(line, "\n"),
			RunID:     runID,
		})
	}
	return entries
}

func parsePSLine(rawLine string) *processStatPayload {
	line := strings.TrimSpace(rawLine)
	if line == "" {
		return nil
	}

	fields := strings.Fields(line)
	if len(fields) < 6 {
		return nil
	}

	pid, err := strconv.Atoi(fields[0])
	if err != nil || pid <= 0 {
		return nil
	}

	cpu, _ := strconv.ParseFloat(fields[1], 64)
	mem, _ := strconv.ParseFloat(fields[2], 64)
	rssKB, _ := strconv.ParseFloat(fields[3], 64)
	vszKB, _ := strconv.ParseFloat(fields[4], 64)
	elapsed := strings.TrimSpace(fields[5])
	command := ""
	if len(fields) > 6 {
		command = strings.Join(fields[6:], " ")
	}

	return &processStatPayload{
		PID:       pid,
		CPU:       cpu,
		Memory:    mem,
		RSSMB:     roundOneDecimal(rssKB / 1024.0),
		VirtualMB: roundOneDecimal(vszKB / 1024.0),
		Elapsed:   elapsed,
		Command:   command,
	}
}

func roundOneDecimal(value float64) float64 {
	return float64(int(value*10+0.5)) / 10
}

func readProcessStat(pid int) *processStatPayload {
	if pid <= 0 || !isProcessRunning(pid) {
		return nil
	}
	command := exec.Command("ps", "-p", strconv.Itoa(pid), "-o", "pid=,pcpu=,pmem=,rss=,vsz=,etime=,command=")
	output, err := command.Output()
	if err != nil {
		return nil
	}
	firstLine := ""
	for _, line := range strings.Split(strings.ReplaceAll(string(output), "\r\n", "\n"), "\n") {
		trimmed := strings.TrimSpace(line)
		if trimmed != "" {
			firstLine = trimmed
			break
		}
	}
	if firstLine == "" {
		return nil
	}
	return parsePSLine(firstLine)
}

func buildPortOverrides(base int) map[string]string {
	serverPort := base + 1
	return map[string]string{
		"WEB_PORT":              strconv.Itoa(base),
		"SERVER_PORT":           strconv.Itoa(serverPort),
		"ADMIN_PORT":            strconv.Itoa(base + 2),
		"ASSET_SERVER_PORT":     strconv.Itoa(base + 3),
		"PROTECTED_GRAPHQL_URL": fmt.Sprintf("http://localhost:%d/graphql/protected", serverPort),
	}
}

func buildServicePortMap(specs []serviceSpec, base int) map[string]int {
	ports := map[string]int{}
	extraKeys := make([]string, 0)

	for _, spec := range specs {
		switch spec.Key {
		case "main":
			ports[spec.Key] = base
		case "api", "graphql":
			ports[spec.Key] = base + 1
		case "admin":
			ports[spec.Key] = base + 2
		default:
			extraKeys = append(extraKeys, spec.Key)
		}
	}

	sort.Strings(extraKeys)
	nextOffset := 4
	for _, key := range extraKeys {
		offset := nextOffset
		if offset >= portBlockSize {
			offset = 1
		}
		ports[key] = base + offset
		nextOffset += 1
	}

	return ports
}

func parseDotEnvFile(filePath string) map[string]string {
	file, err := os.Open(filePath)
	if err != nil {
		return map[string]string{}
	}
	defer file.Close()

	result := map[string]string{}
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}

		match := envLinePattern.FindStringSubmatch(line)
		if len(match) != 3 {
			continue
		}

		key := strings.TrimSpace(match[1])
		value := strings.TrimSpace(match[2])
		if strings.HasPrefix(value, "\"") && strings.HasSuffix(value, "\"") && len(value) >= 2 {
			value = value[1 : len(value)-1]
		} else if strings.HasPrefix(value, "'") && strings.HasSuffix(value, "'") && len(value) >= 2 {
			value = value[1 : len(value)-1]
		}
		result[key] = value
	}
	return result
}

func processEnvMap() map[string]string {
	envMap := map[string]string{}
	for _, entry := range os.Environ() {
		separator := strings.Index(entry, "=")
		if separator <= 0 {
			continue
		}
		key := entry[:separator]
		value := entry[separator+1:]
		envMap[key] = value
	}
	return envMap
}

func envMapToList(envMap map[string]string) []string {
	keys := make([]string, 0, len(envMap))
	for key := range envMap {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	list := make([]string, 0, len(keys))
	for _, key := range keys {
		list = append(list, fmt.Sprintf("%s=%s", key, envMap[key]))
	}
	return list
}

func shellSingleQuote(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "'\\''") + "'"
}

func buildLaunchBootstrapCommand(cwd string, launchCommand string) string {
	directoryLine := shellSingleQuote("directory: " + cwd)
	commandLine := shellSingleQuote("launch command: " + launchCommand)
	return strings.Join([]string{
		"printf '%s\\n' " + directoryLine,
		"printf '%s\\n' " + commandLine,
		"printf '%s\\n' \"process id: $$\"",
		"exec " + launchCommand,
	}, "; ")
}

func truncateLogFile(filePath string) error {
	return os.WriteFile(filePath, []byte{}, 0o644)
}

func appendStructuredLogLine(filePath string, serviceName string, stream string, message string) {
	if filePath == "" || strings.TrimSpace(message) == "" {
		return
	}
	line := fmt.Sprintf("%s\t%s\t%s\t%s\n", time.Now().UTC().Format(time.RFC3339Nano), serviceName, stream, strings.TrimSpace(message))
	file, err := os.OpenFile(filePath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return
	}
	defer file.Close()
	_, _ = file.WriteString(line)
}

func (s *Server) streamProcessOutput(
	projectPath string,
	serviceKey string,
	serviceName string,
	runID string,
	streamName string,
	reader io.Reader,
	logPath string,
) {
	if reader == nil {
		return
	}

	scanner := bufio.NewScanner(reader)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for scanner.Scan() {
		line := strings.TrimRight(scanner.Text(), "\r\n")
		if strings.TrimSpace(line) == "" {
			continue
		}
		appendStructuredLogLine(logPath, serviceName, streamName, line)
		s.emitLogAppendEvent(projectPath, serviceKey, serviceName, streamName, line, runID)
	}

	if err := scanner.Err(); err != nil {
		errLine := fmt.Sprintf("log stream error (%s): %v", streamName, err)
		appendStructuredLogLine(logPath, serviceName, "system", errLine)
		s.emitLogAppendEvent(projectPath, serviceKey, serviceName, "system", errLine, runID)
	}
}

func (s *Server) logPaths(projectPath string, serviceKey string) (string, string) {
	sum := sha1.Sum([]byte(strings.ToLower(filepath.Clean(projectPath))))
	projectToken := hex.EncodeToString(sum[:6])
	serviceToken := sanitizeToken(serviceKey)
	if serviceToken == "" {
		serviceToken = "service"
	}
	prefix := fmt.Sprintf("%s-%s", projectToken, serviceToken)
	return filepath.Join(s.logRoot, prefix+".stdout.log"), filepath.Join(s.logRoot, prefix+".stderr.log")
}

func projectHasRunningServices(state *projectRuntimeState) bool {
	for _, service := range state.Services {
		if service.Run != nil && service.Run.PID > 0 && isProcessRunning(service.Run.PID) {
			return true
		}
	}
	return false
}

func (s *Server) clearProjectPortRangeIfIdleLocked(state *projectRuntimeState) {
	if projectHasRunningServices(state) {
		return
	}
	state.PortRangeBegin = 0
	state.PortRangeEnd = 0
}

func isValidPortBlockBegin(begin int) bool {
	return begin > 0 && begin+portBlockSize-1 <= portBlockMax
}

func (s *Server) collectReservedPortsLocked(excludeProjectPath string) map[int]struct{} {
	reserved := map[int]struct{}{}
	for projectPath, project := range s.projects {
		if excludeProjectPath != "" && projectPath == excludeProjectPath {
			continue
		}
		if project.PortRangeBegin <= 0 || project.PortRangeEnd < project.PortRangeBegin {
			continue
		}
		for port := project.PortRangeBegin; port <= project.PortRangeEnd; port += 1 {
			reserved[port] = struct{}{}
		}
	}
	return reserved
}

func tryListenOnPort(port int, host string) bool {
	address := fmt.Sprintf(":%d", port)
	if strings.TrimSpace(host) != "" {
		address = net.JoinHostPort(host, strconv.Itoa(port))
	}
	listener, err := net.Listen("tcp", address)
	if err != nil {
		return false
	}
	_ = listener.Close()
	return true
}

func isPortAvailable(port int) bool {
	if tryListenOnPort(port, "") {
		return true
	}
	return tryListenOnPort(port, "127.0.0.1")
}

func isPortBlockAvailable(base int, reserved map[int]struct{}) bool {
	if !isValidPortBlockBegin(base) {
		return false
	}
	for offset := 0; offset < portBlockSize; offset += 1 {
		port := base + offset
		if _, exists := reserved[port]; exists {
			return false
		}
		if !isPortAvailable(port) {
			return false
		}
	}
	return true
}

func (s *Server) allocateOpenPortBlockLocked(excludeProjectPath string) (int, error) {
	reserved := s.collectReservedPortsLocked(excludeProjectPath)
	for base := portBlockStart; base <= portBlockMax-portBlockSize; base += portBlockSize {
		if isPortBlockAvailable(base, reserved) {
			return base, nil
		}
	}
	return 0, fmt.Errorf("no available 10-port block found")
}

func (s *Server) getOrAllocateProjectPortRangeLocked(projectPath string, state *projectRuntimeState) (int, int, error) {
	settings := s.portRangeSettingsByProject[projectPath]
	mode := normalizeRuntimePortMode(settings.Mode)
	manualBegin := settings.Begin

	if state.PortRangeBegin > 0 && state.PortRangeEnd >= state.PortRangeBegin {
		if mode == "manual" && manualBegin > 0 && !projectHasRunningServices(state) && state.PortRangeBegin != manualBegin {
			if !isValidPortBlockBegin(manualBegin) {
				return 0, 0, fmt.Errorf("configured manual port range %d is invalid", manualBegin)
			}
			if !isPortBlockAvailable(manualBegin, s.collectReservedPortsLocked(projectPath)) {
				return 0, 0, fmt.Errorf("configured manual port range %d-%d is unavailable", manualBegin, manualBegin+portBlockSize-1)
			}
			state.PortRangeBegin = manualBegin
			state.PortRangeEnd = manualBegin + portBlockSize - 1
		}
		return state.PortRangeBegin, state.PortRangeEnd, nil
	}

	if mode == "manual" && manualBegin > 0 {
		if !isValidPortBlockBegin(manualBegin) {
			return 0, 0, fmt.Errorf("configured manual port range %d is invalid", manualBegin)
		}
		if !isPortBlockAvailable(manualBegin, s.collectReservedPortsLocked(projectPath)) {
			return 0, 0, fmt.Errorf("configured manual port range %d-%d is unavailable", manualBegin, manualBegin+portBlockSize-1)
		}
		state.PortRangeBegin = manualBegin
		state.PortRangeEnd = manualBegin + portBlockSize - 1
		return state.PortRangeBegin, state.PortRangeEnd, nil
	}

	allocated, err := s.allocateOpenPortBlockLocked(projectPath)
	if err != nil {
		return 0, 0, err
	}
	state.PortRangeBegin = allocated
	state.PortRangeEnd = allocated + portBlockSize - 1
	return state.PortRangeBegin, state.PortRangeEnd, nil
}

func waitForProcessExit(pid int, timeout time.Duration) bool {
	if pid <= 0 {
		return true
	}
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if !isProcessRunning(pid) {
			return true
		}
		time.Sleep(100 * time.Millisecond)
	}
	return !isProcessRunning(pid)
}

func sendSignalToServiceProcess(pid int, signal syscall.Signal) {
	if pid <= 0 {
		return
	}
	if err := syscall.Kill(-pid, signal); err == nil {
		return
	}
	_ = syscall.Kill(pid, signal)
}

func (s *Server) waitForServiceExit(projectPath string, serviceKey string, runID string, command *exec.Cmd, serviceName string, stdoutPath string) {
	err := command.Wait()
	exitCode := 0
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			exitCode = exitErr.ExitCode()
		}
	}

	appendStructuredLogLine(stdoutPath, serviceName, "system", "Process exited.")
	s.emitLogAppendEvent(projectPath, serviceKey, serviceName, "system", "Process exited.", runID)

	s.runtimeMu.Lock()
	updated := false

	state := s.projects[projectPath]
	if state == nil {
		s.runtimeMu.Unlock()
		return
	}
	service := state.Services[serviceKey]
	if service == nil || service.Run == nil || service.Run.RunID != runID {
		s.runtimeMu.Unlock()
		return
	}
	service.Run.PID = 0
	service.Run.LastExitCode = &exitCode
	if service.Run.StopRequested {
		service.Run.Status = "stopped"
	} else {
		service.Run.Status = "crashed"
	}
	service.Run.StopRequested = false
	s.clearProjectPortRangeIfIdleLocked(state)
	updated = true
	s.runtimeMu.Unlock()

	if updated {
		snapshot, snapshotErr := s.getRuntimeSnapshotInternal(projectPath)
		if snapshotErr == nil {
			s.emitRuntimeSnapshotEvent(projectPath, serviceKey, runID, snapshot)
		}
	}
}

func (s *Server) promoteServiceToStarted(projectPath string, serviceKey string, runID string) {
	time.Sleep(serviceStableDuration)

	s.runtimeMu.Lock()
	updated := false

	state := s.projects[projectPath]
	if state == nil {
		s.runtimeMu.Unlock()
		return
	}
	service := state.Services[serviceKey]
	if service == nil || service.Run == nil || service.Run.RunID != runID {
		s.runtimeMu.Unlock()
		return
	}
	if service.Run.PID > 0 && isProcessRunning(service.Run.PID) && service.Run.Status == "starting" {
		service.Run.Status = "started"
		updated = true
	}
	s.runtimeMu.Unlock()

	if updated {
		snapshot, snapshotErr := s.getRuntimeSnapshotInternal(projectPath)
		if snapshotErr == nil {
			s.emitRuntimeSnapshotEvent(projectPath, serviceKey, runID, snapshot)
		}
	}
}

func (s *Server) startService(projectPath string, serviceKey string) (string, int, string, error) {
	specs, err := s.discoverServiceSpecs(projectPath)
	if err != nil {
		return "", 0, "", err
	}

	rootEnv := parseDotEnvFile(filepath.Join(projectPath, ".env"))

	s.runtimeMu.Lock()
	state := s.ensureProjectStateLocked(projectPath, specs)
	targetService := s.findServiceLocked(state, serviceKey)
	if targetService == nil {
		s.runtimeMu.Unlock()
		return "", 0, "", fmt.Errorf("no service found for key %q", serviceKey)
	}

	if targetService.Run != nil && targetService.Run.PID > 0 && isProcessRunning(targetService.Run.PID) {
		runID := targetService.Run.RunID
		pid := targetService.Run.PID
		status := targetService.Run.Status
		s.runtimeMu.Unlock()
		return runID, pid, status, nil
	}

	portBegin, _, portErr := s.getOrAllocateProjectPortRangeLocked(projectPath, state)
	if portErr != nil {
		s.runtimeMu.Unlock()
		return "", 0, "", portErr
	}
	servicePortMap := buildServicePortMap(specs, portBegin)
	servicePort := servicePortMap[targetService.Spec.Key]
	if servicePort <= 0 {
		servicePort = portBegin + 1
	}
	targetService.Port = servicePort

	runID := s.nextRunID(targetService.Spec.Key)
	stdoutPath, stderrPath := s.logPaths(projectPath, targetService.Spec.Key)
	if err := truncateLogFile(stdoutPath); err != nil {
		s.runtimeMu.Unlock()
		return "", 0, "", err
	}
	if err := truncateLogFile(stderrPath); err != nil {
		s.runtimeMu.Unlock()
		return "", 0, "", err
	}

	envMap := processEnvMap()
	for key, value := range rootEnv {
		envMap[key] = value
	}
	for key, value := range buildPortOverrides(portBegin) {
		envMap[key] = value
	}
	envMap["PORT"] = strconv.Itoa(servicePort)

	bootstrapCommand := buildLaunchBootstrapCommand(targetService.Spec.Cwd, defaultServiceLaunchCommand)
	cmd := exec.Command("sh", "-lc", bootstrapCommand)
	cmd.Dir = targetService.Spec.Cwd
	cmd.Env = envMapToList(envMap)
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}

	stdoutPipe, err := cmd.StdoutPipe()
	if err != nil {
		s.runtimeMu.Unlock()
		return "", 0, "", err
	}
	stderrPipe, err := cmd.StderrPipe()
	if err != nil {
		s.runtimeMu.Unlock()
		return "", 0, "", err
	}

	if startErr := cmd.Start(); startErr != nil {
		s.runtimeMu.Unlock()
		return "", 0, "", startErr
	}

	pid := cmd.Process.Pid
	targetServiceKey := targetService.Spec.Key
	targetServiceDisplayName := targetService.Spec.DisplayName
	targetService.Run = &processRunState{
		RunID:         runID,
		PID:           pid,
		Status:        "starting",
		StartedAt:     time.Now().UTC(),
		LastExitCode:  nil,
		LaunchCommand: defaultServiceLaunchCommand,
		StdoutPath:    stdoutPath,
		StderrPath:    stderrPath,
	}
	s.runtimeMu.Unlock()

	snapshot, snapshotErr := s.getRuntimeSnapshotInternal(projectPath)
	if snapshotErr == nil {
		s.emitRuntimeSnapshotEvent(projectPath, targetServiceKey, runID, snapshot)
	}

	go s.streamProcessOutput(
		projectPath,
		targetServiceKey,
		targetServiceDisplayName,
		runID,
		"stdout",
		stdoutPipe,
		stdoutPath,
	)
	go s.streamProcessOutput(
		projectPath,
		targetServiceKey,
		targetServiceDisplayName,
		runID,
		"stderr",
		stderrPipe,
		stderrPath,
	)
	go s.waitForServiceExit(projectPath, targetServiceKey, runID, cmd, targetServiceDisplayName, stdoutPath)
	go s.promoteServiceToStarted(projectPath, targetServiceKey, runID)

	return runID, pid, "starting", nil
}

func (s *Server) stopService(projectPath string, serviceKey string) (string, string, error) {
	s.runtimeMu.Lock()
	state := s.projects[projectPath]
	if state == nil {
		s.runtimeMu.Unlock()
		return "", "stopped", nil
	}

	targetService := s.findServiceLocked(state, serviceKey)
	if targetService == nil || targetService.Run == nil {
		s.clearProjectPortRangeIfIdleLocked(state)
		s.runtimeMu.Unlock()
		return "", "stopped", nil
	}
	targetServiceKey := targetService.Spec.Key

	if targetService.Run.PID <= 0 || !isProcessRunning(targetService.Run.PID) {
		runID := targetService.Run.RunID
		targetService.Run.PID = 0
		targetService.Run.Status = "stopped"
		targetService.Run.StopRequested = false
		s.clearProjectPortRangeIfIdleLocked(state)
		s.runtimeMu.Unlock()
		snapshot, snapshotErr := s.getRuntimeSnapshotInternal(projectPath)
		if snapshotErr == nil {
			s.emitRuntimeSnapshotEvent(projectPath, targetServiceKey, runID, snapshot)
		}
		return runID, "stopped", nil
	}

	runID := targetService.Run.RunID
	pid := targetService.Run.PID
	targetService.Run.StopRequested = true
	targetService.Run.Status = "stopped"
	s.runtimeMu.Unlock()

	sendSignalToServiceProcess(pid, syscall.SIGTERM)
	exited := waitForProcessExit(pid, stopGraceDuration)
	if !exited {
		sendSignalToServiceProcess(pid, syscall.SIGKILL)
		_ = waitForProcessExit(pid, stopForceDuration)
	}

	s.runtimeMu.Lock()
	state = s.projects[projectPath]
	if state != nil {
		service := state.Services[targetService.Spec.Key]
		if service != nil && service.Run != nil && service.Run.RunID == runID {
			service.Run.PID = 0
			service.Run.Status = "stopped"
			service.Run.StopRequested = false
		}
		s.clearProjectPortRangeIfIdleLocked(state)
	}
	s.runtimeMu.Unlock()

	snapshot, snapshotErr := s.getRuntimeSnapshotInternal(projectPath)
	if snapshotErr == nil {
		s.emitRuntimeSnapshotEvent(projectPath, targetServiceKey, runID, snapshot)
	}

	return runID, "stopped", nil
}

func (s *Server) startProject(projectPath string) (*masterv1.RuntimeSnapshot, error) {
	specs, err := s.discoverServiceSpecs(projectPath)
	if err != nil {
		return nil, err
	}

	startKeys := make([]string, 0)
	for _, spec := range specs {
		if spec.HasPackageJSON {
			startKeys = append(startKeys, spec.Key)
		}
	}

	for _, key := range startKeys {
		if _, _, _, startErr := s.startService(projectPath, key); startErr != nil {
			s.logger.Warn("failed to start service during StartProject", "project_path", projectPath, "service_key", key, "error", startErr.Error())
		}
	}

	return s.getRuntimeSnapshotInternal(projectPath)
}

func (s *Server) stopProject(projectPath string) (*masterv1.RuntimeSnapshot, error) {
	s.runtimeMu.Lock()
	state := s.projects[projectPath]
	keys := make([]string, 0)
	if state != nil {
		for _, key := range orderedServiceKeys(state.Services) {
			service := state.Services[key]
			if service.Run != nil && service.Run.PID > 0 {
				keys = append(keys, key)
			}
		}
	}
	s.runtimeMu.Unlock()

	for _, key := range keys {
		if _, _, stopErr := s.stopService(projectPath, key); stopErr != nil {
			s.logger.Warn("failed to stop service during StopProject", "project_path", projectPath, "service_key", key, "error", stopErr.Error())
		}
	}

	return s.getRuntimeSnapshotInternal(projectPath)
}

func (s *Server) GetRuntimeSnapshot(ctx context.Context, req *masterv1.GetRuntimeSnapshotRequest) (*masterv1.GetRuntimeSnapshotResponse, error) {
	requestID := s.resolveRequestID(ctx, req.GetRequestId())
	projectPath, err := normalizeProjectPath(req.GetProjectPath())
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "project_path is required")
	}

	snapshot, runtimeErr := s.getRuntimeSnapshotInternal(projectPath)
	if runtimeErr != nil {
		return nil, status.Errorf(codes.Internal, "failed to build runtime snapshot: %v", runtimeErr)
	}

	return &masterv1.GetRuntimeSnapshotResponse{
		RequestId: requestID,
		Snapshot:  snapshot,
	}, nil
}

func (s *Server) StartService(ctx context.Context, req *masterv1.StartServiceRequest) (*masterv1.StartServiceResponse, error) {
	requestID := s.resolveRequestID(ctx, req.GetRequestId())
	projectPath, pathErr := normalizeProjectPath(req.GetProjectPath())
	if pathErr != nil {
		return nil, status.Errorf(codes.InvalidArgument, "project_path is required")
	}

	serviceKey := strings.TrimSpace(req.GetServiceKey())
	if serviceKey == "" {
		return nil, status.Errorf(codes.InvalidArgument, "service_key is required")
	}

	runID, pid, runtimeStatus, startErr := s.startService(projectPath, serviceKey)
	if startErr != nil {
		return nil, status.Errorf(codes.Internal, "failed to start service: %v", startErr)
	}

	return &masterv1.StartServiceResponse{
		RequestId: requestID,
		RunId:     runID,
		Pid:       int64(pid),
		Status:    runtimeStatus,
	}, nil
}

func (s *Server) StartProject(ctx context.Context, req *masterv1.StartProjectRequest) (*masterv1.StartProjectResponse, error) {
	requestID := s.resolveRequestID(ctx, req.GetRequestId())
	projectPath, pathErr := normalizeProjectPath(req.GetProjectPath())
	if pathErr != nil {
		return nil, status.Errorf(codes.InvalidArgument, "project_path is required")
	}

	snapshot, startErr := s.startProject(projectPath)
	if startErr != nil {
		return nil, status.Errorf(codes.Internal, "failed to start project: %v", startErr)
	}

	return &masterv1.StartProjectResponse{
		RequestId: requestID,
		Snapshot:  snapshot,
	}, nil
}

func (s *Server) StopService(ctx context.Context, req *masterv1.StopServiceRequest) (*masterv1.StopServiceResponse, error) {
	requestID := s.resolveRequestID(ctx, req.GetRequestId())
	projectPath, pathErr := normalizeProjectPath(req.GetProjectPath())
	if pathErr != nil {
		return nil, status.Errorf(codes.InvalidArgument, "project_path is required")
	}

	serviceKey := strings.TrimSpace(req.GetServiceKey())
	if serviceKey == "" {
		return nil, status.Errorf(codes.InvalidArgument, "service_key is required")
	}

	runID, runtimeStatus, stopErr := s.stopService(projectPath, serviceKey)
	if stopErr != nil {
		return nil, status.Errorf(codes.Internal, "failed to stop service: %v", stopErr)
	}

	return &masterv1.StopServiceResponse{
		RequestId: requestID,
		RunId:     runID,
		Status:    runtimeStatus,
	}, nil
}

func (s *Server) StopProject(ctx context.Context, req *masterv1.StopProjectRequest) (*masterv1.StopProjectResponse, error) {
	requestID := s.resolveRequestID(ctx, req.GetRequestId())
	projectPath, pathErr := normalizeProjectPath(req.GetProjectPath())
	if pathErr != nil {
		return nil, status.Errorf(codes.InvalidArgument, "project_path is required")
	}

	snapshot, stopErr := s.stopProject(projectPath)
	if stopErr != nil {
		return nil, status.Errorf(codes.Internal, "failed to stop project: %v", stopErr)
	}

	return &masterv1.StopProjectResponse{
		RequestId: requestID,
		Snapshot:  snapshot,
	}, nil
}

func (s *Server) RestartService(ctx context.Context, req *masterv1.RestartServiceRequest) (*masterv1.RestartServiceResponse, error) {
	requestID := s.resolveRequestID(ctx, req.GetRequestId())
	projectPath, pathErr := normalizeProjectPath(req.GetProjectPath())
	if pathErr != nil {
		return nil, status.Errorf(codes.InvalidArgument, "project_path is required")
	}

	serviceKey := strings.TrimSpace(req.GetServiceKey())
	if serviceKey == "" {
		return nil, status.Errorf(codes.InvalidArgument, "service_key is required")
	}

	oldRunID, _, stopErr := s.stopService(projectPath, serviceKey)
	if stopErr != nil {
		return nil, status.Errorf(codes.Internal, "failed to stop service before restart: %v", stopErr)
	}

	newRunID, pid, runtimeStatus, startErr := s.startService(projectPath, serviceKey)
	if startErr != nil {
		return nil, status.Errorf(codes.Internal, "failed to restart service: %v", startErr)
	}

	return &masterv1.RestartServiceResponse{
		RequestId: requestID,
		OldRunId:  oldRunID,
		NewRunId:  newRunID,
		Pid:       int64(pid),
		Status:    runtimeStatus,
	}, nil
}

func (s *Server) GetLogs(ctx context.Context, req *masterv1.GetLogsRequest) (*masterv1.GetLogsResponse, error) {
	requestID := s.resolveRequestID(ctx, req.GetRequestId())
	projectPathInput := strings.TrimSpace(req.GetProjectPath())
	slaveID := strings.TrimSpace(req.GetSlaveId())

	if projectPathInput == "" && slaveID == "" {
		return nil, status.Errorf(codes.InvalidArgument, "project_path or slave_id is required")
	}
	if projectPathInput != "" && slaveID != "" {
		return nil, status.Errorf(codes.InvalidArgument, "project_path and slave_id are mutually exclusive")
	}

	if slaveID != "" {
		return s.getSlaveLogsResponse(requestID, req, slaveID), nil
	}

	projectPath, pathErr := normalizeProjectPath(projectPathInput)
	if pathErr != nil {
		return nil, status.Errorf(codes.InvalidArgument, "project_path is required")
	}
	return s.getProjectLogsResponse(requestID, req, projectPath)
}

func buildServiceFilter(serviceNames []string) map[string]struct{} {
	serviceFilter := map[string]struct{}{}
	for _, name := range serviceNames {
		trimmed := strings.TrimSpace(name)
		if trimmed == "" {
			continue
		}
		serviceFilter[trimmed] = struct{}{}
	}
	return serviceFilter
}

func (s *Server) getProjectLogsResponse(
	requestID string,
	req *masterv1.GetLogsRequest,
	projectPath string,
) (*masterv1.GetLogsResponse, error) {
	specs, err := s.discoverServiceSpecs(projectPath)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to discover services: %v", err)
	}

	type serviceLogContext struct {
		serviceName string
		runID       string
		stdoutPath  string
		stderrPath  string
	}

	s.runtimeMu.Lock()
	state := s.ensureProjectStateLocked(projectPath, specs)
	logContexts := make([]serviceLogContext, 0, len(state.Services))
	for _, key := range orderedServiceKeys(state.Services) {
		service := state.Services[key]
		stdoutPath, stderrPath := s.logPaths(projectPath, key)
		runID := ""
		if service.Run != nil {
			runID = service.Run.RunID
			if service.Run.StdoutPath != "" {
				stdoutPath = service.Run.StdoutPath
			}
			if service.Run.StderrPath != "" {
				stderrPath = service.Run.StderrPath
			}
		}
		logContexts = append(logContexts, serviceLogContext{
			serviceName: service.Spec.DisplayName,
			runID:       runID,
			stdoutPath:  stdoutPath,
			stderrPath:  stderrPath,
		})
	}
	s.runtimeMu.Unlock()

	entries := make([]parsedLogEntry, 0)
	for _, context := range logContexts {
		entries = append(entries, readLogFileEntries(context.stdoutPath, context.serviceName, "stdout", context.runID)...)
		entries = append(entries, readLogFileEntries(context.stderrPath, context.serviceName, "stderr", context.runID)...)
	}

	sort.Slice(entries, func(i, j int) bool {
		if entries[i].Timestamp != entries[j].Timestamp {
			return entries[i].Timestamp < entries[j].Timestamp
		}
		if entries[i].Service != entries[j].Service {
			return entries[i].Service < entries[j].Service
		}
		return entries[i].Message < entries[j].Message
	})

	serviceFilter := buildServiceFilter(req.GetServiceNames())
	afterID := req.GetAfterId()
	pbEntries := make([]*masterv1.LogEntry, 0, len(entries))
	for index, entry := range entries {
		entryID := int64(index + 1)
		if afterID > 0 && entryID <= afterID {
			continue
		}
		if len(serviceFilter) > 0 {
			if _, included := serviceFilter[entry.Service]; !included {
				continue
			}
		}
		pbEntries = append(pbEntries, &masterv1.LogEntry{
			Id:          entryID,
			ProjectPath: projectPath,
			Timestamp:   entry.Timestamp,
			ServiceName: entry.Service,
			Stream:      entry.Stream,
			Message:     entry.Message,
			RunId:       entry.RunID,
		})
	}

	limit := clampLogLimit(req.GetLimit())
	if len(pbEntries) > limit {
		pbEntries = pbEntries[len(pbEntries)-limit:]
	}

	return &masterv1.GetLogsResponse{
		RequestId: requestID,
		Entries:   pbEntries,
	}, nil
}

func (s *Server) getSlaveLogsResponse(
	requestID string,
	req *masterv1.GetLogsRequest,
	slaveID string,
) *masterv1.GetLogsResponse {
	entries := readLogFileEntries(
		s.slaveLogPath(slaveID),
		"agent-slave",
		"system",
		"",
	)

	sort.Slice(entries, func(i, j int) bool {
		if entries[i].Timestamp != entries[j].Timestamp {
			return entries[i].Timestamp < entries[j].Timestamp
		}
		if entries[i].Service != entries[j].Service {
			return entries[i].Service < entries[j].Service
		}
		return entries[i].Message < entries[j].Message
	})

	serviceFilter := buildServiceFilter(req.GetServiceNames())
	afterID := req.GetAfterId()
	projectPath := fmt.Sprintf("@slave:%s", slaveID)
	pbEntries := make([]*masterv1.LogEntry, 0, len(entries))
	for index, entry := range entries {
		entryID := int64(index + 1)
		if afterID > 0 && entryID <= afterID {
			continue
		}
		if len(serviceFilter) > 0 {
			if _, included := serviceFilter[entry.Service]; !included {
				continue
			}
		}
		pbEntries = append(pbEntries, &masterv1.LogEntry{
			Id:          entryID,
			ProjectPath: projectPath,
			Timestamp:   entry.Timestamp,
			ServiceName: entry.Service,
			Stream:      entry.Stream,
			Message:     entry.Message,
		})
	}

	limit := clampLogLimit(req.GetLimit())
	if len(pbEntries) > limit {
		pbEntries = pbEntries[len(pbEntries)-limit:]
	}

	return &masterv1.GetLogsResponse{
		RequestId: requestID,
		Entries:   pbEntries,
	}
}

func stableServiceID(projectPath string, serviceKey string) int64 {
	checksum := crc32.ChecksumIEEE([]byte(projectPath + "::" + serviceKey))
	return int64(checksum)
}

func (s *Server) GetProcessStats(ctx context.Context, req *masterv1.GetProcessStatsRequest) (*masterv1.GetProcessStatsResponse, error) {
	requestID := s.resolveRequestID(ctx, req.GetRequestId())
	projectPath, pathErr := normalizeProjectPath(req.GetProjectPath())
	if pathErr != nil {
		return nil, status.Errorf(codes.InvalidArgument, "project_path is required")
	}

	snapshot, snapshotErr := s.getRuntimeSnapshotInternal(projectPath)
	if snapshotErr != nil {
		return nil, status.Errorf(codes.Internal, "failed to load runtime snapshot: %v", snapshotErr)
	}

	stats := make([]*masterv1.ProcessStat, 0)
	for _, service := range snapshot.GetServices() {
		pid := int(service.GetPid())
		if pid <= 0 {
			continue
		}

		payload := readProcessStat(pid)
		if payload == nil {
			continue
		}

		stats = append(stats, &masterv1.ProcessStat{
			ServiceId:     stableServiceID(projectPath, service.GetServiceKey()),
			ServiceName:   service.GetServiceName(),
			ServiceKey:    service.GetServiceKey(),
			Pid:           int64(payload.PID),
			CpuPercent:    payload.CPU,
			MemoryPercent: payload.Memory,
			RssMb:         payload.RSSMB,
			VirtualMb:     payload.VirtualMB,
			Elapsed:       payload.Elapsed,
			Command:       payload.Command,
			Status:        "running",
			RunId:         service.GetRunId(),
		})
	}

	sort.Slice(stats, func(i, j int) bool {
		leftRank := serviceSortRank(stats[i].GetServiceKey())
		rightRank := serviceSortRank(stats[j].GetServiceKey())
		if leftRank != rightRank {
			return leftRank < rightRank
		}
		if stats[i].GetServiceName() != stats[j].GetServiceName() {
			return stats[i].GetServiceName() < stats[j].GetServiceName()
		}
		return stats[i].GetPid() < stats[j].GetPid()
	})

	return &masterv1.GetProcessStatsResponse{
		RequestId: requestID,
		Stats:     stats,
	}, nil
}

func (s *Server) GetPortRangeSettings(ctx context.Context, req *masterv1.GetPortRangeSettingsRequest) (*masterv1.GetPortRangeSettingsResponse, error) {
	requestID := s.resolveRequestID(ctx, req.GetRequestId())
	projectPath, pathErr := normalizeProjectPath(req.GetProjectPath())
	if pathErr != nil {
		return nil, status.Errorf(codes.InvalidArgument, "project_path is required")
	}

	s.runtimeMu.Lock()
	settings := s.portRangeSettingsByProject[projectPath]
	s.runtimeMu.Unlock()

	mode := normalizeRuntimePortMode(settings.Mode)
	begin := settings.Begin
	if mode != "manual" {
		begin = 0
	}

	return &masterv1.GetPortRangeSettingsResponse{
		RequestId: requestID,
		Settings: &masterv1.PortRangeSettings{
			Mode:  mode,
			Begin: int32(begin),
		},
	}, nil
}

func (s *Server) SetPortRangeSettings(ctx context.Context, req *masterv1.SetPortRangeSettingsRequest) (*masterv1.SetPortRangeSettingsResponse, error) {
	requestID := s.resolveRequestID(ctx, req.GetRequestId())
	projectPath, pathErr := normalizeProjectPath(req.GetProjectPath())
	if pathErr != nil {
		return nil, status.Errorf(codes.InvalidArgument, "project_path is required")
	}

	mode := normalizeRuntimePortMode(req.GetSettings().GetMode())
	begin := int(req.GetSettings().GetBegin())
	if mode == "manual" && begin > 0 && !isValidPortBlockBegin(begin) {
		return nil, status.Errorf(codes.InvalidArgument, "manual begin must be between 1 and %d", portBlockMax-portBlockSize+1)
	}
	if mode != "manual" {
		begin = 0
	}

	s.runtimeMu.Lock()
	s.portRangeSettingsByProject[projectPath] = portRangeSettings{
		Mode:  mode,
		Begin: begin,
	}
	s.runtimeMu.Unlock()

	return &masterv1.SetPortRangeSettingsResponse{
		RequestId: requestID,
		Settings: &masterv1.PortRangeSettings{
			Mode:  mode,
			Begin: int32(begin),
		},
	}, nil
}

func (s *Server) resolvePortRangeForLaunchEnvironment(projectPath string) (int, error) {
	s.runtimeMu.Lock()
	state := s.projects[projectPath]
	settings := s.portRangeSettingsByProject[projectPath]
	reserved := s.collectReservedPortsLocked(projectPath)
	s.runtimeMu.Unlock()

	if state != nil && state.PortRangeBegin > 0 && state.PortRangeEnd >= state.PortRangeBegin {
		return state.PortRangeBegin, nil
	}

	if normalizeRuntimePortMode(settings.Mode) == "manual" && settings.Begin > 0 {
		if !isValidPortBlockBegin(settings.Begin) {
			return 0, fmt.Errorf("manual port range begin is invalid")
		}
		if !isPortBlockAvailable(settings.Begin, reserved) {
			return 0, fmt.Errorf("manual port range is unavailable")
		}
		return settings.Begin, nil
	}

	for base := portBlockStart; base <= portBlockMax-portBlockSize; base += portBlockSize {
		if isPortBlockAvailable(base, reserved) {
			return base, nil
		}
	}

	return 0, fmt.Errorf("no available 10-port block found")
}

func (s *Server) GetLaunchEnvironment(ctx context.Context, req *masterv1.GetLaunchEnvironmentRequest) (*masterv1.GetLaunchEnvironmentResponse, error) {
	requestID := s.resolveRequestID(ctx, req.GetRequestId())
	projectPath, pathErr := normalizeProjectPath(req.GetProjectPath())
	if pathErr != nil {
		return nil, status.Errorf(codes.InvalidArgument, "project_path is required")
	}

	basePort, portErr := s.resolvePortRangeForLaunchEnvironment(projectPath)
	if portErr != nil {
		return nil, status.Errorf(codes.Internal, "failed to resolve launch port range: %v", portErr)
	}

	rootEnv := parseDotEnvFile(filepath.Join(projectPath, ".env"))
	merged := map[string]string{}
	for key, value := range rootEnv {
		merged[key] = value
	}
	overrides := buildPortOverrides(basePort)
	for key, value := range overrides {
		merged[key] = value
	}

	overrideOrder := []string{"WEB_PORT", "SERVER_PORT", "ADMIN_PORT", "ASSET_SERVER_PORT", "PROTECTED_GRAPHQL_URL"}
	entries := make([]*masterv1.LaunchEnvEntry, 0, len(merged))
	seen := map[string]struct{}{}
	for _, key := range overrideOrder {
		if value, ok := merged[key]; ok {
			entries = append(entries, &masterv1.LaunchEnvEntry{Key: key, Value: value})
			seen[key] = struct{}{}
		}
	}

	remainingKeys := make([]string, 0, len(merged))
	for key := range merged {
		if _, has := seen[key]; has {
			continue
		}
		remainingKeys = append(remainingKeys, key)
	}
	sort.Strings(remainingKeys)
	for _, key := range remainingKeys {
		entries = append(entries, &masterv1.LaunchEnvEntry{Key: key, Value: merged[key]})
	}

	return &masterv1.GetLaunchEnvironmentResponse{
		RequestId: requestID,
		Entries:   entries,
	}, nil
}

func (s *Server) nextRunID(prefix string) string {
	token := sanitizeToken(prefix)
	if token == "" {
		token = "run"
	}
	sequence := s.requestSeed.Add(1)
	return fmt.Sprintf("%s-%d-%d", token, time.Now().UTC().UnixMilli(), sequence)
}
