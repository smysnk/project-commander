package slavev1

import (
	"testing"

	"google.golang.org/protobuf/proto"
)

func TestRegisterSlaveRequestRoundTripPreservesRuntimeMetadata(t *testing.T) {
	request := &RegisterSlaveRequest{
		SlaveId:        "slave-1",
		HostName:       "blackbox",
		ProcessLogRoot: "/var/log/project-commander/processes",
		StateRoot:      "/var/lib/project-commander/slave",
		BootId:         "boot-1",
		RuntimeCapabilities: []string{
			"runtime.reconcile",
			"runtime.telemetry",
		},
		DiscoveredProjects: []*DiscoveredProject{
			{
				Name:         "managed-app",
				Path:         "/srv/projects/managed-app",
				RelativePath: ".",
				Types:        []string{"node-project"},
				Services:     []string{"web"},
				HasMakefile:  true,
			},
		},
	}

	encoded, err := proto.Marshal(request)
	if err != nil {
		t.Fatalf("marshal request: %v", err)
	}

	var decoded RegisterSlaveRequest
	if err := proto.Unmarshal(encoded, &decoded); err != nil {
		t.Fatalf("unmarshal request: %v", err)
	}

	if decoded.GetSlaveId() != "slave-1" {
		t.Fatalf("expected slave id to survive round trip, got %q", decoded.GetSlaveId())
	}
	if decoded.GetProcessLogRoot() != "/var/log/project-commander/processes" {
		t.Fatalf("expected process log root to survive round trip, got %q", decoded.GetProcessLogRoot())
	}
	if len(decoded.GetRuntimeCapabilities()) != 2 || decoded.GetRuntimeCapabilities()[0] != "runtime.reconcile" {
		t.Fatalf("expected runtime capabilities to survive round trip, got %#v", decoded.GetRuntimeCapabilities())
	}
	if len(decoded.GetDiscoveredProjects()) != 1 || decoded.GetDiscoveredProjects()[0].GetName() != "managed-app" {
		t.Fatalf("expected discovered project to survive round trip, got %#v", decoded.GetDiscoveredProjects())
	}
}
