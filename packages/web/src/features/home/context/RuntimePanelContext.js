import createRequiredContext from './createRequiredContext';

export const [RuntimePanelContext, useRuntimePanelContext] = createRequiredContext(
  'RuntimePanelContext',
  'Wrap component tree in RuntimePanelProvider.',
);

export function RuntimePanelProvider({ value, children }) {
  return (
    <RuntimePanelContext.Provider value={value}>
      {children}
    </RuntimePanelContext.Provider>
  );
}
