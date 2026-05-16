# pcctl

`pcctl` is the shell-oriented Project Commander lifecycle client. It uses `commander-client`, so it goes through the same GraphQL API, automation tokens, authorization, and runtime audit trail as `commander-mcp`.

## Configuration

Config is resolved in this order:

1. command flags
2. environment variables
3. `~/.project-commander/pcctl.json`

Supported environment variables:

```sh
PROJECT_COMMANDER_URL=https://commander.smysnk.com
PROJECT_COMMANDER_TOKEN=<automation-token>
PROJECT_COMMANDER_DEFAULT_HOST=clearbox
```

Example config file:

```json
{
  "url": "https://commander.smysnk.com",
  "token": "pc_xxx",
  "defaultHost": "clearbox"
}
```

## Examples

```sh
pcctl hosts list --json
pcctl projects list --host clearbox
pcctl templates list --host clearbox --project varcad.io
pcctl process ensure --host clearbox --project varcad.io --template docker-compose-web --wait --json
pcctl process restart --host clearbox --project varcad.io --template docker-compose-web --wait
pcctl process ps --host clearbox --project varcad.io --status running --search web
pcctl process logs --run-id <run-id>
pcctl process soft-kill --run-id <run-id>
pcctl process hard-kill --run-id <run-id>
pcctl path resolve --host clearbox --path /Volumes/shared/play/varcad.io
```

Wait failures return exit code `2`; authentication/authorization failures return exit code `3`.

Raw command process definitions remain disabled unless `PROJECT_COMMANDER_PCCTL_ALLOW_RAW_COMMANDS=true` is set and the command includes `--privileged-scope raw-command`.
