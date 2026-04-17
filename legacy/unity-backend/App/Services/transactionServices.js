'use strict';
var Sys = require('../../Boot/Sys');

const mongoose = require('mongoose');
const transactionModel = mongoose.model('transactions');
const depositTransactionModel = mongoose.model('DepositMoney');
const withdrawTransactionModel = mongoose.model('Withdraw');
const tickets = mongoose.model('Ticket');
const riskCountryModel = mongoose.model('riskCountry');
const dailyTransactionsModel = mongoose.model('dailyTransactions');
module.exports = {

    getDatatableDeposit: async function(query, length, start, sort) {
        try {
            return await depositTransactionModel.find(query).skip(start).limit(length).sort(sort);
        } catch (e) {
            console.log("Error", e);
        }
    },
    getCountDeposit: async function(data) {
        try {
            return await depositTransactionModel.countDocuments(data);
        } catch (e) {
            console.log("Error", e);
        }
    },
    
    getByDataDeposit: async function(data) {
        try {
            return await depositTransactionModel.find(data);
        } catch (e) {
            console.log("Error", e);
        }
    },

    getDepositsByData: async function (data, select, setOption) {
        try {
            return await depositTransactionModel.find(data, select, setOption);  // setOption(sort, limit,skip)
        } catch (e) {
            throw new Error('error in getDepositsByData' + e.message);
        }
    },

    createTransaction: async function(data) {
        try {
            return await transactionModel.create(data);
        } catch (error) {
            Sys.Log.info('Error in createTransaction : ' + error);
        }
    },
    getById: async function(id) {
        try {
            return await transactionModel.findById(id);
        } catch (error) {
            Sys.Log.info('Error in getById : ' + error);
        }
    },
    getByData: async function(data) {
        // console.log('Find By Data:', data)
        try {
            return await transactionModel.find(data).sort({ "createdAt": -1 }).lean();
        } catch (e) {
            console.log("Error", e);
        }
    },
    getByDataNew: async function(data) {
        // console.log('Find By Data:', data)
        try {
            return await transactionModel.find(data);
        } catch (e) {
            console.log("Error", e);
        }
    },
    getDatatable: async function(query, length, start, sort) {
        try {
            return await transactionModel.find(query).skip(start).limit(length).sort(sort);
        } catch (e) {
            console.log("Error", e);
        }
    },
    getCount: async function(data) {
        try {
            return await transactionModel.countDocuments(data);
        } catch (e) {
            console.log("Error", e);
        }
    },
    getCountCommission: async function(data) {
        try {
            return await CommissionModel.countDocuments(data);
        } catch (e) {
            console.log("Error", e);
        }
    },
    getByDataCommission: async function(data) {
        try {
            return await CommissionModel.find(data);
        } catch (e) {
            console.log("Error", e);
        }
    },
    getCommissionaggregateQuery: async function(data) {
        try {
            return await CommissionModel.aggregate(data);
        } catch (e) {
            console.log("Error", e);
        }
    },

    getTicketDataLimited: async function (query, start, length = null,sort) {
        try {
            return await tickets.find(query).skip(start).limit(length).sort(sort);
        } catch (e) {
            console.log("Error", e);
        }
    },

    getTicketCount: async function (data) {
        try {
            return await tickets.countDocuments(data);
        } catch (e) {
            console.log("Error", e);
        }
    },

    deleteManyTransactions: async function (data) {
        try {
            return await transactionModel.deleteMany(data);
        } catch (e) {
            console.log("Error", e);
        }
    },

    updateManyTransactions: async function (query,update) {
        try {
            return await depositTransactionModel.updateMany(query,update);
        } catch (e) {
            console.log("Error", e);
        }
    },

    getTransactionsByData: async function (data, select, setOption) {
        try {
            return await transactionModel.find(data, select, setOption).lean();  // setOption(sort, limit,skip)
        } catch (e) {
            //console.log("Error",e);
            throw new Error('error in getTransactionsByData' + e.message);
        }
    },

    addRiskCountry: async function (data) {
        try {
            return await riskCountryModel.create(data);
        } catch (e) {
            console.log("Error in addRiskCountry", e);
        }
    },

    getRiskCountryDatatable: async function (query, length, start, sort) {
        try {
            return await riskCountryModel.find(query).skip(start).limit(length).sort(sort);
        } catch (e) {
            console.log("Error in getRiskCountryDatatable", e);
        }
    },

    getRiskCountryCount: async function (query) {
        try {
            return await riskCountryModel.countDocuments(query);
        } catch (e) {
            console.log("Error in getRiskCountryCount", e);
        }
    },

    getSingleRiskCountryData: async function (query) {
        try {
            return await riskCountryModel.findOne(query);
        } catch (e) {
            console.log("Error in getSingleRiskCountryData", e);
        }
    },

    deleteRiskCountry: async function (id) {
        try {
            return await riskCountryModel.findByIdAndDelete(id);
        } catch (e) {
            console.log("Error in deleteRiskCountry", e);
        }
    },

    dailyTransactionUpdate: async function (query,data) {
        try {
            return await dailyTransactionsModel.findOneAndUpdate(query, data, {upsert: true});
        } catch (e) {
            console.log("Error in dailyTransactionUpdate", e);
        }
    },
    getDataByAggre: async function (query) {
        try {
            return await dailyTransactionsModel.aggregate(query);
        } catch (e) {
            console.log("Error in getDataByAggre", e);
        }
    },

    getRiskCountry: async function (data){
        try {
            return await riskCountryModel.find(data);
        } catch (e) {
            console.log("Error in getRiskCountry", e);
        }
    },

    getCountWithdraw: async function(data) {
        try {
            return await withdrawTransactionModel.countDocuments(data);
        } catch (e) {
            console.log("Error", e);
        }
    },
    updateManyWithdraw: async function (query,update) {
        try {
            return await withdrawTransactionModel.updateMany(query,update);
        } catch (e) {
            console.log("Error", e);
        }
    },
}