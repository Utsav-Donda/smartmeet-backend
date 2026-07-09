'use strict';

const { DataTypes, Model } = require('sequelize');

module.exports = (sequelize) => {
  class User extends Model {
    static associate(models) {
      User.hasMany(models.Room, { foreignKey: 'host_id', as: 'hostedRooms' });
      User.hasMany(models.RoomParticipant, { foreignKey: 'user_id', as: 'roomParticipations' });
      User.hasMany(models.ConnectionMetric, { foreignKey: 'participant_id', as: 'connectionMetrics' });
    }

    toSafeJSON() {
      const { id, email, username, avatarUrl, createdAt, updatedAt } = this.get();
      return { id, email, username, avatarUrl, createdAt, updatedAt };
    }
  }

  User.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      email: {
        type: DataTypes.STRING(255),
        allowNull: false,
        unique: true,
        validate: { isEmail: true },
      },
      username: {
        type: DataTypes.STRING(30),
        allowNull: false,
        unique: true,
      },
      passwordHash: {
        type: DataTypes.STRING(255),
        allowNull: false,
        field: 'password_hash',
      },
      avatarUrl: {
        type: DataTypes.STRING(1024),
        allowNull: true,
        field: 'avatar_url',
      },
    },
    {
      sequelize,
      modelName: 'User',
      tableName: 'users',
      underscored: true,
      timestamps: true,
    }
  );

  return User;
};

/*
⚡ IMPROVEMENT SUGGESTIONS FOR USER MODEL:
1. Add a `lastLoginAt` column and index to support inactive-account cleanup and security auditing.
PRIORITY: Low
IMPLEMENTATION_EFFORT: Low
IMPACT: Low
*/
