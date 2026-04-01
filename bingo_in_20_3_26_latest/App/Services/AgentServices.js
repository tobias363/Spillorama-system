'use strict';
const mongoose = require('mongoose');
var Sys = require('../../Boot/Sys');
const agentModel = mongoose.model('agent');
const agentShiftModel = mongoose.model('agentShift');
const agentTransactionModel = mongoose.model('agentTransaction');
const settlementModel = mongoose.model("settlement");
module.exports = {

    getByData: async function(data) {
        try {
            return await agentModel.find(data);
        } catch (e) {
            console.log("AgentServices Error in getByData", e);
            return new Error(e);
        }
    },

    getByDataForRole: async function(data, column) {
        try {
            return await agentModel.find(data).select(column);
        } catch (e) {
            console.log("AgentServices Error in getByData", e);
            return new Error(e);
        }
    },
    getSingleAgentData: async function(data) {
        try {
            return await agentModel.findOne(data);
        } catch (e) {
            console.log("AgentServices Error in getSingleAgentData", e);
            return new Error(e);
        }
    },
    getSingleAgentByData: async function(data, select, setOption) {
        try {
            return await agentModel.findOne(data, select, setOption).lean();
        } catch (e) {
            console.log("AgentServices Error in getSingleAgentByData", e);
            return new Error(e);
        }
    },
    getSingleAgentDataForRole: async function(data, column) {
        try {
            return await agentModel.findOne(data).select(column);
        } catch (e) {
            console.log("AgentServices Error in getSingleAgentDataForRole", e);
            return new Error(e);
        }
    },
    getSingleUserData: async function(data, column) {
        try {
            return await agentModel.findOne(data).select(column).limit(1).sort({_id:-1});
        } catch (e) {
            console.log("AgentServices Error in getSingleAgentDataForRole", e);
            return new Error(e);
        }
    },
    insertPlayerData: async function(data) {
        try {
            return await agentModel.create(data);
        } catch (e) {
            console.log("AgentServices Error in insertPlayerData", e);
            return new Error(e);
        }
    },
    FindOneUpdate: async function(id, query) {
        try {
            let player = await agentModel.findOneAndUpdate({ _id: id }, query, { new: true });
            return player;
        } catch (error) {
            Sys.Log.info('Error in Update Agent : ' + error);
        }
    },
    getAllAgentDataSelect: async function(data, column) {
        try {
            return await agentModel.find(data).select(column);
        } catch (e) {
            console.log("AgentServices Error in getSinglePlayerData", e);
            return new Error(e);
        }
    },
    getById: async function(id) {
        try {
            return await agentModel.findById(id);
        } catch (error) {
            console.log('AgentServices Error in getById : ', error);
        }
    },
    getAgentDatatable: async function(data, length, start, sort) {
        try {
            return await agentModel.find(data).skip(start).limit(length).sort(sort);
        } catch (e) {
            console.log("AgentServices Error in getPlayerData", e);
            return new Error(e);
        }
    },


    updateManyData: async function(data) {
        try {
            return await agentModel.updateMany({}, {
                $pull: {
                    hallName: { _id: data },
                }
            }, { multi: true });
        } catch (e) {
            console.log(" Error in updateManyData", e);
            return new Error(e);
        }
    },

    getAgentCount: async function(data) {
        try {
            return await agentModel.countDocuments(data);
        } catch (e) {
            console.log("AgentServices Error in getAgentCount", e);
            return new Error(e);
        }
    },

    insertAgentData: async function(data) {
        let session = await mongoose.startSession();
        session.startTransaction();
        try {
            data.uniqId = 'Bingo' + (await agentModel.countDocuments({}) + 1000);
            await agentModel.create(data);
            return true;
        } catch (e) {
            console.log("AgentServices Error in insertAgentData", e);
            await session.abortTransaction();
            session.endSession();
            return new Error(e);
        }
    },

    // insertAgentData: async function(data){
    //   let session = await mongoose.startSession();
    //   session.startTransaction();
    //     try {
    //       let tmpData = {
    //         name: 'test',
    //         email: 'test',            
    //         phone: 77,
    //         password : 'test',
    //         hallName: 'test'
    //       };
    //       let tmpData32 = {
    //         name: 'test',
    //         email: 'test',            
    //         phone: 'sdrr',
    //         password : 'test',
    //         hallName: 'test'
    //       };
    //       tmpData.uniqId = 'Bingo'+(await agentModel.countDocuments({}) + 1000);
    //       tmpData32.uniqId = 'Bingo'+(await agentModel.countDocuments({}) + 1000);
    //       let ss = await agentModel.create([tmpData], { session: session });
    //       let ss32 = await agentModel.create([tmpData32], { session: session });
    //       await session.commitTransaction();
    //       session.endSession();
    //       return true;
    //     } catch (e) {
    //       console.log("AgentServices Error in insertAgentData",e);
    //       await session.abortTransaction();
    //       session.endSession();
    //       return new Error(e);
    //     }
    // },

    deletePlayer: async function(data) {
        try {
            return await agentModel.deleteOne({ _id: data });
        } catch (e) {
            console.log("AgentServices Error in deletePlayer", e);
            return new Error(e);
        }
    },

    getPlayerDatatable: async function(query, length, start, column) {
        try {
            if (length == -1) {
                return await agentModel.find(query).lean();
            } else {
                return await agentModel.find(query).skip(start).limit(length).select(column).lean();
            }
        } catch (e) {
            console.log("AgentServices Error in getPlayerDataTable", e);
            return new Error(e);
        }
    },

    insertAgentData: async function(data) {
        try {
            data.uniqId = 'Bingo' + (await agentModel.countDocuments({}) + 1000);
            return await agentModel.create(data);
        } catch (e) {
            console.log("AgentServices Error in insertPlayerData", e);
            return new Error(e);
        }
    },

    agentCount: async function (data) {
        try {
            return await agentModel.countDocuments(data);
        } catch (e) {
            console.log("AgentServices Error in countAgent", e);
            return new Error(e);
        }
    }, 

    deletePlayer: async function(data) {
        try {
            return await agentModel.deleteOne({ _id: data });
        } catch (e) {
            console.log("AgentServices Error in deletePlayer", e);
            return new Error(e);
        }
    },

    updateAgentData: async function(condition, data) {
        try {
            return await agentModel.updateOne(condition, data);
        } catch (e) {
            console.log("AgentServices Error in updatePlayerData", e);
            return new Error(e);
        }
    },

    getLimitPlayer: async function(data) {
        try {
            return await agentModel.find(data).limit(8).sort({ createdAt: -1 });
        } catch (e) {
            console.log("AgentServices Error in getLimitPlayer", e);
            return new Error(e);
        }
    },

    getLimitedPlayerWithSort: async function(data, limit, sortBy, sortOrder) {
        try {
            return await agentModel.find(data).sort({ chips: sortOrder }).limit(limit);
        } catch (e) {
            console.log("AgentServices Error in getLimitedPlayerWithSort", e);
            return new Error(e);
        }
    },

    aggregateQuery: async function(data) {
        try {
            return await agentModel.aggregate(data);
        } catch (e) {
            console.log("AgentServices Error in aggregateQuery", e);
            return new Error(e);
        }
    },

    updateMultiplePlayerData: async function(condition, data) {
        try {
            await agentModel.updateMany(condition, data, { multi: true });
        } catch (e) {
            console.log("AgentServices Error in updateMultiplePlayerData", e);
            return new Error(e);
        }
    },

    updateManyAgents: async function(condition, data, options = {}) {
        try {
            return await agentModel.updateMany(condition, data, options);
        } catch (e) {
            console.log("AgentServices Error in updateManyAgents", e);
            return new Error(e);
        }
    },

    getPlayerExport: async function(query, pageSize) {
        try {
            return await agentModel.find(query).limit(pageSize);
        } catch (e) {
            console.log("AgentServices Error in getPlayerExport", e);
            return new Error(e);
        }
    },

    getLoggedInTokens: async function() {
        try {
            return await agentModel.find({ loginToken: { $ne: null } }).select({ loginToken: 1, _id: 0 });
        } catch (e) {
            console.log("Error", e);
            return new Error(e);
        }
    },

    updateAgentNested: async function(condition, query, filter) {
        try {
            let tickets = await agentModel.findOneAndUpdate(condition, query, filter);
            return tickets;
        } catch (error) {
            console.log("Error in Update Ticket :",error);
            Sys.Log.info('Error in Update Ticket : ' + error);
        }
    },

    // Agent shift services

    getShiftByData: async function (data, select, setOption) {
        try {
            return await agentShiftModel.find(data, select, setOption);  // setOption(sort, limit,skip)
        } catch (e) {
            //console.log("Error",e);
            throw new Error('error in getShiftByData' + e.message);
        }
    },

    getShiftById: async function (id, select) {
        try {
            return await agentShiftModel.findById(id, select);
        } catch (error) {
            console.log('GameServices Error in getShiftById : ', error);
        }
    },

    getShiftCount: async function (data) {
        try {
            return await agentShiftModel.countDocuments(data);
        } catch (e) {
            console.log("Error", e);
        }
    },

    getSingleShiftData: async function (data, select, setOption) {
        try {
            return await agentShiftModel.findOne(data, select, setOption).lean();
        } catch (e) {
            console.log("Error in getSingleShiftData:", e);
        }
    },

    getShiftDatatable: async function (query, length, start, sort) { //sort
        try {
            return await agentShiftModel.find(query).sort(sort).skip(start).limit(length).lean(); //.sort(sort)
        } catch (e) {
            console.log("Error getShiftDatatable :", e);
        }
    },

    insertShiftData: async function (data) {
        try {
            return await agentShiftModel.create(data);
        } catch (e) {
            console.log("Error", e);
        }
    },

    deleteShift: async function (data) {
        try {
            return await agentShiftModel.deleteOne(data);
        } catch (e) {
            console.log("Error", e);
        }
    },

    updateShiftData: async function (condition, query, filter) {
        try {
            return await agentShiftModel.findOneAndUpdate(condition, query, filter);
        } catch (e) {
            console.log("updateShiftData", e);
        }
    },

    aggregateQueryShift: async function (data) {
        try {
            return await agentShiftModel.aggregate(data);
        } catch (e) {
            console.log("Error in gameservice aggregateQueryShift", e);
        }
    },

    updateManyShiftData: async function(condition, data) {
        try {
            return await agentShiftModel.updateMany(condition, data);
        } catch (e) {
            console.log(" Error in updateManyShiftData", e);
            return new Error(e);
        }
    },


    // Agent transaction services

    getAgentTransactionByData: async function (data, select, setOption) {
        try {
            return await agentTransactionModel.find(data, select, setOption);  // setOption(sort, limit,skip)
        } catch (e) {
            //console.log("Error",e);
            throw new Error('error in getAgentTransactionByData' + e.message);
        }
    },

    getAgentTransactionById: async function (id, select) {
        try {
            return await agentTransactionModel.findById(id, select);
        } catch (error) {
            console.log('GameServices Error in getAgentTransactionById : ', error);
        }
    },

    getAgentTransactionCount: async function (data) {
        try {
            return await agentTransactionModel.countDocuments(data);
        } catch (e) {
            console.log("Error", e);
        }
    },

    getSingleAgentTransactionData: async function (data, select, setOption) {
        try {
            return await agentTransactionModel.findOne(data, select, setOption).lean();
        } catch (e) {
            console.log("Error in getSingleAgentTransactionData:", e);
        }
    },

    getAgentTransactionDatatable: async function (query, length, start, sort) { //sort
        try {
            return await agentTransactionModel.find(query).sort(sort).skip(start).limit(length).lean(); //.sort(sort)
        } catch (e) {
            console.log("Error getAgentTransactionDatatable :", e);
        }
    },

    insertAgentTransactionData: async function (data) {
        try {
            return await agentTransactionModel.create(data);
        } catch (e) {
            console.log("Error", e);
        }
    },

    deleteAgentTransaction: async function (data) {
        try {
            return await agentTransactionModel.deleteOne(data);
        } catch (e) {
            console.log("Error", e);
        }
    },

    updateAgentTransactionData: async function (condition, query, filter) {
        try {
            return await agentTransactionModel.findOneAndUpdate(condition, query, filter);
        } catch (e) {
            console.log("Error in updateAgentTransactionData", e);
        }
    },

    aggregateQueryAgentTransaction: async function (data) {
        try {
            return await agentTransactionModel.aggregate(data);
        } catch (e) {
            console.log("Error in gameservice aggregateQueryAgentTransaction", e);
        }
    },


    insertAgentTransactionSession: async function (transactionData, session) {
        try {
            const transaction = new agentTransactionModel(transactionData);
            return transaction.save({ session });
        } catch (e) {
            console.log("Error", e);
        }
    },

    updateShiftSession: async function (condition, query, filter, session) {
        try {
            return await agentShiftModel.findOneAndUpdate(condition, query, filter).session(session);;
        } catch (e) {
            console.log("Error in updateHallSession", e);
        }
    },

    // settlement services
   
    getSettlementByData: async function (data, select, setOption) {
        try {
            return await settlementModel.find(data, select, setOption);  // setOption(sort, limit,skip)
        } catch (e) {
            //console.log("Error",e);
            throw new Error('error in getSettlementByData' + e.message);
        }
    },

    getSettlementById: async function (id, select) {
        try {
            return await settlementModel.findById(id, select);
        } catch (error) {
            console.log('GameServices Error in getSettlementById : ', error);
        }
    },

    getSettlementCount: async function (data) {
        try {
            return await settlementModel.countDocuments(data);
        } catch (e) {
            console.log("Error", e);
        }
    },

    getSingleSettlementData: async function (data, select, setOption) {
        try {
            return await settlementModel.findOne(data, select, setOption).lean();
        } catch (e) {
            console.log("Error in getSingleSettlementData:", e);
        }
    },

    insertSettlementData: async function (data) {
        try {
            return await settlementModel.create(data);
        } catch (e) {
            console.log("Error", e);
        }
    },

    deleteSettlement: async function (data) {
        try {
            return await settlementModel.deleteOne(data);
        } catch (e) {
            console.log("Error", e);
        }
    },

    updateSettlementData: async function (condition, query, filter) {
        try {
            return await settlementModel.findOneAndUpdate(condition, query, filter);
        } catch (e) {
            console.log("Error in updateSettlementData", e);
        }
    },

    aggregateQuerySettlement: async function (data) {
        try {
            return await settlementModel.aggregate(data);
        } catch (e) {
            console.log("Error in gameservice aggregateQuerySettlement", e);
        }
    },

}