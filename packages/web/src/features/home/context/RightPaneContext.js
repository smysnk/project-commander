import createRequiredContext from './createRequiredContext';

export const [RightPaneContext, useRightPaneContext] = createRequiredContext(
  'RightPaneContext',
  'Wrap component tree in RightPaneProvider.',
);

export function RightPaneProvider({ value, children }) {
  return (
    <RightPaneContext.Provider value={value}>
      {children}
    </RightPaneContext.Provider>
  );
}
