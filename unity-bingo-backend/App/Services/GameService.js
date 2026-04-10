'use strict';

const mongoose = require('mongoose');
var Sys = require('../../Boot/Sys');
const gameModel = mongoose.model('game');
const savedGameModel = mongoose.model('savedGame');
const gameTypeModel = mongoose.model('gameType');
const ticketModel = mongoose.model('Ticket');
const subGameModel = mongoose.model('subGame');
const subGame5Model = mongoose.model('subGame5');
const staticTicketModel = mongoose.model('staticTicket');
const parentGameModel = mongoose.model('parentGame');
const staticPhysicalTicketModel = mongoose.model('staticPhysicalTicket');
const transactionModel = mongoose.model('transactions');

module.exports = {

    bulkWriteTicketData: async function (data) {
        try {
            return await ticketModel.bulkWrite(data);
        } catch (error) {
            console.log("Error in bulkWriteTicketData", error);
            return new Error(error);
        }
    },

    bulkWriteTransactionData: async function (data) {
        try {
            return await transactionModel.bulkWrite(data);
        } catch (error) {
            console.log("Error in bulkWriteTransactionData", error);
            return new Error(error);
        }
    },

    insertBulkTicketData: async function (data,options) {
        try {
            return await ticketModel.insertMany(data, options);
        } catch (error) {
            console.log("Error in bulkWriteTicketData", error);
            return new Error(error);
        }
    },

    getByIdTicket: async function (id) {
        try {
            return await ticketModel.findById(id);
        } catch (error) {
            console.log('GameServices Error in getById : ', error);
        }
    },
    insertTicketData: async function (data) {
        try {
            return await ticketModel.create(data);
        } catch (e) {
            console.log("Error insertTicketData", e);
        }
    },

    getTicketCount: async function (data) {
        try {
            return await ticketModel.countDocuments(data);
        } catch (e) {
            console.log("Error getTicketCount", e);
        }
    },

    getTicketCountGame3 : async function () {
        try {
            return await ticketModel.estimatedDocumentCount();
        } catch (e) {
            console.log("Error getTicketCount", e);
        }
    },

    getTicketsByData: async function (data, select, setOption) {
        try {
            return await ticketModel.find(data, select, setOption).lean(); //.collation({ locale: "en_US", numericOrdering: true });  // setOption(sort, limit,skip)
        } catch (e) {
            //console.log("Error",e);
            throw new Error('error in getTicketsByData' + e.message);
        }
    },

    getSingleTicketByData: async function (data, select, setOption) {
        try {
            return await ticketModel.findOne(data, select, setOption);  // setOption(sort, limit,skip)
        } catch (e) {
            throw new Error('error in getSingleTicketByData' + e.message);
        }
    },

    deleteTicketMany: async function (data) {
        try {
            return await ticketModel.deleteMany({ gameId: data });
        } catch (e) {
            console.log("Error", e);
        }
    },

    getTicketDatatable: async function (query, length, start, sort) {
        try {
            return await ticketModel.find(query).sort(sort).skip(start).limit(length).lean();
        } catch (e) {
            console.log("Error", e);
        }
    },

    getTicketsCount: async function (query) {
        try {
            return await ticketModel.countDocuments(query);
        } catch (e) {
            console.log("Error", e);
        }
    },

    getGameTypeCount: async function (data) {
        try {
            return await gameTypeModel.countDocuments(data);
        } catch (e) {
            console.log("Error getGameTypeCount", e);
        }
    },

    getGameTypeDatatable: async function (query, length, start, sort) {
        try {
            return await gameTypeModel.find(query).skip(start).limit(length).sort(sort);
        } catch (e) {
            console.log("Error getGameTypeDatatable", e);
        }
    },
    getGameTypeById: async function (id) {
        try {
            return await gameTypeModel.findById(id);
        } catch (error) {
            console.log('GameServices Error in getGameTypeById : ', error);
        }
    },

    getSingleGameTypeByData: async function (data, select, setOption) {
        try {
            return await gameTypeModel.findOne(data, select, setOption).lean();
        } catch (error) {
            console.log('GameServices Error in getSingleGameTypeByData : ', error);
        }
    },

    getSubGameTypeById: async function (id) {
        try {
            return await subGameModel.findById(id);
        } catch (error) {
            console.log('GameServices Error in getSubGameTypeById : ', error);
        }
    },

    getGameTypeByData: async function (data) {
        try {
            return await gameTypeModel.findOne(data);
        } catch (error) {
            console.log('GameServices Error in getById : ', error);
        }
    },

    updateOneGameType: async function (condition, data) {
        try {
            return await gameTypeModel.updateOne(condition, data);
        } catch (e) {
            console.log("Error", e);
        }
    },
    insertGameTypeData: async function (data) {
        try {
            return await gameTypeModel.create(data);
        } catch (e) {
            console.log("Error insertGameTypeData", e);
        }
    },

    getByDataGameType: async function (data) {
        console.log("🚀 ~ data:", data)
        try {
            return await gameTypeModel.find(data);
        } catch (e) {
            console.log("Error", e);
        }
    },
   
    getByDataSortGameType: async function (data) {
        try {
            return await gameTypeModel.find(data).sort({ type: 1 });
        } catch (e) {
            console.log("Error", e);
        }
    },

    getByIdGameType: async function (id) {
        try {
            return await gameTypeModel.findById(id);
        } catch (error) {
            console.log('GameServices Error in gameTypeModel : ', error);
        }
    },

    getByIdGameTypeValidation: async function (id) {
        try {
            return await gameTypeModel.findById(id);
        } catch (error) {
            console.log('GameServices Error in gameTypeModel : ', error);
        }
    },

    getByData: async function (data) {
        try {
            return await gameModel.find(data);
        } catch (e) {
            console.log("Error", e);
        }
    },

    getGamesByData: async function (data, select, setOption) {
        try {
            return await gameModel.find(data, select, setOption);  // setOption(sort, limit,skip)
        } catch (e) {
            //console.log("Error",e);
            throw new Error('error in getGamesByData' + e.message);
        }
    },
    getGamesData: async function (data, select) {
        try {
            return await gameModel.find(data, select);  // setOption(sort, limit,skip)
        } catch (e) {
            //console.log("Error",e);
            throw new Error('error in getGamesByData' + e.message);
        }
    },

    getGamesBySelectData: async function (data, select) {
        try {
            return await gameModel.find(data, select);  // setOption(sort, limit,skip)
        } catch (e) {
            //console.log("Error",e);
            throw new Error('error in getGamesByData' + e.message);
        }
    },
    getParentGamesBySelectData: async function (data, select) {
        try {
            return await parentGameModel.find(data, select);  // setOption(sort, limit,skip)
        } catch (e) {
            //console.log("Error",e);
            throw new Error('error in getGamesByData' + e.message);
        }
    },

    getBySubGameData: async function (data) {
        try {
            return await subGameModel.find(data);
        } catch (e) {
            console.log("Error", e);
        }
    },

    getById: async function (id) {
        try {
            return await gameModel.findById(id);
        } catch (error) {
            console.log('GameServices Error in getById : ', error);
        }
    },

    getParentById: async function (id) {
        try {
            return await parentGameModel.findById(id);
        } catch (error) {
            console.log('GameServices Error in getParentById : ', error);
        }
    },

    getByIdSavedGames: async function (id) {
        try {
            return await savedGameModel.findById(id);
        } catch (error) {
            console.log('GameServices Error in getById : ', error);
        }
    },
    getSingleGameType: async function (data) {
        try {
            return await gameTypeModel.findOne({ _id: data });
        } catch (e) {
            console.log("Error", e);
        }
    },
    deleteGameType: async function (data) {
        try {
            return await gameTypeModel.deleteOne({ _id: data });
        } catch (e) {
            console.log("Error", e);
        }
    },
    getGameData: async function (data, select = null) {
        try {
            return await gameModel.find(data).select(select).lean();
        } catch (e) {
            console.log("Error", e);
        }
    },

    getGameCount: async function (data) {
        try {
            //return  await gameModel.countDocuments(data);
            return await gameModel.countDocuments(data);
        } catch (e) {
            console.log("Error", e);
        }
    },

    getSelectedGameCount: async function (data) {
        try {
            //return  await gameModel.countDocuments(data);
            return await gameModel.find(data).countDocuments();
        } catch (e) {
            console.log("Error", e);
        }
    },

    getSelectedParentGameCount: async function (data) {
        try {
            //return  await gameModel.countDocuments(data);
            return await parentGameModel.find(data).countDocuments();
        } catch (e) {
            console.log("Error", e);
        }
    },

    getSelectedSavedGameCount: async function (data) {
        try {
            //return  await gameModel.countDocuments(data);
            return await savedGameModel.find(data).countDocuments();
        } catch (e) {
            console.log("Error", e);
        }
    },

    getSelectedGameSubCount: async function (data) {
        try {
            //return  await gameModel.countDocuments(data);
            return await subGameModel.find(data).countDocuments();
        } catch (e) {
            console.log("Error", e);
        }
    },

    getSingleGameData: async function (data, column) {
        try {
            return await gameModel.findOne(data).select(column).lean();
        } catch (e) {
            console.log("Error in getSingleGameData:", e);
        }
    },

    getSingleGame: async function (data, select, setOption) {
        try {
            return await gameModel.findOne(data, select, setOption).lean();
        } catch (error) {
            console.log('GameServices Error in getSingleGame : ', error);
        }
    },

    getSingleParentGameData: async function (data, column) {
        try {
            return await parentGameModel.findOne(data).select(column).lean();
        } catch (e) {
            console.log("Error in getSingleGameData:", e);
        }
    },

    getSingleSavedGameData: async function (data) {
        try {
            return await savedGameModel.findOne(data).lean();
        } catch (e) {
            console.log("Error", e);
        }
    },

    getSingleSubGameData: async function (data, column) {
        try {
            return await subGameModel.findOne(data).select(column).lean();
        } catch (e) {
            console.log("Error", e);
        }
    },

    getSingleGameDataWithStartAndLimit: async function (data, start, length) {
        try {
            console.log("getSingleGameDataWithStartAndLimit", data, start, length);
            return await gameModel.findOne(data).skip(start).limit(length).lean();
        } catch (e) {
            console.log("Error", e);
        }
    },

    getGameDatatable: async function (query, length, start, sort) { //sort
        try {
            return await gameModel.find(query).sort(sort).skip(start).limit(length).lean(); //.sort(sort)
        } catch (e) {
            console.log("Error", e);
        }
    },

    getParentGameDatatable: async function (query, length, start, sort) { //sort
        try {
            return await parentGameModel.find(query).sort(sort).skip(start).limit(length).lean(); //.sort(sort)
        } catch (e) {
            console.log("Error getParentGameDatatable :", e);
        }
    },

    getGameDatatableTest: async function (query, length, start) {
        try {
            return await gameModel.find(query);
        } catch (e) {
            console.log("Error", e);
        }
    },

    insertGameData: async function (data) {
        try {
            return await gameModel.create(data);
        } catch (e) {
            console.log("Error", e);
        }
    },

    insertParentGameData: async function (data) {
        try {
            return await parentGameModel.create(data);
        } catch (e) {
            console.log("Error", e);
        }
    },

    insertSavedGameData: async function (data) {
        try {
            return await savedGameModel.create(data);
        } catch (e) {
            console.log("Error", e);
        }
    },

    getSavedGame: async function (query, length, start) {
        try {
            return await savedGameModel.find(query).skip(start).limit(length).lean();
        } catch (e) {
            console.log("Error", e);
        }
    },

    insertSubGameData: async function (data) {
        try {
            return await subGameModel.create(data);
        } catch (e) {
            console.log("Error", e);
        }
    },

    deleteGame: async function (data) {
        try {
            return await gameModel.deleteOne({ _id: data });
        } catch (e) {
            console.log("Error", e);
        }
    },

    deleteParentGame: async function (data) {
        try {
            return await parentGameModel.deleteOne({ _id: data });
        } catch (e) {
            console.log("Error", e);
        }
    },

    deleteSaveGame: async function (data) {
        try {
            return await savedGameModel.deleteOne({ _id: data });
        } catch (e) {
            console.log("Error", e);
        }
    },

    updateGameData: async function (condition, data) {
        try {
            return await gameModel.updateOne(condition, data);
        } catch (e) {
            console.log("Error", e);
        }
    },
    updateParentGameData: async function (condition, data) {
        try {
            return await parentGameModel.updateOne(condition, data);
        } catch (e) {
            console.log("updateParentGameData", e);
        }
    },

    updateManyParentGameData: async function (condition, data, options = {}) {
        try {
            return await parentGameModel.updateMany(condition, data, options);
        } catch (e) {
            console.log(" Error in updateManyParentGameData ticket", e);
            return new Error(e);
        }
    },

    updateManyTicketData: async function (condition, data, options = {}) {
        try {
            return await ticketModel.updateMany(condition, data, options);
        } catch (e) {
            console.log(" Error in updateManyTicketData ticket", e);
            return new Error(e);
        }
    },

    updateSaveGameData: async function (condition, data) {
        try {
            let game = await savedGameModel.findOneAndUpdate(condition, data, { new: true });
            return game;
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
            throw new Error(e.message);
        }
    },

    aggregateQueryParentGame: async function (data) {
        try {
            return await parentGameModel.aggregate(data);
        } catch (e) {
            console.log("Error in gameservice aggregateQueryParentGame", e);
        }
    },

    aggregateQuerySubGame: async function (data) {
        try {
            return await subGameModel.aggregate(data);
        } catch (e) {
            console.log("Error", e);
        }
    },


    insertStaticTicketData: async function (data) {
        try {
            return await staticTicketModel.create(data);
        } catch (e) {
            console.log("Error insertTicketData", e);
        }
    },

    insertManyStaticTicketData: async function (data, options) {
        try {
            return staticTicketModel.insertMany(data, options);
        } catch (e) {
            console.log("Error insertTicketData");
        }
    },

    getStaticTicketCount: async function (data) {
        try {
            return await staticTicketModel.countDocuments(data);
        } catch (e) {
            console.log("Error getTicketCount", e);
        }
    },


    deleteStaticTicketMany: async function (data) {
        try {
            return await staticTicketModel.deleteMany({ gameId: data });
        } catch (e) {
            console.log("Error", e);
        }
    },

    deleteTicketManydata: async function (data) {
        try {
            return await ticketModel.deleteMany(data);
        } catch (e) {
            console.log("Error", e);
        }
    },

    findOneAndUpdateGameData: async function (condition, data) {
        try {
            let game = await gameModel.findOneAndUpdate(condition, data, { new: true });
            return game;
        } catch (e) {
            console.log("Error", e);
        }
    },

    updateManyGameData: async function (condition, data, options = {}) {
        try {
            return await gameModel.updateMany(condition, data, options);
        } catch (e) {
            console.log(" Error in updateManyGameData ticket", e);
            return new Error(e);
        }
    },

    bulkWriteGameData: async function (data) {
        try {
            return await gameModel.bulkWrite(data);
        } catch (error) {
            console.log("Error in bulkWriteGameData", error);
            return new Error(error);
        }
    },

    aggregateQueryTickets: async function (data) {
        try {
            // return await ticketModel.aggregate(data).allowDiskUse(true);
            return await ticketModel.aggregate(data);   //.allowDiskUse(true);
        } catch (e) {
            console.log("GameService Error in aggregateQueryTickets", e);
            return new Error(e);
        }
    },

    // static physical tickets services
    insertStaticPhysicalTicketData: async function (data) {
        try {
            return await staticPhysicalTicketModel.create(data);
        } catch (e) {
            console.log("Error insertStaticPhysicalTicketData", e);
        }
    },

    insertManyStaticPhysicalTicketData: async function (data, options) {
        try {
            return staticPhysicalTicketModel.insertMany(data, options);
        } catch (e) {
            console.log("Error insertManyStaticPhysicalTicketData");
        }
    },

    getStaticPhysicalTicketCount: async function (data) {
        try {
            return await staticPhysicalTicketModel.countDocuments(data);
        } catch (e) {
            console.log("Error getStaticPhysicalTicketCount", e);
        }
    },


    deleteStaticPhysicalTicketMany: async function (data) {
        try {
            return await staticPhysicalTicketModel.deleteMany({ gameId: data });
        } catch (e) {
            console.log("Error in deleteStaticPhysicalTicketMany", e);
        }
    },

    getSingleStaticPhysicalTicketsByData: async function (data, select, setOption) {
        try {
            return await staticPhysicalTicketModel.findOne(data, select, setOption);
        } catch (e) {
            throw new Error('error in getStaticPhysicalTicketsByData' + e.message);
        }
    },

    getStaticPhysicalTicketsByData: async function (data, select, setOption) {
        try {
            return await staticPhysicalTicketModel.find(data, select, setOption).lean();
        } catch (e) {
            throw new Error('error in getStaticPhysicalTicketsByData' + e.message);
        }
    },
    
    updateStaticPhysicalTickets: async function(condition, query) {
        try {
            let tickets = await staticPhysicalTicketModel.findOneAndUpdate(condition, query, { new: true });
            return tickets;
        } catch (error) {
            Sys.Log.info('Error in Update static physical tickets : ' + error);
        }
    },

    updateManyStaticPhysicalTickets: async function(condition, query, options) {
        try {
            let tickets = await staticPhysicalTicketModel.updateMany(condition, query, options);
            return tickets;
        } catch (error) {
            Sys.Log.info('Error in Update static physical tickets : ' + error);
        }
    },

    getGame4SubgamesByData: async function (data, select, setOption) {
        try {
            return await subGameModel.find(data, select, setOption);  // setOption(sort, limit,skip)
        } catch (e) {
            throw new Error('error in getGame4SubgamesByData' + e.message);
        }
    },
    getSingleSubgame5Data: async function (data, select, setOption) {
        try {
            return await subGame5Model.findOne(data, select, setOption).lean();
        } catch (e) {
            Sys.Log.info('Error in getSingleSubgame5Data : ' + e);
        }
    },

}