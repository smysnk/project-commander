const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../db');

class HostRuntimeState extends Model {}

HostRuntimeState.init(
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    hostId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      unique: true,
      field: 'host_id',
    },
    slaveId: {
      type: DataTypes.STRING,
      allowNull: false,
      field: 'slave_id',
    },
    bootId: {
      type: DataTypes.STRING,
      allowNull: true,
      field: 'boot_id',
    },
    sampledAt: {
      type: DataTypes.DATE,
      allowNull: false,
      field: 'sampled_at',
      defaultValue: DataTypes.NOW,
    },
    cpuPercent: {
      type: DataTypes.DOUBLE,
      allowNull: false,
      defaultValue: 0,
      field: 'cpu_percent',
    },
    load1m: {
      type: DataTypes.DOUBLE,
      allowNull: true,
      field: 'load_1m',
    },
    load5m: {
      type: DataTypes.DOUBLE,
      allowNull: true,
      field: 'load_5m',
    },
    load15m: {
      type: DataTypes.DOUBLE,
      allowNull: true,
      field: 'load_15m',
    },
    memoryTotalBytes: {
      type: DataTypes.BIGINT,
      allowNull: false,
      defaultValue: 0,
      field: 'memory_total_bytes',
    },
    memoryUsedBytes: {
      type: DataTypes.BIGINT,
      allowNull: false,
      defaultValue: 0,
      field: 'memory_used_bytes',
    },
    memoryAvailableBytes: {
      type: DataTypes.BIGINT,
      allowNull: false,
      defaultValue: 0,
      field: 'memory_available_bytes',
    },
    diskTotalBytes: {
      type: DataTypes.BIGINT,
      allowNull: false,
      defaultValue: 0,
      field: 'disk_total_bytes',
    },
    diskUsedBytes: {
      type: DataTypes.BIGINT,
      allowNull: false,
      defaultValue: 0,
      field: 'disk_used_bytes',
    },
    diskAvailableBytes: {
      type: DataTypes.BIGINT,
      allowNull: false,
      defaultValue: 0,
      field: 'disk_available_bytes',
    },
    diskMount: {
      type: DataTypes.STRING,
      allowNull: true,
      field: 'disk_mount',
    },
  },
  {
    sequelize,
    modelName: 'HostRuntimeState',
    tableName: 'host_runtime_state',
    underscored: true,
    indexes: [
      {
        unique: true,
        fields: ['host_id'],
      },
      {
        fields: ['sampled_at'],
      },
    ],
  },
);

module.exports = {
  HostRuntimeState,
};
