package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"testing"
	"time"

	slavev1 "github.com/josh/project-commander/packages/agent-shared/gen/projectcommander/slave/v1"
)

func TestTelemetrySampler_SampleHostTelemetry(t *testing.T) {
	projectPath := t.TempDir()
	sampler := newTelemetrySampler(nil, config{
		ProjectPath: projectPath,
		StateRoot:   filepath.Join(projectPath, "state"),
	})

	sample := sampler.SampleHostTelemetry()
	if sample == nil {
		t.Fatalf("expected host telemetry sample")
	}
	if sample.GetSampledAt() == "" {
		t.Fatalf("expected sampledAt to be populated")
	}
	if sample.GetMemoryTotalBytes() <= 0 {
		t.Fatalf("expected memory total bytes to be positive, got %d", sample.GetMemoryTotalBytes())
	}
	if sample.GetDiskTotalBytes() <= 0 {
		t.Fatalf("expected disk total bytes to be positive, got %d", sample.GetDiskTotalBytes())
	}
}

func TestTelemetrySampler_SampleProcessTelemetry(t *testing.T) {
	projectPath := t.TempDir()
	logPath := filepath.Join(projectPath, "telemetry.log")
	logFile, err := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		t.Fatalf("open log file failed: %v", err)
	}
	command := exec.Command("sh", "-lc", "while true; do sleep 1; done")
	command.Dir = projectPath
	command.Stdout = logFile
	command.Stderr = logFile
	command.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	if err := command.Start(); err != nil {
		_ = logFile.Close()
		t.Fatalf("start process failed: %v", err)
	}
	_ = logFile.Close()
	t.Cleanup(func() {
		_ = sendSignalToProcessGroupOrProcess(command.Process.Pid, processGroupID(command.Process.Pid), syscall.SIGKILL)
		_, _ = command.Process.Wait()
	})

	sampler := newTelemetrySampler(nil, config{ProjectPath: projectPath})
	run := &slavev1.ObservedProcessRun{
		RunId:      "run-telemetry",
		ProcessKey: "api",
		Pid:        int64(command.Process.Pid),
		Status:     processStatusRunning,
	}

	var samples []*slavev1.ProcessTelemetrySample
	if ok := waitForManagerCondition(3*time.Second, func() bool {
		samples = sampler.SampleProcessTelemetry([]*slavev1.ObservedProcessRun{run})
		return len(samples) == 1 && samples[0].GetRunId() == run.GetRunId() && samples[0].GetSampledAt() != ""
	}); !ok {
		t.Fatalf("expected process telemetry sample")
	}
	if samples[0].GetPid() != run.GetPid() {
		t.Fatalf("expected telemetry pid %d, got %d", run.GetPid(), samples[0].GetPid())
	}
}
