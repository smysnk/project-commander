const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../db');

class HostSshKeyConfig extends Model {}

HostSshKeyConfig.init(
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
    keyName: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'default',
      field: 'key_name',
    },
    privateKey: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: 'private_key',
    },
    publicKey: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: 'public_key',
    },
    passphrase: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    knownHosts: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: 'known_hosts',
    },
    strictHostKeyChecking: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
      field: 'strict_host_key_checking',
    },
    fingerprint: {
      type: DataTypes.STRING,
      allowNull: true,
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
    modelName: 'HostSshKeyConfig',
    tableName: 'host_ssh_key_configs',
    underscored: true,
    indexes: [
      {
        unique: true,
        fields: ['host_id', 'key_name'],
      },
      {
        fields: ['agent_uuid'],
      },
    ],
  },
);

module.exports = {
  HostSshKeyConfig,
};
