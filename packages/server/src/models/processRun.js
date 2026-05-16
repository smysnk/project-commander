const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../db');

class ProcessRun extends Model {}

const dialect = sequelize.getDialect();
const isPostgres = dialect === 'postgres';
const isSqlite = dialect === 'sqlite';
const structuredDataType = isPostgres ? DataTypes.JSONB : (isSqlite ? DataTypes.TEXT : DataTypes.JSON);

const parseArgsValue = (raw) => {
  if (Array.isArray(raw)) {
    return raw;
  }
  if (typeof raw === 'string' && raw.length > 0) {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
};

ProcessRun.init(
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    runId: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
      field: 'run_id',
    },
    desiredProcessId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: 'desired_process_id',
    },
    hostId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: 'host_id',
    },
    projectId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: 'project_id',
    },
    serviceId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: 'service_id',
    },
    packageKey: {
      type: DataTypes.STRING,
      allowNull: false,
      field: 'package_key',
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
    pid: {
      type: DataTypes.BIGINT,
      allowNull: false,
    },
    pgid: {
      type: DataTypes.BIGINT,
      allowNull: true,
    },
    launchFingerprint: {
      type: DataTypes.STRING,
      allowNull: true,
      field: 'launch_fingerprint',
    },
    command: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    argsJson: {
      type: structuredDataType,
      allowNull: false,
      field: 'args_json',
      defaultValue: isSqlite ? '[]' : [],
      get() {
        return parseArgsValue(this.getDataValue('argsJson'));
      },
      set(value) {
        const normalized = Array.isArray(value) ? value : [];
        if (isSqlite) {
          this.setDataValue('argsJson', JSON.stringify(normalized));
          return;
        }
        this.setDataValue('argsJson', normalized);
      },
    },
    cwd: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    envHash: {
      type: DataTypes.STRING,
      allowNull: true,
      field: 'env_hash',
    },
    status: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'starting',
    },
    startedAt: {
      type: DataTypes.DATE,
      allowNull: false,
      field: 'started_at',
      defaultValue: DataTypes.NOW,
    },
    lastSeenAt: {
      type: DataTypes.DATE,
      allowNull: false,
      field: 'last_seen_at',
      defaultValue: DataTypes.NOW,
    },
    exitedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'exited_at',
    },
    exitCode: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: 'exit_code',
    },
    exitSignal: {
      type: DataTypes.STRING,
      allowNull: true,
      field: 'exit_signal',
    },
    logPath: {
      type: DataTypes.STRING,
      allowNull: true,
      field: 'log_path',
    },
    adopted: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    reconciliationSource: {
      type: DataTypes.STRING,
      allowNull: true,
      field: 'reconciliation_source',
    },
  },
  {
    sequelize,
    modelName: 'ProcessRun',
    tableName: 'process_runs',
    underscored: true,
    indexes: [
      {
        unique: true,
        fields: ['run_id'],
      },
      {
        unique: true,
        fields: ['host_id', 'boot_id', 'pid', 'launch_fingerprint', 'started_at'],
      },
      {
        fields: ['desired_process_id'],
      },
      {
        fields: ['host_id'],
      },
      {
        fields: ['project_id'],
      },
      {
        fields: ['slave_id'],
      },
    ],
  },
);

module.exports = {
  ProcessRun,
};
