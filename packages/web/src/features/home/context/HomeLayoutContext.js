import createRequiredContext from './createRequiredContext';

export const [HomeLayoutContext, useHomeLayoutContext] = createRequiredContext(
  'HomeLayoutContext',
  'Wrap component tree in HomeLayoutProvider.',
);

export function HomeLayoutProvider({ value, children }) {
  return (
    <HomeLayoutContext.Provider value={value}>
      {children}
    </HomeLayoutContext.Provider>
  );
}
