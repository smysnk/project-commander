'use client';

export default function TagChip({
  children,
  className = '',
  title = undefined,
  style = undefined,
  align = 'left',
  fullWidth = false,
}) {
  const normalizedAlign = align === 'center' ? 'center' : 'left';
  const combinedClassName = `tagChip tagChip--${normalizedAlign} ${fullWidth ? 'tagChip--fullWidth' : ''} ${className}`.trim();

  return (
    <span className={combinedClassName} title={title} style={style}>
      {children}
    </span>
  );
}
