'use strict';

const { DataTypes, Model } = require('sequelize');

module.exports = (sequelize) => {
  class ConnectionMetric extends Model {
    static associate(models) {
      ConnectionMetric.belongsTo(models.Room, { foreignKey: 'room_id', as: 'room' });
      ConnectionMetric.belongsTo(models.User, { foreignKey: 'participant_id', as: 'participant' });
    }
  }

  ConnectionMetric.init(
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
      participantId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: 'participant_id',
      },
      bandwidthIn: {
        type: DataTypes.FLOAT,
        allowNull: false,
        defaultValue: 0,
        field: 'bandwidth_in',
      },
      bandwidthOut: {
        type: DataTypes.FLOAT,
        allowNull: false,
        defaultValue: 0,
        field: 'bandwidth_out',
      },
      latency: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      packetLoss: {
        type: DataTypes.FLOAT,
        allowNull: false,
        defaultValue: 0,
        field: 'packet_loss',
      },
      recordedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        field: 'recorded_at',
      },
    },
    {
      sequelize,
      modelName: 'ConnectionMetric',
      tableName: 'connection_metrics',
      underscored: true,
      timestamps: false,
    }
  );

  return ConnectionMetric;
};

/*
⚡ IMPROVEMENT SUGGESTIONS FOR CONNECTION_METRIC MODEL:
1. Batch-insert metrics client-side (e.g. every 10s) instead of per-sample to reduce write amplification on this high-cardinality table.
PRIORITY: Medium
IMPLEMENTATION_EFFORT: Medium
IMPACT: Medium
*/
