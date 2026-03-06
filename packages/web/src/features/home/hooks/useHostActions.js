import { useCallback } from 'react';
import { graphqlRequest } from '../../../lib/graphqlClient';
import {
  setHomeDomainField,
} from '../../../store';
import {
  MUTATION_ADD_HOST,
  MUTATION_ADD_HOST_DIRECTORY,
  MUTATION_CHECKOUT_HOST_PROJECT,
  MUTATION_DELETE_HOST,
  MUTATION_REMOVE_HOST_DIRECTORY,
  MUTATION_UPGRADE_HOST_AGENT,
} from '../graphql/documents';
import {
  deriveDestinationFolderFromRepositoryUrl,
  normalizeHostDirectories,
} from '../lib/homeUtils';
import hostActionUtils from './hostActionUtils.cjs';

const { computeCheckoutDestinationState } = hostActionUtils;

export const useHostActions = ({
  dispatch,
  graphqlEndpoint,
  setError,
  loadHosts,
  manualHostIp,
  showAddDirectoryRowByHostId,
  directoryInputByHostId,
  directoryMutationBusyByHostId,
  showCheckoutRowByHostId,
  checkoutRepoInputByHostId,
  checkoutBaseDirectoryByHostId,
  checkoutDestinationByHostId,
  checkoutAutoDestinationByHostId,
  checkoutMutationBusyByHostId,
}) => {
  const onAddHost = useCallback(async () => {
    const ip = manualHostIp.trim();
    if (!ip) {
      setError('Host target is required.');
      return;
    }

    setError('');
    dispatch(setHomeDomainField('addingHost', true));
    try {
      await graphqlRequest({
        query: MUTATION_ADD_HOST,
        variables: { ip },
        endpoint: graphqlEndpoint,
      });
      dispatch(setHomeDomainField('manualHostIp', ''));
      dispatch(setHomeDomainField('showAddHostRow', false));
      await loadHosts(graphqlEndpoint);
    } catch (addHostError) {
      setError(addHostError.message || 'Unable to add host');
    } finally {
      dispatch(setHomeDomainField('addingHost', false));
    }
  }, [dispatch, graphqlEndpoint, loadHosts, manualHostIp, setError]);

  const onDeleteHost = useCallback(async (host) => {
    const hostId = Number(host?.id);
    const hostName = String(host?.name || '').trim() || String(host?.ip || '').trim() || `#${hostId}`;
    if (!Number.isInteger(hostId) || hostId <= 0) {
      setError('Unable to delete host: invalid host id.');
      return;
    }

    if (typeof window !== 'undefined') {
      const confirmed = window.confirm(`Delete host "${hostName}"?`);
      if (!confirmed) {
        return;
      }
    }

    setError('');
    dispatch(setHomeDomainField('deletingHostId', hostId));
    try {
      const data = await graphqlRequest({
        query: MUTATION_DELETE_HOST,
        variables: { hostId },
        endpoint: graphqlEndpoint,
      });
      if (!data?.deleteHost) {
        throw new Error('Host was not found or already deleted.');
      }
      await loadHosts(graphqlEndpoint);
    } catch (deleteHostError) {
      setError(deleteHostError.message || 'Unable to delete host');
    } finally {
      dispatch(setHomeDomainField('deletingHostId', null));
    }
  }, [dispatch, graphqlEndpoint, loadHosts, setError]);

  const onUpgradeHostAgent = useCallback(async (host) => {
    const hostId = Number(host?.id);
    if (!Number.isInteger(hostId) || hostId <= 0) {
      setError('Unable to deploy host agent: invalid host id.');
      return;
    }

    setError('');
    dispatch(setHomeDomainField('upgradingHostId', hostId));
    try {
      await graphqlRequest({
        query: MUTATION_UPGRADE_HOST_AGENT,
        variables: { hostId },
        endpoint: graphqlEndpoint,
      });
      await loadHosts(graphqlEndpoint);
    } catch (upgradeError) {
      setError(upgradeError.message || 'Unable to deploy host agent');
    } finally {
      dispatch(setHomeDomainField('upgradingHostId', null));
    }
  }, [dispatch, graphqlEndpoint, loadHosts, setError]);

  const onAddHostDirectory = useCallback(async (host) => {
    const hostId = Number(host?.id);
    if (!Number.isInteger(hostId) || hostId <= 0) {
      setError('Unable to add directory: invalid host id.');
      return;
    }

    const directoryPath = String(directoryInputByHostId?.[hostId] || '').trim();
    if (!directoryPath) {
      setError('Directory path is required.');
      return;
    }

    setError('');
    dispatch(setHomeDomainField('directoryMutationBusyByHostId', {
      ...(directoryMutationBusyByHostId || {}),
      [hostId]: true,
    }));
    try {
      await graphqlRequest({
        query: MUTATION_ADD_HOST_DIRECTORY,
        variables: { hostId, directoryPath },
        endpoint: graphqlEndpoint,
      });
      dispatch(setHomeDomainField('directoryInputByHostId', {
        ...(directoryInputByHostId || {}),
        [hostId]: '',
      }));
      dispatch(setHomeDomainField('showAddDirectoryRowByHostId', {
        ...(showAddDirectoryRowByHostId || {}),
        [hostId]: false,
      }));
      await loadHosts(graphqlEndpoint);
    } catch (addDirectoryError) {
      setError(addDirectoryError.message || 'Unable to add directory');
    } finally {
      dispatch(setHomeDomainField('directoryMutationBusyByHostId', {
        ...(directoryMutationBusyByHostId || {}),
        [hostId]: false,
      }));
    }
  }, [
    directoryInputByHostId,
    directoryMutationBusyByHostId,
    dispatch,
    graphqlEndpoint,
    loadHosts,
    setError,
    showAddDirectoryRowByHostId,
  ]);

  const onRemoveHostDirectory = useCallback(async ({ host, directoryPath }) => {
    const hostId = Number(host?.id);
    if (!Number.isInteger(hostId) || hostId <= 0) {
      setError('Unable to remove directory: invalid host id.');
      return;
    }

    const normalizedDirectoryPath = String(directoryPath || '').trim();
    if (!normalizedDirectoryPath) {
      setError('Unable to remove directory: invalid path.');
      return;
    }

    setError('');
    dispatch(setHomeDomainField('directoryMutationBusyByHostId', {
      ...(directoryMutationBusyByHostId || {}),
      [hostId]: true,
    }));
    try {
      await graphqlRequest({
        query: MUTATION_REMOVE_HOST_DIRECTORY,
        variables: { hostId, directoryPath: normalizedDirectoryPath },
        endpoint: graphqlEndpoint,
      });
      await loadHosts(graphqlEndpoint);
    } catch (removeDirectoryError) {
      setError(removeDirectoryError.message || 'Unable to remove directory');
    } finally {
      dispatch(setHomeDomainField('directoryMutationBusyByHostId', {
        ...(directoryMutationBusyByHostId || {}),
        [hostId]: false,
      }));
    }
  }, [directoryMutationBusyByHostId, dispatch, graphqlEndpoint, loadHosts, setError]);

  const onCheckoutRepositoryInputChange = useCallback((hostId, value) => {
    const { nextInputValue, derivedDestination, nextDestination } = computeCheckoutDestinationState({
      inputValue: value,
      existingDestination: checkoutDestinationByHostId?.[hostId],
      previousAutoDestination: checkoutAutoDestinationByHostId?.[hostId],
      deriveDestinationFolder: deriveDestinationFolderFromRepositoryUrl,
    });
    dispatch(setHomeDomainField('checkoutRepoInputByHostId', {
      ...(checkoutRepoInputByHostId || {}),
      [hostId]: nextInputValue,
    }));
    dispatch(setHomeDomainField('checkoutDestinationByHostId', {
      ...(checkoutDestinationByHostId || {}),
      [hostId]: nextDestination,
    }));
    dispatch(setHomeDomainField('checkoutAutoDestinationByHostId', {
      ...(checkoutAutoDestinationByHostId || {}),
      [hostId]: derivedDestination,
    }));
  }, [
    checkoutAutoDestinationByHostId,
    checkoutDestinationByHostId,
    checkoutRepoInputByHostId,
    dispatch,
  ]);

  const onCancelCheckoutHostProject = useCallback((hostId) => {
    dispatch(setHomeDomainField('checkoutRepoInputByHostId', {
      ...(checkoutRepoInputByHostId || {}),
      [hostId]: '',
    }));
    dispatch(setHomeDomainField('checkoutDestinationByHostId', {
      ...(checkoutDestinationByHostId || {}),
      [hostId]: '',
    }));
    dispatch(setHomeDomainField('checkoutAutoDestinationByHostId', {
      ...(checkoutAutoDestinationByHostId || {}),
      [hostId]: '',
    }));
    dispatch(setHomeDomainField('showCheckoutRowByHostId', {
      ...(showCheckoutRowByHostId || {}),
      [hostId]: false,
    }));
  }, [
    checkoutAutoDestinationByHostId,
    checkoutDestinationByHostId,
    checkoutRepoInputByHostId,
    dispatch,
    showCheckoutRowByHostId,
  ]);

  const onCheckoutHostProject = useCallback(async (host) => {
    const hostId = Number(host?.id);
    if (!Number.isInteger(hostId) || hostId <= 0) {
      setError('Unable to checkout project: invalid host id.');
      return;
    }

    const repositoryUrl = String(checkoutRepoInputByHostId?.[hostId] || '').trim();
    const hostDirectories = normalizeHostDirectories(host?.directories);
    const selectedBaseDirectory = String(
      checkoutBaseDirectoryByHostId?.[hostId] || hostDirectories[0] || '',
    ).trim();
    const destinationFolder = String(checkoutDestinationByHostId?.[hostId] || '').trim();
    if (!repositoryUrl) {
      setError('Git repository URL is required.');
      return;
    }
    if (!selectedBaseDirectory) {
      setError('A target project directory is required before checkout.');
      return;
    }
    if (!destinationFolder) {
      setError('Destination folder is required.');
      return;
    }

    setError('');
    dispatch(setHomeDomainField('checkoutMutationBusyByHostId', {
      ...(checkoutMutationBusyByHostId || {}),
      [hostId]: true,
    }));
    try {
      await graphqlRequest({
        query: MUTATION_CHECKOUT_HOST_PROJECT,
        variables: {
          hostId,
          repositoryUrl,
          baseDirectory: selectedBaseDirectory,
          destinationFolder,
        },
        endpoint: graphqlEndpoint,
      });
      onCancelCheckoutHostProject(hostId);
      await loadHosts(graphqlEndpoint);
    } catch (checkoutError) {
      setError(checkoutError.message || 'Unable to checkout project on host');
    } finally {
      dispatch(setHomeDomainField('checkoutMutationBusyByHostId', {
        ...(checkoutMutationBusyByHostId || {}),
        [hostId]: false,
      }));
    }
  }, [
    checkoutBaseDirectoryByHostId,
    checkoutDestinationByHostId,
    checkoutMutationBusyByHostId,
    checkoutRepoInputByHostId,
    dispatch,
    graphqlEndpoint,
    loadHosts,
    onCancelCheckoutHostProject,
    setError,
  ]);

  return {
    onAddHost,
    onDeleteHost,
    onUpgradeHostAgent,
    onAddHostDirectory,
    onRemoveHostDirectory,
    onCheckoutRepositoryInputChange,
    onCancelCheckoutHostProject,
    onCheckoutHostProject,
  };
};
