'use strict';
var Sys = require('../../../Boot/Sys');

const mongoose = require('mongoose');
const playerModel = mongoose.model('player');
const gameModel = mongoose.model('game');
module.exports = {
    getById: async function(id, select, setOption) {
        try {
            return await playerModel.findById(id, select, setOption).lean();
        } catch (error) {
            Sys.Log.info('Error in getByData : ' + error);
        }
    },

    getByData: async function(data, select, setOption) {
        try {
            return await playerModel.find(data, select, setOption).lean();
        } catch (error) {
            Sys.Log.info('Error in getByData : ' + error);
        }
    },

    updateSinglePlayer: async function (condition, query, filter) {
        try {
            return await playerModel.findOneAndUpdate(condition, query, filter).lean();
        } catch (e) {
            Sys.Log.info('Error in updateSinglePlayer : ' + e);
        }
    },

    updateGameWininng: async function(gameId, id, query) {
        try {
            console.log("updateGameWininng", gameId, id, query);
            let game = await gameModel.findOne(gameId);
            let targetObject = game.players.find(item => JSON.stringify(item.id) == JSON.stringify(id));
            console.log("targetObject.isLossAndWo", targetObject);
            if (targetObject.isLossAndWon == false) {
                console.log("targetObject.isLossAndWo", targetObject.isLossAndWon);
                await playerModel.updateOne({ _id: id }, query, { new: true });
                return true;
            } else {
                return false;
            }
        } catch (error) {
            console.log('Error in playerServices updateGameWininng: ',error);
        }
    },

    updateManyPlayerData: async function (condition, data) {
        try {
            await playerModel.updateMany(condition, data);
        } catch (e) {
            console.log("Error", e);
        }
    },

    getPlayerCount: async function(data, select, setOption) {
        try {
            return await playerModel.countDocuments(data, select, setOption);
        } catch (error) {
            Sys.Log.info('Error in getPlayerCount : ' + error);
        }
    },

    bulkWrite: async function (operations) {
        try {
            return await playerModel.bulkWrite(operations, { ordered: false });
        } catch (e) {
            console.error("Error in bulkWrite:", e);
            throw e;
        }
    },
}