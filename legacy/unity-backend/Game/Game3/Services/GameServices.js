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

    getAggregateTicketData: async function (data) {
        try {
            return await tickets.aggregate(data);
        } catch (e) {
            console.log("Error", e);
            throw new Error(e.message)
        }
    },

    updateSingleTicket: async function (condition, query, filter) {
        try {
            return await tickets.findOneAndUpdate(condition, query, filter).lean();
        } catch (e) {
            Sys.Log.info('Error in updateSingleTicket : ' + e);
        }
    },

    getTicketCount: async function (data) {
        try {
            return await tickets.countDocuments(data);
        } catch (e) {
            console.log("Error", e);
        }
    },

    updateManyData: async function(condition, data) {
        try {
            return await tickets.updateMany(condition, data);
        } catch (e) {
            console.log(" Error in updateManyData ticket", e);
            return new Error(e);
        }
    },

    bulkWriteTickets: async function (operations, options = { ordered: false }) {
        try {
            return await tickets.bulkWrite(operations, options);
        } catch (e) {
            console.error("Error in bulkWriteTickets:", e);
            throw e;
        }
    },

    // game Services
    getByData: async function(data, select, setOption) {
        try {
            return await gameModel.find(data, select, setOption).lean();
        } catch (e) {
            console.log("Error", e);
        }
    },

    getSingleGameData: async function (data, select, setOption) {
        try {
            return await gameModel.findOne(data, select, setOption).lean();
        } catch (e) {
            console.log("Error", e);
        }
    },

    updateSingleGame: async function (condition, query, filter) {
        try {
            return await gameModel.findOneAndUpdate(condition, query, filter).lean();
        } catch (e) {
            Sys.Log.info('Error in updateSingleGame : ' + e);
        }
    },

    updateGame: async function (data, query, options = { new: true }) {
        try {
            return await gameModel.updateOne(data, query, options).lean();
        } catch (error) {
            Sys.Log.info('Error in Update game : ' + error);
        }
    },

    getGameCount: async function(data) {
        try {
            return await gameModel.countDocuments(data);
        } catch (e) {
            console.log("Error", e);
        }
    },

    getSingleParentGameData: async function (data, select, setOption) {
        try {
            return await parentGameModel.findOne(data, select, setOption).lean();
        } catch (e) {
            console.log("Error in getSingleParentGameData:", e);
        }
    }
}