'use strict';

const mongoose = require('mongoose');
var Sys = require('../../../Boot/Sys');
const gameModel = mongoose.model('game');
const hallModel = mongoose.model('hall');
const ticketModel = mongoose.model('Ticket');
const subGame5Model = mongoose.model('subGame5');
module.exports = {

    getTicketsByData: async function(data, select, setOption) {
        try {
            return await ticketModel.find(data, select, setOption).lean();
        } catch (e) {
            console.log("Error", e);
        }
    },

    getSingleTicketData: async function (data, select, setOption) {
        try {
            return await ticketModel.findOne(data, select, setOption).lean();
        } catch (e) {
            Sys.Log.info('Error in getSingleData : ' + e);
        }
    },

    updateTicket: async function (condition, query, filter) {
        try {
            let ticket = await ticketModel.findOneAndUpdate(condition, query, filter);
            return ticket;
        } catch (e) {
            Sys.Log.info('Error in updateGame : ' + e);
        }
    },

    updateOneTicket: async function(condition, query, filter) {
        try {
            let ticket = await ticketModel.updateOne(condition, query, filter);
            return ticket;
        } catch (error) {
            Sys.Log.info('Error in Update game : ' + error);
        }
    },

    updateManyTicketData: async function(condition, data) {
        try {
            return await ticketModel.updateMany(condition, data);
        } catch (e) {
            console.log(" Error in updateData", e);
            return new Error(e);
        }
    },
   
    getTicketCount: async function(data) {
        try {
            return await ticketModel.countDocuments(data);
        } catch (e) {
            console.log("Error", e);
        }
    },

    getTicketDatatable: async function(query, length, start) {
        try {
            return await ticketModel.find(query).skip(start).limit(length).sort({ createdAt: -1 }).lean();
        } catch (e) {
            console.log("Error", e);
        }
    },

    aggregateTicketQuery: async function(data) {
        try {
            return await ticketModel.aggregate(data).allowDiskUse(true);
        } catch (e) {
            console.log("Error", e);
        }
    },
    
    bulkWriteTicketData: async function (data) {
        try {
            return await ticketModel.bulkWrite(data);
        } catch (e) {
            console.log("Error in bulkWriteTicketData", e);
            return new Error(e);
        }
    },

    /**
     * Performs bulk write operations on ticket documents
     * @param {Array} operations - Array of update operations to perform
     * @returns {Object} - Result of the bulk write operation
     */
    bulkWriteTickets: async function (operations) {
        try {
            return await ticketModel.bulkWrite(operations, { ordered: false });
        } catch (e) {
            console.error("Error in bulkWriteTickets:", e);
            throw e;
        }
    },

    // Hall Services
    getHallData: async function(data) {
        try {
            return await hallModel.find(data).lean();
        } catch (e) {
            console.log("Error", e);
        }
    },

    // Game Services
    getGameByData: async function(data, select, setOption) {
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
            Sys.Log.info('Error in getSingleData : ' + e);
        }
    },

    updateGame: async function (condition, query, filter) {
        try {
            let player = await gameModel.findOneAndUpdate(condition, query, filter);
            return player;
        } catch (e) {
            Sys.Log.info('Error in updateGame : ' + e);
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
   
    getGameCount: async function(data) {
        try {
            return await gameModel.countDocuments(data);
        } catch (e) {
            console.log("Error", e);
        }
    },

    getGameDatatable: async function(query, length, start) {
        try {
            return await gameModel.find(query).skip(start).limit(length).sort({ createdAt: -1 }).lean();
        } catch (e) {
            console.log("Error", e);
        }
    },

    aggregateGameQuery: async function(data) {
        try {
            return await gameModel.aggregate(data).allowDiskUse(true);
        } catch (e) {
            console.log("Error", e);
        }
    },

    // Subgame 5 Services
    insertSubgameData: async function (data) {
        try {
            return await subGame5Model.create(data);
        } catch (e) {
            console.log("Error", e);
        }
    },

    getSubgameByData: async function(data, select, setOption) {
        try {
            return await subGame5Model.find(data, select, setOption).lean();
        } catch (e) {
            console.log("Error in getSubgameByData", e);
        }
    },

    getSingleSubgameData: async function (data, select, setOption) {
        try {
            return await subGame5Model.findOne(data, select, setOption).lean();
        } catch (e) {
            Sys.Log.info('Error in getSingleSubgameData : ' + e);
        }
    },

    updateSubgame: async function (condition, query, filter) {
        try {
            let game = await subGame5Model.findOneAndUpdate(condition, query, filter);
            return game;
        } catch (e) {
            Sys.Log.info('Error in updateSubgame : ' + e);
        }
    },

    updateManySubgameData: async function(condition, data) {
        try {
            return await subGame5Model.updateMany(condition, data);
        } catch (e) {
            console.log(" Error in updateManySubgameData", e);
            return new Error(e);
        }
    },
   
    getSubgameCount: async function(data) {
        try {
            return await subGame5Model.countDocuments(data);
        } catch (e) {
            console.log("Error", e);
        }
    },

    getSubgameDatatable: async function(query, length, start) {
        try {
            return await subGame5Model.find(query).skip(start).limit(length).sort({ createdAt: -1 }).lean();
        } catch (e) {
            console.log("Error", e);
        }
    },

    aggregateSubgameQuery: async function(data) {
        try {
            return await subGame5Model.aggregate(data).allowDiskUse(true);
        } catch (e) {
            console.log("Error", e);
        }
    },

   
}