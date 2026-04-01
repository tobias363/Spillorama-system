'use strict';
var Sys = require('../../../Boot/Sys');

const mongoose = require('mongoose');
const playerModel = mongoose.model('player');
const gameModel = mongoose.model('game');
module.exports = {

    getOneByData: async function(data, select, setOption) {
        try {
            return await playerModel.findOne(data, select, setOption).lean();
        } catch (error) {
            Sys.Log.info('Error in getOneByData : ' + error);
        }
    },

    getByData: async function(data, select, setOption) {
        try {
            return await playerModel.find(data, select, setOption).lean();
        } catch (error) {
            Sys.Log.info('Error in getByData : ' + error);
        }
    },

    getById: async function(id, select, setOption) {
        try {
            return await playerModel.findById(id, select, setOption).lean();
        } catch (error) {
            Sys.Log.info('Error in getByData : ' + error);
        }
    },

    updateSinglePlayer: async function (condition, query, filter) {
        try {
            let ticket = await playerModel.findOneAndUpdate(condition, query, filter).lean();
            return ticket;
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
            Sys.Log.info('Error in Update Player : ' + error);
        }
    },

    updateManyData: async function (condition, data) {
        try {
            return await playerModel.updateMany(condition, data);
        } catch (e) {
            console.log(" Error in updateManyData ticket", e);
            return new Error(e);
        }
    },
}