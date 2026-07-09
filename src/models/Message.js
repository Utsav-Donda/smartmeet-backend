'use strict';

const { DataTypes, Model } = require('sequelize');

module.exports = (sequelize) => {
  class Message extends Model {
    static associate(models) {
      Message.belongsTo(models.Room, { foreignKey: 'room_id', as: 'room' });
      Message.belongsTo(models.User, { foreignKey: 'user_id', as: 'user' });
    }
  }

  Message.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      roomId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: 'room_id',
      },
      userId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: 'user_id',
      },
      body: {
        type: DataTypes.STRING(2000),
        allowNull: false,
      },
    },
    {
      sequelize,
      modelName: 'Message',
      tableName: 'messages',
      underscored: true,
      timestamps: true,
    }
  );

  return Message;
};
