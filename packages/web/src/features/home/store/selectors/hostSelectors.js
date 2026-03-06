import { MASTER_AGENT_SIDEBAR_ID } from '../../constants/ui';
import { selectHomeDomain, selectHomeHosts, selectHomeHostsLoading } from './homeDomainSelectors';

const EMPTY_OBJECT = Object.freeze({});

export const selectHosts = (state) => selectHomeHosts(state);

export const selectHostsLoading = (state) => selectHomeHostsLoading(state);

export const selectSelectedHostId = (state) => state?.uiInteractions?.selectedHostId ?? null;

export const selectIsMasterSidebarSelected = (state) => (
  selectSelectedHostId(state) === MASTER_AGENT_SIDEBAR_ID
);

export const selectSelectedHost = (state) => {
  const selectedHostId = Number(selectSelectedHostId(state));
  if (!Number.isInteger(selectedHostId) || selectedHostId <= 0) {
    return null;
  }
  return selectHosts(state).find((host) => Number(host?.id) === selectedHostId) || null;
};

export const selectSelectedHostNumericId = (state) => {
  const selectedHostId = Number(selectSelectedHostId(state));
  return Number.isInteger(selectedHostId) && selectedHostId > 0 ? selectedHostId : null;
};

export const selectShowAddHostRow = (state) => Boolean(selectHomeDomain(state)?.showAddHostRow);

export const selectManualHostIp = (state) => String(selectHomeDomain(state)?.manualHostIp || '');

export const selectAddingHost = (state) => Boolean(selectHomeDomain(state)?.addingHost);

export const selectDeletingHostId = (state) => selectHomeDomain(state)?.deletingHostId ?? null;

export const selectUpgradingHostId = (state) => selectHomeDomain(state)?.upgradingHostId ?? null;

export const selectShowAddDirectoryRowByHostId = (state) => {
  const map = selectHomeDomain(state)?.showAddDirectoryRowByHostId;
  return map && typeof map === 'object' ? map : EMPTY_OBJECT;
};

export const selectDirectoryInputByHostId = (state) => {
  const map = selectHomeDomain(state)?.directoryInputByHostId;
  return map && typeof map === 'object' ? map : EMPTY_OBJECT;
};

export const selectDirectoryMutationBusyByHostId = (state) => {
  const map = selectHomeDomain(state)?.directoryMutationBusyByHostId;
  return map && typeof map === 'object' ? map : EMPTY_OBJECT;
};

export const selectShowCheckoutRowByHostId = (state) => {
  const map = selectHomeDomain(state)?.showCheckoutRowByHostId;
  return map && typeof map === 'object' ? map : EMPTY_OBJECT;
};

export const selectCheckoutRepoInputByHostId = (state) => {
  const map = selectHomeDomain(state)?.checkoutRepoInputByHostId;
  return map && typeof map === 'object' ? map : EMPTY_OBJECT;
};

export const selectCheckoutBaseDirectoryByHostId = (state) => {
  const map = selectHomeDomain(state)?.checkoutBaseDirectoryByHostId;
  return map && typeof map === 'object' ? map : EMPTY_OBJECT;
};

export const selectCheckoutDestinationByHostId = (state) => {
  const map = selectHomeDomain(state)?.checkoutDestinationByHostId;
  return map && typeof map === 'object' ? map : EMPTY_OBJECT;
};

export const selectCheckoutAutoDestinationByHostId = (state) => {
  const map = selectHomeDomain(state)?.checkoutAutoDestinationByHostId;
  return map && typeof map === 'object' ? map : EMPTY_OBJECT;
};

export const selectCheckoutMutationBusyByHostId = (state) => {
  const map = selectHomeDomain(state)?.checkoutMutationBusyByHostId;
  return map && typeof map === 'object' ? map : EMPTY_OBJECT;
};
