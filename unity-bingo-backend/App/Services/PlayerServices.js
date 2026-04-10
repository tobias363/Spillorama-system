'use strict';
const mongoose = require('mongoose');
var Sys = require('../../Boot/Sys');
const playerModel = mongoose.model('player');
const transactionModel = mongoose.model('transactions');

module.exports = {

    getByTransactionData: async function(data) {
        try {
            return await transactionModel.find(data);
        } catch (error) {
            console.log('Error in getByTransactionData : ' + error);
        }
    },

    getPlayerTransactionDataCount: async function(data) {
        try {
            return await transactionModel.countDocuments(data);
        } catch (e) {
            console.log("PlayerServices Error in getPlayerTransactionDataCount", e);
            return new Error(e);
        }
    },

    aggregateQueryTransaction: async function(data) {
        try {
            return await transactionModel.aggregate(data); //.explain("executionStats")
        } catch (e) {
            console.log("PlayerServices Error in aggregateQueryTransaction", e);
            return new Error(e);
        }
    },


    getTransactionDataTable: async function(query, length, start, sort) {
        try {
            return await transactionModel.find(query).skip(start).limit(length).sort(sort);
        } catch (e) {
            console.log("Error in getTransactionDataTable", e);
        }
    },



    getByData: async function(data) {
        //console.log('Find By Data:',data)
        try {
            return await playerModel.find(data);
        } catch (e) {
            console.log("PlayerServices Error in getByData", e);
            return new Error(e);
        }
    },
    getByDataForSpecificFields: async function(data) {
        //console.log('Find By Data:',data)
        try {
            return await playerModel.find(data).select({ username: 1, _id: 1 , customerNumber: 1 , phone:1});
        } catch (e) {
            console.log("PlayerServices Error in getByDataForSpecificFields", e);
            return new Error(e);
        }
    },
    getById: async function(id) {
        try {
            return await playerModel.findById(id);
        } catch (error) {
            console.log('PlayerServices Error in getById : ', error);
        }
    },

    getPlayerData: async function(data,sort=null,limit=null) {
        try {
            return await playerModel.find(data).sort(sort).limit(limit);
        } catch (e) {
            console.log("PlayerServices Error in getPlayerData", e);
            return new Error(e);
        }
    },

    getPlayerCount: async function(data) {
        try {
            return await playerModel.countDocuments(data);
        } catch (e) {
            console.log("PlayerServices Error in getPlayerCount", e);
            return new Error(e);
        }
    },

    getAllPlayerDataTableSelected: async function(data, column, start, length, sort) {
        try {
            return await playerModel.find(data).select(column).skip(start).limit(length).sort(sort);
        } catch (e) {
            console.log("PlayerServices Error in getAllPlayerDataSelected", e);
            return new Error(e);
        }
    },

    getSinglePlayerData: async function(data, column) {
        try {
            return await playerModel.findOne(data).select(column);
        } catch (e) {
            console.log("PlayerServices Error in getSinglePlayerData", e);
            return new Error(e);
        }
    },

    updateManyData: async function(data) {
        try {
            return await playerModel.updateMany({}, {
                $pull: {
                    hall: { _id: data },
                    hallId: data
                }
            }, { multi: true });
        } catch (e) {
            console.log(" Error in updateManyData", e);
            return new Error(e);
        }
    },

    updateManyDataDailyAttendance: async function(condition, data) {
        try {
            return await playerModel.updateMany(condition, data);
        } catch (e) {
            console.log(" Error in updateManyDataDailyAttendance", e);
            return new Error(e);
        }
    },

    getSinglePlayer: async function(data) {
        try {
            return await playerModel.findOne(data);
        } catch (e) {
            console.log("PlayerServices Error in getSinglePlayer", e);
            return new Error(e);
        }
    },

    getPlayerDatatable: async function(query, length, start, column, sort) {
        try {
            if (length == -1) {
                return await playerModel.find(query).lean();
            } else {
                return await playerModel.find(query).skip(start).limit(length).select(column).sort(sort).lean();
            }
        } catch (e) {
            console.log("PlayerServices Error in getPlayerDataTable", e);
            return new Error(e);
        }
    },
    getPlayerDatatableNew: async function(query, length, start, sort) {
        try {
            return await playerModel.find(query).skip(start).limit(length).sort(sort);
        } catch (e) {
            console.log("PlayerServices Error in getPlayerDataTable", e);
            return new Error(e);
        }
    },

    insertPlayerData: async function(data) {
        try {
            data.uniqId = 'SP' + (await playerModel.countDocuments({}) + 1000);
            console.log("UniqId", data.uniqId)
            return await playerModel.create(data);
        } catch (e) {
            console.log("PlayerServices Error in insertPlayerData", e);
            return new Error(e);
        }
    },

    deletePlayer: async function(data) {
        try {
            return await playerModel.deleteOne({ _id: data });
        } catch (e) {
            console.log("PlayerServices Error in deletePlayer", e);
            return new Error(e);
        }
    },

    updatePlayerData: async function(condition, data) {
        try {
            return await playerModel.updateOne(condition, data);
        } catch (e) {
            console.log("PlayerServices Error in updatePlayerData", e);
            return new Error(e);
        }
    },
    update: async function(id, query) {
        try {
            let player = await playerModel.updateOne({ _id: id }, query, { new: true });
            return player;
        } catch (error) {
            Sys.Log.info('Error in Update Player : ' + error);
        }
    },
    getLimitPlayer: async function(data) {
        try {
            return await playerModel.find(data).limit(8).sort({ createdAt: -1 });
        } catch (e) {
            console.log("PlayerServices Error in getLimitPlayer", e);
            return new Error(e);
        }
    },

    getTopPlayer: async function(data) {
        try {
            return await playerModel.find(data).limit(5).sort({ walletAmount: -1 });
        } catch (e) {
            console.log("PlayerServices Error in getTopPlayer", e);
            return new Error(e);
        }
    },

    getTopPlayerWithLean: async function(data) {
        try {
            return await playerModel.find(data).limit(5).sort({ points: -1 }).lean();
        } catch (e) {
            console.log("PlayerServices Error in getTopPlayer", e);
            return new Error(e);
        }
    },

    getLimitedPlayerWithSort: async function(data, limit, sortBy, sortOrder) {
        try {
            return await playerModel.find(data).sort({ chips: sortOrder }).limit(limit);
        } catch (e) {
            console.log("PlayerServices Error in getLimitedPlayerWithSort", e);
            return new Error(e);
        }
    },

    aggregateQuery: async function(data) {
        try {
            return await playerModel.aggregate(data);
        } catch (e) {
            console.log("PlayerServices Error in aggregateQuery", e);
            return new Error(e);
        }
    },

    updateMultiplePlayerData: async function(condition, data) {
        try {
            await playerModel.update(condition, data, { multi: true });
        } catch (e) {
            console.log("PlayerServices Error in updateMultiplePlayerData", e);
            return new Error(e);
        }
    },

    getPlayerExport: async function(query, pageSize) {
        try {
            return await playerModel.find(query).limit(pageSize);
        } catch (e) {
            console.log("PlayerServices Error in getPlayerExport", e);
            return new Error(e);
        }
    },

    getLoggedInTokens: async function() {
        try {
            return await playerModel.find({ loginToken: { $ne: null } }).select({ loginToken: 1, _id: 0 });
        } catch (e) {
            console.log("Error", e);
            return new Error(e);
        }
    },
    insertPlayersData: async function(data) {
        try {
            return await playerModel.create(data);
        } catch (e) {
            console.log("AgentServices Error in insertPlayerData", e);
            return new Error(e);
        }
    },
    bulkWritePlayerData: async function (data,option = null) {
        try {
            return await playerModel.bulkWrite(data,option);
        } catch (error) {
            console.log("Error in bulkWritePlayerData", error);
            return new Error(error);
        }
    },


    getSinglePlayerSession: async function (data, select, setOption, session) {
        try {
            return await playerModel.findOne(data, select, setOption).session(session);
        } catch (e) {
            console.log("Error in getSinglePlayerSession:", e);
        }
    },

    findOneandUpdatePlayer: async function (condition, query, filter, session) {
        try {
            return await playerModel.findOneAndUpdate(condition, query, filter);
        } catch (e) {
            console.log("Error in getSinglePlayerSession", e);
        }
    },

    updatePlayerSession: async function (condition, query, filter, session) {
        try {
            return await playerModel.findOneAndUpdate(condition, query, filter).session(session);
        } catch (e) {
            console.log("Error in getSinglePlayerSession", e);
        }
    },

    insertPlayerTransactionSession: async function (transactionData, session) {
        try {
            const transaction = new transactionModel(transactionData);
            return transaction.save({ session });
        } catch (e) {
            console.log("Error", e);
        }
    },

    // Method to update many players - for BankID functionality
    updateManyPlayers: async function(condition, data, options = {}) {
        try {
            return await playerModel.updateMany(condition, data, options);
        } catch (e) {
            console.log("PlayerServices Error in updateManyPlayers", e);
            return new Error(e);
        }
    },

    // Method to get all players with optional select fields - for BankID functionality
    getAllPlayersData: async function(condition, select = {}, options = {}) {
        try {
            return await playerModel.find(condition, select, options).lean();
        } catch (e) {
            console.log("PlayerServices Error in getAllPlayersData", e);
            return new Error(e);
        }
    },

    getSinglePlayerByData: async function(condition, select = {}, options = {}) {
        try {
            return await playerModel.findOne(condition, select, options).lean();
        } catch (e) {
            console.log("PlayerServices Error in getPlayerByData", e);
            return new Error(e);
        }
    }

}