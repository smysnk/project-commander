module.exports = {
  up: async (queryInterface, Sequelize) => {
    const dialect = queryInterface.sequelize.getDialect();
    const structuredDataType = dialect === 'postgres'
      ? Sequelize.JSONB
      : (dialect === 'sqlite' ? Sequelize.TEXT : Sequelize.JSON);

    await queryInterface.createTable('automation_api_tokens', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      name: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      token_hash: {
        type: Sequelize.STRING,
        allowNull: false,
        unique: true,
      },
      access_mode: {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: 'observe',
      },
      scopes_json: {
        type: structuredDataType,
        allowNull: false,
        defaultValue: dialect === 'sqlite' ? '[]' : [],
      },
      allowed_host_ids_json: {
        type: structuredDataType,
        allowNull: false,
        defaultValue: dialect === 'sqlite' ? '[]' : [],
      },
      allowed_project_ids_json: {
        type: structuredDataType,
        allowNull: false,
        defaultValue: dialect === 'sqlite' ? '[]' : [],
      },
      allowed_path_prefixes_json: {
        type: structuredDataType,
        allowNull: false,
        defaultValue: dialect === 'sqlite' ? '[]' : [],
      },
      raw_command_allowed: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      full_access: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      expires_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      last_used_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      created_by: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      revoked_at: {
        type: Sequelize.DATE,
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

    await queryInterface.addIndex('automation_api_tokens', ['token_hash'], { unique: true });
    await queryInterface.addIndex('automation_api_tokens', ['access_mode']);
    await queryInterface.addIndex('automation_api_tokens', ['revoked_at', 'expires_at']);

    await queryInterface.createTable('runtime_audit_events', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      request_id: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      actor_type: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      actor_id: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      actor_name: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      tool_name: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      scope: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      host_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      project_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      desired_process_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      run_id: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      process_key: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      action: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      input_json: {
        type: structuredDataType,
        allowNull: false,
        defaultValue: dialect === 'sqlite' ? '{}' : {},
      },
      result_json: {
        type: structuredDataType,
        allowNull: false,
        defaultValue: dialect === 'sqlite' ? '{}' : {},
      },
      status: {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: 'success',
      },
      error_message: {
        type: Sequelize.TEXT,
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

    await queryInterface.addIndex('runtime_audit_events', ['request_id']);
    await queryInterface.addIndex('runtime_audit_events', ['actor_type', 'actor_id']);
    await queryInterface.addIndex('runtime_audit_events', ['action']);
    await queryInterface.addIndex('runtime_audit_events', ['host_id', 'project_id']);
    await queryInterface.addIndex('runtime_audit_events', ['created_at']);
  },
};
