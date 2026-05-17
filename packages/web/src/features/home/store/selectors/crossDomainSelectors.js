import { WORKSPACE_PANEL } from '../../constants/ui';
import { selectSelectedHost, selectIsMasterSidebarSelected } from './hostSelectors';
import { selectActiveWorkspacePanel } from './layoutSelectors';
import { selectSelectedProject, selectSelectedProjectPath } from './projectSelectors';

const selectIsLogsWorkspacePanelActive = (state) => (
  selectActiveWorkspacePanel(state) === WORKSPACE_PANEL.LOGS
);

export const selectIsProjectLogContext = (state) => (
  selectIsLogsWorkspacePanelActive(state)
  && !selectIsMasterSidebarSelected(state)
  && selectSelectedHost(state) == null
  && Boolean(selectSelectedProjectPath(state))
);

export const selectIsMasterLogContext = (state) => (
  selectIsLogsWorkspacePanelActive(state) && selectIsMasterSidebarSelected(state)
);

export const selectIsHostLogContext = (state) => (
  selectIsLogsWorkspacePanelActive(state)
  && !selectIsMasterLogContext(state)
  && selectSelectedHost(state) != null
);

export const selectIsRuntimeLogContext = (state) => (
  selectIsLogsWorkspacePanelActive(state)
  && !selectIsProjectLogContext(state)
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
