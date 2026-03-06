const isTreeExpandable = (value) => Boolean(value) && typeof value === 'object';

export default function DebugTreeNode({
  name,
  value,
  path,
  expandedPaths,
  togglePath,
}) {
  const expandable = isTreeExpandable(value);
  const isExpanded = expandable ? expandedPaths.has(path) : false;
  const isArray = Array.isArray(value);
  const entries = expandable
    ? (isArray ? value.map((item, index) => [String(index), item]) : Object.entries(value))
    : [];

  const summary = isArray ? `Array(${value.length})` : `Object(${entries.length})`;

  return (
    <div className="debugNode">
      <div className="debugNodeRow">
        {expandable ? (
          <button
            type="button"
            className="debugToggle"
            onClick={() => togglePath(path)}
            aria-label={isExpanded ? `Collapse ${name}` : `Expand ${name}`}
          >
            {isExpanded ? '▾' : '▸'}
          </button>
        ) : (
          <span className="debugSpacer" />
        )}
        <span className="debugKey">{name}</span>
        <span className="debugColon">:</span>
        {expandable ? (
          <span className="debugMeta">{summary}</span>
        ) : (
          <span className="debugValue">{JSON.stringify(value)}</span>
        )}
      </div>
      {expandable && isExpanded ? (
        <div className="debugChildren">
          {entries.map(([childKey, childValue]) => {
            const childPath = path ? `${path}.${childKey}` : childKey;
            return (
              <DebugTreeNode
                key={childPath}
                name={childKey}
                value={childValue}
                path={childPath}
                expandedPaths={expandedPaths}
                togglePath={togglePath}
              />
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
