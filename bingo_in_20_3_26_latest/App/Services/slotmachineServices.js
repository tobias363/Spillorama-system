'use strict';

const mongoose = require('mongoose');
const slotMachineModel = mongoose.model('SlotMachine');

module.exports = {
    getByData: async function (data, select, setOption) {
        try {
            return await slotMachineModel.find(data, select, setOption);  // setOption(sort, limit,skip)
        } catch (e) {
            //console.log("Error",e);
            throw new Error('error in getByData' + e.message);
        }
    },

    getById: async function (id, select) {
        try {
            return await slotMachineModel.findById(id, select);
        } catch (error) {
            console.log('GameServices Error in getById : ', error);
        }
    },

    getCount: async function (data) {
        try {
            return await slotMachineModel.countDocuments(data);
        } catch (e) {
            console.log("Error", e);
        }
    },

    getSingleData: async function (data, select, setOption) {
        try {
            return await slotMachineModel.findOne(data, select, setOption).lean();
        } catch (e) {
            console.log("Error in getSingleData:", e);
        }
    },

    insertData: async function (data) {
        try {
            return await slotMachineModel.create(data);
        } catch (e) {
            console.log("Error", e);
        }
    },

    deleteData: async function (data) {
        try {
            return await slotMachineModel.deleteOne(data);
        } catch (e) {
            console.log("Error", e);
        }
    },

    updateData: async function (condition, data) {
        try {
            return await slotMachineModel.findOneAndUpdate(condition, data, { new: true });
        } catch (e) {
            console.log("updateData", e);
        }
    },

    updateOneData: async function (condition, data) {
        try {
            return await slotMachineModel.updateOne(condition, data);
        } catch (e) {
            console.log("updateData", e);
        }
    },

    aggregateQuery: async function (data) {
        try {
            return await slotMachineModel.aggregate(data);
        } catch (e) {
            console.log("Error in gameservice aggregateQuery", e);
        }
    },
}