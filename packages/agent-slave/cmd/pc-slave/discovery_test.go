package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestScanDiscoveredProjects_LimitsToConfiguredRootAndOneChildLevel(t *testing.T) {
	rootDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(rootDir, "package.json"), []byte(`{"name":"root"}`), 0o644); err != nil {
		t.Fatalf("write root package.json: %v", err)
	}
	topLevelDir := filepath.Join(rootDir, "apps")
	if err := os.MkdirAll(topLevelDir, 0o755); err != nil {
		t.Fatalf("create top-level folder: %v", err)
	}
	if err := os.WriteFile(filepath.Join(topLevelDir, "package.json"), []byte(`{"name":"apps"}`), 0o644); err != nil {
		t.Fatalf("write top-level package.json: %v", err)
	}
	grandchildDir := filepath.Join(topLevelDir, "api")
	if err := os.MkdirAll(grandchildDir, 0o755); err != nil {
		t.Fatalf("create grandchild folder: %v", err)
	}
	if err := os.WriteFile(filepath.Join(grandchildDir, "package.json"), []byte(`{"name":"api"}`), 0o644); err != nil {
		t.Fatalf("write grandchild package.json: %v", err)
	}

	projects, err := scanDiscoveredProjects(rootDir, 3)
	if err != nil {
		t.Fatalf("scanDiscoveredProjects returned error: %v", err)
	}
	if len(projects) < 2 {
		t.Fatalf("expected at least 2 discovered projects, got %d", len(projects))
	}

	var foundRoot bool
	var foundTopLevel bool
	var foundGrandchild bool
	for _, project := range projects {
		if project.GetPath() == rootDir {
			foundRoot = true
		}
		if project.GetPath() == topLevelDir {
			foundTopLevel = true
			if len(project.GetServices()) == 0 {
				t.Fatalf("expected top-level project services to be detected")
			}
		}
		if project.GetPath() == grandchildDir {
			foundGrandchild = true
		}
	}
	if !foundRoot {
		t.Fatalf("expected root project to be discovered")
	}
	if !foundTopLevel {
		t.Fatalf("expected top-level project to be discovered")
	}
	if foundGrandchild {
		t.Fatalf("did not expect grandchild project %q to be discovered", grandchildDir)
	}
}

func TestScanDiscoveredProjectsSkipsIgnoredDirectories(t *testing.T) {
	rootDir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(rootDir, "node_modules", "foo"), 0o755); err != nil {
		t.Fatalf("create ignored dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(rootDir, "node_modules", "foo", "package.json"), []byte(`{"name":"foo"}`), 0o644); err != nil {
		t.Fatalf("write ignored project package.json: %v", err)
	}
	if err := os.WriteFile(filepath.Join(rootDir, "Makefile"), []byte("build:\n\t@echo ok\n"), 0o644); err != nil {
		t.Fatalf("write makefile: %v", err)
	}

	projects, err := scanDiscoveredProjects(rootDir, 2)
	if err != nil {
		t.Fatalf("scanDiscoveredProjects returned error: %v", err)
	}
	if len(projects) != 1 {
		t.Fatalf("expected only root project to be discovered, got %d", len(projects))
	}
	if projects[0].GetPath() != rootDir {
		t.Fatalf("expected root project path %s, got %s", rootDir, projects[0].GetPath())
	}
}
