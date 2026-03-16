package masterv1

import (
	"testing"

	slavev1 "github.com/josh/project-commander/packages/agent-shared/gen/projectcommander/slave/v1"
	"google.golang.org/protobuf/proto"
)

func TestUpsertDesiredProcessRequestRoundTripPreservesNestedDesiredProcess(t *testing.T) {
	request := &UpsertDesiredProcessRequest{
		SlaveId: "slave-1",
		DesiredProcess: &slavev1.DesiredProcess{
			DesiredProcessId: 41,
			ProcessKey:       "api",
			ProjectPath:      "/srv/projects/api",
			PackageKey:       "packages/api",
			LaunchMode:       "exec",
			Cwd:              "/srv/projects/api/packages/api",
			Command:          "yarn",
			Args:             []string{"dev"},
		},
	}

	encoded, err := proto.Marshal(request)
	if err != nil {
		t.Fatalf("marshal request: %v", err)
	}

	var decoded UpsertDesiredProcessRequest
	if err := proto.Unmarshal(encoded, &decoded); err != nil {
		t.Fatalf("unmarshal request: %v", err)
	}

	if decoded.GetSlaveId() != "slave-1" {
		t.Fatalf("expected slave id to survive round trip, got %q", decoded.GetSlaveId())
	}
	if decoded.GetDesiredProcess().GetProcessKey() != "api" {
		t.Fatalf("expected process key to survive round trip, got %q", decoded.GetDesiredProcess().GetProcessKey())
	}
	if decoded.GetDesiredProcess().GetCommand() != "yarn" {
		t.Fatalf("expected command to survive round trip, got %q", decoded.GetDesiredProcess().GetCommand())
	}
}
