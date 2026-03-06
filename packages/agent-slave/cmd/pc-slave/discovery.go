package main

import (
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"

	slavev1 "github.com/josh/project-commander/packages/agent-shared/gen/projectcommander/slave/v1"
)

var ignoredDiscoveryDirectories = map[string]struct{}{
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

var makefileNames = []string{"Makefile", "makefile", "GNUmakefile"}

type discoveryQueueItem struct {
	path  string
	depth int
}

func directoryExists(targetPath string) bool {
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
	return !info.IsDir()
}

func hasMakefile(folderPath string) bool {
	for _, candidate := range makefileNames {
		if fileExists(filepath.Join(folderPath, candidate)) {
			return true
		}
	}
	return false
}

func hasNestedGoMod(folderPath string, maxDepth int) bool {
	queue := []discoveryQueueItem{{path: folderPath, depth: 0}}
	for len(queue) > 0 {
		current := queue[0]
		queue = queue[1:]
		entries, err := os.ReadDir(current.path)
		if err != nil {
			continue
		}

		for _, entry := range entries {
			if !entry.IsDir() {
				continue
			}
			if _, ignored := ignoredDiscoveryDirectories[entry.Name()]; ignored {
				continue
			}
			nextDir := filepath.Join(current.path, entry.Name())
			if fileExists(filepath.Join(nextDir, "go.mod")) {
				return true
			}
			if current.depth < maxDepth {
				queue = append(queue, discoveryQueueItem{path: nextDir, depth: current.depth + 1})
			}
		}
	}
	return false
}

func inferProjectTypes(folderPath string) []string {
	types := make([]string, 0, 4)
	hasPackageJSON := fileExists(filepath.Join(folderPath, "package.json"))
	hasPackagesDir := directoryExists(filepath.Join(folderPath, "packages"))
	hasGoMod := fileExists(filepath.Join(folderPath, "go.mod"))
	hasGoWork := fileExists(filepath.Join(folderPath, "go.work"))
	hasFolderMakefile := hasMakefile(folderPath)
	hasNestedModule := false
	if hasGoMod {
		hasNestedModule = hasNestedGoMod(folderPath, 2)
	}

	if hasPackageJSON {
		types = append(types, "node-project")
		if hasPackagesDir {
			types = append(types, "node-monorepo")
		}
	}
	if hasGoMod {
		types = append(types, "go-project")
	}
	if hasGoWork || (hasGoMod && hasNestedModule) {
		types = append(types, "go-monorepo")
	}
	if len(types) == 0 && hasFolderMakefile {
		types = append(types, "make-project")
	}
	return types
}

func inferProjectServices(folderPath string, projectTypes []string) []string {
	seen := map[string]struct{}{}
	addService := func(value string) {
		normalized := strings.TrimSpace(value)
		if normalized == "" {
			return
		}
		if _, exists := seen[normalized]; exists {
			return
		}
		seen[normalized] = struct{}{}
	}

	addService("main")

	if fileExists(filepath.Join(folderPath, "schema.graphql")) || directoryExists(filepath.Join(folderPath, "graphql")) {
		addService("graphql")
	}
	if directoryExists(filepath.Join(folderPath, "api")) || directoryExists(filepath.Join(folderPath, "server")) {
		addService("api")
	} else {
		for _, projectType := range projectTypes {
			if projectType == "go-project" {
				addService("api")
				break
			}
		}
	}
	if directoryExists(filepath.Join(folderPath, "admin")) {
		addService("admin")
	}

	packagesPath := filepath.Join(folderPath, "packages")
	if directoryExists(packagesPath) {
		entries, err := os.ReadDir(packagesPath)
		if err == nil {
			for _, entry := range entries {
				if !entry.IsDir() {
					continue
				}
				if _, ignored := ignoredDiscoveryDirectories[entry.Name()]; ignored {
					continue
				}
				addService(entry.Name())
			}
		}
	}

	services := make([]string, 0, len(seen))
	for service := range seen {
		services = append(services, service)
	}
	sort.Strings(services)
	return services
}

func inspectDiscoveredProject(folderPath string, rootPath string) *slavev1.DiscoveredProject {
	cleanFolderPath := filepath.Clean(folderPath)
	types := inferProjectTypes(cleanFolderPath)
	hasFolderMakefile := hasMakefile(cleanFolderPath)
	if len(types) == 0 && !hasFolderMakefile {
		return nil
	}

	relativePath, err := filepath.Rel(rootPath, cleanFolderPath)
	if err != nil {
		relativePath = "."
	}
	relativePath = filepath.ToSlash(strings.TrimSpace(relativePath))
	if relativePath == "" {
		relativePath = "."
	}

	return &slavev1.DiscoveredProject{
		Name:         filepath.Base(cleanFolderPath),
		Path:         cleanFolderPath,
		RelativePath: relativePath,
		Types:        types,
		Services:     inferProjectServices(cleanFolderPath, types),
		HasMakefile:  hasFolderMakefile,
	}
}

func scanDiscoveredProjects(rootPath string, maxDepth int) ([]*slavev1.DiscoveredProject, error) {
	normalizedRoot := strings.TrimSpace(rootPath)
	if normalizedRoot == "" {
		return []*slavev1.DiscoveredProject{}, nil
	}
	absoluteRoot, err := filepath.Abs(normalizedRoot)
	if err != nil {
		return nil, fmt.Errorf("resolve discovery root path: %w", err)
	}
	absoluteRoot = filepath.Clean(absoluteRoot)
	if !directoryExists(absoluteRoot) {
		return nil, fmt.Errorf("discovery root path is not a directory: %s", absoluteRoot)
	}

	if maxDepth < 0 {
		maxDepth = defaultDiscoveryMaxDepth
	} else if maxDepth > defaultDiscoveryMaxDepth {
		maxDepth = defaultDiscoveryMaxDepth
	}

	discovered := make([]*slavev1.DiscoveredProject, 0, 32)
	seenPaths := map[string]struct{}{}
	addProject := func(candidate *slavev1.DiscoveredProject) {
		if candidate == nil {
			return
		}
		pathKey := strings.ToLower(strings.TrimSpace(candidate.GetPath()))
		if pathKey == "" {
			return
		}
		if _, exists := seenPaths[pathKey]; exists {
			return
		}
		seenPaths[pathKey] = struct{}{}
		discovered = append(discovered, candidate)
	}

	addProject(inspectDiscoveredProject(absoluteRoot, absoluteRoot))

	queue := []discoveryQueueItem{{path: absoluteRoot, depth: 0}}
	for len(queue) > 0 {
		current := queue[0]
		queue = queue[1:]

		entries, readErr := os.ReadDir(current.path)
		if readErr != nil {
			continue
		}

		for _, entry := range entries {
			if !entry.IsDir() {
				continue
			}
			if entry.Type()&fs.ModeSymlink != 0 {
				continue
			}
			if _, ignored := ignoredDiscoveryDirectories[entry.Name()]; ignored {
				continue
			}

			candidatePath := filepath.Join(current.path, entry.Name())
			childDepth := current.depth + 1
			if childDepth <= maxDepth {
				addProject(inspectDiscoveredProject(candidatePath, absoluteRoot))
			}
			if childDepth < maxDepth {
				queue = append(queue, discoveryQueueItem{path: candidatePath, depth: childDepth})
			}
		}
	}

	sort.Slice(discovered, func(i, j int) bool {
		return discovered[i].GetPath() < discovered[j].GetPath()
	})

	return discovered, nil
}
