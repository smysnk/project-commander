package main

import (
	"log/slog"
	"testing"

	slavev1 "github.com/josh/project-commander/packages/agent-shared/gen/projectcommander/slave/v1"
)

func TestValidateDestinationFolderName(t *testing.T) {
	if _, err := validateDestinationFolderName("repo-name"); err != nil {
		t.Fatalf("expected destination folder to be accepted, got error: %v", err)
	}

	if _, err := validateDestinationFolderName("nested/repo"); err == nil {
		t.Fatalf("expected destination folder containing slash to be rejected")
	}
}

func TestNormalizeCheckoutOutputLinesTruncatesAndLimits(t *testing.T) {
	raw := ""
	for i := 0; i < maxCheckoutOutputLines+25; i++ {
		raw += "line\n"
	}

	normalized := normalizeCheckoutOutputLines(raw)
	if len(normalized) != maxCheckoutOutputLines {
		t.Fatalf("expected %d lines, got %d", maxCheckoutOutputLines, len(normalized))
	}
}

func TestExecuteSlaveCommandRejectsUnsupportedType(t *testing.T) {
	result := executeSlaveCommand(t.Context(), slog.Default(), nil, &slavev1.SlaveCommand{
		CommandId:   "test-1",
		CommandType: "unsupported",
	})

	if result.status != slaveCommandStatusFailed {
		t.Fatalf("expected failed status, got %q", result.status)
	}
}
