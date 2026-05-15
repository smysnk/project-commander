const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../db');

class HostPathMapping extends Model {}

HostPathMapping.init(
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    hostId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: 'host_id',
    },
    agentUuid: {
      type: DataTypes.STRING,
      allowNull: true,
      field: 'agent_uuid',
    },
    logicalRoot: {
      type: DataTypes.STRING,
      allowNull: true,
      field: 'logical_root',
    },
    codexPathPrefix: {
      type: DataTypes.STRING,
      allowNull: false,
      field: 'codex_path_prefix',
    },
    hostPathPrefix: {
      type: DataTypes.STRING,
      allowNull: false,
      field: 'host_path_prefix',
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    enabled: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    createdBy: {
      type: DataTypes.STRING,
      allowNull: true,
      field: 'created_by',
    },
    updatedBy: {
      type: DataTypes.STRING,
      allowNull: true,
      field: 'updated_by',
    },
  },
  {
    sequelize,
    modelName: 'HostPathMapping',
    tableName: 'host_path_mappings',
    underscored: true,
    indexes: [
      {
        unique: true,
        fields: ['host_id', 'codex_path_prefix', 'host_path_prefix'],
      },
      {
        fields: ['agent_uuid'],
      },
      {
        fields: ['host_id', 'enabled'],
      },
    ],
  },
);

module.exports = {
  HostPathMapping,
};
