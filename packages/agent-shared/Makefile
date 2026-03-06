.PHONY: proto-generate

ROOT_DIR := ../..
PROTO_DIR := $(ROOT_DIR)/proto
OUT_DIR := $(ROOT_DIR)/packages/agent-shared/gen
COLOR_CYAN := \033[1;36m
COLOR_GREEN := \033[1;32m
COLOR_RESET := \033[0m

PROTO_FILES := \
	$(PROTO_DIR)/projectcommander/master/v1/master_control.proto \
	$(PROTO_DIR)/projectcommander/master/v1/master_events.proto \
	$(PROTO_DIR)/projectcommander/slave/v1/slave_control.proto

proto-generate:
	@printf "$(COLOR_CYAN)[agent:shared:proto] generating Go stubs$(COLOR_RESET)\n"
	@mkdir -p "$(OUT_DIR)"
	PATH="$(PATH):$(HOME)/go/bin" protoc \
		-I "$(PROTO_DIR)" \
		--go_out="$(OUT_DIR)" \
		--go_opt=paths=source_relative \
		--go-grpc_out="$(OUT_DIR)" \
		--go-grpc_opt=paths=source_relative \
		$(PROTO_FILES)
	@printf "$(COLOR_GREEN)[agent:shared:proto] wrote packages/agent-shared/gen$(COLOR_RESET)\n"
