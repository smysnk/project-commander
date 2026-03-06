import {
  selectHomeDomain,
  selectHomeTerminalOutputBySessionId,
  selectHomeTerminalSessionsByHostId,
} from './homeDomainSelectors';
import { selectSelectedHostNumericId } from './hostSelectors';
const EMPTY_ARRAY = Object.freeze([]);
const EMPTY_OBJECT = Object.freeze({});

export const selectTerminalSessionsByHostId = (state) => selectHomeTerminalSessionsByHostId(state);

export const selectTerminalOutputBySessionId = (state) => selectHomeTerminalOutputBySessionId(state);

export const selectTerminalInputByHostId = (state) => {
  const inputByHostId = selectHomeDomain(state)?.terminalInputByHostId;
  return inputByHostId && typeof inputByHostId === 'object' ? inputByHostId : EMPTY_OBJECT;
};

export const selectTerminalStartingByHostId = (state) => {
  const startingByHostId = selectHomeDomain(state)?.terminalStartingByHostId;
  return startingByHostId && typeof startingByHostId === 'object' ? startingByHostId : EMPTY_OBJECT;
};

export const selectTerminalSendingByHostId = (state) => {
  const sendingByHostId = selectHomeDomain(state)?.terminalSendingByHostId;
  return sendingByHostId && typeof sendingByHostId === 'object' ? sendingByHostId : EMPTY_OBJECT;
};

export const selectSelectedTerminalSession = (state) => {
  const selectedHostId = selectSelectedHostNumericId(state);
  if (!selectedHostId) {
    return null;
  }
  const session = selectTerminalSessionsByHostId(state)?.[selectedHostId];
  return session && typeof session === 'object' ? session : null;
};

export const selectSelectedTerminalOutput = (state) => {
  const sessionId = selectSelectedTerminalSession(state)?.sessionId;
  if (!sessionId) {
    return EMPTY_ARRAY;
  }
  const output = selectTerminalOutputBySessionId(state)?.[sessionId];
  return Array.isArray(output) ? output : EMPTY_ARRAY;
};

export const selectSelectedHostTerminalInput = (state) => {
  const selectedHostId = selectSelectedHostNumericId(state);
  if (!selectedHostId) {
    return '';
  }
  return String(selectTerminalInputByHostId(state)?.[selectedHostId] || '');
};

export const selectSelectedHostTerminalStarting = (state) => {
  const selectedHostId = selectSelectedHostNumericId(state);
  if (!selectedHostId) {
    return false;
  }
  return Boolean(selectTerminalStartingByHostId(state)?.[selectedHostId]);
};

export const selectSelectedHostTerminalSending = (state) => {
  const selectedHostId = selectSelectedHostNumericId(state);
  if (!selectedHostId) {
    return false;
  }
  return Boolean(selectTerminalSendingByHostId(state)?.[selectedHostId]);
};
