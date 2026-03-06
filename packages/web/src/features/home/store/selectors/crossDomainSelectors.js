import { LEFT_PANEL_MODE } from '../../constants/ui';
import { selectSelectedHost, selectIsMasterSidebarSelected } from './hostSelectors';
import { selectLeftPanelMode } from './layoutSelectors';
import { selectSelectedProject, selectSelectedProjectPath } from './projectSelectors';

export const selectIsProjectLogContext = (state) => (
  selectLeftPanelMode(state) === LEFT_PANEL_MODE.PROJECTS
);

export const selectIsMasterLogContext = (state) => (
  selectLeftPanelMode(state) !== LEFT_PANEL_MODE.PROJECTS && selectIsMasterSidebarSelected(state)
);

export const selectIsHostLogContext = (state) => (
  selectLeftPanelMode(state) !== LEFT_PANEL_MODE.PROJECTS
  && !selectIsMasterLogContext(state)
  && selectSelectedHost(state) != null
);

export const selectIsRuntimeLogContext = (state) => (
  selectLeftPanelMode(state) !== LEFT_PANEL_MODE.PROJECTS
  && !selectIsMasterLogContext(state)
  && !selectIsHostLogContext(state)
);

let lastLogContextDescriptorInput = null;
let lastLogContextDescriptorResult = null;

export const selectLogContextDescriptorInput = (state) => {
  const nextInput = {
    isProjectLogContext: selectIsProjectLogContext(state),
    selectedProjectPath: selectSelectedProjectPath(state),
    isMasterLogContext: selectIsMasterLogContext(state),
    isHostLogContext: selectIsHostLogContext(state),
    selectedHost: selectSelectedHost(state),
  };

  if (
    lastLogContextDescriptorInput &&
    lastLogContextDescriptorInput.isProjectLogContext === nextInput.isProjectLogContext &&
    lastLogContextDescriptorInput.selectedProjectPath === nextInput.selectedProjectPath &&
    lastLogContextDescriptorInput.isMasterLogContext === nextInput.isMasterLogContext &&
    lastLogContextDescriptorInput.isHostLogContext === nextInput.isHostLogContext &&
    lastLogContextDescriptorInput.selectedHost === nextInput.selectedHost
  ) {
    return lastLogContextDescriptorResult;
  }

  lastLogContextDescriptorInput = nextInput;
  lastLogContextDescriptorResult = nextInput;
  return nextInput;
};

export const selectStatusBarSelectedProject = (state) => selectSelectedProject(state);
