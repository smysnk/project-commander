module.exports = {
  up: async (queryInterface, Sequelize) => {
    const dialect = queryInterface.sequelize.getDialect();
    const structuredDataType = dialect === 'postgres'
      ? Sequelize.JSONB
      : (dialect === 'sqlite' ? Sequelize.TEXT : Sequelize.JSON);

    await queryInterface.createTable('desired_processes', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      process_key: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      host_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'hosts',
          key: 'id',
        },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      project_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'projects',
          key: 'id',
        },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      service_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'services',
          key: 'id',
        },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      package_key: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      package_relative_path: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      desired_state: {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: 'running',
      },
      launch_mode: {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: 'exec',
      },
      cwd: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      command: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      args_json: {
        type: structuredDataType,
        allowNull: false,
        defaultValue: dialect === 'sqlite' ? '[]' : [],
      },
      env_json: {
        type: structuredDataType,
        allowNull: false,
        defaultValue: dialect === 'sqlite' ? '{}' : {},
      },
      env_hash: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      launch_fingerprint: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      log_root: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      restart_policy: {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: 'manual',
      },
      created_by: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      updated_by: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      created_at: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      updated_at: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    await queryInterface.addIndex('desired_processes', ['host_id', 'project_id', 'package_key'], { unique: true });
    await queryInterface.addIndex('desired_processes', ['process_key']);
    await queryInterface.addIndex('desired_processes', ['host_id']);
    await queryInterface.addIndex('desired_processes', ['project_id']);

    await queryInterface.createTable('process_runs', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      run_id: {
        type: Sequelize.STRING,
        allowNull: false,
        unique: true,
      },
      desired_process_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'desired_processes',
          key: 'id',
        },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      host_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'hosts',
          key: 'id',
        },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      project_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'projects',
          key: 'id',
        },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      service_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'services',
          key: 'id',
        },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      package_key: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      slave_id: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      boot_id: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      pid: {
        type: Sequelize.BIGINT,
        allowNull: false,
      },
      pgid: {
        type: Sequelize.BIGINT,
        allowNull: true,
      },
      launch_fingerprint: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      command: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      args_json: {
        type: structuredDataType,
        allowNull: false,
        defaultValue: dialect === 'sqlite' ? '[]' : [],
      },
      cwd: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      env_hash: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      status: {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: 'starting',
      },
      started_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      last_seen_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      exited_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      exit_code: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      exit_signal: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      log_path: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      adopted: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      reconciliation_source: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      created_at: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      updated_at: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    await queryInterface.addIndex('process_runs', ['run_id'], { unique: true });
    await queryInterface.addIndex(
      'process_runs',
      ['host_id', 'boot_id', 'pid', 'launch_fingerprint', 'started_at'],
      { unique: true },
    );
    await queryInterface.addIndex('process_runs', ['desired_process_id']);
    await queryInterface.addIndex('process_runs', ['host_id']);
    await queryInterface.addIndex('process_runs', ['project_id']);
    await queryInterface.addIndex('process_runs', ['slave_id']);

    await queryInterface.createTable('process_runtime_state', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      process_run_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        unique: true,
        references: {
          model: 'process_runs',
          key: 'id',
        },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      sampled_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      cpu_percent: {
        type: Sequelize.DOUBLE,
        allowNull: false,
        defaultValue: 0,
      },
      memory_percent: {
        type: Sequelize.DOUBLE,
        allowNull: false,
        defaultValue: 0,
      },
      rss_bytes: {
        type: Sequelize.BIGINT,
        allowNull: false,
        defaultValue: 0,
      },
      vms_bytes: {
        type: Sequelize.BIGINT,
        allowNull: false,
        defaultValue: 0,
      },
      read_bytes: {
        type: Sequelize.BIGINT,
        allowNull: false,
        defaultValue: 0,
      },
      write_bytes: {
        type: Sequelize.BIGINT,
        allowNull: false,
        defaultValue: 0,
      },
      read_ops: {
        type: Sequelize.BIGINT,
        allowNull: false,
        defaultValue: 0,
      },
      write_ops: {
        type: Sequelize.BIGINT,
        allowNull: false,
        defaultValue: 0,
      },
      open_fds: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      thread_count: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      status: {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: 'unknown',
      },
      created_at: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      updated_at: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    await queryInterface.addIndex('process_runtime_state', ['process_run_id'], { unique: true });
    await queryInterface.addIndex('process_runtime_state', ['sampled_at']);

    await queryInterface.createTable('host_runtime_state', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      host_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        unique: true,
        references: {
          model: 'hosts',
          key: 'id',
        },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      slave_id: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      boot_id: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      sampled_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      cpu_percent: {
        type: Sequelize.DOUBLE,
        allowNull: false,
        defaultValue: 0,
      },
      load_1m: {
        type: Sequelize.DOUBLE,
        allowNull: true,
      },
      load_5m: {
        type: Sequelize.DOUBLE,
        allowNull: true,
      },
      load_15m: {
        type: Sequelize.DOUBLE,
        allowNull: true,
      },
      memory_total_bytes: {
        type: Sequelize.BIGINT,
        allowNull: false,
        defaultValue: 0,
      },
      memory_used_bytes: {
        type: Sequelize.BIGINT,
        allowNull: false,
        defaultValue: 0,
      },
      memory_available_bytes: {
        type: Sequelize.BIGINT,
        allowNull: false,
        defaultValue: 0,
      },
      disk_total_bytes: {
        type: Sequelize.BIGINT,
        allowNull: false,
        defaultValue: 0,
      },
      disk_used_bytes: {
        type: Sequelize.BIGINT,
        allowNull: false,
        defaultValue: 0,
      },
      disk_available_bytes: {
        type: Sequelize.BIGINT,
        allowNull: false,
        defaultValue: 0,
      },
      disk_mount: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      created_at: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      updated_at: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    await queryInterface.addIndex('host_runtime_state', ['host_id'], { unique: true });
    await queryInterface.addIndex('host_runtime_state', ['sampled_at']);
  },
};
