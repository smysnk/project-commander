const { Project } = require('./project');
const { Service } = require('./service');
const { Technology } = require('./technology');
const { PortRange } = require('./portRange');
const { Host } = require('./host');
const { DesiredProcess } = require('./desiredProcess');
const { ProcessRun } = require('./processRun');
const { ProcessRuntimeState } = require('./processRuntimeState');
const { HostRuntimeState } = require('./hostRuntimeState');

const initModelAssociations = () => {
  Host.hasMany(Project, {
    as: 'projects',
    foreignKey: 'hostId',
  });
  Project.belongsTo(Host, {
    as: 'host',
    foreignKey: 'hostId',
  });

  Host.hasMany(DesiredProcess, {
    as: 'desiredProcesses',
    foreignKey: 'hostId',
  });
  DesiredProcess.belongsTo(Host, {
    as: 'host',
    foreignKey: 'hostId',
  });

  Host.hasOne(HostRuntimeState, {
    as: 'runtimeState',
    foreignKey: 'hostId',
  });
  HostRuntimeState.belongsTo(Host, {
    as: 'host',
    foreignKey: 'hostId',
  });

  Project.hasMany(Service, {
    as: 'services',
    foreignKey: 'projectId',
  });
  Service.belongsTo(Project, {
    as: 'project',
    foreignKey: 'projectId',
  });

  Project.hasMany(DesiredProcess, {
    as: 'desiredProcesses',
    foreignKey: 'projectId',
  });
  DesiredProcess.belongsTo(Project, {
    as: 'project',
    foreignKey: 'projectId',
  });

  Project.hasMany(ProcessRun, {
    as: 'processRuns',
    foreignKey: 'projectId',
  });
  ProcessRun.belongsTo(Project, {
    as: 'project',
    foreignKey: 'projectId',
  });

  Service.hasMany(DesiredProcess, {
    as: 'desiredProcesses',
    foreignKey: 'serviceId',
  });
  DesiredProcess.belongsTo(Service, {
    as: 'service',
    foreignKey: 'serviceId',
  });

  Service.hasMany(ProcessRun, {
    as: 'processRuns',
    foreignKey: 'serviceId',
  });
  ProcessRun.belongsTo(Service, {
    as: 'service',
    foreignKey: 'serviceId',
  });

  DesiredProcess.hasMany(ProcessRun, {
    as: 'runs',
    foreignKey: 'desiredProcessId',
  });
  ProcessRun.belongsTo(DesiredProcess, {
    as: 'desiredProcess',
    foreignKey: 'desiredProcessId',
  });

  ProcessRun.hasOne(ProcessRuntimeState, {
    as: 'runtimeState',
    foreignKey: 'processRunId',
  });
  ProcessRuntimeState.belongsTo(ProcessRun, {
    as: 'processRun',
    foreignKey: 'processRunId',
  });

  Project.hasOne(PortRange, {
    as: 'portRange',
    foreignKey: 'projectId',
  });
  PortRange.belongsTo(Project, {
    as: 'project',
    foreignKey: 'projectId',
  });

  Project.belongsToMany(Technology, {
    as: 'technologies',
    through: 'project_technologies',
    foreignKey: 'project_id',
    otherKey: 'technology_id',
  });
  Technology.belongsToMany(Project, {
    as: 'projects',
    through: 'project_technologies',
    foreignKey: 'technology_id',
    otherKey: 'project_id',
  });
};

module.exports = {
  Project,
  Host,
  Service,
  DesiredProcess,
  ProcessRun,
  ProcessRuntimeState,
  HostRuntimeState,
  Technology,
  PortRange,
  initModelAssociations,
};
