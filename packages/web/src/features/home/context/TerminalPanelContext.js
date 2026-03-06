import createRequiredContext from './createRequiredContext';

export const [TerminalPanelContext, useTerminalPanelContext] = createRequiredContext(
  'TerminalPanelContext',
  'Wrap component tree in TerminalPanelProvider.',
);

export function TerminalPanelProvider({ value, children }) {
  return (
    <TerminalPanelContext.Provider value={value}>
      {children}
    </TerminalPanelContext.Provider>
  );
}
