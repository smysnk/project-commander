package main

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	slavev1 "github.com/josh/project-commander/packages/agent-shared/gen/projectcommander/slave/v1"
)

func TestProcessLogShipperCollectsAppendedLines(t *testing.T) {
	rootDir := t.TempDir()
	logPath := filepath.Join(rootDir, "123.log")
	if err := os.WriteFile(logPath, []byte("line one\nline two\n"), 0o644); err != nil {
		t.Fatalf("write initial log failed: %v", err)
	}

	shipper := newProcessLogShipper(nil)
	runs := []*slavev1.ObservedProcessRun{
		{
			RunId:      "run-1",
			ProcessKey: "api",
			PackageKey: "api",
			LogPath:    logPath,
		},
	}

	first := shipper.Collect(runs, time.Date(2026, time.March, 9, 12, 0, 0, 0, time.UTC))
	if len(first) != 1 {
		t.Fatalf("expected one chunk, got %d", len(first))
	}
	if got, want := first[0].GetRunId(), "run-1"; got != want {
		t.Fatalf("expected run id %q, got %q", want, got)
	}
	if !reflect.DeepEqual(first[0].GetLines(), []string{"line one", "line two"}) {
		t.Fatalf("unexpected lines: %#v", first[0].GetLines())
	}

	second := shipper.Collect(runs, time.Date(2026, time.March, 9, 12, 0, 1, 0, time.UTC))
	if len(second) != 0 {
		t.Fatalf("expected no new lines on second collect, got %d chunks", len(second))
	}

	file, err := os.OpenFile(logPath, os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		t.Fatalf("open append handle failed: %v", err)
	}
	if _, err := file.WriteString("line three\npartial"); err != nil {
		_ = file.Close()
		t.Fatalf("append log output failed: %v", err)
	}
	_ = file.Close()

	third := shipper.Collect(runs, time.Date(2026, time.March, 9, 12, 0, 2, 0, time.UTC))
	if len(third) != 1 {
		t.Fatalf("expected one appended chunk, got %d", len(third))
	}
	if !reflect.DeepEqual(third[0].GetLines(), []string{"line three"}) {
		t.Fatalf("unexpected appended lines: %#v", third[0].GetLines())
	}

	file, err = os.OpenFile(logPath, os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		t.Fatalf("re-open append handle failed: %v", err)
	}
	if _, err := file.WriteString(" tail\n"); err != nil {
		_ = file.Close()
		t.Fatalf("append partial completion failed: %v", err)
	}
	_ = file.Close()

	fourth := shipper.Collect(runs, time.Date(2026, time.March, 9, 12, 0, 3, 0, time.UTC))
	if len(fourth) != 1 {
		t.Fatalf("expected one chunk after remainder flush, got %d", len(fourth))
	}
	if !reflect.DeepEqual(fourth[0].GetLines(), []string{"partial tail"}) {
		t.Fatalf("unexpected remainder lines: %#v", fourth[0].GetLines())
	}
}
