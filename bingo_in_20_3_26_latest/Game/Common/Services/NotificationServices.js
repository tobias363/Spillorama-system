'use strict';
var Sys = require('../../../Boot/Sys');
const mongoose = require('mongoose');
const notificationModel = mongoose.model('notification');

module.exports = {

    create: async function(data) {
        try {
            return await notificationModel.create(data);
        } catch (error) {
            console.log("ChipsServices  Error in createTransaction", error);
            return new Error(error);
        }
    },

    FindOneUpdate: async function(data, query) {
        try {
            let player = await notificationModel.findOneAndUpdate(data, query, { new: true, useFindAndModify: false });
            return player;
        } catch (error) {
            console.log("Error in FindOneUpdate :", error);
            return new Error(error);
        }
    },

    updateManyData: async function (condition, data, options = { }) {
        try {
            return await notificationModel.updateMany(condition, data, options);
        } catch (e) {
            console.log(" Error in updateManyData ticket", e);
            return new Error(e);
        }
    },

    getOneByData: async function(data, select, setOption) {
        try {
            return await notificationModel.findOne(data, select, setOption);
        } catch (error) {
            console.log("Error in getOneByData :", error);
            return new Error(error);
        }
    },

    getByData: async function(data, select, setOption) {
        try {
            return await notificationModel.find(data, select, setOption).sort({createdAt:-1}).limit(20);
        } catch (error) {
            console.log("Error in getByData :", error);
            return new Error(error);
        }
    },

    countDocuments: async function(id) {
        try {
            return await notificationModel.countDocuments(id);
        } catch (error) {
            console.log("Error in countDocuments :", error);
            return new Error(error);
        }
    },

    deleteNotification: async function(data) {
        try {
            return await notificationModel.deleteOne(data);
        } catch (error) {
            console.log("Error in deleteNotification", error);
            return new Error(error);
        }
    },

    bulkWriteNotification: async function(data) {
        try {
            return await notificationModel.bulkWrite(data);
        } catch (error) {
            console.log("Error in bulkWriteNotification", error);
            return new Error(error);
        }
    },
}