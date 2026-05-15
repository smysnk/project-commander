module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('host_path_mappings', {
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
      agent_uuid: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      logical_root: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      codex_path_prefix: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      host_path_prefix: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      description: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      enabled: {
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

    await queryInterface.addIndex(
      'host_path_mappings',
      ['host_id', 'codex_path_prefix', 'host_path_prefix'],
      { unique: true },
    );
    await queryInterface.addIndex('host_path_mappings', ['agent_uuid']);
    await queryInterface.addIndex('host_path_mappings', ['host_id', 'enabled']);
  },
};
