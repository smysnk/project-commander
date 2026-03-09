.PHONY: dev run build

BIN_DIR := ../../bin
COLOR_CYAN := \033[1;36m
COLOR_GREEN := \033[1;32m
COLOR_RESET := \033[0m

dev:
	@printf "$(COLOR_CYAN)[agent:slave:dev] watching Go files for changes$(COLOR_RESET)\n"
	@bash -lc 'VERSION="$$(node ../../scripts/version/sync-package-versions.mjs --quiet)"; set -a; [ -f ../../.env ] && . ../../.env; set +a; ../../scripts/dev/watch-go.sh go run -ldflags "-X main.buildVersion=$$VERSION" ./cmd/pc-slave'

run:
	@bash -lc 'VERSION="$$(node ../../scripts/version/sync-package-versions.mjs --quiet)"; set -a; [ -f ../../.env ] && . ../../.env; set +a; go run -ldflags "-X main.buildVersion=$$VERSION" ./cmd/pc-slave'

build:
	@printf "$(COLOR_CYAN)[agent:slave:build] start (verbose)$(COLOR_RESET)\n"
	@bash -lc 'VERSION="$$(node ../../scripts/version/sync-package-versions.mjs --quiet)"; mkdir -p "$(BIN_DIR)"; go build -v -x -ldflags "-X main.buildVersion=$$VERSION" -o "$(BIN_DIR)/pc-slave" ./cmd/pc-slave'
	@printf "$(COLOR_GREEN)[agent:slave:build] wrote bin/pc-slave$(COLOR_RESET)\n"
