'use strict';
const mongoose = require('mongoose');
var Sys = require('../../Boot/Sys');
const playerModel = mongoose.model('player');
const transactionModel = mongoose.model('transactions');

module.exports = {

    getSinglePlayerData: async function(data, column) {
        try {
            return await playerModel.findOne(data).select(column).sort({_id:-1});
        } catch (e) {
            console.log("UniqueServices Error in getSinglePlayerData", e);
            return new Error(e);
        }
    },
    insertPlayersData: async function(data) {
        try {
            return await playerModel.create(data);
        } catch (e) {
            console.log("UniqueServices Error in insertPlayerData", e);
            return new Error(e);
        }
    },
    getPlayerData: async function(data,length, start,sort) {
        try {
            return await playerModel.find(data).skip(start).limit(length).sort(sort).lean();
        } catch (e) {
            console.log("UniqueServices Error in getPlayerData", e);
            return new Error(e);
        }
    },

    getPlayerCount: async function(data) {
        try {
            return await playerModel.countDocuments(data);
        } catch (e) {
            console.log("UniqueServices Error in getPlayerCount", e);
            return new Error(e);
        }
    },
    updateUniquePlayerData: async function(condition, data) {
        try {
            return await playerModel.updateOne(condition, data);
        } catch (e) {
            console.log("UniqueServices Error in updateUniquePlayerData", e);
            return new Error(e);
        }
    },



}