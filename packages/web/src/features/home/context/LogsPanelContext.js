import createRequiredContext from './createRequiredContext';

export const [LogsPanelContext, useLogsPanelContext] = createRequiredContext(
  'LogsPanelContext',
  'Wrap component tree in LogsPanelProvider.',
);

export function LogsPanelProvider({ value, children }) {
  return (
    <LogsPanelContext.Provider value={value}>
      {children}
    </LogsPanelContext.Provider>
  );
}
