'use strict';
const { data } = require('jquery');
const mongoose = require('mongoose');
var Sys = require('../../Boot/Sys');
const hallModel = mongoose.model('hall');
const groupHallModel = mongoose.model('groupHall');
const hallReportModel = mongoose.model('hallReport');
const hallCashSafeTransactionModel = mongoose.model('hallCashSafeTransaction');
module.exports = {

    getByData: async function(data,select = {}) {
        try {
            return await hallModel.find(data).select(select);
        } catch (e) {
            console.log("HallServices Error in getByData", e);
            return new Error(e);
        }
    },
    getById: async function(id) {
        try {
            return await hallModel.findById(id);
        } catch (error) {
            console.log('HallServices Error in getById : ', error);
        }
    },

    updateManyDataById: async function(query, data) {
        try {
            return await hallModel.updateMany(query, data);
        } catch (error) {
            console.log('HallServices Error in updateManyDataById : ', error);
        }
    },

    getHallDatatable: async function(query, length, start, sort) {
        try {
            return await hallModel.find(query).skip(start).limit(length).sort(sort);
        } catch (e) {
            console.log("HallServices Error in getPlayerData", e);
            return new Error(e);
        }
    },

    getHallCount: async function(data) {
        try {
            return await hallModel.countDocuments(data);
        } catch (e) {
            console.log("HallServices Error in getAgentCount", e);
            return new Error(e);
        }
    },

    getSingleHallData: async function(data, column) {
        try {
            return await hallModel.findOne(data).select(column);
        } catch (e) {
            console.log("HallServices Error in getSingleHallData", e);
            return new Error(e);
        }
    },

    getSingleHall: async function(data) {
        try {
            return await hallModel.findOne(data);
        } catch (e) {
            console.log("HallServices Error in getSingleHall", e);
            return new Error(e);
        }
    },

    getAllHallDataSelect: async function(data, column) {
        try {
            return await hallModel.find(data).select(column);
        } catch (e) {
            console.log("HallServices Error in getAllHallDataSelect", e);
            return new Error(e);
        }
    },

    getHallSelectDatatable: async function(query, length, start, column) {
        try {
            if (length == -1) {
                return await hallModel.find(query).lean();
            } else {
                return await hallModel.find(query).skip(start).limit(length).select(column).lean();
            }
        } catch (e) {
            console.log("HallServices Error in getPlayerDataTable", e);
            return new Error(e);
        }
    },

    insertHallData: async function(data) {
        try {

            return await hallModel.create(data);
        } catch (e) {
            console.log("HallServices Error in insertPlayerData", e);
            return new Error(e);
        }
    },

    deleteHall: async function(data) {
        try {
            return await hallModel.deleteOne({ _id: data });
        } catch (e) {
            console.log("HallServices Error in deletePlayer", e);
            return new Error(e);
        }
    },

    updateHallData: async function(condition, data) {
        try {
            return await hallModel.updateOne(condition, data);
        } catch (e) {
            console.log("HallServices Error in updatePlayerData", e);
            return new Error(e);
        }
    },

    updateHall: async function (condition, query, filter) {
        try {
            return await hallModel.findOneAndUpdate(condition, query, filter);
        } catch (e) {
            console.log("updateHall", e);
        }
    },

    updateManyData: async function(data) {
        try {
            return await hallModel.updateMany({}, {
                $pull: {
                    agents: { _id: data },
                }
            }, { multi: true });
        } catch (e) {
            console.log(" Error in updateManyData", e);
            return new Error(e);
        }
    },
    
    getLimitHall: async function(data) {
        try {
            return await hallModel.find(data).limit(8).sort({ createdAt: -1 });
        } catch (e) {
            console.log("HallServices Error in getLimitPlayer", e);
            return new Error(e);
        }
    },

    aggregateQuery: async function(data) {
        try {
            return await hallModel.aggregate(data);
        } catch (e) {
            console.log("HallServices Error in aggregateQuery", e);
            return new Error(e);
        }
    },
   
    getGroupHallByData: async function(data) {
        try {
            return await groupHallModel.find(data);
        } catch (e) {
            console.log("HallServices Error in getGroupHallByData", e);
            return new Error(e);
        }
    },

    getGroupHallById: async function(id) {
        try {
            return await groupHallModel.findById(id);
        } catch (error) {
            console.log('HallServices Error in getById : ', error);
        }
    },

    getGroupOfHallsByData: async function (data, select, setOption) {
        try {
            return await groupHallModel.find(data, select, setOption).lean();
        } catch (e) {
            console.log("Error in getGroupOfHallsByData:", e);
        }
    },

    getPopulatedHall: async function (query, length = null, start = null, column = null) {
        try {
            // .skip(start).limit(length).select(column).
            console.log("query",query);
            return await hallModel.find(query).lean(); //.populate('products')
        } catch (e) {
            console.log("HallServices Error in getPopulatedHall", e);
            return new Error(e);
        }
    },

    getSinglePopulatedHall: async function (query) {
        try {
            return await hallModel.findOne(query).populate('products').lean();
        } catch (e) {
            console.log("HallServices Error in getSinglePopulatedHall", e);
            return new Error(e);
        }
    },

    getHallsByData: async function (data, select, setOption) {
        try {
            return await hallModel.find(data, select, setOption).lean();
        } catch (e) {
            console.log("Error in getHallsByData:", e);
        }
    },

    getSingleHallByData: async function (data, select, setOption) {
        try {
            return await hallModel.findOne(data, select, setOption).lean();
        } catch (e) {
            console.log("Error in getSingleHallByData:", e);
        }
    },

    // Hall Report services
    insertHallReportData: async function(data) {
        try {
            return await hallReportModel.create(data);
        } catch (e) {
            console.log("Error in inserting hall report data", e);
            return new Error(e);
        }
    },

    getSingleHallReportData: async function (data, select, setOption) {
        try {
            return await hallReportModel.findOne(data, select, setOption).lean();
        } catch (e) {
            console.log("Error in getSingleHallReportData:", e);
        }
    },

    updateHalReportData: async function (condition, data) {
        try {
            return await hallReportModel.findOneAndUpdate(condition, data, { new: true });
        } catch (e) {
            console.log("updateHalReportData", e);
        }
    },


    getSingleHallSession: async function (data, select, setOption, session) {
        try {
            return await hallModel.findOne(data, select, setOption).session(session);
        } catch (e) {
            console.log("Error in getSingleHallSession:", e);
        }
    },

    updateHallSession: async function (condition, query, filter, session) {
        try {
            return await hallModel.findOneAndUpdate(condition, query, filter).session(session);;
        } catch (e) {
            console.log("Error in updateHallSession", e);
        }
    },

    // hall Cash & Safe Transaction services

    getCashSafeByData: async function (data, select, setOption) {
        try {
            return await hallCashSafeTransactionModel.find(data, select, setOption);  // setOption(sort, limit,skip)
        } catch (e) {
            //console.log("Error",e);
            throw new Error('error in getCashSafeByData' + e.message);
        }
    },

    getCashSafeById: async function (id, select) {
        try {
            return await hallCashSafeTransactionModel.findById(id, select);
        } catch (error) {
            console.log('GameServices Error in getCashSafeById : ', error);
        }
    },

    getCashSafeCount: async function (data) {
        try {
            return await hallCashSafeTransactionModel.countDocuments(data);
        } catch (e) {
            console.log("Error", e);
        }
    },

    getSingleCashSafeData: async function (data, select, setOption) {
        try {
            return await hallCashSafeTransactionModel.findOne(data, select, setOption).lean();
        } catch (e) {
            console.log("Error in getSingleCashSafeData:", e);
        }
    },

    getCashSafeDatatable: async function (query, length, start, sort) { //sort
        try {
            return await hallCashSafeTransactionModel.find(query).sort(sort).skip(start).limit(length).lean(); //.sort(sort)
        } catch (e) {
            console.log("Error getCashSafeDatatable :", e);
        }
    },

    insertCashSafeData: async function (data) {
        try {
            return await hallCashSafeTransactionModel.create(data);
        } catch (e) {
            console.log("Error", e);
        }
    },

    deleteCashSafe: async function (data) {
        try {
            return await hallCashSafeTransactionModel.deleteOne(data);
        } catch (e) {
            console.log("Error", e);
        }
    },

    updateCashSafeData: async function (condition, query, filter) {
        try {
            return await hallCashSafeTransactionModel.findOneAndUpdate(condition, query, filter);
        } catch (e) {
            console.log("updateCashSafeData", e);
        }
    },

    aggregateQueryCashSafe: async function (data) {
        try {
            return await hallCashSafeTransactionModel.aggregate(data);
        } catch (e) {
            console.log("Error in gameservice aggregateQueryCashSafe", e);
        }
    },


}