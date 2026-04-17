'use strict';

const mongoose = require('mongoose');
var Sys = require('../../Boot/Sys');
const patternModel = mongoose.model('pattern');
module.exports = {

    getByData: async function(data) {
        try {
            return await patternModel.find(data).sort({ count: 1 });
        } catch (e) {
            console.log(" Error in getByData", e);
            return new Error(e);
        }
    }, //.sort({_id:-1}).limit(1);

    updateManyData: async function(condition, data) {
        try {
            console.log("condition", condition, "data", data);
            let check = await patternModel.updateMany(condition, data, { multi: true }); //.updateMany(condition, data);
            console.log("check", check);
            return check;
        } catch (e) {
            console.log(" Error in updateData", e);
            return new Error(e);
        }
    },

    getByDataLastData: async function(data) {
        try {
            return await patternModel.find(data).sort({ count: -1 }).limit(1);
        } catch (e) {
            console.log(" Error in getByData", e);
            return new Error(e);
        }
    }, //.sort({_id:-1}).limit(1);

    getSelectedGamePatternCount: async function(data) {
        try {
            return await patternModel.find(data).countDocuments();
        } catch (e) {
            console.log("Error", e);
        }
    },

    patternFindAll: async function(data) {
        try {
            return await patternModel.find(data).lean();
        } catch (e) {
            console.log("Error", e);
        }
    },

    getGamePatternDatatable: async function(query, length, start, sort) {
        try {
            return await patternModel.find(query).skip(start).limit(length).sort(sort).lean();
        } catch (e) {
            console.log("Error", e);
        }
    },

    getCount: async function(data) {
        try {
            //return  await gameModel.countDocuments(data);
            return await patternModel.countDocuments(data);
        } catch (e) {
            console.log("Error", e);
        }
    },

    getSingleGamePatternData: async function(data, column) {
        try {
            return await patternModel.findOne(data).select(column).lean();
        } catch (e) {
            console.log("Error", e);
        }
    },

    getByIdPattern: async function(id) {
        try {
            return await patternModel.findById(id);
        } catch (error) {
            console.log('getByIdPattern Error in getById : ', error);
        }
    },

    updateOneGamePattern: async function(condition, data) {
        try {
            return await patternModel.updateOne(condition, data);
        } catch (e) {
            console.log("Error", e);
        }
    },
    insertGamePatternData: async function(data) {
        try {
            return await patternModel.create(data);
        } catch (e) {
            console.log("Error insertGameTwoData", e);
        }
    },
    deleteGamePattern: async function(data) {
        try {
            return await patternModel.deleteOne({ _id: data });
        } catch (e) {
            console.log("Error", e);
        }
    },

    getGamePatternData: async function(data, column) {
        try {
            return await patternModel.find(data).select(column).lean();
        } catch (e) {
            console.log("Error", e);
        }
    },

    insertManyData: async function (data, options) {
        try {
            return await patternModel.insertMany(data, options);
        } catch (e) {
            console.log("Error insertManyData");
        }
    },

    getPatternsByData: async function (data, select, setOption) {
        try {
            return await patternModel.find(data, select, setOption).lean(); //.collation({ locale: "en_US", numericOrdering: true });  // setOption(sort, limit,skip)
        } catch (e) {
            //console.log("Error",e);
            throw new Error('error in getTicketsByData' + e.message);
        }
    },

}