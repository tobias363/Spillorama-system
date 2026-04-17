'use strict';

const mongoose = require('mongoose');
const Sys = require('../../../Boot/Sys');
const gameModel = mongoose.model('game');
const tickets = mongoose.model('Ticket');
const parentGameModel = mongoose.model('parentGame');
module.exports = {

    // tickets Services
    getTicketByData: async function(data, select, setOption) {
        try {
            return await tickets.find(data, select, setOption).lean();
        } catch (error) {
            Sys.Log.info('Error in getTicketByData : ' + error);
        }
    },

    getSingleTicketData: async function (data, select, setOption) {
        try {
            return await tickets.findOne(data, select, setOption).lean();
        } catch (error) {
            Sys.Log.info('Error in getSingleTicketData : ' + error);
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

    updateMultiTicket: async function (condition, query) {
        try {
            //console.log("mongoose multi query", condition, query)
            let player = await tickets.updateMany(condition, query);
            return player;
        } catch (error) {
            Sys.Log.info('Error in Update Ticket : ' + error);
        }
    },

    getTicketCount: async function (data) {
        try {
            return await tickets.countDocuments(data);
        } catch (e) {
            console.log("Error", e);
        }
    },

    bulkWriteTickets: async function (operations) {
        try {
            return await tickets.bulkWrite(operations, { ordered: false });
        } catch (e) {
            console.error("Error in bulkWriteTickets:", e);
            throw e;
        }
    },

    // Game Services
    getSingleGameByData: async function (data, select, setOption) {
        try {
            return await gameModel.findOne(data, select, setOption).lean();
        } catch (e) {
            console.log("Error", e);
        }
    },

    getByData: async function (data, select, setOption) {
        try {
            return await gameModel.find(data, select, setOption).lean();
        } catch (e) {
            console.log("Error", e);
        }
    },

    updateSingleGame: async function (condition, query, filter) {
        try {
            let ticket = await gameModel.findOneAndUpdate(condition, query, filter).lean();
            return ticket;
        } catch (e) {
            Sys.Log.info('Error in updateSingleTicket : ' + e);
        }
    },

    updateGame: async function (data, query, options = { new: true }) {
        try {
            let player = await gameModel.updateOne(data, query, options).lean();
            return player;
        } catch (error) {
            Sys.Log.info('Error in Update game : ' + error);
        }
    },

    getGameCount: async function (data) {
        try {
            return await gameModel.countDocuments(data);
        } catch (e) {
            console.log("Error", e);
        }
    },

    deleteManyGames: async function (data) {
        try {
            return await gameModel.deleteMany(data);
        } catch (e) {
            console.log("Error", e);
        }
    },

    // Parent game services
    getByDataParent: async function (data, select, setOption) {
        try {
            return await parentGameModel.find(data, select, setOption).lean();
        } catch (e) {
            console.log("Error", e);
        }
    },

    getSingleParentGame: async function (data, select, setOption) {
        try {
            return await parentGameModel.findOne(data, select, setOption).lean();
        } catch (e) {
            console.log("Error", e);
        }
    },

    updateParentGame: async function (condition, data, options) {
        try {
            return await parentGameModel.findOneAndUpdate(condition, data, options);
        } catch (e) {
            console.log("updateParentGame", e);
        }
    },

    
}