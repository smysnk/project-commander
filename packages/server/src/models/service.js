const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../db');

class Service extends Model {}

Service.init(
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    kind: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    port: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    processId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: 'process_id',
      // Legacy compatibility field. Runtime process identity now belongs in
      // desired_processes/process_runs rather than the service row itself.
    },
    relativePath: {
      type: DataTypes.STRING,
      allowNull: true,
      field: 'relative_path',
    },
    language: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    commands: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: [],
    },
    envVarNames: {
      type: DataTypes.JSON,
      allowNull: false,
      field: 'env_var_names',
      defaultValue: [],
    },
    envFiles: {
      type: DataTypes.JSON,
      allowNull: false,
      field: 'env_files',
      defaultValue: [],
    },
    hasMakefile: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      field: 'has_makefile',
      defaultValue: false,
    },
    hasPackageJson: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      field: 'has_package_json',
      defaultValue: false,
    },
    projectId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: 'project_id',
    },
  },
  {
    sequelize,
    modelName: 'Service',
    tableName: 'services',
    underscored: true,
    indexes: [
      {
        fields: ['project_id'],
      },
    ],
  },
);

module.exports = {
  Service,
};
