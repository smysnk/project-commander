module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('host_ssh_key_configs', {
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
      key_name: {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: 'default',
      },
      private_key: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      public_key: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      passphrase: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      known_hosts: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      strict_host_key_checking: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      fingerprint: {
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

    await queryInterface.addIndex('host_ssh_key_configs', ['host_id', 'key_name'], { unique: true });
    await queryInterface.addIndex('host_ssh_key_configs', ['agent_uuid']);
  },
};
