import { useCallback, useEffect, useMemo } from 'react';
import { setHomeDomainField, setUiSelectedHostId } from '../../../store';
import { MASTER_AGENT_SIDEBAR_ID } from '../constants/ui';
import { useHostActions } from '../hooks/useHostActions';
import { useHostQueries } from '../hooks/useHomeQueries';

export default function useHostsSidebarController({
  dispatch,
  graphqlEndpoint,
  setError,
  activateHostsPanel,
  setSelectedHostId,
  setShowAddHostRow,
  setManualHostIp,
  setHostsLoading,
  setHosts,
  setTerminalSessionByHostId,
  hostsLoading,
  addingHost,
  deletingHostId,
  hosts,
  showAddHostRow,
  manualHostIp,
  selectedHostId,
  isMasterSidebarSelected,
  masterConnectionHealthClass,
  masterConnectionStatus,
  masterAgentInfo,
  showAddDirectoryRowByHostId,
  directoryInputByHostId,
  directoryMutationBusyByHostId,
  showCheckoutRowByHostId,
  checkoutRepoInputByHostId,
  checkoutBaseDirectoryByHostId,
  checkoutDestinationByHostId,
  checkoutAutoDestinationByHostId,
  checkoutMutationBusyByHostId,
  terminalInputByHostId,
  terminalStartingByHostId,
  terminalSendingByHostId,
  terminalSessionByHostId,
  slaveTargetVersion,
  upgradingHostId,
  runtimeRegistryByHostId,
  runtimeRegistryLoadingByHostId,
  runtimeActionBusyByHostId,
  onViewManagedProcessLogs,
  onSoftKillObservedProcess,
  onHardKillObservedProcess,
  toHostHealthClassName,
  normalizeHostDirectories,
  isHostVersionOutOfDate,
  deriveDestinationFolderFromRepositoryUrl,
  formatVersionWithProtocol,
  formatRuntimeDateTime,
}) {
  const { loadHosts } = useHostQueries({
    dispatch,
    graphqlEndpoint,
    setError,
    setHostsLoading,
    setHosts,
    showAddDirectoryRowByHostId,
    directoryInputByHostId,
    directoryMutationBusyByHostId,
    showCheckoutRowByHostId,
    checkoutRepoInputByHostId,
    checkoutBaseDirectoryByHostId,
    checkoutDestinationByHostId,
    checkoutAutoDestinationByHostId,
    checkoutMutationBusyByHostId,
    terminalInputByHostId,
    terminalStartingByHostId,
    terminalSendingByHostId,
    terminalSessionByHostId,
    setTerminalSessionByHostId,
  });

  const {
    onAddHost,
    onDeleteHost,
    onUpgradeHostAgent,
    onAddHostDirectory,
    onRemoveHostDirectory,
    onCheckoutRepositoryInputChange,
    onCancelCheckoutHostProject,
    onCheckoutHostProject,
  } = useHostActions({
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
  });

  useEffect(() => {
    loadHosts(graphqlEndpoint);
  }, [graphqlEndpoint, loadHosts]);

  useEffect(() => {
    if (!Array.isArray(hosts) || hosts.length === 0) {
      if (selectedHostId !== null && selectedHostId !== MASTER_AGENT_SIDEBAR_ID) {
        dispatch(setUiSelectedHostId(null));
      }
      return;
    }

    if (selectedHostId == null || selectedHostId === MASTER_AGENT_SIDEBAR_ID) {
      return;
    }

    const hasSelected = hosts.some((host) => Number(host?.id) === Number(selectedHostId));
    if (!hasSelected) {
      dispatch(setUiSelectedHostId(null));
    }
  }, [dispatch, hosts, selectedHostId]);

  const onToggleAddHostRow = useCallback(() => {
    setError('');
    const next = !Boolean(showAddHostRow);
    if (!next) {
      setManualHostIp('');
    }
    setShowAddHostRow(next);
  }, [setError, setManualHostIp, setShowAddHostRow, showAddHostRow]);

  const onSelectHost = useCallback((hostId) => {
    setSelectedHostId(hostId);
    activateHostsPanel();
  }, [activateHostsPanel, setSelectedHostId]);

  const onSelectMasterHost = useCallback(() => {
    setSelectedHostId(MASTER_AGENT_SIDEBAR_ID);
    activateHostsPanel();
  }, [activateHostsPanel, setSelectedHostId]);

  const onToggleHostCheckoutRow = useCallback((hostId, hostDirectories = []) => {
    setError('');
    const next = !Boolean(showCheckoutRowByHostId?.[hostId]);
    if (next) {
      const defaultBaseDirectory = hostDirectories[0] || '';
      dispatch(setHomeDomainField('checkoutBaseDirectoryByHostId', {
        ...(checkoutBaseDirectoryByHostId || {}),
        [hostId]: String(checkoutBaseDirectoryByHostId?.[hostId] || defaultBaseDirectory),
      }));
    }
    dispatch(setHomeDomainField('showCheckoutRowByHostId', {
      ...(showCheckoutRowByHostId || {}),
      [hostId]: next,
    }));
  }, [checkoutBaseDirectoryByHostId, dispatch, setError, showCheckoutRowByHostId]);

  const onToggleHostDirectoryRow = useCallback((hostId) => {
    setError('');
    const next = !Boolean(showAddDirectoryRowByHostId?.[hostId]);
    if (!next) {
      dispatch(setHomeDomainField('directoryInputByHostId', {
        ...(directoryInputByHostId || {}),
        [hostId]: '',
      }));
    }
    dispatch(setHomeDomainField('showAddDirectoryRowByHostId', {
      ...(showAddDirectoryRowByHostId || {}),
      [hostId]: next,
    }));
  }, [directoryInputByHostId, dispatch, setError, showAddDirectoryRowByHostId]);

  const onHostDirectoryInputChange = useCallback((hostId, value) => {
    dispatch(setHomeDomainField('directoryInputByHostId', {
      ...(directoryInputByHostId || {}),
      [hostId]: value,
    }));
  }, [directoryInputByHostId, dispatch]);

  const onCheckoutBaseDirectoryChange = useCallback((hostId, value) => {
    dispatch(setHomeDomainField('checkoutBaseDirectoryByHostId', {
      ...(checkoutBaseDirectoryByHostId || {}),
      [hostId]: String(value || ''),
    }));
  }, [checkoutBaseDirectoryByHostId, dispatch]);

  const onCheckoutDestinationChange = useCallback((hostId, value) => {
    dispatch(setHomeDomainField('checkoutDestinationByHostId', {
      ...(checkoutDestinationByHostId || {}),
      [hostId]: value,
    }));
  }, [checkoutDestinationByHostId, dispatch]);

  return useMemo(() => ({
    hostsLoading,
    addingHost,
    deletingHostId,
    hosts,
    showAddHostRow,
    manualHostIp,
    onManualHostIpChange: setManualHostIp,
    onToggleAddHostRow,
    onAddHost,
    selectedHostId,
    onSelectHost,
    isMasterSidebarSelected,
    onSelectMasterHost,
    masterConnectionHealthClass,
    masterConnectionStatus,
    masterAgentInfo,
    showAddDirectoryRowByHostId,
    directoryInputByHostId,
    directoryMutationBusyByHostId,
    showCheckoutRowByHostId,
    checkoutRepoInputByHostId,
    checkoutBaseDirectoryByHostId,
    checkoutDestinationByHostId,
    checkoutMutationBusyByHostId,
    slaveTargetVersion,
    upgradingHostId,
    runtimeRegistryByHostId,
    runtimeRegistryLoadingByHostId,
    runtimeActionBusyByHostId,
    onViewManagedProcessLogs,
    onSoftKillObservedProcess,
    onHardKillObservedProcess,
    onUpgradeHostAgent,
    onDeleteHost,
    onToggleHostCheckoutRow,
    onToggleHostDirectoryRow,
    onHostDirectoryInputChange,
    onAddHostDirectory,
    onRemoveHostDirectory,
    onCheckoutRepositoryInputChange,
    onCheckoutBaseDirectoryChange,
    onCheckoutDestinationChange,
    onCancelCheckoutHostProject,
    onCheckoutHostProject,
    toHostHealthClassName,
    normalizeHostDirectories,
    isHostVersionOutOfDate,
    deriveDestinationFolderFromRepositoryUrl,
    formatVersionWithProtocol,
    formatRuntimeDateTime,
  }), [
    addingHost,
    checkoutBaseDirectoryByHostId,
    checkoutDestinationByHostId,
    checkoutMutationBusyByHostId,
    checkoutRepoInputByHostId,
    deletingHostId,
    deriveDestinationFolderFromRepositoryUrl,
    directoryInputByHostId,
    directoryMutationBusyByHostId,
    formatRuntimeDateTime,
    formatVersionWithProtocol,
    hosts,
    hostsLoading,
    isHostVersionOutOfDate,
    isMasterSidebarSelected,
    manualHostIp,
    masterAgentInfo,
    masterConnectionHealthClass,
    masterConnectionStatus,
    normalizeHostDirectories,
    onAddHost,
    onAddHostDirectory,
    onCancelCheckoutHostProject,
    onCheckoutBaseDirectoryChange,
    onCheckoutDestinationChange,
    onCheckoutHostProject,
    onCheckoutRepositoryInputChange,
    onDeleteHost,
    onHostDirectoryInputChange,
    onRemoveHostDirectory,
    onSelectHost,
    onSelectMasterHost,
    onToggleAddHostRow,
    onToggleHostCheckoutRow,
    onToggleHostDirectoryRow,
    onUpgradeHostAgent,
    onViewManagedProcessLogs,
    onSoftKillObservedProcess,
    onHardKillObservedProcess,
    runtimeActionBusyByHostId,
    runtimeRegistryByHostId,
    runtimeRegistryLoadingByHostId,
    selectedHostId,
    setManualHostIp,
    showAddDirectoryRowByHostId,
    showAddHostRow,
    showCheckoutRowByHostId,
    slaveTargetVersion,
    toHostHealthClassName,
    upgradingHostId,
  ]);
}
