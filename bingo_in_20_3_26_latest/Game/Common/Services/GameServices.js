'use strict';

const mongoose = require('mongoose');
var Sys = require('../../../Boot/Sys');
const gameModel = mongoose.model('game');
const parentGameModel = mongoose.model('parentGame');
const hallModel = mongoose.model('hall');
const groupHallModel = mongoose.model('groupHall');
const gameType = mongoose.model('gameType');
const Loyalty = mongoose.model('loyalty');
const Voucher = mongoose.model('Voucher');
const leaderboard = mongoose.model('Leaderboard');
const tickets = mongoose.model('Ticket');
const subGameModel = mongoose.model('subGame');
module.exports = {


    getSingleSubGameData: async function (data) {
        try {
            return await subGameModel.findOne(data).lean();
        } catch (e) {
            console.log("Error", e);
        }
    },


    // tickets Services

    getTicketListData: async function (data, columns) {
        try {
            return await tickets.find(data).select(columns);
        } catch (e) {
            console.log("Error", e);
        }
    },

    getTicketData: async function (data) {
        try {
            return await tickets.find(data);
        } catch (e) {
            console.log("Error", e);
        }
    },

    getSingleTicketData: async function (data) {
        try {
            return await tickets.findOne(data);
        } catch (e) {
            console.log("Error", e);
        }
    },

    updateTicket: async function (id, query) {
        try {
            let player = await tickets.updateOne({ _id: id }, query, { new: true });
            return player;
        } catch (error) {
            Sys.Log.info('Error in Update Ticket : ' + error);
        }
    },

    // updateManyData: async function (condition, data) {
    //     try {
    //         return await tickets.updateMany(condition, data);
    //     } catch (e) {
    //         console.log(" Error in updateManyData ticket", e);
    //         return new Error(e);
    //     }
    // },

    updateManyTicketData: async function (condition, data, options = { ordered: true }) {
        try {
            return await tickets.updateMany(condition, data, options);
        } catch (e) {
            console.log(" Error in updateManyData ticket", e);
            return new Error(e);
        }
    },

    //*************************************************************************************************** */
    // Game Type Services
    createList: async function (data) {
        try {
            return await gameType.create(data);
        } catch (e) {
            console.log("Error", e);
        }
    },

    getListData: async function (data, select, setOption) {
        try {
            return await gameType.find(data, select, setOption).lean();
        } catch (e) {
            console.log("Error", e);
        }
    },


    getSingleGameTypeData: async function (data) {
        try {
            return await gameType.findOne(data);
        } catch (e) {
            console.log("Error", e);
        }
    },
    //*************************************************************************************************** */

    // Hall Services
    getHallData: async function (data, select, setOption) {
        try {
            return await hallModel.find(data, select, setOption).lean();
        } catch (e) {
            console.log("Error in getHallData", e);
        }
    },

    getGroupHallData: async function (data) {
        try {
            return await groupHallModel.find(data);
        } catch (e) {
            console.log("Error in getGroupHallData", e);
        }
    },

    getSingleGroupHallData: async function (data) {
        try {
            return await groupHallModel.findOne(data);
        } catch (e) {
            console.log("Error", e);
        }
    },
    getSingleHallData: async function (data, select = null) {
        try {
            return await hallModel.findOne(data).select(select);
        } catch (e) {
            console.log("Error in getSingleHallData", e);
        }
    },

    getSingleHallByData: async function (data, select, setOption) {
        try {
            return await hallModel.findOne(data, select, setOption).lean();
        } catch (e) {
            console.log("Error", e);
        }
    },

    //*************************************************************************************************** */

    // leaderboard Services
    getleaderboardData: async function (data, column) {
        try {
            return await leaderboard.find(data).select(column);
        } catch (e) {
            console.log("Error", e);
        }
    },

    //*************************************************************************************************** */


    // Voucher Services
    getVoucherData: async function (data) {
        try {
            return await Voucher.find(data);
        } catch (e) {
            console.log("Error", e);
        }
    },
    //*************************************************************************************************** */

    // Loyalty Services
    getLoyaltyData: async function (data) {
        try {
            return await Loyalty.find(data);
        } catch (e) {
            console.log("Error", e);
        }
    },
    //*************************************************************************************************** */

    // game Services
    getByData: async function (data, select, setOption) {

        try {
            return await gameModel.find(data, select, setOption).sort({ specialGame: -1 });
        } catch (e) {
            console.log("Error", e);
        }
    },

    updateGame: async function (id, query) {
        try {
            let player = await gameModel.updateOne({ _id: id }, query, { new: true });
            return player;
        } catch (error) {
            Sys.Log.info('Error in Update game : ' + error);
        }
    },

    updateManyData: async function (condition, data) {
        try {
            return await gameModel.updateMany(condition, data);
        } catch (e) {
            console.log(" Error in updateData", e);
            return new Error(e);
        }
    },

    bulkWriteGames: async function (operations, options) {  
        try {
            return await gameModel.bulkWrite(operations, options);
        } catch (e) {
            console.error("Error in bulkWriteGames:", e);
            throw e;
        }
    },

    getParentByData: async function (data, select, setOption) {
        try {
            return await parentGameModel.find(data, select, setOption);
        } catch (e) {
            console.log("Error in getParentByData", e);
        }
    },
    updateParentGame: async function (id, query) {
        try {
            let player = await parentGameModel.updateOne({ _id: id }, query, { new: true });
            return player;
        } catch (error) {
            Sys.Log.info('Error in Update Parent game : ' + error);
            return new Error(error);
        }
    },

    updateManyParentData: async function (condition, data) {
        try {
            return await parentGameModel.updateMany(condition, data);
        } catch (e) {
            console.log(" Error in updateManyParentData", e);
            return new Error(e);
        }
    },

    getGameData: async function (data) {
        try {
            return await gameModel.find(data);
        } catch (e) {
            console.log("Error", e);
        }
    },

    getGameCount: async function (data) {
        try {
            return await gameModel.countDocuments(data);
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

    getSingleParentGameData: async function (data) {
        try {
            return await parentGameModel.findOne(data);
        } catch (e) {
            console.log("Error in getSingleParentGameData::", e);
        }
    },

    getGameDatatable: async function (query, length, start) {
        try {
            return await gameModel.find(query).skip(start).limit(length).sort({ createdAt: -1 });
        } catch (e) {
            console.log("Error", e);
        }
    },



    getLimitedGame: async function (data) {
        try {
            return await gameModel.find(data).limit(10).sort({ createdAt: -1 });
        } catch (e) {
            console.log("Error", e);
        }
    },

    aggregateQuery: async function (data) {
        try {
            return await gameModel.aggregate(data);
        } catch (e) {
            console.log("Error", e);
        }
    },


    //childgame for game 2
    getChildGame: async function (data) {
        try {
            return await gameModel.find(data);
        } catch (error) {
            console.log("Error in getChildGame ::", error);
            return new Error(error);
        }
    },

    createChildGame: async function (data) {
        try {
            return await gameModel.create(data);
        } catch (error) {
            console.log("Error in createChildGame", error);
            return new Error(error);
        }
    }
    //*************************************************************************************************** */
}