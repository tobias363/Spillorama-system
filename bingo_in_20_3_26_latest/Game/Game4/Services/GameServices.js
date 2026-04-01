'use strict';

const mongoose = require('mongoose');
const Sys = require('../../../Boot/Sys');
const gameModel = mongoose.model('game');
const tickets = mongoose.model('Ticket');
const subGameModel = mongoose.model('subGame');

module.exports = {

    // tickets Services
    getTicketByData: async function(data, select, setOption) {
        try {
            return await tickets.find(data, select, setOption).lean();
        } catch (error) {
            Sys.Log.info('Error in getNewsByData : ' + error);
        }
    },

    updateSingleTicket: async function (condition, query, filter) {
        try {
            let ticket = await tickets.findOneAndUpdate(condition, query, filter).lean();
            return ticket;
        } catch (e) {
            Sys.Log.info('Error in updateSingleTicket : ' + e);
        }
    },

    updateManyTicketData: async function(condition, data) {
        try {
            return await tickets.updateMany(condition, data);
        } catch (e) {
            console.log(" Error in updateManyData ticket", e);
            return new Error(e);
        }
    },

    // Game Services
    getSingleGameData: async function(data, select, setOption) {
        try {
            return await gameModel.findOne(data, select, setOption).lean();
        } catch (e) {
            console.log("Error", e);
        }
    },

    getByData: async function(data, select, setOption) {
        try {
            return await gameModel.find(data, select, setOption).lean();
        } catch (e) {
            console.log("Error", e);
        }
    },

    updateManyData: async function(condition, data) {
        try {
            return await gameModel.updateMany(condition, data);
        } catch (e) {
            console.log(" Error in updateData", e);
            return new Error(e);
        }
    },

    // Subgame model
    getSubGameData: async function(data, select, setOption) {
        try {
            return await subGameModel.find(data, select, setOption).lean();
        } catch (e) {
            console.log("Error", e);
        }
    },

    getSingleSubGameData: async function(data, select, setOption) {
        try {
            return await subGameModel.findOne(data, select, setOption).lean();
        } catch (e) {
            console.log("Error", e);
        }
    },

    updateSubGame: async function (condition, query, filter) {
        try {
            let subGame = await subGameModel.findOneAndUpdate(condition, query, filter).lean();
            return subGame;
        } catch (e) {
            Sys.Log.info('Error in updateGame : ' + e);
        }
    },

    subgameCount: async function (query) {
        try {
            return await subGameModel.countDocuments(query);
        } catch (e) {
            Sys.Log.info('Error in updateGame : ' + e);
        }
    },

    bulkWriteTicket: async function(operation, option) {
        try {
            return await tickets.bulkWrite(operation, option);
        } catch (e) {
            Sys.Log.info('Error in bulkWrite : ' + e);
        }
    }

}