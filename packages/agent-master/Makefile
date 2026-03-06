.PHONY: dev run build

BIN_DIR := ../../bin
COLOR_CYAN := \033[1;36m
COLOR_GREEN := \033[1;32m
COLOR_RESET := \033[0m

dev:
	@printf "$(COLOR_CYAN)[agent:master:dev] watching Go files for changes$(COLOR_RESET)\n"
	@bash -lc 'set -a; [ -f ../../.env ] && . ../../.env; set +a; ../../scripts/dev/watch-go.sh go run ./cmd/pc-master'

run:
	@bash -lc 'set -a; [ -f ../../.env ] && . ../../.env; set +a; go run ./cmd/pc-master'

build:
	@printf "$(COLOR_CYAN)[agent:master:build] start (verbose)$(COLOR_RESET)\n"
	@mkdir -p "$(BIN_DIR)"
	go build -v -x -o "$(BIN_DIR)/pc-master" ./cmd/pc-master
	@printf "$(COLOR_GREEN)[agent:master:build] wrote bin/pc-master$(COLOR_RESET)\n"
