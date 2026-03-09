package main

import (
	"log/slog"
	"testing"
)

func TestParseLogLevel(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name  string
		input string
		want  slog.Level
		ok    bool
	}{
		{name: "trace", input: "trace", want: levelTrace, ok: true},
		{name: "debug", input: "DEBUG", want: slog.LevelDebug, ok: true},
		{name: "info", input: "info", want: slog.LevelInfo, ok: true},
		{name: "warn", input: "warn", want: slog.LevelWarn, ok: true},
		{name: "warning", input: "warning", want: slog.LevelWarn, ok: true},
		{name: "error", input: "error", want: slog.LevelError, ok: true},
		{name: "invalid", input: "verbose", want: slog.LevelInfo, ok: false},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got, ok := parseLogLevel(tc.input)
			if ok != tc.ok {
				t.Fatalf("expected ok=%v, got %v", tc.ok, ok)
			}
			if got != tc.want {
				t.Fatalf("expected level %v, got %v", tc.want, got)
			}
		})
	}
}

func TestResolveConsoleLogLevelPrefersFlagOverEnv(t *testing.T) {
	t.Setenv("PC_SLAVE_CONSOLE_LOG_LEVEL", "error")
	level, raw, ok := resolveConsoleLogLevel("trace")
	if !ok {
		t.Fatalf("expected flag level to be valid")
	}
	if raw != "trace" {
		t.Fatalf("expected raw trace, got %q", raw)
	}
	if level != levelTrace {
		t.Fatalf("expected trace level, got %v", level)
	}
}

func TestResolveConsoleLogLevelFromEnv(t *testing.T) {
	t.Setenv("PC_SLAVE_CONSOLE_LOG_LEVEL", "debug")
	level, raw, ok := resolveConsoleLogLevel("")
	if !ok {
		t.Fatalf("expected env level to be valid")
	}
	if raw != "debug" {
		t.Fatalf("expected raw debug, got %q", raw)
	}
	if level != slog.LevelDebug {
		t.Fatalf("expected debug level, got %v", level)
	}
}

func TestResolveConsoleLogLevelInvalidFallsBack(t *testing.T) {
	t.Setenv("PC_SLAVE_CONSOLE_LOG_LEVEL", "chatty")
	level, raw, ok := resolveConsoleLogLevel("")
	if ok {
		t.Fatalf("expected invalid level to return ok=false")
	}
	if raw != "chatty" {
		t.Fatalf("expected raw chatty, got %q", raw)
	}
	if level != slog.LevelInfo {
		t.Fatalf("expected info fallback level, got %v", level)
	}
}

func TestFormatLogLevelLabel(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name  string
		level slog.Level
		want  string
	}{
		{name: "trace", level: levelTrace, want: "TRACE"},
		{name: "debug", level: slog.LevelDebug, want: "DEBUG"},
		{name: "info", level: slog.LevelInfo, want: "INFO"},
		{name: "warn", level: slog.LevelWarn, want: "WARN"},
		{name: "error", level: slog.LevelError, want: "ERROR"},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if got := formatLogLevelLabel(tc.level); got != tc.want {
				t.Fatalf("expected %s, got %s", tc.want, got)
			}
		})
	}
}
