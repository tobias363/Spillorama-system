'use strict';
const mongoose = require('mongoose');
var Sys = require('../../Boot/Sys');
const VoucherModel = mongoose.model('Voucher');


module.exports = {

    getByData: async function(data) {
        try {
            return await VoucherModel.find(data);
        } catch (e) {
            console.log("VoucherServices Error in getByData", e);
            return new Error(e);
        }
    },

    getByDataStatus: async function(data) {
        try {
            return await VoucherModel.find(data).select(['_id', 'voucherId', 'voucherCode', 'voucherType', 'points', 'expiryDate']);;
        } catch (e) {
            console.log("VoucherServices Error in getByDataStatus", e);
            return new Error(e);
        }
    },


    voucherData: async function(data) {
        try {
            return await VoucherModel.find(data).lean();
        } catch (e) {
            console.log("VoucherServices Error in getByDataStatus", e);
            return new Error(e);
        }
    },


    getById: async function(id) {
        try {
            return await VoucherModel.findById(id);
        } catch (error) {
            console.log('VoucherServices Error in getById : ', error);
        }
    },

    getDatatable: async function(query, length, start, sort) {
        try {
            return await VoucherModel.find(query).skip(start).limit(length).sort(sort);
        } catch (e) {
            console.log("VoucherServices Error in getPlayerData", e);
            return new Error(e);
        }
    },

    getCount: async function(data) {
        try {
            return await VoucherModel.countDocuments(data);
        } catch (e) {
            console.log("VoucherServices Error in getAgentCount", e);
            return new Error(e);
        }
    },

    getSingleData: async function(data, column) {
        try {
            return await VoucherModel.findOne(data).select(column);
        } catch (e) {
            console.log("VoucherServices Error in getSingleHallData", e);
            return new Error(e);
        }
    },

    getSingle: async function(data) {
        try {
            return await VoucherModel.findOne(data);
        } catch (e) {
            console.log("VoucherServices Error in getSingle", e);
            return new Error(e);
        }
    },


    insertData: async function(data) {
        try {

            return await VoucherModel.create(data);
        } catch (e) {
            console.log("VoucherServices Error in insertPlayerData", e);
            return new Error(e);
        }
    },

    delete: async function(data) {
        try {
            return await VoucherModel.deleteOne({ _id: data });
        } catch (e) {
            console.log("VoucherServices Error in deletePlayer", e);
            return new Error(e);
        }
    },

    updateData: async function(condition, data) {
        try {
            return await VoucherModel.updateOne(condition, data);
        } catch (e) {
            console.log("VoucherServices Error in updatePlayerData", e);
            return new Error(e);
        }
    },

    aggregateQuery: async function(data) {
        try {
            return await VoucherModel.aggregate(data);
        } catch (e) {
            console.log("VoucherServices Error in aggregateQuery", e);
            return new Error(e);
        }
    },
}