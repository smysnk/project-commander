import { useCallback } from 'react';
import { graphqlRequest } from '../../../lib/graphqlClient';
import {
  MUTATION_DELETE_DESIRED_PROCESS,
  MUTATION_ENSURE_DESIRED_PROCESS,
  MUTATION_HARD_KILL_PROCESS,
  MUTATION_SOFT_KILL_PROCESS,
} from '../graphql/documents';

export default function useRuntimeRegistryActions({
  graphqlEndpoint,
  setError,
  setRuntimeActionBusyByHostId,
  loadSlaveRuntimeBundle,
}) {
  const withBusyHostAction = useCallback(async (hostId, action) => {
    const hostKey = Number.isInteger(Number(hostId)) && Number(hostId) > 0
      ? Number(hostId)
      : String(hostId || '').trim();
    setRuntimeActionBusyByHostId((current) => ({
      ...(current || {}),
      [hostKey]: true,
    }));
    try {
      return await action();
    } finally {
      setRuntimeActionBusyByHostId((current) => ({
        ...(current || {}),
        [hostKey]: false,
      }));
    }
  }, [setRuntimeActionBusyByHostId]);

  const ensureDesiredProcess = useCallback(async (input = {}) => {
    const hostId = Number(input?.hostId);
    if (!Number.isInteger(hostId) || hostId <= 0) {
      setError('A valid host is required to define a managed process.');
      return null;
    }

    return withBusyHostAction(hostId, async () => {
      setError('');
      const variables = {
        desiredProcessId: Number.isInteger(Number(input?.desiredProcessId)) ? Number(input.desiredProcessId) : null,
        hostId,
        agentUuid: String(input?.agentUuid || '').trim() || null,
        projectId: Number.isInteger(Number(input?.projectId)) ? Number(input.projectId) : null,
        projectPath: String(input?.projectPath || '').trim() || null,
        serviceId: Number.isInteger(Number(input?.serviceId)) ? Number(input.serviceId) : null,
        processKey: String(input?.processKey || '').trim() || null,
        packageKey: String(input?.packageKey || '').trim() || null,
        packageRelativePath: String(input?.packageRelativePath || '').trim() || null,
        desiredState: String(input?.desiredState || 'running').trim() || 'running',
        launchMode: String(input?.launchMode || 'exec').trim() || 'exec',
        cwd: String(input?.cwd || '').trim(),
        command: String(input?.command || '').trim(),
        args: Array.isArray(input?.args) ? input.args.map((value) => String(value)).filter(Boolean) : [],
        env: Array.isArray(input?.env)
          ? input.env
            .map((entry) => ({
              key: String(entry?.key || '').trim(),
              value: entry?.value == null ? '' : String(entry.value),
            }))
            .filter((entry) => entry.key)
          : [],
        logRoot: String(input?.logRoot || '').trim() || null,
        restartPolicy: String(input?.restartPolicy || 'manual').trim() || 'manual',
        createdBy: String(input?.createdBy || 'ui').trim() || 'ui',
        updatedBy: String(input?.updatedBy || input?.createdBy || 'ui').trim() || 'ui',
      };

      if (!variables.projectId && !variables.projectPath) {
        throw new Error('A project selection is required before creating a managed process.');
      }
      if (!variables.packageKey) {
        throw new Error('Package key is required.');
      }
      if (!variables.processKey) {
        variables.processKey = variables.packageKey;
      }
      if (!variables.cwd) {
        throw new Error('Working directory is required.');
      }
      if (!variables.command) {
        throw new Error('Command is required.');
      }

      await graphqlRequest({
        query: MUTATION_ENSURE_DESIRED_PROCESS,
        variables,
        endpoint: graphqlEndpoint,
      });
      await loadSlaveRuntimeBundle({
        hostId,
        agentUuid: variables.agentUuid,
      });
      return true;
    }).catch((error) => {
      setError(error.message || 'Unable to ensure desired process');
      return null;
    });
  }, [graphqlEndpoint, loadSlaveRuntimeBundle, setError, withBusyHostAction]);

  const deleteDesiredProcess = useCallback(async (input = {}) => {
    const hostId = Number(input?.hostId);
    if (!Number.isInteger(hostId) || hostId <= 0) {
      setError('A valid host is required to delete a managed process.');
      return null;
    }

    return withBusyHostAction(hostId, async () => {
      setError('');
      await graphqlRequest({
        query: MUTATION_DELETE_DESIRED_PROCESS,
        variables: {
          desiredProcessId: Number.isInteger(Number(input?.desiredProcessId)) ? Number(input.desiredProcessId) : null,
          hostId,
          agentUuid: String(input?.agentUuid || '').trim() || null,
          projectId: Number.isInteger(Number(input?.projectId)) ? Number(input.projectId) : null,
          projectPath: String(input?.projectPath || '').trim() || null,
          packageKey: String(input?.packageKey || '').trim() || null,
          processKey: String(input?.processKey || '').trim() || null,
        },
        endpoint: graphqlEndpoint,
      });
      await loadSlaveRuntimeBundle({
        hostId,
        agentUuid: String(input?.agentUuid || '').trim() || null,
      });
      return true;
    }).catch((error) => {
      setError(error.message || 'Unable to delete managed process');
      return null;
    });
  }, [graphqlEndpoint, loadSlaveRuntimeBundle, setError, withBusyHostAction]);

  const queueKillProcess = useCallback(async ({
    hard = false,
    hostId,
    agentUuid,
    runId,
    processKey,
    pid,
    reason,
  } = {}) => {
    const parsedHostId = Number(hostId);
    if (!Number.isInteger(parsedHostId) || parsedHostId <= 0) {
      setError('A valid host is required to send a kill command.');
      return null;
    }

    return withBusyHostAction(parsedHostId, async () => {
      setError('');
      await graphqlRequest({
        query: hard ? MUTATION_HARD_KILL_PROCESS : MUTATION_SOFT_KILL_PROCESS,
        variables: {
          hostId: parsedHostId,
          agentUuid: String(agentUuid || '').trim() || null,
          runId: String(runId || '').trim() || null,
          processKey: String(processKey || '').trim() || null,
          pid: Number.isInteger(Number(pid)) ? Number(pid) : null,
          reason: String(reason || '').trim() || null,
        },
        endpoint: graphqlEndpoint,
      });
      await loadSlaveRuntimeBundle({
        hostId: parsedHostId,
        agentUuid,
      });
      return true;
    }).catch((error) => {
      setError(error.message || `Unable to ${hard ? 'hard' : 'soft'} kill managed process`);
      return null;
    });
  }, [graphqlEndpoint, loadSlaveRuntimeBundle, setError, withBusyHostAction]);

  const softKillProcessAction = useCallback(
    (input = {}) => queueKillProcess({ ...input, hard: false }),
    [queueKillProcess],
  );

  const hardKillProcessAction = useCallback(
    (input = {}) => queueKillProcess({ ...input, hard: true }),
    [queueKillProcess],
  );

  return {
    ensureDesiredProcess,
    deleteDesiredProcess,
    softKillProcess: softKillProcessAction,
    hardKillProcess: hardKillProcessAction,
  };
}
