package master

import (
	"context"
	"log/slog"
	"strings"
	"testing"

	masterv1 "github.com/josh/project-commander/packages/agent-shared/gen/projectcommander/master/v1"
	slavev1 "github.com/josh/project-commander/packages/agent-shared/gen/projectcommander/slave/v1"
	"google.golang.org/grpc/metadata"
)

func authorizedSlaveContext() context.Context {
	return metadata.NewIncomingContext(context.Background(), metadata.Pairs("x-slave-key", "shared-key"))
}

func TestDesiredProcessMirrorAndSlaveReadback(t *testing.T) {
	t.Parallel()

	server := NewServer(slog.Default(), "0.1.0", "/tmp/project-commander/master.sock", "shared-key")

	upsertResponse, err := server.UpsertDesiredProcess(context.Background(), &masterv1.UpsertDesiredProcessRequest{
		RequestId: "upsert-1",
		SlaveId:   "slave-a",
		DesiredProcess: &slavev1.DesiredProcess{
			DesiredProcessId:    101,
			HostId:              11,
			ProjectId:           22,
			ProcessKey:          "api",
			ProjectPath:         "/workspace/project-a",
			PackageKey:          "api",
			PackageRelativePath: "packages/api",
			DesiredState:        "running",
			LaunchMode:          "exec",
			Cwd:                 "/workspace/project-a/packages/api",
			Command:             "yarn",
			Args:                []string{"dev"},
			Env: []*slavev1.ProcessEnvEntry{
				{Key: "NODE_ENV", Value: "development"},
			},
			EnvHash:           "env-hash",
			LaunchFingerprint: "fingerprint-1",
			LogRoot:           "/tmp/logs",
			RestartPolicy:     "manual",
			UpdatedAt:         "2026-03-09T00:00:00Z",
		},
	})
	if err != nil {
		t.Fatalf("UpsertDesiredProcess returned error: %v", err)
	}
	if upsertResponse.GetStatus() != "upserted" {
		t.Fatalf("expected upserted status, got %q", upsertResponse.GetStatus())
	}

	listResponse, err := server.ListDesiredProcesses(context.Background(), &masterv1.ListDesiredProcessesRequest{
		RequestId: "list-1",
		SlaveId:   "slave-a",
	})
	if err != nil {
		t.Fatalf("ListDesiredProcesses returned error: %v", err)
	}
	if len(listResponse.GetDesiredProcesses()) != 1 {
		t.Fatalf("expected 1 desired process, got %d", len(listResponse.GetDesiredProcesses()))
	}

	readbackResponse, err := server.GetDesiredProcesses(authorizedSlaveContext(), &slavev1.GetDesiredProcessesRequest{
		RequestId: "slave-list-1",
		SlaveId:   "slave-a",
		BootId:    "boot-a",
	})
	if err != nil {
		t.Fatalf("GetDesiredProcesses returned error: %v", err)
	}
	if len(readbackResponse.GetDesiredProcesses()) != 1 {
		t.Fatalf("expected 1 desired process from slave readback, got %d", len(readbackResponse.GetDesiredProcesses()))
	}
	if got := readbackResponse.GetDesiredProcesses()[0].GetProcessKey(); got != "api" {
		t.Fatalf("expected process key api, got %q", got)
	}

	runtimeStateResponse, err := server.GetSlaveRuntimeState(context.Background(), &masterv1.GetSlaveRuntimeStateRequest{
		RequestId: "runtime-1",
		SlaveId:   "slave-a",
	})
	if err != nil {
		t.Fatalf("GetSlaveRuntimeState returned error: %v", err)
	}
	if runtimeStateResponse.GetRuntimeState().GetBootId() != "boot-a" {
		t.Fatalf("expected boot id boot-a, got %q", runtimeStateResponse.GetRuntimeState().GetBootId())
	}
	if len(runtimeStateResponse.GetRuntimeState().GetDesiredProcesses()) != 1 {
		t.Fatalf("expected desired process in runtime state, got %d", len(runtimeStateResponse.GetRuntimeState().GetDesiredProcesses()))
	}
}

func TestRegisterHeartbeatAndReconciliationPopulateRuntimeState(t *testing.T) {
	t.Parallel()

	server := NewServer(slog.Default(), "0.1.0", "/tmp/project-commander/master.sock", "shared-key")

	if _, err := server.UpsertDesiredProcess(context.Background(), &masterv1.UpsertDesiredProcessRequest{
		RequestId: "upsert-2",
		SlaveId:   "slave-b",
		DesiredProcess: &slavev1.DesiredProcess{
			ProcessKey:  "worker",
			ProjectPath: "/workspace/project-b",
			PackageKey:  "worker",
			Cwd:         "/workspace/project-b",
			Command:     "yarn",
		},
	}); err != nil {
		t.Fatalf("UpsertDesiredProcess returned error: %v", err)
	}

	registerResponse, err := server.RegisterSlave(authorizedSlaveContext(), &slavev1.RegisterSlaveRequest{
		RequestId: "register-1",
		SlaveId:   "slave-b",
		HostName:  "builder",
		Version:   "0.1.0",
		BootId:    "boot-b",
	})
	if err != nil {
		t.Fatalf("RegisterSlave returned error: %v", err)
	}
	if registerResponse.GetDesiredProcessCount() != 1 {
		t.Fatalf("expected desired process count 1, got %d", registerResponse.GetDesiredProcessCount())
	}
	if !registerResponse.GetReconcileRequired() {
		t.Fatalf("expected reconcile_required=true")
	}

	if _, err := server.Heartbeat(authorizedSlaveContext(), &slavev1.HeartbeatRequest{
		RequestId:  "heartbeat-1",
		SlaveId:    "slave-b",
		BootId:     "boot-b",
		Timestamp:  "2026-03-09T01:00:00Z",
		CpuPercent: 12.5,
		ProcessTelemetry: []*slavev1.ProcessTelemetrySample{
			{
				RunId:      "run-1",
				ProcessKey: "worker",
				Pid:        4321,
				SampledAt:  "2026-03-09T01:00:00Z",
				CpuPercent: 14.2,
				Status:     "running",
			},
		},
		ObservedRuns: []*slavev1.ObservedProcessRun{
			{
				RunId:       "run-1",
				ProcessKey:  "worker",
				ProjectPath: "/workspace/project-b",
				PackageKey:  "worker",
				Pid:         4321,
				Command:     "yarn",
				Args:        []string{"dev"},
				Cwd:         "/workspace/project-b",
				Status:      "running",
				StartedAt:   "2026-03-09T00:59:59Z",
				LastSeenAt:  "2026-03-09T01:00:00Z",
			},
		},
	}); err != nil {
		t.Fatalf("Heartbeat returned error: %v", err)
	}

	if _, err := server.ReportProcessReconciliation(authorizedSlaveContext(), &slavev1.ReportProcessReconciliationRequest{
		RequestId: "reconcile-1",
		SlaveId:   "slave-b",
		BootId:    "boot-b",
		Changes: []*slavev1.ProcessReconciliationChange{
			{
				ChangeType: "running_and_matches",
				Reason:     "process still running",
				ObservedRun: &slavev1.ObservedProcessRun{
					RunId:       "run-1",
					ProcessKey:  "worker",
					ProjectPath: "/workspace/project-b",
					PackageKey:  "worker",
					Pid:         4321,
					Command:     "yarn",
					Cwd:         "/workspace/project-b",
					Status:      "running",
				},
			},
		},
		ObservedRuns: []*slavev1.ObservedProcessRun{
			{
				RunId:       "run-1",
				ProcessKey:  "worker",
				ProjectPath: "/workspace/project-b",
				PackageKey:  "worker",
				Pid:         4321,
				Command:     "yarn",
				Cwd:         "/workspace/project-b",
				Status:      "running",
			},
		},
	}); err != nil {
		t.Fatalf("ReportProcessReconciliation returned error: %v", err)
	}

	runtimeStateResponse, err := server.GetSlaveRuntimeState(context.Background(), &masterv1.GetSlaveRuntimeStateRequest{
		RequestId: "runtime-2",
		SlaveId:   "slave-b",
	})
	if err != nil {
		t.Fatalf("GetSlaveRuntimeState returned error: %v", err)
	}
	runtimeState := runtimeStateResponse.GetRuntimeState()
	if runtimeState.GetStatus() != runtimeStateStatusConnected {
		t.Fatalf("expected runtime state status connected, got %q", runtimeState.GetStatus())
	}
	if runtimeState.GetHostTelemetry() == nil {
		t.Fatalf("expected host telemetry to be captured from heartbeat")
	}
	if got := runtimeState.GetHostTelemetry().GetCpuPercent(); got != 12.5 {
		t.Fatalf("expected host cpu percent 12.5, got %v", got)
	}
	if len(runtimeState.GetObservedRuns()) != 1 {
		t.Fatalf("expected 1 observed run, got %d", len(runtimeState.GetObservedRuns()))
	}
	if len(runtimeState.GetProcessTelemetry()) != 1 {
		t.Fatalf("expected 1 process telemetry sample, got %d", len(runtimeState.GetProcessTelemetry()))
	}
}

func TestHeartbeatProcessLogChunksAreMirroredIntoMasterLogs(t *testing.T) {
	logRoot := t.TempDir()
	t.Setenv("PC_MASTER_LOG_DIR", logRoot)

	server := NewServer(slog.Default(), "0.1.0", "/tmp/project-commander/master.sock", "shared-key")

	if _, err := server.Heartbeat(authorizedSlaveContext(), &slavev1.HeartbeatRequest{
		RequestId: "heartbeat-process-logs",
		SlaveId:   "slave-process-1",
		BootId:    "boot-process-1",
		ProcessLogChunks: []*slavev1.ProcessLogChunk{
			{
				RunId:      "run-abc",
				ProcessKey: "api",
				PackageKey: "api",
				LogPath:    "/remote/logs/123.log",
				Stream:     "stdout",
				Lines:      []string{"started", "ready on 3000"},
			},
		},
	}); err != nil {
		t.Fatalf("Heartbeat returned error: %v", err)
	}

	response, err := server.GetLogs(context.Background(), &masterv1.GetLogsRequest{
		RequestId: "get-process-logs",
		SlaveId:   "slave-process-1",
		RunId:     "run-abc",
		Limit:     50,
	})
	if err != nil {
		t.Fatalf("GetLogs returned error: %v", err)
	}
	if len(response.GetEntries()) != 2 {
		t.Fatalf("expected 2 mirrored log entries, got %d", len(response.GetEntries()))
	}
	if got := response.GetEntries()[0].GetServiceName(); got != "api" {
		t.Fatalf("expected service name api, got %q", got)
	}
	if got := response.GetEntries()[0].GetRunId(); got != "run-abc" {
		t.Fatalf("expected run id run-abc, got %q", got)
	}
	if got := response.GetEntries()[0].GetProjectPath(); got != "@process:slave-process-1:run-abc" {
		t.Fatalf("unexpected process project path %q", got)
	}
	if !strings.Contains(response.GetEntries()[1].GetMessage(), "ready on 3000") {
		t.Fatalf("expected mirrored message to contain appended output, got %q", response.GetEntries()[1].GetMessage())
	}
}
