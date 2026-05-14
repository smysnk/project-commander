# Fleet Deployment

This directory is the Rancher Fleet bundle for `project-commander`.

## Defaults

- Namespace: `project-commander`
- Release name: `project-commander`
- Public domain: `commander.smysnk.com`
- Web ingress path: `/`
- Control-plane ingress paths: `/graphql`, `/health`, `/api/discovery`, `/ws`
- External slave listener: `commander.smysnk.com:30552`
- TLS secret: `tls-commander-smysnk-com`
- Fleet namespace: `fleet-local`
- GitRepo manifest: `fleet/gitrepo.yml`

## Runtime Shape

The chart intentionally deploys two workloads:

- `web`
- `control-plane`
  - `server` container
  - `master` container

`server` and `master` remain in the same pod so they can share the existing Unix domain socket used by the Node backend to talk to `pc-master`.

## Validate

```bash
yarn fleet:lint
yarn fleet:template
```

## Images

Default image coordinates are:

- app image: `222634406587.dkr.ecr.us-east-1.amazonaws.com/project-commander-app:main`
- master image: `222634406587.dkr.ecr.us-east-1.amazonaws.com/project-commander-master:main`

For local smoke builds you can still build:

```bash
yarn docker:build:app
yarn docker:build:master
```

GitHub Actions is configured to build and push both images to ECR on `main`.

## Secrets

The default values render an inline placeholder master secret with `PC_SLAVE_SHARED_KEY=change-me` so the chart can bootstrap locally.

Before using real remote slaves, replace that with a real secret, either by:

1. overriding `controlPlane.master.secret`, or
2. setting `controlPlane.master.existingSecret`

Starter secret files are included at:

- `.env.fleet.master.example`
- `.env.fleet.server.example`

If you switch to Postgres, set `database.mode=postgres` and provide `DATABASE_URL` through the server secret.

## DNS and Ingress

The chart is configured to let the ingress controller handle the public hostname, following the same pattern as the other Fleet-managed repos.

Defaults:

- host: `commander.smysnk.com`
- ingress class: `traefik`
- cert-manager issuer annotation: `letsencrypt-prod`
- TLS secret: `tls-commander-smysnk-com`

## Deploy

```bash
kubectl apply -f ./fleet/gitrepo.yml
kubectl -n fleet-local get gitrepo project-commander -o wide
kubectl -n project-commander get deploy,svc,ingress,configmap,secret,pvc
```

Or use the helper:

```bash
yarn k8s:deploy:local
```
