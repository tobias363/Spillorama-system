'use strict';

const mongoose = require('mongoose');
var Sys = require('../../Boot/Sys');
const depositModel = mongoose.model('DepositMoney');

module.exports = {

    getById: async function(id) {
        try {
            return await depositModel.findById(id);
        } catch (error) {
            console.log('DepositServices Error in getById : ', error);
        }
    },

    getSingleData: async function(data, column) {
        try {
            return await depositModel.findOne(data);
        } catch (e) {
            console.log("DepositServices Error in getSingleData", e);
            return new Error(e);
        }
    },


    getByData: async function(data) {
        try {
            return await depositModel.find(data);
        } catch (e) {
            console.log("DepositServices Error in getByData", e);
            return new Error(e);
        }
    },


    insertData: async function(data) {
        try {

            return await depositModel.create(data);
        } catch (e) {
            console.log("DepositServices Error in insertData", e);
            return new Error(e);
        }
    },

    updateData: async function(condition, data) {
        try {
            return await depositModel.updateOne(condition, data);
        } catch (e) {
            console.log("DepositServices Error in updateData", e);
            return new Error(e);
        }
    },

    getSingleByData: async function (data, select, setOption) {
        try {
            return await depositModel.findOne(data, select, setOption).lean();
        } catch (e) {
            console.log("Error in getSingleByData:", e);
        }
    },

    getTransactionByData: async function (data, select, setOption) {
        try {
            return await depositModel.find(data, select, setOption);
        } catch (e) {
            console.log("Error in getSingleByData:", e);
        }
    },

    updateManyData: async function (condition, data) {
        try {
            return await depositModel.updateMany(condition, data);
        } catch (e) {
            console.log("Error in updateManyData:", e);
        }
    },

}