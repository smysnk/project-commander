const removeIndexIfExists = async (queryInterface, tableName, indexNameOrFields) => {
  try {
    await queryInterface.removeIndex(tableName, indexNameOrFields);
  } catch {
    // Index names differ by dialect/version; absence is safe during additive migration.
  }
};

const rebuildSqliteDesiredProcessesWithoutPackageUnique = async (queryInterface) => {
  const sequelize = queryInterface.sequelize;

  // Earlier SQLite changeColumn migrations folded the old composite unique index
  // into a table-level UNIQUE(package_key) constraint. SQLite cannot drop that
  // constraint directly, so rebuild the table before adding deployment indexes.
  await sequelize.query('PRAGMA foreign_keys = OFF');
  try {
    await sequelize.query('DROP TABLE IF EXISTS desired_processes_rebuild');
    await sequelize.query(`
      CREATE TABLE desired_processes_rebuild (
        id INTEGER PRIMARY KEY,
        process_key VARCHAR(255) NOT NULL,
        host_id INTEGER NOT NULL REFERENCES hosts(id) ON DELETE CASCADE ON UPDATE CASCADE,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE ON UPDATE CASCADE,
        service_id INTEGER REFERENCES services(id) ON DELETE SET NULL ON UPDATE CASCADE,
        package_key VARCHAR(255) NOT NULL,
        package_relative_path VARCHAR(255),
        desired_state VARCHAR(255) NOT NULL DEFAULT 'running',
        launch_mode VARCHAR(255) NOT NULL DEFAULT 'exec',
        cwd VARCHAR(255) NOT NULL,
        command TEXT NOT NULL,
        args_json TEXT NOT NULL DEFAULT '[]',
        env_json TEXT NOT NULL DEFAULT '{}',
        env_hash VARCHAR(255),
        launch_fingerprint VARCHAR(255) NOT NULL,
        log_root VARCHAR(255),
        restart_policy VARCHAR(255) NOT NULL DEFAULT 'manual',
        created_by VARCHAR(255),
        updated_by VARCHAR(255),
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deployment_id INTEGER REFERENCES deployment_instances(id) ON DELETE SET NULL ON UPDATE CASCADE
      )
    `);
    await sequelize.query(`
      INSERT INTO desired_processes_rebuild (
        id,
        process_key,
        host_id,
        project_id,
        service_id,
        package_key,
        package_relative_path,
        desired_state,
        launch_mode,
        cwd,
        command,
        args_json,
        env_json,
        env_hash,
        launch_fingerprint,
        log_root,
        restart_policy,
        created_by,
        updated_by,
        created_at,
        updated_at,
        deployment_id
      )
      SELECT
        id,
        process_key,
        host_id,
        project_id,
        service_id,
        package_key,
        package_relative_path,
        desired_state,
        launch_mode,
        cwd,
        command,
        args_json,
        env_json,
        env_hash,
        launch_fingerprint,
        log_root,
        restart_policy,
        created_by,
        updated_by,
        created_at,
        updated_at,
        deployment_id
      FROM desired_processes
    `);
    await sequelize.query('DROP TABLE desired_processes');
    await sequelize.query('ALTER TABLE desired_processes_rebuild RENAME TO desired_processes');
  } finally {
    await sequelize.query('PRAGMA foreign_keys = ON');
  }
};

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const dialect = queryInterface.sequelize.getDialect();
    const structuredDataType = dialect === 'postgres'
      ? Sequelize.JSONB
      : (dialect === 'sqlite' ? Sequelize.TEXT : Sequelize.JSON);

    await queryInterface.createTable('deployment_instances', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
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
      deployment_key: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      display_name: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      deployment_path: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      env_json: {
        type: structuredDataType,
        allowNull: false,
        defaultValue: dialect === 'sqlite' ? '{}' : {},
      },
      log_root: {
        type: Sequelize.STRING,
        allowNull: true,
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

    await queryInterface.addIndex('deployment_instances', ['host_id', 'project_id', 'deployment_key'], {
      unique: true,
      name: 'deployment_instances_host_project_key_unique',
    });
    await queryInterface.addIndex('deployment_instances', ['host_id']);
    await queryInterface.addIndex('deployment_instances', ['project_id']);

    await queryInterface.addColumn('desired_processes', 'deployment_id', {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: {
        model: 'deployment_instances',
        key: 'id',
      },
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE',
    });
    await queryInterface.addColumn('process_runs', 'deployment_id', {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: {
        model: 'deployment_instances',
        key: 'id',
      },
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE',
    });

    await removeIndexIfExists(queryInterface, 'desired_processes', ['host_id', 'project_id', 'package_key']);
    await removeIndexIfExists(queryInterface, 'desired_processes', 'desired_processes_host_id_project_id_package_key');
    if (dialect === 'sqlite') {
      await rebuildSqliteDesiredProcessesWithoutPackageUnique(queryInterface);
    }
    await queryInterface.addIndex('desired_processes', ['host_id', 'project_id', 'deployment_id', 'process_key'], {
      unique: true,
      name: 'desired_processes_host_project_deployment_process_unique',
    });
    await queryInterface.addIndex('desired_processes', ['host_id', 'process_key'], {
      unique: true,
      name: 'desired_processes_host_process_key_unique',
    });
    await queryInterface.addIndex('desired_processes', ['deployment_id']);
    await queryInterface.addIndex('process_runs', ['deployment_id']);
  },

  down: async (queryInterface) => {
    await removeIndexIfExists(queryInterface, 'process_runs', ['deployment_id']);
    await removeIndexIfExists(queryInterface, 'desired_processes', ['deployment_id']);
    await removeIndexIfExists(queryInterface, 'desired_processes', 'desired_processes_host_process_key_unique');
    await removeIndexIfExists(queryInterface, 'desired_processes', 'desired_processes_host_project_deployment_process_unique');
    await queryInterface.removeColumn('process_runs', 'deployment_id');
    await queryInterface.removeColumn('desired_processes', 'deployment_id');
    await queryInterface.dropTable('deployment_instances');
    try {
      await queryInterface.addIndex('desired_processes', ['host_id', 'project_id', 'package_key'], { unique: true });
    } catch {
      // best effort rollback
    }
  },
};
