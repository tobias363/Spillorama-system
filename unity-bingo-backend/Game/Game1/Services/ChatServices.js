'use strict';

const mongoose = require('mongoose');
var Sys = require('../../../Boot/Sys');
const Model = mongoose.model('Chats');


module.exports = {

    insertData: async function(data) {
        try {
            return await Model.create(data);
        } catch (e) {
            console.log("Error", e);
            throw new Error('error in insertData' + e.message);
        }
    },
    getById: async function(id) {
        try {
            return await Model.findById(id);
        } catch (error) {
            Sys.Log.info('Error in getByData : ' + error);
        }
    },
    getDistinct: async function(field, data) {
        try {
            return await Model.distinct(field, data);
        } catch (error) {
            Sys.Log.info('Error in getDistinct : ' + error);
        }
    },
    getByData: async function(data) {
        // console.log('Find By Data:', data)
        try {
            return await Model.find(data);
        } catch (e) {
            console.log("Error", e);
        }
    },

    getPlayerData: async function(data) {
        try {
            return await Model.find(data);
        } catch (e) {
            console.log("Error", e);
        }
    },
    getDataSort: async function(data) {
        try {
            return await Model.find(data).sort({ "createdAt": -1 });
        } catch (e) {
            console.log("Error", e);
        }
    },

    getCount: async function(data) {
        try {
            return await Model.countDocuments(data);
        } catch (e) {
            console.log("Error", e);
        }
    },



    getDatatable: async function(query, length, start) {
        try {
            return await Model.find(query).skip(start).limit(length);
        } catch (e) {
            console.log("Error", e);
        }
    },



    delete: async function(data) {
        try {
            await Model.deleteOne({ _id: data });
        } catch (e) {
            console.log("Error", e);
        }
    },

    updateData: async function(condition, data) {
        try {
            return await Model.updateOne(condition, data, { multi: true });
        } catch (e) {
            console.log(" Error in updateData", e);
            return new Error(e);
        }
    },


    updateManyData: async function(condition, data) {
        try {
            return await Model.updateMany(condition, data);
        } catch (e) {
            console.log(" Error in updateData", e);
            return new Error(e);
        }
    },


    getLimit: async function(data) {
        try {
            return await Model.find(data).limit(8).sort({ createdAt: -1 });
        } catch (e) {
            console.log("Error", e);
        }
    },

    aggregateQuery: async function(data) {
        try {
            return await Model.aggregate(data);
        } catch (e) {
            console.log("Error", e);
        }
    },
    getSingleData: async function(data) {
        try {
            return await Model.findOne(data);
        } catch (e) {
            console.log("Error", e);
            return new Error(e);
        }
    },
    getSort: async function(data) {
        try {
            return await Model.sort(data);
        } catch (e) {
            console.log("Error", e);
            return new Error(e);
        }
    },

    updateMultipleData: async function(condition, data) {
        try {
            await Model.updateMany(condition, data, { multi: true });
        } catch (e) {
            console.log("Error", e);
        }
    },

    getExport: async function(query, pageSize) {
        try {
            return await Model.find(query).limit(pageSize);
        } catch (e) {
            console.log("Error", e);
        }
    },


}