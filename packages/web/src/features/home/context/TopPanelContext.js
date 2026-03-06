import createRequiredContext from './createRequiredContext';

export const [TopPanelContext, useTopPanelContext] = createRequiredContext(
  'TopPanelContext',
  'Wrap component tree in TopPanelProvider.',
);

export function TopPanelProvider({ value, children }) {
  return (
    <TopPanelContext.Provider value={value}>
      {children}
    </TopPanelContext.Provider>
  );
}
