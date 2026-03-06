import createRequiredContext from './createRequiredContext';

export const [StatusBarContext, useStatusBarContext] = createRequiredContext(
  'StatusBarContext',
  'Wrap component tree in StatusBarProvider.',
);

export function StatusBarProvider({ value, children }) {
  return (
    <StatusBarContext.Provider value={value}>
      {children}
    </StatusBarContext.Provider>
  );
}
