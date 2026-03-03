const { Project } = require('./project');
const { Service } = require('./service');
const { Technology } = require('./technology');
const { PortRange } = require('./portRange');

const initModelAssociations = () => {
  Project.hasMany(Service, {
    as: 'services',
    foreignKey: 'projectId',
  });
  Service.belongsTo(Project, {
    as: 'project',
    foreignKey: 'projectId',
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
  Service,
  Technology,
  PortRange,
  initModelAssociations,
};
