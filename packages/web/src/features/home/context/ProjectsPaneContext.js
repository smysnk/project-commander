import createRequiredContext from './createRequiredContext';

export const [ProjectsPaneContext, useProjectsPaneContext] = createRequiredContext(
  'ProjectsPaneContext',
  'Wrap component tree in ProjectsPaneProvider.',
);

export function ProjectsPaneProvider({ value, children }) {
  return (
    <ProjectsPaneContext.Provider value={value}>
      {children}
    </ProjectsPaneContext.Provider>
  );
}
