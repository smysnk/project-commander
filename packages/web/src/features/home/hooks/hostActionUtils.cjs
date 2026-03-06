function computeCheckoutDestinationState({
  inputValue,
  existingDestination,
  previousAutoDestination,
  deriveDestinationFolder,
} = {}) {
  const nextInputValue = String(inputValue || '');
  const derivedDestination = typeof deriveDestinationFolder === 'function'
    ? String(deriveDestinationFolder(nextInputValue) || '')
    : '';
  const normalizedExistingDestination = String(existingDestination || '');
  const normalizedPreviousAuto = String(previousAutoDestination || '');
  const nextDestination = (!normalizedExistingDestination || normalizedExistingDestination === normalizedPreviousAuto)
    ? derivedDestination
    : normalizedExistingDestination;
  return {
    nextInputValue,
    derivedDestination,
    nextDestination,
  };
}

module.exports = {
  computeCheckoutDestinationState,
};
