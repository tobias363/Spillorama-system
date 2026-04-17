'use strict';

const mongoose = require('mongoose');
var Sys = require('../../Boot/Sys');
const otherGameModel = mongoose.model('otherGame');
module.exports = {

    getByData: async function(data) {
        try {
            return await otherGameModel.findOne(data);
        } catch (e) {
            console.log("OtherGamesServices Error in getByData", e);
            return new Error(e);
        }
    },

    getMinigameWinningsByData: async function(data, select, setOption) {
        try {
            return await otherGameModel.findOne(data, select, setOption).lean();
        } catch (error) {
            Sys.Log.info('Error in getMinigameWinningsByData : ' + error);
        }
    },

    insertData: async function(data) {
        try {

            return await otherGameModel.create(data);
        } catch (e) {
            console.log("OtherGamesServices Error in insertData", e);
            return new Error(e);
        }
    },

    updateData: async function(condition, data) {
        try {
            return await otherGameModel.updateOne(condition, data);
        } catch (e) {
            console.log("OtherGamesServices Error in updateData", e);
            return new Error(e);
        }
    },
}