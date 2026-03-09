const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../db');

class ProcessRuntimeState extends Model {}

ProcessRuntimeState.init(
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    processRunId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      unique: true,
      field: 'process_run_id',
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
    memoryPercent: {
      type: DataTypes.DOUBLE,
      allowNull: false,
      defaultValue: 0,
      field: 'memory_percent',
    },
    rssBytes: {
      type: DataTypes.BIGINT,
      allowNull: false,
      defaultValue: 0,
      field: 'rss_bytes',
    },
    vmsBytes: {
      type: DataTypes.BIGINT,
      allowNull: false,
      defaultValue: 0,
      field: 'vms_bytes',
    },
    readBytes: {
      type: DataTypes.BIGINT,
      allowNull: false,
      defaultValue: 0,
      field: 'read_bytes',
    },
    writeBytes: {
      type: DataTypes.BIGINT,
      allowNull: false,
      defaultValue: 0,
      field: 'write_bytes',
    },
    readOps: {
      type: DataTypes.BIGINT,
      allowNull: false,
      defaultValue: 0,
      field: 'read_ops',
    },
    writeOps: {
      type: DataTypes.BIGINT,
      allowNull: false,
      defaultValue: 0,
      field: 'write_ops',
    },
    openFds: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: 'open_fds',
    },
    threadCount: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: 'thread_count',
    },
    status: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'unknown',
    },
  },
  {
    sequelize,
    modelName: 'ProcessRuntimeState',
    tableName: 'process_runtime_state',
    underscored: true,
    indexes: [
      {
        unique: true,
        fields: ['process_run_id'],
      },
      {
        fields: ['sampled_at'],
      },
    ],
  },
);

module.exports = {
  ProcessRuntimeState,
};
