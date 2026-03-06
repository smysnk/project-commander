import createRequiredContext from './createRequiredContext';

export const [DebugPanelContext, useDebugPanelContext] = createRequiredContext(
  'DebugPanelContext',
  'Wrap component tree in DebugPanelProvider.',
);

export function DebugPanelProvider({ value, children }) {
  return (
    <DebugPanelContext.Provider value={value}>
      {children}
    </DebugPanelContext.Provider>
  );
}
