.PHONY: dev start build-all e2e-host-directories

COLOR_BLUE := \033[1;34m
COLOR_CYAN := \033[1;36m
COLOR_GREEN := \033[1;32m
COLOR_RESET := \033[0m

dev:
	@yarn mono-helper env yarn workspaces foreach -p -A -i run dev & wait

start:
	@yarn start:server & yarn start:web & wait

build-all:
	@printf "$(COLOR_CYAN)[build:all] syncing workspace version from git commit count$(COLOR_RESET)\n"
	@yarn version:sync
	@printf "$(COLOR_CYAN)[build:all] generating Go protobuf stubs$(COLOR_RESET)\n"
	@yarn proto:generate:go
	@printf "$(COLOR_BLUE)[build:all] building web/server$(COLOR_RESET)\n"
	@yarn build
	@printf "$(COLOR_BLUE)[build:all] building pc-master$(COLOR_RESET)\n"
	@yarn agent:master:build
	@printf "$(COLOR_BLUE)[build:all] building pc-slave$(COLOR_RESET)\n"
	@yarn agent:slave:build
	@printf "$(COLOR_BLUE)[build:all] syncing local installed pc-slave service(s)$(COLOR_RESET)\n"
	@bash ./scripts/deploy/update-local-slave-install.sh --binary ./bin/pc-slave
	@printf "$(COLOR_GREEN)[build:all] complete$(COLOR_RESET)\n"

e2e-host-directories:
	@printf "$(COLOR_CYAN)[e2e] validating host directories mutation flow$(COLOR_RESET)\n"
	@node ./scripts/e2e/host-directories.e2e.mjs
