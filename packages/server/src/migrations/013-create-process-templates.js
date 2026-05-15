module.exports = {
  up: async (queryInterface, Sequelize) => {
    const dialect = queryInterface.sequelize.getDialect();
    const structuredDataType = dialect === 'postgres'
      ? Sequelize.JSONB
      : (dialect === 'sqlite' ? Sequelize.TEXT : Sequelize.JSON);

    await queryInterface.createTable('process_templates', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      host_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'hosts',
          key: 'id',
        },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      project_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'projects',
          key: 'id',
        },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      template_key: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      display_name: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      description: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      package_key: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      package_relative_path: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      process_key_template: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      cwd_template: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      desired_state: {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: 'running',
      },
      launch_mode: {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: 'shell',
      },
      command: {
        type: Sequelize.STRING,
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
      restart_policy: {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: 'manual',
      },
      health_checks_json: {
        type: structuredDataType,
        allowNull: false,
        defaultValue: dialect === 'sqlite' ? '[]' : [],
      },
      log_root: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      enabled: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      allow_codex: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
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

    await queryInterface.addIndex('process_templates', ['template_key']);
    await queryInterface.addIndex('process_templates', ['host_id', 'project_id', 'template_key']);
    await queryInterface.addIndex('process_templates', ['enabled', 'allow_codex']);
  },
};
