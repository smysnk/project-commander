import { useCallback } from 'react';
import { graphqlRequest } from '../../../lib/graphqlClient';
import { setHomeDomainField } from '../../../store';
import {
  MUTATION_SEND_HOST_TERMINAL_INPUT,
  MUTATION_START_HOST_TERMINAL_SESSION,
  QUERY_TERMINAL_SESSION,
} from '../graphql/documents';
import { MAX_TERMINAL_OUTPUT_ENTRIES } from '../constants/ui';
import { normalizeTerminalSession } from '../lib/homeUtils';
import terminalActionUtils from './terminalActionUtils.cjs';

const {
  normalizePositiveHostId,
  resolveTerminalSubmitRequest,
} = terminalActionUtils;

export const useTerminalActions = ({
  dispatch,
  graphqlEndpoint,
  selectedHostId,
  terminalInputByHostId,
  terminalStartingByHostId,
  terminalSendingByHostId,
  terminalSessionByHostId,
  terminalOutputBySessionId,
  setTerminalSessionByHostId,
  setTerminalOutputBySessionId,
  setError,
}) => {
  const loadTerminalSession = useCallback(async (hostId, endpoint) => {
    const parsedHostId = Number(hostId);
    if (!Number.isInteger(parsedHostId) || parsedHostId <= 0) {
      return null;
    }

    const data = await graphqlRequest({
      query: QUERY_TERMINAL_SESSION,
      variables: { hostId: parsedHostId },
      endpoint: endpoint || graphqlEndpoint,
    });
    const normalizedSession = normalizeTerminalSession(data?.terminalSession);
    setTerminalSessionByHostId({
      ...(terminalSessionByHostId || {}),
      [parsedHostId]: normalizedSession,
    });
    if (normalizedSession?.sessionId) {
      setTerminalOutputBySessionId({
        ...(terminalOutputBySessionId || {}),
        [normalizedSession.sessionId]: normalizedSession.status === 'closed'
          ? []
          : normalizedSession.output.slice(-MAX_TERMINAL_OUTPUT_ENTRIES),
      });
    }
    return normalizedSession;
  }, [
    graphqlEndpoint,
    setTerminalOutputBySessionId,
    setTerminalSessionByHostId,
    terminalOutputBySessionId,
    terminalSessionByHostId,
  ]);

  const startTerminalSessionForHost = useCallback(async (host) => {
    const hostId = Number(host?.id);
    if (!Number.isInteger(hostId) || hostId <= 0) {
      setError('Unable to start terminal session: invalid host id.');
      return null;
    }

    setError('');
    dispatch(setHomeDomainField('terminalStartingByHostId', {
      ...(terminalStartingByHostId || {}),
      [hostId]: true,
    }));
    try {
      const data = await graphqlRequest({
        query: MUTATION_START_HOST_TERMINAL_SESSION,
        variables: { hostId },
        endpoint: graphqlEndpoint,
      });
      const normalizedSession = normalizeTerminalSession(data?.startHostTerminalSession);
      if (!normalizedSession) {
        throw new Error('Unable to start terminal session.');
      }
      setTerminalSessionByHostId({
        ...(terminalSessionByHostId || {}),
        [hostId]: normalizedSession,
      });
      setTerminalOutputBySessionId({
        ...(terminalOutputBySessionId || {}),
        [normalizedSession.sessionId]: normalizedSession.status === 'closed'
          ? []
          : normalizedSession.output.slice(-MAX_TERMINAL_OUTPUT_ENTRIES),
      });
      dispatch(setHomeDomainField('terminalInputByHostId', {
        ...(terminalInputByHostId || {}),
        [hostId]: '',
      }));
      return normalizedSession;
    } catch (startError) {
      setError(startError.message || 'Unable to start terminal session');
      return null;
    } finally {
      dispatch(setHomeDomainField('terminalStartingByHostId', {
        ...(terminalStartingByHostId || {}),
        [hostId]: false,
      }));
    }
  }, [
    dispatch,
    graphqlEndpoint,
    setError,
    setTerminalOutputBySessionId,
    setTerminalSessionByHostId,
    terminalInputByHostId,
    terminalOutputBySessionId,
    terminalSessionByHostId,
    terminalStartingByHostId,
  ]);

  const sendTerminalInput = useCallback(async ({ sessionId, hostId, input }) => {
    const parsedHostId = normalizePositiveHostId(hostId);
    if (!parsedHostId) {
      setError('Unable to send terminal input: invalid host id.');
      return false;
    }
    const normalizedSessionId = String(sessionId || '').trim();
    if (!normalizedSessionId) {
      setError('No active terminal session.');
      return false;
    }

    setError('');
    dispatch(setHomeDomainField('terminalSendingByHostId', {
      ...(terminalSendingByHostId || {}),
      [parsedHostId]: true,
    }));
    try {
      await graphqlRequest({
        query: MUTATION_SEND_HOST_TERMINAL_INPUT,
        variables: {
          sessionId: normalizedSessionId,
          input: String(input || ''),
        },
        endpoint: graphqlEndpoint,
      });
      return true;
    } catch (sendError) {
      setError(sendError.message || 'Unable to send terminal input');
      return false;
    } finally {
      dispatch(setHomeDomainField('terminalSendingByHostId', {
        ...(terminalSendingByHostId || {}),
        [parsedHostId]: false,
      }));
    }
  }, [dispatch, graphqlEndpoint, setError, terminalSendingByHostId]);

  const onTerminalInputChange = useCallback((hostId, value) => {
    const parsedHostId = normalizePositiveHostId(hostId);
    if (!parsedHostId) {
      return;
    }
    dispatch(setHomeDomainField('terminalInputByHostId', {
      ...(terminalInputByHostId || {}),
      [parsedHostId]: String(value || ''),
    }));
  }, [dispatch, terminalInputByHostId]);

  const onSubmitTerminalInput = useCallback(async () => {
    const request = resolveTerminalSubmitRequest({
      selectedHostId,
      terminalSessionByHostId,
      terminalInputByHostId,
      normalizeSession: normalizeTerminalSession,
    });
    if (!request.ok) {
      setError(request.error);
      return;
    }
    const sent = await sendTerminalInput({
      hostId: request.hostId,
      sessionId: request.sessionId,
      input: request.input,
    });
    if (sent) {
      dispatch(setHomeDomainField('terminalInputByHostId', {
        ...(terminalInputByHostId || {}),
        [request.hostId]: '',
      }));
    }
  }, [
    dispatch,
    selectedHostId,
    sendTerminalInput,
    setError,
    terminalInputByHostId,
    terminalSessionByHostId,
  ]);

  return {
    loadTerminalSession,
    startTerminalSessionForHost,
    sendTerminalInput,
    onTerminalInputChange,
    onSubmitTerminalInput,
  };
};
